import os

_ENV_LOADED = False


def _load_env_file():
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.isfile(env_path):
        with open(env_path, encoding="utf-8") as env_file:
            for line in env_file:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())
    _ENV_LOADED = True


def env(key: str, default: str = "") -> str:
    raw = os.environ.get(key)
    if raw is not None:
        return raw.strip()
    _load_env_file()
    return os.environ.get(key, default).strip()


def as_bool(value: str, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def as_int(value: str, default: int, setting_name: str) -> int:
    try:
        return int((value or "").strip())
    except Exception:
        print(f"[Config] Valor inválido para {setting_name}: {value!r}. Usando default={default}")
        return int(default)


def as_int_list(value: str, setting_name: str) -> list[int]:
    items: list[int] = []
    for raw in (value or "").split(","):
        token = raw.strip()
        if not token:
            continue
        try:
            items.append(int(token))
        except Exception:
            print(f"[Config] Valor inválido en {setting_name}: {token!r}. Se ignora este item.")
    return items


DISCORD_WEBHOOK_URL = env("DISCORD_WEBHOOK_URL")
RESEND_API_KEY = env("RESEND_API_KEY")
RESEND_FROM = env("RESEND_FROM", "onboarding@resend.dev")
ALERT_RECIPIENTS = [item.strip() for item in env("ALERT_RECIPIENTS").split(",") if item.strip()]
ALERT_COOLDOWN_S = as_int(env("ALERT_COOLDOWN_S", "300"), 300, "ALERT_COOLDOWN_S")
APP_TEST_MODE = as_bool(env("TEST_MODE", "true"), default=True)
OPENROUTER_API_KEY = env("OPENROUTER_API_KEY")
OPENROUTER_MODEL = env("OPENROUTER_MODEL", "openrouter/auto")
SENSOR_CALIBRATION_S = as_int(env("SENSOR_CALIBRATION_S", "30"), 30, "SENSOR_CALIBRATION_S")
MIN_TAKE_READING_GAP_S = as_int(env("MIN_TAKE_READING_GAP_S", "10"), 10, "MIN_TAKE_READING_GAP_S")
READING_CAPTURE_ENABLED_DEFAULT = as_bool(env("READING_CAPTURE_ENABLED_DEFAULT", "true"), default=True)
TELEGRAM_BOT_TOKEN = env("TELEGRAM_BOT_TOKEN")
TELEGRAM_BOT_ENABLED = as_bool(env("TELEGRAM_BOT_ENABLED", "true"), default=True)
TELEGRAM_ENABLE_BUILTIN_WELCOME = as_bool(env("TELEGRAM_ENABLE_BUILTIN_WELCOME", "true"), default=True)
TELEGRAM_WHITELIST_USER_IDS = as_int_list(env("TELEGRAM_WHITELIST_USER_IDS"), "TELEGRAM_WHITELIST_USER_IDS")
TELEGRAM_CA_BUNDLE = env("TELEGRAM_CA_BUNDLE")

SUPABASE_SYNC_ENABLED = as_bool(env("SUPABASE_SYNC_ENABLED", "true"), default=True)
SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_RPC_INGEST = env("SUPABASE_RPC_INGEST", "ingest_water_reading") or "ingest_water_reading"
DEVICE_UID = env("DEVICE_UID", "uno-q-dashboard")
