from __future__ import annotations

import datetime
import json
import time
import urllib.request

try:
    import resend
except Exception:
    resend = None

from config import (
    ALERT_COOLDOWN_S,
    ALERT_RECIPIENTS,
    DISCORD_WEBHOOK_URL,
    RESEND_API_KEY,
    RESEND_FROM,
)
from domain import NTU_GREEN, PH_GREEN_MAX, PH_GREEN_MIN, STATUS_LABEL, VALID_LOCATIONS


class AlertManager:
    def __init__(self):
        self.last_alert_ts = {}

    def can_alert(self, loc: str) -> bool:
        now = time.time()
        if loc not in self.last_alert_ts:
            return True
        return (now - self.last_alert_ts[loc]) >= ALERT_COOLDOWN_S

    def mark_alerted(self, loc: str):
        self.last_alert_ts[loc] = time.time()

    def _looks_like_placeholder(self, value: str | None) -> bool:
        token = (value or "").strip().lower()
        if not token:
            return False
        placeholders = {
            "change_me",
            "changeme",
            "placeholder",
            "your_resend_api_key",
            "your_discord_webhook_url",
            "your_email@example.com",
            "example@example.com",
            "none",
            "null",
        }
        if token in placeholders:
            return True
        return (
            "placeholder" in token
            or token.startswith("your_")
            or token.endswith("_here")
            or "replace" in token
        )

    def _looks_like_email(self, address: str | None) -> bool:
        raw = self._extract_email_address(address)
        if not raw or self._looks_like_placeholder(raw):
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

    def _extract_email_address(self, address: str | None) -> str:
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

    def _discord_webhook_is_valid(self) -> bool:
        raw = (DISCORD_WEBHOOK_URL or "").strip()
        if not raw or self._looks_like_placeholder(raw):
            return False
        lowered = raw.lower()
        return lowered.startswith("https://discord.com/api/webhooks/") or lowered.startswith(
            "https://discordapp.com/api/webhooks/"
        )

    def _resend_is_valid(self) -> bool:
        raw_key = (RESEND_API_KEY or "").strip()
        if not raw_key or self._looks_like_placeholder(raw_key):
            return False
        if not raw_key.startswith("re_"):
            return False
        if not self._looks_like_email(RESEND_FROM):
            return False
        if not ALERT_RECIPIENTS:
            return False
        return all(self._looks_like_email(item) for item in ALERT_RECIPIENTS)

    def send_email(self, loc: str, ph: float, ntu: float, temp_c: float, humidity: float, status: int):
        if resend is None:
            print("[Email] Libreria resend no instalada, alerta omitida.")
            return {"ok": False, "error": "Libreria resend no instalada"}
        if not self._resend_is_valid():
            print("[Email] Configuracion Resend incompleta, alerta omitida.")
            return {
                "ok": False,
                "error": "Configuración Resend inválida (API key, remitente o destinatarios).",
            }
        loc_name = VALID_LOCATIONS[loc]["name"]
        subject = f"ALERTA Calidad Agua — {loc_name} — {STATUS_LABEL[status]}"
        temp_line = f"Temperatura : {temp_c:.1f} °C\n" if temp_c != -1.0 else ""
        hum_line = f"Humedad     : {humidity:.1f} %\n" if humidity != -1.0 else ""
        body = (
            f"ALERTA DE CALIDAD DEL AGUA\n"
            f"{'=' * 40}\n"
            f"Ubicación : {loc_name}\n"
            f"pH        : {ph:.2f}\n"
            f"Turbidez  : {ntu:.1f} NTU\n"
            f"{temp_line}"
            f"{hum_line}"
            f"Estado    : {STATUS_LABEL[status]}\n"
            f"Fecha/Hora: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            f"Rangos seguros — pH: {PH_GREEN_MIN}–{PH_GREEN_MAX} | Turbidez: <{NTU_GREEN} NTU\n"
        )
        try:
            resend.api_key = RESEND_API_KEY

            bucket_window = max(60, int(ALERT_COOLDOWN_S) if ALERT_COOLDOWN_S else 0)
            bucket = int(time.time() // bucket_window)
            idem_key = f"critical-alert/{loc}/{status}/{bucket}"

            result = resend.Emails.send(
                {
                    "from": RESEND_FROM,
                    "to": ALERT_RECIPIENTS,
                    "subject": subject,
                    "html": f"<pre>{body}</pre>",
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
                print(f"[Email] Alerta enviada id={message_id} a: {ALERT_RECIPIENTS}")
                return {"ok": True, "recipients": ALERT_RECIPIENTS, "id": message_id}

            print(f"[Email] Respuesta Resend sin id: {result}")
            return {"ok": False, "error": "Resend no devolvió id de envío para alerta."}
        except Exception as exc:
            print(f"[Email] Error al enviar: {exc}")
            return {"ok": False, "error": str(exc)}

    def send_discord_webhook(self, loc: str, ph: float, ntu: float, temp_c: float, humidity: float, status: int):
        if not self._discord_webhook_is_valid():
            print("[Discord] Webhook no configurado, alerta omitida.")
            return {"ok": False, "error": "DISCORD_WEBHOOK_URL no configurado o inválido"}
        loc_name = VALID_LOCATIONS[loc]["name"]
        color_map = {0: 0x22C55E, 1: 0xEAB308, 2: 0xEF4444}
        emoji_map = {0: "🟢", 1: "🟡", 2: "🔴"}
        fields = [
            {"name": "📍 Ubicación", "value": loc_name, "inline": True},
            {"name": "🧪 pH", "value": f"{ph:.2f}", "inline": True},
            {"name": "💧 Turbidez", "value": f"{ntu:.1f} NTU", "inline": True},
            {"name": "🚦 Estado", "value": STATUS_LABEL[status], "inline": True},
        ]
        if temp_c != -1.0:
            fields.append({"name": "🌡️ Temperatura", "value": f"{temp_c:.1f} °C", "inline": True})
        if humidity != -1.0:
            fields.append({"name": "💦 Humedad", "value": f"{humidity:.1f} %", "inline": True})
        payload = json.dumps({
            "embeds": [{
                "title": f"{emoji_map[status]} ALERTA CALIDAD DEL AGUA",
                "color": color_map[status],
                "fields": fields,
                "footer": {"text": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')},
            }]
        }).encode("utf-8")
        request = urllib.request.Request(
            DISCORD_WEBHOOK_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as resp:
                print(f"[Discord] Alerta enviada: {resp.status}")
                return {"ok": True, "status": int(resp.status)}
        except Exception as exc:
            print(f"[Discord] Error al enviar alerta: {exc}")
            return {"ok": False, "error": str(exc)}
