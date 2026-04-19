from __future__ import annotations

import datetime
import hashlib
import math
import os
import time
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from arduino.app_bricks.telegram_bot import Message, Sender  # pyright: ignore[reportMissingImports]

try:
    import psutil
except Exception:
    psutil = None

try:
    import resend
except Exception:
    resend = None

try:
    import requests
except Exception:
    requests = None

try:
    import certifi
except Exception:
    certifi = None

try:
    from arduino.app_bricks.telegram_bot import TelegramBot  # pyright: ignore[reportMissingImports]
    _telegram_import_error = ""
except Exception as exc:
    TelegramBot = None
    _telegram_import_error = str(exc)

from arduino.app_bricks.dbstorage_tsstore import TimeSeriesStore  # pyright: ignore[reportMissingImports]
from arduino.app_bricks.web_ui import WebUI  # pyright: ignore[reportMissingImports]
from arduino.app_utils import App, Bridge  # pyright: ignore[reportMissingImports]

import json
from alerts import AlertManager
from config import (
    ALERT_RECIPIENTS,
    APP_TEST_MODE,
    DISCORD_WEBHOOK_URL,
    MIN_TAKE_READING_GAP_S,
    OPENROUTER_API_KEY,
    OPENROUTER_MODEL,
    READING_CAPTURE_ENABLED_DEFAULT,
    RESEND_API_KEY,
    RESEND_FROM,
    SENSOR_CALIBRATION_S,
    TELEGRAM_BOT_ENABLED,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CA_BUNDLE,
    TELEGRAM_ENABLE_BUILTIN_WELCOME,
    TELEGRAM_WHITELIST_USER_IDS,
)
from domain import STATUS_LABEL, VALID_LOCATIONS, compute_status
try:
    from reading_store import ReadingPayload, ReadingStore
    _reading_store_import_error = ""
except Exception as exc:
    ReadingPayload = None
    ReadingStore = None
    _reading_store_import_error = str(exc)
from repository import latest_all, latest_for_location, read_samples


current_location = "panama"
reading_in_progress = False
reading_requested_at_ms = 0
READING_TIMEOUT_MS = 15000
capture_enabled = READING_CAPTURE_ENABLED_DEFAULT
last_take_reading_by_location_ms = {key: 0 for key in VALID_LOCATIONS}
preview_by_location: dict[str, dict[str, Any]] = {}
location_calibration_started_ms = {
    key: int(datetime.datetime.now().timestamp() * 1000) for key in VALID_LOCATIONS
}

db = TimeSeriesStore()
ui = WebUI()
alerts = AlertManager()
telegram_bot = None
telegram_pending_chat_ids: set[int] = set()
telegram_known_chat_ids: set[int] = set(int(item) for item in TELEGRAM_WHITELIST_USER_IDS)
reading_store = None
reading_store_start_error = _reading_store_import_error
if ReadingStore is None:
    print(
        "[Almacenamiento] ReadingStore no disponible, se continúa en modo degradado: "
        f"{reading_store_start_error}"
    )
else:
    try:
        reading_store = ReadingStore()
        reading_store.start()
        print(f"[Almacenamiento] modo={reading_store.mode()}")
    except Exception as exc:
        reading_store = None
        reading_store_start_error = str(exc)
        print(f"[Almacenamiento] Error de inicialización, se continúa en modo degradado: {exc}")


def _storage_mode() -> str:
    if reading_store is None:
        return "disabled"
    try:
        return reading_store.mode()
    except Exception as exc:
        print(f"[Almacenamiento] Error consultando modo: {exc}")
        return "degraded"


def _storage_is_available() -> bool:
    return reading_store is not None


def on_get_samples(resource: str, start: str, aggr_window: str):
    return read_samples(db, resource, start, aggr_window)


def on_get_latest_all():
    return latest_all(db)


def on_set_location(loc: str):
    global current_location
    if loc not in VALID_LOCATIONS:
        return {"ok": False, "error": f"Ubicación inválida: {loc}"}

    current_location = loc
    location_calibration_started_ms[loc] = int(datetime.datetime.now().timestamp() * 1000)
    print(f"Ubicación activa: {loc}")
    seconds_left = _seconds_until_calibrated(loc)
    ui.send_message(
        "calibration_state_update",
        {
            "location": loc,
            "name": VALID_LOCATIONS[loc]["name"],
            "seconds_left": seconds_left,
            "ready": seconds_left == 0,
        },
    )
    preview_payload = preview_by_location.get(loc)
    if preview_payload:
        ui.send_message("preview_update", preview_payload)
    return {
        "ok": True,
        "location": loc,
        "name": VALID_LOCATIONS[loc]["name"],
        "calibration_seconds_left": seconds_left,
    }


def _seconds_until_calibrated(loc: str) -> int:
    started_ms = location_calibration_started_ms.get(loc, 0)
    if SENSOR_CALIBRATION_S <= 0:
        return 0
    elapsed_ms = max(0, int(datetime.datetime.now().timestamp() * 1000) - started_ms)
    remain_ms = max(0, SENSOR_CALIBRATION_S * 1000 - elapsed_ms)
    return int((remain_ms + 999) // 1000)


def _to_valid_float(value: float | None, minimum: float, maximum: float) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except Exception:
        return None
    if not math.isfinite(parsed):
        return None
    if parsed < minimum or parsed > maximum:
        return None
    return parsed


def _normalize_optional_placeholder(value: float | None) -> float | None:
    """Convierte sentinelas de firmware (-1) en None para evitar persistencias falsas."""
    if value is None:
        return None
    try:
        parsed = float(value)
    except Exception:
        return value
    if abs(parsed + 1.0) < 1e-6:
        return None
    return parsed


def _set_reading_state(in_progress: bool):
    global reading_in_progress, reading_requested_at_ms
    reading_in_progress = in_progress
    reading_requested_at_ms = int(datetime.datetime.now().timestamp() * 1000) if in_progress else 0
    ui.send_message(
        "reading_state_update",
        {
            "in_progress": reading_in_progress,
            "location": current_location,
            "requested_at": reading_requested_at_ms if reading_in_progress else None,
        },
    )


def _sync_board_preview_state():
    try:
        Bridge.call("set_preview_enabled", bool(capture_enabled))
    except Exception:
        # Compatibilidad: firmware antiguos no exponen este proveedor.
        pass


def _emit_capture_state(client=None):
    ui.send_message(
        "capture_state_update",
        {
            "enabled": bool(capture_enabled),
            "location": current_location,
        },
        client,
    )


def _parse_capture_state(raw_state: str) -> bool | None:
    state = (raw_state or "").strip().lower()
    if state in {"1", "true", "on", "enable", "enabled", "resume", "start"}:
        return True
    if state in {"0", "false", "off", "disable", "disabled", "pause", "stop"}:
        return False
    return None


def on_set_capture_enabled(state: str):
    global capture_enabled
    parsed = _parse_capture_state(state)
    if parsed is None:
        return {
            "ok": False,
            "error": "Estado inválido. Usa on/off, true/false, pause/resume.",
        }

    capture_enabled = bool(parsed)
    if not capture_enabled:
        _set_reading_state(False)
        try:
            Bridge.call("set_led_state", False)
        except Exception:
            pass

    _sync_board_preview_state()
    _emit_capture_state()

    action = "reanudada" if capture_enabled else "pausada"
    print(f"[Capture] Toma de lectura {action}")
    return {
        "ok": True,
        "enabled": capture_enabled,
        "message": f"Captura {action}.",
    }


def _request_board_reading() -> dict[str, Any]:
    if not capture_enabled:
        return {"ok": False, "error": "La captura está en pausa. Reanuda para tomar lecturas."}

    if reading_in_progress:
        return {"ok": False, "error": "Lectura en progreso, espere..."}

    now_ms = int(datetime.datetime.now().timestamp() * 1000)
    min_gap_ms = max(0, int(MIN_TAKE_READING_GAP_S)) * 1000
    if min_gap_ms > 0:
        last_request_ms = int(last_take_reading_by_location_ms.get(current_location, 0))
        elapsed_ms = now_ms - last_request_ms
        if last_request_ms > 0 and elapsed_ms < min_gap_ms:
            retry_after_s = int((min_gap_ms - elapsed_ms + 999) // 1000)
            return {
                "ok": False,
                "error": f"Lectura muy frecuente. Espera {retry_after_s}s para evitar ruido y saturación.",
                "retry_after_s": retry_after_s,
            }

    seconds_left = _seconds_until_calibrated(current_location)
    if (not APP_TEST_MODE) and seconds_left > 0:
        ui.send_message(
            "calibration_state_update",
            {
                "location": current_location,
                "name": VALID_LOCATIONS[current_location]["name"],
                "seconds_left": seconds_left,
                "ready": False,
            },
        )
        return {
            "ok": False,
            "error": f"Sensores calibrando. Espera {seconds_left}s antes de guardar.",
            "calibration_seconds_left": seconds_left,
        }

    _set_reading_state(True)
    print(f"Solicitando lectura — ubicación: {current_location}")

    try:
        Bridge.call("set_led_state", True)
    except Exception:
        # Proveedor opcional en el sketch; ignorar si no está disponible.
        pass

    try:
        Bridge.call("take_reading")
    except Exception as exc:
        try:
            Bridge.call("set_led_state", False)
        except Exception:
            pass
        _set_reading_state(False)
        return {"ok": False, "error": str(exc)}

    last_take_reading_by_location_ms[current_location] = now_ms
    return {"ok": True, "location": current_location}


def on_take_reading():
    return _request_board_reading()


def on_autosave_preview_on_exit(**kwargs):
    if APP_TEST_MODE:
        return {"ok": False, "saved": False, "error": "Autosave omitido en modo prueba."}

    if not capture_enabled:
        return {"ok": False, "saved": False, "error": "Captura ya detenida."}

    requested_loc = str(kwargs.get("location") or current_location).strip().lower()
    if requested_loc in VALID_LOCATIONS and requested_loc != current_location:
        on_set_location(requested_loc)

    ph = _to_valid_float(kwargs.get("ph"), 0.0, 14.0)
    ntu = _to_valid_float(kwargs.get("ntu"), 0.0, 1000.0)
    tds = _to_valid_float(kwargs.get("tds"), 0.0, 3000.0)
    temp_c = _to_valid_float(_normalize_optional_placeholder(kwargs.get("temp_c", kwargs.get("tempC"))), -10.0, 80.0)
    humidity = _to_valid_float(_normalize_optional_placeholder(kwargs.get("humidity")), 0.0, 100.0)

    if ph is None or ntu is None:
        return {
            "ok": False,
            "saved": False,
            "error": "Preview incompleto para autosave (pH/NTU inválidos).",
        }

    preview_ts_raw = kwargs.get("ts")
    if preview_ts_raw is not None:
        try:
            preview_ts_ms = int(float(preview_ts_raw))
            if 0 < preview_ts_ms < 10_000_000_000:
                preview_ts_ms *= 1000

            now_ms = int(datetime.datetime.now().timestamp() * 1000)
            # Evita guardar previews demasiado viejos al salir.
            if abs(now_ms - preview_ts_ms) > 10 * 60 * 1000:
                return {
                    "ok": False,
                    "saved": False,
                    "error": "Preview en vivo desactualizado; autosave omitido.",
                }
        except Exception:
            # Si no viene timestamp válido, se continúa con el autosave.
            pass

    receive_reading(ph=ph, ntu=ntu, tds=tds, temp_c=temp_c, humidity=humidity)
    pause_result = on_set_capture_enabled("off")

    return {
        "ok": True,
        "saved": True,
        "autosaved": True,
        "capture_stopped": bool(isinstance(pause_result, dict) and pause_result.get("enabled") is False),
    }


def _telegram_sender_chat_id(sender: Sender) -> int | None:
    chat_id = getattr(sender, "chat_id", None)
    if chat_id is None:
        return None
    try:
        parsed_chat_id = int(chat_id)
        telegram_known_chat_ids.add(parsed_chat_id)
        return parsed_chat_id
    except Exception:
        return None


def _telegram_command_args(message: Message) -> list[str]:
    raw = str(getattr(message, "text", "") or "").strip()
    if not raw:
        return []
    parts = raw.split()
    return parts[1:] if len(parts) > 1 else []


def _telegram_locations_help() -> str:
    lines = ["Ubicaciones disponibles:"]
    for loc_key, loc_data in VALID_LOCATIONS.items():
        lines.append(f"- {loc_key}: {loc_data['name']}")
    return "\n".join(lines)


def _telegram_resolve_location(raw: str | None) -> str | None:
    token = (raw or "").strip().lower()
    if not token:
        return None

    normalized = token.replace(" ", "_")
    if normalized in VALID_LOCATIONS:
        return normalized

    for loc_key, loc_data in VALID_LOCATIONS.items():
        name_norm = str(loc_data.get("name", "")).strip().lower().replace(" ", "_")
        if normalized == name_norm:
            return loc_key
    return None


def _telegram_build_status_text(loc_key: str) -> str:
    latest = latest_for_location(db, loc_key)
    status_code = latest.get("status")
    status_label = STATUS_LABEL.get(status_code, "Sin datos") if status_code is not None else "Sin datos"
    location_name = latest.get("name") or VALID_LOCATIONS[loc_key]["name"]
    reading_state = "en progreso" if (reading_in_progress and loc_key == current_location) else "sin lectura activa"
    capture_state = "activa" if capture_enabled else "pausada"
    calibration_left = _seconds_until_calibrated(loc_key)

    return (
        f"Estado HydroLabs ({location_name})\n"
        f"- pH: {_format_chat_number(latest.get('ph'), 2)}\n"
        f"- Turbidez (NTU): {_format_chat_number(latest.get('ntu'), 1)}\n"
        f"- TDS (ppm): {_format_chat_number(latest.get('tds'), 0)}\n"
        f"- Estado: {status_label}\n"
        f"- Captura: {capture_state}\n"
        f"- Lectura: {reading_state}\n"
        f"- Calibracion restante: {calibration_left}s"
    )


def _telegram_notify_pending(text: str):
    if telegram_bot is None or not telegram_pending_chat_ids:
        return

    pending_ids = list(telegram_pending_chat_ids)
    telegram_pending_chat_ids.clear()
    for chat_id in pending_ids:
        try:
            telegram_bot.send_message(chat_id, text)
        except Exception as exc:
            print(f"[Telegram] Error enviando notificacion a chat_id={chat_id}: {exc}")


def _telegram_target_chat_ids(requested_chat_id: Any = None) -> list[int]:
    targets: set[int] = set()

    if requested_chat_id is not None:
        try:
            parsed = int(requested_chat_id)
            if parsed != 0:
                targets.add(parsed)
        except Exception:
            pass

    if not targets:
        for chat_id in TELEGRAM_WHITELIST_USER_IDS:
            try:
                parsed = int(chat_id)
                if parsed != 0:
                    targets.add(parsed)
            except Exception:
                continue

        for chat_id in telegram_known_chat_ids:
            if chat_id != 0:
                targets.add(int(chat_id))

    return sorted(targets)


def _send_telegram_test_alert(loc: str, ph: float, ntu: float, tds: float, status: int, requested_chat_id: Any = None):
    if telegram_bot is None:
        return {
            "ok": False,
            "error": "Bot de Telegram no inicializado. Revisa TELEGRAM_BOT_TOKEN y TELEGRAM_CA_BUNDLE.",
        }

    target_chat_ids = _telegram_target_chat_ids(requested_chat_id)
    if not target_chat_ids:
        return {
            "ok": False,
            "error": (
                "No hay chat_id destino para Telegram. "
                "Configura TELEGRAM_WHITELIST_USER_IDS, envía telegram_chat_id en la solicitud, "
                "o escribe /hello al bot para registrar el chat actual."
            ),
        }

    message = (
        "Prueba de alerta HydroLabs\n"
        f"Ubicacion: {VALID_LOCATIONS[loc]['name']}\n"
        f"Estado: {STATUS_LABEL.get(status, 'Sin datos')}\n"
        f"pH: {ph:.2f}\n"
        f"Turbidez: {ntu:.1f} NTU\n"
        f"TDS: {tds:.0f} ppm"
    )

    sent_chat_ids: list[int] = []
    failed_chat_ids: dict[str, str] = {}
    for chat_id in target_chat_ids:
        try:
            telegram_bot.send_message(chat_id, message)
            sent_chat_ids.append(chat_id)
        except Exception as exc:
            failed_chat_ids[str(chat_id)] = str(exc)

    return {
        "ok": len(sent_chat_ids) > 0,
        "sent_chat_ids": sent_chat_ids,
        "failed_chat_ids": failed_chat_ids,
        "error": None if sent_chat_ids else "No se pudo entregar el mensaje Telegram a los chats destino.",
    }


def telegram_hello(sender: Sender, message: Message):
    sender.reply(f"Hola {sender.first_name}. Soy HydroLabs Bot para el medidor de pH/TDS/NTU.")


def telegram_help_cmd(sender: Sender, message: Message):
    sender.reply(
        "Comandos disponibles:\n"
        "/hello - Saludo\n"
        "/help - Mostrar esta ayuda\n"
        "/estado [ubicacion] - Ver ultima lectura\n"
        "/ubicaciones - Listar ubicaciones validas\n"
        "/ubicacion <clave> - Cambiar ubicacion activa\n"
        "/tomar [ubicacion] - Solicitar lectura al Arduino\n"
        "/captura <on|off> - Reanudar o pausar captura"
    )


def telegram_locations_cmd(sender: Sender, message: Message):
    sender.reply(_telegram_locations_help())


def telegram_status_cmd(sender: Sender, message: Message):
    args = _telegram_command_args(message)
    loc_key = current_location
    if args:
        parsed = _telegram_resolve_location(args[0])
        if parsed is None:
            sender.reply(f"Ubicacion invalida: {args[0]}\n\n{_telegram_locations_help()}")
            return
        loc_key = parsed

    sender.reply(_telegram_build_status_text(loc_key))


def telegram_set_location_cmd(sender: Sender, message: Message):
    args = _telegram_command_args(message)
    if not args:
        sender.reply(f"Uso: /ubicacion <clave>\n\n{_telegram_locations_help()}")
        return

    loc_key = _telegram_resolve_location(args[0])
    if loc_key is None:
        sender.reply(f"Ubicacion invalida: {args[0]}\n\n{_telegram_locations_help()}")
        return

    result = on_set_location(loc_key)
    if not result.get("ok"):
        sender.reply(f"No se pudo cambiar ubicacion: {result.get('error', 'error desconocido')}")
        return

    sender.reply(
        f"Ubicacion activa: {result.get('name', loc_key)}\n"
        f"Calibracion restante: {result.get('calibration_seconds_left', 0)}s"
    )


def telegram_take_reading_cmd(sender: Sender, message: Message):
    args = _telegram_command_args(message)
    if args:
        loc_key = _telegram_resolve_location(args[0])
        if loc_key is None:
            sender.reply(f"Ubicacion invalida: {args[0]}\n\n{_telegram_locations_help()}")
            return
        if loc_key != current_location:
            on_set_location(loc_key)

    result = _request_board_reading()
    if not result.get("ok"):
        retry_hint = ""
        if result.get("retry_after_s"):
            retry_hint = f" Reintenta en {result.get('retry_after_s')}s."
        sender.reply(f"No se pudo tomar lectura: {result.get('error', 'error desconocido')}.{retry_hint}")
        return

    chat_id = _telegram_sender_chat_id(sender)
    if chat_id is not None:
        telegram_pending_chat_ids.add(chat_id)

    sender.reply(
        f"Lectura solicitada para {VALID_LOCATIONS[current_location]['name']}. "
        "Te envio el resultado cuando llegue desde el Arduino."
    )


def telegram_capture_cmd(sender: Sender, message: Message):
    args = _telegram_command_args(message)
    if not args:
        sender.reply(
            f"Estado actual de captura: {'activa' if capture_enabled else 'pausada'}.\n"
            "Uso: /captura <on|off>"
        )
        return

    result = on_set_capture_enabled(args[0])
    if not result.get("ok"):
        sender.reply(f"No se pudo cambiar captura: {result.get('error', 'error desconocido')}")
        return

    sender.reply(f"Captura {'activa' if result.get('enabled') else 'pausada'}.")


def telegram_text_fallback(sender: Sender, message: Message):
    text = str(getattr(message, "text", "") or "").strip().lower()
    if not text:
        sender.reply("No recibi texto. Usa /help para ver comandos.")
        return

    if "estado" in text:
        telegram_status_cmd(sender, message)
        return

    if "tomar" in text or "lectura" in text:
        telegram_take_reading_cmd(sender, message)
        return

    sender.reply("No reconozco ese mensaje. Usa /help para ver comandos del medidor de agua.")


def _looks_like_telegram_token(token: str) -> bool:
    raw = (token or "").strip()
    if not raw:
        return False

    lowered = raw.lower()
    if lowered in {
        "111",
        "change_me",
        "changeme",
        "your_telegram_bot_token",
        "telegram_bot_token",
        "placeholder",
    }:
        return False

    if ":" not in raw:
        return False

    bot_id, secret = raw.split(":", 1)
    if not bot_id.isdigit():
        return False

    if len(secret) < 20:
        return False

    for char in secret:
        if not (char.isalnum() or char in {"-", "_"}):
            return False

    return True


def _is_tls_certificate_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "certificate verify failed" in message
        or "certificateverifyfailed" in message
        or ("ssl" in message and "certificate" in message)
    )


def _resolve_telegram_ca_bundle() -> str | None:
    configured = (TELEGRAM_CA_BUNDLE or "").strip()
    if configured:
        if os.path.isfile(configured):
            return configured
        print(f"[Telegram] TELEGRAM_CA_BUNDLE no existe o no es archivo: {configured!r}")

    env_bundle = (os.environ.get("SSL_CERT_FILE") or "").strip()
    if env_bundle and os.path.isfile(env_bundle):
        return env_bundle

    if certifi is not None:
        try:
            certifi_bundle = str(certifi.where() or "").strip()
        except Exception:
            certifi_bundle = ""
        if certifi_bundle and os.path.isfile(certifi_bundle):
            return certifi_bundle

    return None


def _prepare_telegram_tls() -> str | None:
    ca_bundle = _resolve_telegram_ca_bundle()
    if not ca_bundle:
        print("[Telegram] CA bundle no detectado; se usara trust store por defecto del runtime.")
        return None

    os.environ["SSL_CERT_FILE"] = ca_bundle
    os.environ["REQUESTS_CA_BUNDLE"] = ca_bundle
    os.environ["CURL_CA_BUNDLE"] = ca_bundle
    print(f"[Telegram] TLS configurado con CA bundle: {ca_bundle}")
    return ca_bundle


def _telegram_tls_preflight(ca_bundle: str | None) -> bool:
    if requests is None:
        # Sin requests no se puede hacer preflight; se intenta iniciar el brick igualmente.
        return True

    verify_value: bool | str = ca_bundle if ca_bundle else True
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getMe"

    try:
        response = requests.get(url, timeout=8, verify=verify_value)
    except Exception as exc:
        if _is_tls_certificate_error(exc):
            print(
                "[Telegram] Error TLS al contactar api.telegram.org. "
                "Configura TELEGRAM_CA_BUNDLE con la ruta de tu CA corporativa o del certificado raiz."
            )
            return False
        print(f"[Telegram] Advertencia en preflight de red ({exc}); se intentara iniciar el bot igualmente.")
        return True

    if response.status_code == 401:
        print("[Telegram] Token no autorizado (HTTP 401) en preflight getMe; bot deshabilitado.")
        return False

    if response.status_code >= 500:
        print(
            f"[Telegram] api.telegram.org respondio HTTP {response.status_code} en preflight; "
            "se intentara iniciar el bot igualmente."
        )

    return True


def _looks_like_placeholder(secret: str | None) -> bool:
    token = (secret or "").strip().lower()
    if not token:
        return False

    known_placeholders = {
        "change_me",
        "changeme",
        "placeholder",
        "your_key",
        "your_api_key",
        "your_openrouter_api_key",
        "openrouter_api_key",
        "your_resend_api_key",
        "resend_api_key",
        "your_discord_webhook_url",
        "discord_webhook_url",
        "your_email@example.com",
        "example@example.com",
        "none",
        "null",
        "xxx",
        "123",
    }

    if token in known_placeholders:
        return True

    return (
        "replace" in token
        or "placeholder" in token
        or token.startswith("your_")
        or token.endswith("_here")
    )


def _extract_email_address(address: str | None) -> str:
    raw = (address or "").strip()
    if not raw:
        return ""

    if "<" in raw and ">" in raw:
        lt = raw.rfind("<")
        gt = raw.rfind(">")
        if 0 <= lt < gt:
            candidate = raw[lt + 1 : gt].strip()
            if candidate:
                return candidate

    return raw


def _looks_like_email(address: str | None) -> bool:
    raw = _extract_email_address(address)
    if not raw or _looks_like_placeholder(raw):
        return False
    if raw.count("@") != 1:
        return False
    if any(char.isspace() for char in raw):
        return False
    local, domain = raw.split("@", 1)
    if not local or not domain or "." not in domain:
        return False
    if domain.startswith(".") or domain.endswith("."):
        return False
    return True


def _is_valid_discord_webhook(url: str | None) -> bool:
    raw = (url or "").strip()
    if not raw or _looks_like_placeholder(raw):
        return False

    lowered = raw.lower()
    return lowered.startswith("https://discord.com/api/webhooks/") or lowered.startswith(
        "https://discordapp.com/api/webhooks/"
    )


def _is_valid_resend_key(api_key: str | None) -> bool:
    raw = (api_key or "").strip()
    if not raw or _looks_like_placeholder(raw):
        return False
    return raw.startswith("re_") and len(raw) >= 10


def _is_valid_openrouter_key(api_key: str | None) -> bool:
    raw = (api_key or "").strip()
    if not raw or _looks_like_placeholder(raw):
        return False
    return raw.startswith("sk-or-") and len(raw) >= 16


def _has_valid_alert_recipients() -> bool:
    if not ALERT_RECIPIENTS:
        return False
    return all(_looks_like_email(item) for item in ALERT_RECIPIENTS)


def _is_resend_report_configured() -> bool:
    return _is_valid_resend_key(RESEND_API_KEY) and _looks_like_email(RESEND_FROM)


def _is_email_alert_configured() -> bool:
    return _is_resend_report_configured() and _has_valid_alert_recipients()


def _is_discord_alert_configured() -> bool:
    return _is_valid_discord_webhook(DISCORD_WEBHOOK_URL)


def _parse_limit(raw_limit: str, default: int, minimum: int = 1, maximum: int = 200) -> int:
    try:
        parsed = int(raw_limit)
    except Exception:
        parsed = default
    return max(minimum, min(parsed, maximum))


def _fallback_recent_rows_for_location(loc: str) -> list[dict[str, Any]]:
    latest = latest_for_location(db, loc)
    has_any_value = any(
        latest.get(key) is not None for key in ("ph", "ntu", "tds", "tempC", "humidity", "status", "ts")
    )
    if not has_any_value:
        return []

    return [
        {
            "id": None,
            "ts": latest.get("ts"),
            "status": latest.get("status"),
            "ph": latest.get("ph"),
            "ntu": latest.get("ntu"),
            "tds": latest.get("tds"),
            "tempC": latest.get("tempC"),
            "humidity": latest.get("humidity"),
        }
    ]


def _normalize_recent_row(loc: str, row: dict[str, Any], source: str) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "location": loc,
        "name": VALID_LOCATIONS[loc]["name"],
        "ts": row.get("ts"),
        "status": row.get("status"),
        "ph": row.get("ph"),
        "ntu": row.get("ntu"),
        "tds": row.get("tds"),
        "tempC": row.get("tempC"),
        "humidity": row.get("humidity"),
        "source": source,
    }


def _init_telegram_bot():
    global telegram_bot

    if not TELEGRAM_BOT_ENABLED:
        print("[Telegram] Bot deshabilitado por TELEGRAM_BOT_ENABLED.")
        return
    if not TELEGRAM_BOT_TOKEN:
        print("[Telegram] TELEGRAM_BOT_TOKEN no configurado; bot deshabilitado.")
        return
    if not _looks_like_telegram_token(TELEGRAM_BOT_TOKEN):
        print(
            "[Telegram] TELEGRAM_BOT_TOKEN invalido o placeholder; "
            "bot deshabilitado hasta configurar un token real de BotFather."
        )
        return
    if TelegramBot is None:
        print(f"[Telegram] Brick no disponible: {_telegram_import_error}")
        return

    ca_bundle = _prepare_telegram_tls()
    if not _telegram_tls_preflight(ca_bundle):
        print("[Telegram] Bot deshabilitado por fallo de conectividad TLS.")
        return

    try:
        init_kwargs = {
            "token": TELEGRAM_BOT_TOKEN,
            "enable_builtin_welcome": TELEGRAM_ENABLE_BUILTIN_WELCOME,
        }
        if TELEGRAM_WHITELIST_USER_IDS:
            init_kwargs["whitelist_user_ids"] = TELEGRAM_WHITELIST_USER_IDS

        telegram_bot = TelegramBot(**init_kwargs)
        telegram_bot.add_command("hello", telegram_hello, "Saludo de HydroLabs")
        telegram_bot.add_command("help", telegram_help_cmd, "Mostrar comandos")
        telegram_bot.add_command("estado", telegram_status_cmd, "Ver ultima lectura")
        telegram_bot.add_command("ubicaciones", telegram_locations_cmd, "Listar ubicaciones")
        telegram_bot.add_command("ubicacion", telegram_set_location_cmd, "Cambiar ubicacion activa")
        telegram_bot.add_command("tomar", telegram_take_reading_cmd, "Solicitar lectura al Arduino")
        telegram_bot.add_command("captura", telegram_capture_cmd, "Pausar/reanudar captura")
        telegram_bot.on_text(telegram_text_fallback)

        print("[Telegram] Bot inicializado para control del medidor de agua.")
    except Exception as exc:
        telegram_bot = None
        print(f"[Telegram] Error inicializando bot: {exc}")


def on_get_recent_readings(loc: str, limit: str):
    if loc not in VALID_LOCATIONS:
        return {"ok": False, "error": f"Ubicación inválida: {loc}"}
    parsed_limit = _parse_limit(limit, default=50, maximum=200)

    if not _storage_is_available():
        rows = _fallback_recent_rows_for_location(loc)
        return {
            "ok": True,
            "rows": rows,
            "source": "timeseries_fallback",
            "warning": "Almacenamiento 3NF no disponible; mostrando última lectura persistida en series temporales.",
            "detail": reading_store_start_error,
        }

    try:
        rows = reading_store.list_recent(loc, limit=parsed_limit)
        return {"ok": True, "rows": rows, "source": "3nf"}
    except Exception as exc:
        rows = _fallback_recent_rows_for_location(loc)
        return {
            "ok": True,
            "rows": rows,
            "source": "timeseries_fallback",
            "warning": "Error consultando almacenamiento 3NF; se muestra respaldo desde series temporales.",
            "detail": str(exc),
        }


def on_get_latest_persisted(limit: str):
    parsed_limit = _parse_limit(limit, default=len(VALID_LOCATIONS), maximum=max(32, len(VALID_LOCATIONS)))
    rows: list[dict[str, Any]] = []
    source = "3nf"
    warning = None
    detail = None

    if _storage_is_available():
        try:
            for loc_key in VALID_LOCATIONS:
                recent_rows = reading_store.list_recent(loc_key, limit=1)
                if not recent_rows:
                    continue
                rows.append(_normalize_recent_row(loc_key, recent_rows[0], "3nf"))
        except Exception as exc:
            source = "timeseries_fallback"
            warning = "Error consultando almacenamiento 3NF; se muestra respaldo desde series temporales."
            detail = str(exc)
            rows = []
    else:
        source = "timeseries_fallback"
        warning = "Almacenamiento 3NF no disponible; mostrando respaldo desde series temporales."
        detail = reading_store_start_error

    if source == "timeseries_fallback":
        for loc_key in VALID_LOCATIONS:
            fallback_rows = _fallback_recent_rows_for_location(loc_key)
            if not fallback_rows:
                continue
            rows.append(_normalize_recent_row(loc_key, fallback_rows[0], "timeseries_fallback"))

    rows.sort(key=lambda row: int(row.get("ts") or 0), reverse=True)
    generated_at_ms = int(datetime.datetime.now().timestamp() * 1000)
    return {
        "ok": True,
        "rows": rows[:parsed_limit],
        "source": source,
        "warning": warning,
        "detail": detail,
        "mode": _storage_mode(),
        "storage_ready": _storage_is_available(),
        "generated_at_ms": generated_at_ms,
    }


def _to_iso_utc_from_ms(ts_ms: int | None) -> str | None:
    if ts_ms is None:
        return None
    try:
        return datetime.datetime.fromtimestamp(float(ts_ms) / 1000.0, tz=datetime.timezone.utc).isoformat()
    except Exception:
        return None


def _to_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _export_row(loc_key: str, loc_name: str, row: dict[str, Any]) -> dict[str, Any]:
    ts_ms = row.get("ts")
    status_raw = row.get("status")
    status_code = None
    if status_raw is not None:
        try:
            status_code = int(status_raw)
        except Exception:
            status_code = None

    return {
        "id": row.get("id"),
        "location_key": loc_key,
        "location_name": loc_name,
        "lat": VALID_LOCATIONS[loc_key]["lat"],
        "lon": VALID_LOCATIONS[loc_key]["lon"],
        "ts_ms": ts_ms,
        "ts_iso_utc": _to_iso_utc_from_ms(ts_ms),
        "status": status_code,
        "status_label": STATUS_LABEL.get(status_code, "Sin datos") if status_code is not None else "Sin datos",
        "ph": _to_number(row.get("ph")),
        "ntu": _to_number(row.get("ntu")),
        "tds": _to_number(row.get("tds")),
        "tempC": _to_number(row.get("tempC")),
        "humidity": _to_number(row.get("humidity")),
    }


def on_export_readings_json(loc: str, limit: str):
    if not _storage_is_available():
        return {
            "ok": False,
            "error": "Almacenamiento no disponible en runtime.",
            "detail": reading_store_start_error,
        }

    scope = (loc or "all").strip().lower()

    if scope != "all" and scope not in VALID_LOCATIONS:
        return {"ok": False, "error": f"Ubicación inválida para exportación: {scope}"}

    try:
        parsed_limit = int(limit)
    except Exception:
        parsed_limit = 500

    parsed_limit = max(1, min(parsed_limit, 5000))
    locations = list(VALID_LOCATIONS.keys()) if scope == "all" else [scope]

    rows: list[dict[str, Any]] = []
    for loc_key in locations:
        loc_name = VALID_LOCATIONS[loc_key]["name"]
        for row in reading_store.list_recent(loc_key, limit=parsed_limit):
            rows.append(_export_row(loc_key, loc_name, row))

    rows.sort(key=lambda item: ((item.get("ts_ms") or 0), str(item.get("location_key") or "")))

    generated_at_ms = int(datetime.datetime.now().timestamp() * 1000)
    return {
        "ok": True,
        "format": "hydrolabs.readings.v1",
        "scope": scope,
        "limit_per_location": parsed_limit,
        "generated_at_ms": generated_at_ms,
        "generated_at_iso_utc": _to_iso_utc_from_ms(generated_at_ms),
        "row_count": len(rows),
        "columns": [
            "id",
            "location_key",
            "location_name",
            "lat",
            "lon",
            "ts_ms",
            "ts_iso_utc",
            "status",
            "status_label",
            "ph",
            "ntu",
            "tds",
            "tempC",
            "humidity",
        ],
        "rows": rows,
    }


def on_socket_get_reading_state(client, data):
    ui.send_message(
        "reading_state_update",
        {
            "in_progress": reading_in_progress,
            "location": current_location,
            "requested_at": reading_requested_at_ms if reading_in_progress else None,
        },
        client,
    )

    seconds_left = _seconds_until_calibrated(current_location)
    ui.send_message(
        "calibration_state_update",
        {
            "location": current_location,
            "name": VALID_LOCATIONS[current_location]["name"],
            "seconds_left": seconds_left,
            "ready": seconds_left == 0,
        },
        client,
    )

    preview_payload = preview_by_location.get(current_location)
    if preview_payload:
        ui.send_message("preview_update", preview_payload, client)
    _emit_capture_state(client)


def on_socket_take_reading(client, data):
    payload = data if isinstance(data, dict) else {}
    requested_loc = payload.get("location")
    if requested_loc in VALID_LOCATIONS and requested_loc != current_location:
        on_set_location(requested_loc)

    result = _request_board_reading()
    if not result.get("ok"):
        ui.send_message(
            "reading_error",
            {
                "error": result.get("error", "No fue posible tomar lectura"),
                "calibration_seconds_left": result.get("calibration_seconds_left"),
                "retry_after_s": result.get("retry_after_s"),
            },
            client,
        )


def on_runtime_config():
    telegram_targets = _telegram_target_chat_ids()
    return {
        "test_mode": APP_TEST_MODE,
        "storage_mode": _storage_mode(),
        "storage_ready": _storage_is_available(),
        "storage_error": reading_store_start_error or None,
        "chatbot_configured": _is_valid_openrouter_key(OPENROUTER_API_KEY),
        "sensor_calibration_s": SENSOR_CALIBRATION_S,
        "capture_enabled": bool(capture_enabled),
        "min_take_reading_gap_s": max(0, int(MIN_TAKE_READING_GAP_S)),
        "default_location": current_location,
        "notifications": {
            "discord_configured": _is_discord_alert_configured(),
            "email_configured": _is_resend_report_configured(),
            "email_alerts_configured": _is_email_alert_configured(),
            "telegram_configured": telegram_bot is not None,
            "telegram_targets": len(telegram_targets),
        },
    }


def preview_reading(
    ph: float,
    ntu: float,
    tds: float | None = None,
    temp_c: float | None = None,
    humidity: float | None = None,
):
    if not capture_enabled:
        return

    loc = current_location
    timestamp = int(datetime.datetime.now().timestamp() * 1000)
    temp_c = _normalize_optional_placeholder(temp_c)
    humidity = _normalize_optional_placeholder(humidity)

    ph_safe = _to_valid_float(ph, 0.0, 14.0)
    ntu_safe = _to_valid_float(ntu, 0.0, 1000.0)
    tds_safe = _to_valid_float(tds, 0.0, 3000.0)
    temp_safe = _to_valid_float(temp_c, -10.0, 80.0)
    humidity_safe = _to_valid_float(humidity, 0.0, 100.0)

    if ph_safe is None or ntu_safe is None:
        return

    status = compute_status(ph_safe, ntu_safe, tds_safe)
    location_cfg = VALID_LOCATIONS[loc]

    preview_payload = {
        "location": loc,
        "name": location_cfg["name"],
        "ph": round(ph_safe, 2),
        "ntu": round(ntu_safe, 1),
        "tds": round(tds_safe, 0) if tds_safe is not None else None,
        "tempC": round(temp_safe, 1) if temp_safe is not None else None,
        "humidity": round(humidity_safe, 1) if humidity_safe is not None else None,
        "status": status,
        "label": STATUS_LABEL[status],
        "ts": timestamp,
        "preview": True,
    }

    preview_by_location[loc] = preview_payload
    ui.send_message("preview_update", preview_payload)


def receive_reading(
    ph: float,
    ntu: float,
    tds: float | None = None,
    temp_c: float | None = None,
    humidity: float | None = None,
):
    _set_reading_state(False)
    try:
        Bridge.call("set_led_state", False)
    except Exception:
        pass

    if not capture_enabled:
        ui.send_message(
            "reading_error",
            {
                "error": "Lectura descartada: captura en pausa.",
                "location": current_location,
            },
        )
        _telegram_notify_pending("Lectura descartada: la captura esta en pausa.")
        return

    loc = current_location
    timestamp = int(datetime.datetime.now().timestamp() * 1000)

    if ph is None or ntu is None:
        print(f"[receive_reading] Lectura inválida: ph={ph}, ntu={ntu}")
        _telegram_notify_pending("Lectura descartada: valores recibidos incompletos desde el Arduino.")
        return

    # Compatibilidad hacia atrás con payloads de firmware anteriores:
    # receive_reading(ph, ntu, temp_c, humidity)
    if humidity is None and tds is not None and temp_c is not None:
        maybe_temp = _to_valid_float(tds, -10.0, 80.0)
        maybe_humidity = _to_valid_float(temp_c, 0.0, 100.0)
        if maybe_temp is not None and maybe_humidity is not None:
            tds = None
            temp_c = maybe_temp
            humidity = maybe_humidity

    temp_c = _normalize_optional_placeholder(temp_c)
    humidity = _normalize_optional_placeholder(humidity)

    ph = _to_valid_float(ph, 0.0, 14.0)
    ntu = _to_valid_float(ntu, 0.0, 1000.0)
    tds = _to_valid_float(tds, 0.0, 3000.0)
    temp_c = _to_valid_float(temp_c, -10.0, 80.0)
    humidity = _to_valid_float(humidity, 0.0, 100.0)

    if ph is None or ntu is None:
        ui.send_message(
            "reading_error",
            {
                "error": "Lectura descartada: datos fuera de rango útil. Espera calibración y reintenta.",
                "location": loc,
            },
        )
        _telegram_notify_pending(
            "Lectura descartada: datos fuera de rango util. Espera calibracion y vuelve a intentar."
        )
        return

    status = compute_status(ph, ntu, tds)

    db.write_sample(f"ph_{loc}", ph, timestamp)
    db.write_sample(f"ntu_{loc}", ntu, timestamp)
    db.write_sample(f"estado_{loc}", float(status), timestamp)

    if tds is not None:
        db.write_sample(f"tds_{loc}", tds, timestamp)
    if temp_c is not None:
        db.write_sample(f"temp_{loc}", temp_c, timestamp)
    if humidity is not None:
        db.write_sample(f"humidity_{loc}", humidity, timestamp)

    location_cfg = VALID_LOCATIONS[loc]
    storage_report = {
        "saved": False,
        "synced": False,
        "queued": False,
        "queue_pending": None,
        "mode": _storage_mode(),
        "error": None,
    }

    if ReadingPayload is None:
        print(f"[3NF] Lectura no persistida: modelo no disponible ({reading_store_start_error})")
        storage_report["error"] = f"Modelo de lectura no disponible: {reading_store_start_error}"
    else:
        payload = ReadingPayload(
            location_key=loc,
            location_name=location_cfg["name"],
            lat=float(location_cfg["lat"]),
            lon=float(location_cfg["lon"]),
            measured_at_ms=timestamp,
            status=status,
            ph=ph,
            ntu=ntu,
            tds=tds,
            temp_c=temp_c,
            humidity=humidity,
        )

        if _storage_is_available():
            try:
                persisted = reading_store.save(payload)
                local_id = persisted.get("local_id")
                storage_report = {
                    "saved": local_id is not None,
                    "synced": bool(persisted.get("synced")),
                    "queued": bool(persisted.get("queued")),
                    "queue_pending": persisted.get("queue_pending"),
                    "mode": persisted.get("mode") or _storage_mode(),
                    "error": None,
                }
                if local_id is None:
                    storage_report["error"] = "No se obtuvo identificador local de persistencia."
                print(
                    f"[3NF] id_local={persisted.get('local_id')} sincronizado={persisted.get('synced')} "
                    f"en_cola={persisted.get('queued')} pendientes={persisted.get('queue_pending')} modo={persisted.get('mode')}"
                )
            except Exception as exc:
                print(f"[3NF] Error guardando lectura: {exc}")
                storage_report["error"] = str(exc)
        else:
            print(f"[3NF] Lectura no persistida: almacenamiento no disponible ({reading_store_start_error})")
            storage_report["error"] = f"Almacenamiento no disponible: {reading_store_start_error}"

    tds_str = f"{tds:.0f} ppm" if tds is not None else "N/D"
    temp_str = f"{temp_c:.1f} °C" if temp_c is not None else "N/D"
    hum_str = f"{humidity:.1f} %" if humidity is not None else "N/D"
    print(
        f"[receive_reading] {location_cfg['name']} — pH={ph:.2f} NTU={ntu:.1f} "
        f"TDS={tds_str} Temp={temp_str} Hum={hum_str} Estado={STATUS_LABEL[status]}"
    )

    try:
        Bridge.call("set_status", status)
    except Exception as exc:
        print(f"[Bridge] set_status error: {exc}")

    ui.send_message(
        "reading_update",
        {
            "location": loc,
            "name": location_cfg["name"],
            "ph": round(ph, 2),
            "ntu": round(ntu, 1),
            "tds": round(tds, 0) if tds is not None else None,
            "tempC": round(temp_c, 1) if temp_c is not None else None,
            "humidity": round(humidity, 1) if humidity is not None else None,
            "status": status,
            "label": STATUS_LABEL[status],
            "ts": timestamp,
            "preview": False,
            "storage": storage_report,
        },
    )
    _telegram_notify_pending(
        "Lectura completada\n"
        f"Ubicacion: {location_cfg['name']}\n"
        f"pH: {ph:.2f}\n"
        f"Turbidez: {ntu:.1f} NTU\n"
        f"TDS: {tds_str}\n"
        f"Estado: {STATUS_LABEL[status]}"
    )

    if status == 2 and alerts.can_alert(loc):
        alerts.mark_alerted(loc)
        alerts.send_discord_webhook(loc, ph, ntu, temp_c if temp_c is not None else -1.0, humidity if humidity is not None else -1.0, status)
        alerts.send_email(loc, ph, ntu, temp_c if temp_c is not None else -1.0, humidity if humidity is not None else -1.0, status)


def collect_resource_metrics():
    now_ms = int(datetime.datetime.now().timestamp() * 1000)
    if reading_in_progress and reading_requested_at_ms > 0 and (now_ms - reading_requested_at_ms) > READING_TIMEOUT_MS:
        print("[Bridge] Timeout esperando receive_reading")
        _set_reading_state(False)
        try:
            Bridge.call("set_led_state", False)
        except Exception:
            pass
        ui.send_message("reading_error", {"error": "Timeout de lectura: el sketch no respondió a tiempo."})
        _telegram_notify_pending("Timeout de lectura: el sketch no respondio a tiempo.")

    if _storage_is_available():
        try:
            sync_result = reading_store.retry_unsynced(limit=10)
            if sync_result.get("attempted", 0) > 0:
                print(
                    f"[Supabase] reintento intentados={sync_result.get('attempted')} sincronizados={sync_result.get('synced')} "
                    f"pendientes={sync_result.get('pending')}"
                )
        except Exception as exc:
            print(f"[Supabase] Error en reintento: {exc}")

    if psutil is None:
        time.sleep(5)
        return

    ts = int(datetime.datetime.now().timestamp() * 1000)
    try:
        cpu_percent = float(psutil.cpu_percent(interval=1))
        mem_percent = float(psutil.virtual_memory().percent)

        db.write_sample("cpu", cpu_percent, ts)
        db.write_sample("mem", mem_percent, ts)

        ui.send_message("cpu_usage", {"value": round(cpu_percent, 2), "ts": ts})
        ui.send_message("memory_usage", {"value": round(mem_percent, 2), "ts": ts})
    except Exception as exc:
        print(f"[Resources] Error recopilando métricas: {exc}")

    time.sleep(4)


ui.expose_api("GET", "/get_samples/{resource}/{start}/{aggr_window}", on_get_samples)
ui.expose_api("GET", "/get_latest_all", on_get_latest_all)
ui.expose_api("GET", "/get_recent_readings/{loc}/{limit}", on_get_recent_readings)
ui.expose_api("GET", "/get_latest_persisted/{limit}", on_get_latest_persisted)
ui.expose_api("GET", "/export_readings_json/{loc}/{limit}", on_export_readings_json)
ui.expose_api("GET", "/runtime_config", on_runtime_config)
ui.expose_api("POST", "/set_location/{loc}", on_set_location)
ui.expose_api("POST", "/take_reading", on_take_reading)
ui.expose_api("POST", "/autosave_preview_on_exit", on_autosave_preview_on_exit)
ui.expose_api("POST", "/set_capture_enabled/{state}", on_set_capture_enabled)

ui.on_message("get_reading_state", on_socket_get_reading_state)
ui.on_message("take_reading", on_socket_take_reading)


def _format_chat_number(value: Any, decimals: int = 1) -> str:
    if value is None:
        return "N/D"
    try:
        return f"{float(value):.{decimals}f}"
    except Exception:
        return "N/D"


def _build_hydrobot_context() -> str:
    latest = latest_for_location(db, current_location)
    status_code = latest.get("status")
    status_label = STATUS_LABEL.get(status_code, "Sin datos") if status_code is not None else "Sin datos"
    calibration_left = _seconds_until_calibrated(current_location)
    location_name = latest.get("name") or VALID_LOCATIONS.get(current_location, {}).get("name", current_location)

    return (
        f"ubicacion={location_name}; estado={status_label}; "
        f"ph={_format_chat_number(latest.get('ph'), 2)}; "
        f"ntu={_format_chat_number(latest.get('ntu'), 1)}; "
        f"tds={_format_chat_number(latest.get('tds'), 0)} ppm; "
        f"temp_c={_format_chat_number(latest.get('tempC'), 1)}; "
        f"humedad={_format_chat_number(latest.get('humidity'), 1)}%; "
        f"calibracion_s={calibration_left}; modo_prueba={'si' if APP_TEST_MODE else 'no'}"
    )


def _resolve_openrouter_model_candidates() -> list[str]:
    configured = str(OPENROUTER_MODEL or "").strip()
    base_candidates = [
        configured,
        "openrouter/auto",
        "meta-llama/llama-3.3-8b-instruct:free",
        "google/gemma-3-12b-it:free",
        "mistralai/mistral-7b-instruct:free",
    ]

    candidates: list[str] = []
    for raw_name in base_candidates:
        model_name = str(raw_name or "").strip()
        if model_name and model_name not in candidates:
            candidates.append(model_name)

    return candidates or ["openrouter/auto"]


def _extract_openrouter_error(payload: Any) -> str | None:
    if isinstance(payload, dict):
        error_obj = payload.get("error")
        if isinstance(error_obj, dict):
            message = str(error_obj.get("message") or "").strip()
            code = str(error_obj.get("code") or "").strip()
            if message and code:
                return f"{message} (code={code})"
            if message:
                return message
        if isinstance(error_obj, str) and error_obj.strip():
            return error_obj.strip()

        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
        if isinstance(detail, list) and detail:
            first = detail[0]
            if isinstance(first, dict):
                msg = str(first.get("msg") or "").strip()
                loc = first.get("loc")
                loc_path = ""
                if isinstance(loc, (list, tuple)) and loc:
                    loc_path = ".".join(str(item) for item in loc)
                if msg and loc_path:
                    return f"{loc_path}: {msg}"
                if msg:
                    return msg
            return str(first)

        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()

    if isinstance(payload, str) and payload.strip():
        return payload.strip()
    return None

def on_chatbot_message(prompt: str | None = None, api_key: str | None = None, **kwargs):
    raw_prompt = prompt if prompt not in (None, "") else kwargs.get("prompt", kwargs.get("message", ""))
    raw_api_key = api_key if api_key not in (None, "") else kwargs.get("api_key", "")

    prompt_text = str(raw_prompt or "").strip()
    api_key_value = str(raw_api_key or "").strip()
    
    if not prompt_text:
        return {"ok": False, "error": "No se proporcionó un prompt"}
    
    effective_api_key = api_key_value if api_key_value else OPENROUTER_API_KEY
    
    if not _is_valid_openrouter_key(effective_api_key):
        return {
            "ok": False,
            "error": "Falta API Key valida de OpenRouter. Configura OPENROUTER_API_KEY o guarda una clave sk-or-... en el chat.",
        }

    if requests is None:
        return {"ok": False, "error": "Librería requests no instalada en el runtime."}

    compact_prompt = prompt_text[:1200]
    hydrobot_context = _build_hydrobot_context()
    model_candidates = _resolve_openrouter_model_candidates()
        
    try:
        system_message = (
            "Eres HydroBot, asistente de HydroLabs para calidad del agua en Panamá. "
            "Responde siempre en español claro para público no técnico. "
            "Empieza tus respuestas con 'HydroBot:'. "
            "Usa contexto operativo cuando venga incluido, sin inventar datos. "
            "Cuando interpretes lecturas, usa formato: 1) Resultado, 2) Significado, 3) Acción recomendada. "
            "Sé breve y útil: máximo 120 palabras salvo que el usuario pida más detalle."
        )

        last_http_error = ""
        for index, model_name in enumerate(model_candidates):
            has_more_models = index < (len(model_candidates) - 1)
            print(f"[Chatbot] Enviando consulta a OpenRouter con modelo: {model_name}")
            response = requests.post(
                url="https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {effective_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_name,
                    "messages": [
                        {
                            "role": "system",
                            "content": system_message,
                        },
                        {
                            "role": "user",
                            "content": f"Contexto operativo: {hydrobot_context}\n\nConsulta: {compact_prompt}",
                        },
                    ],
                },
                timeout=20,
            )

            try:
                data = response.json()
            except Exception:
                data = response.text

            if response.ok:
                if isinstance(data, dict):
                    choices = data.get("choices")
                    if isinstance(choices, list) and choices:
                        first_choice = choices[0] if isinstance(choices[0], dict) else {}
                        message_obj = first_choice.get("message") if isinstance(first_choice, dict) else {}
                        if isinstance(message_obj, dict):
                            content = str(message_obj.get("content") or "").strip()
                            if content:
                                return {"ok": True, "reply": content, "model": model_name}

                parsed_error = _extract_openrouter_error(data) or "Respuesta no esperada de OpenRouter (sin choices)."
                last_http_error = f"OpenRouter respuesta inválida ({model_name}): {parsed_error}"
                if has_more_models:
                    print("[Chatbot] Respuesta sin choices; probando siguiente fallback de modelo")
                    continue

                return {
                    "ok": False,
                    "error": last_http_error,
                    "status_code": response.status_code,
                    "model": model_name,
                }

            parsed_error = _extract_openrouter_error(data) or "Error no detallado por OpenRouter."
            last_http_error = f"OpenRouter HTTP {response.status_code} ({model_name}): {parsed_error}"

            # Si el modelo configurado falla por validación o disponibilidad, intenta un fallback estable.
            if response.status_code in {400, 404, 422, 429, 503} and has_more_models:
                print("[Chatbot] Modelo rechazado; probando siguiente fallback")
                continue

            return {
                "ok": False,
                "error": last_http_error,
                "status_code": response.status_code,
                "model": model_name,
            }

        return {
            "ok": False,
            "error": last_http_error or "No se pudo obtener respuesta del chatbot.",
            "model": "openrouter/auto",
        }
    except Exception as exc:
        print(f"[Chatbot] Error: {exc}")
        return {"ok": False, "error": str(exc)}

ui.expose_api("POST", "/chat", on_chatbot_message)

def on_send_report(**kwargs):
    """Envía un reporte PDF por Resend."""
    import base64

    try:
        payload: dict[str, Any] = {}
        for container_key in ("body", "data", "payload"):
            nested_payload = kwargs.get(container_key)
            if isinstance(nested_payload, dict):
                payload.update(nested_payload)
        payload.update(kwargs)

        email = str(payload.get("email", "")).strip()
        location = str(payload.get("location", "")).strip()
        raw_pdf_data = str(payload.get("pdf_data", "")).strip()
        subject = str(payload.get("subject", "Reporte de Calidad del Agua")).strip() or "Reporte de Calidad del Agua"

        if not email or not raw_pdf_data:
            return {"ok": False, "error": "Email y datos PDF son requeridos."}
        if len(email) > 320:
            return {"ok": False, "error": "Email destino demasiado largo."}
        if not _looks_like_email(email):
            return {"ok": False, "error": "Email destino inválido."}

        if not location:
            location = VALID_LOCATIONS.get(current_location, {}).get("name", current_location)
        if len(location) > 80:
            location = location[:80]

        if len(subject) > 160:
            subject = subject[:160]

        if resend is None:
            return {"ok": False, "error": "Librería Resend no instalada en el runtime."}
        if not _is_valid_resend_key(RESEND_API_KEY):
            return {"ok": False, "error": "RESEND_API_KEY no configurado o inválido."}
        if not _looks_like_email(RESEND_FROM):
            return {"ok": False, "error": "RESEND_FROM no es un correo válido."}

        pdf_data = raw_pdf_data
        if pdf_data.startswith("data:") and "," in pdf_data:
            _, pdf_data = pdf_data.split(",", 1)
            pdf_data = pdf_data.strip()

        try:
            pdf_bytes = base64.b64decode(pdf_data, validate=True)
        except Exception:
            return {"ok": False, "error": "Archivo PDF inválido (base64)."}

        if len(pdf_bytes) < 8:
            return {"ok": False, "error": "Archivo PDF vacío o corrupto."}

        resend.api_key = RESEND_API_KEY

        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()[:24]
        idempotency_seed = f"{email.lower()}|{location.lower()}|{subject}|{pdf_hash}"
        idempotency_hash = hashlib.sha256(idempotency_seed.encode("utf-8")).hexdigest()[:48]
        idem_key = f"report/{idempotency_hash}"

        result = resend.Emails.send(
            {
                "from": RESEND_FROM,
                "to": [email],
                "subject": subject,
                "html": (
                    "<p>Adjunto encontrarás tu reporte de calidad del agua.</p>"
                    f"<p><b>Ubicación:</b> {location}</p>"
                ),
                "attachments": [
                    {
                        "filename": "reporte-calidad-agua.pdf",
                        "content": pdf_data,
                    }
                ],
            },
            idempotency_key=idem_key,
        )

        message_id = None
        if isinstance(result, dict):
            message_id = result.get("id")
            if not message_id and isinstance(result.get("data"), dict):
                message_id = result["data"].get("id")
        elif result is not None:
            message_id = getattr(result, "id", None)

        if message_id:
            print(f"[Email] Reporte enviado por Resend id={message_id} to={email}")
            return {
                "ok": True,
                "message": "Reporte enviado correctamente por correo.",
                "id": message_id,
            }

        print(f"[Email] Respuesta Resend: {result}")
        return {
            "ok": False,
            "error": "Resend no devolvió un id de envío.",
            "detail": str(result),
        }

    except Exception as exc:
        print(f"[Email] Error: {exc}")
        return {"ok": False, "error": str(exc)}

ui.expose_api("POST", "/send_report", on_send_report)


def _run_test_notification_channel(channel_name: str, sender):
    try:
        result = sender()
    except Exception as exc:
        print(f"[Alerts/Test] {channel_name} lanzó excepción: {exc}")
        return {"ok": False}

    if isinstance(result, dict):
        if result.get("ok"):
            return {"ok": True}

        detail = str(result.get("error") or "sin detalle")
        print(f"[Alerts/Test] {channel_name} falló: {detail}")
        return {"ok": False}

    print(f"[Alerts/Test] {channel_name} devolvió respuesta no válida: {result!r}")
    return {"ok": False}


def on_test_notifications(location: str | None = None, telegram_chat_id: Any = None, chat_id: Any = None, **kwargs):
    loc = location or kwargs.get("location") or current_location
    if loc not in VALID_LOCATIONS:
        return {"ok": False, "error": f"Ubicación inválida: {loc}"}

    requested_telegram_chat_id = telegram_chat_id if telegram_chat_id not in (None, "") else chat_id
    if requested_telegram_chat_id in (None, ""):
        requested_telegram_chat_id = kwargs.get("telegram_chat_id", kwargs.get("chat_id"))

    # Valores de prueba en zona de alerta para validar canales sin esperar una medición crítica real.
    ph = 5.8
    ntu = 12.0
    tds = 950.0
    status = 2

    def _send_discord():
        if not _is_discord_alert_configured():
            print("[Alerts/Test] Discord omitido: configuración incompleta.")
            return {"ok": False}
        return alerts.send_discord_webhook(loc, ph, ntu, -1.0, -1.0, status)

    def _send_email():
        if not _is_email_alert_configured():
            print("[Alerts/Test] Email omitido: configuración incompleta.")
            return {"ok": False}
        return alerts.send_email(loc, ph, ntu, -1.0, -1.0, status)

    def _send_telegram():
        return _send_telegram_test_alert(
            loc=loc,
            ph=ph,
            ntu=ntu,
            tds=tds,
            status=status,
            requested_chat_id=requested_telegram_chat_id,
        )

    channel_results = {
        "discord": _run_test_notification_channel("Discord", _send_discord),
        "email": _run_test_notification_channel("Email", _send_email),
        "telegram": _run_test_notification_channel("Telegram", _send_telegram),
    }

    ok_channels = [name for name, result in channel_results.items() if isinstance(result, dict) and result.get("ok")]

    return {
        "ok": len(ok_channels) > 0,
        "location": loc,
        "status": status,
        "ok_channels": ok_channels,
        "channels": channel_results,
    }


ui.expose_api("POST", "/test_notifications", on_test_notifications)

print("[WebUI] Rutas personalizadas deshabilitadas; se usa el servicio estático por defecto.")

print("Registrando callback 'receive_reading'...")
Bridge.provide("receive_reading", receive_reading)
Bridge.provide("preview_reading", preview_reading)
_sync_board_preview_state()
_init_telegram_bot()

print("Iniciando app de monitoreo de calidad del agua...")
App.run(user_loop=collect_resource_metrics)
