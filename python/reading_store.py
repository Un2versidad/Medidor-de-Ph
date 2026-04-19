from __future__ import annotations

import datetime
import json
from dataclasses import dataclass
from typing import Any

try:
    import requests
except Exception:
    requests = None
from arduino.app_bricks.dbstorage_sqlstore import SQLStore

from config import (
    DEVICE_UID,
    SUPABASE_RPC_INGEST,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_SYNC_ENABLED,
    SUPABASE_URL,
)
from domain import VALID_LOCATIONS


METRIC_DEFINITIONS = {
    "ph": {"unit": "pH", "description": "Potencial de hidrógeno"},
    "ntu": {"unit": "NTU", "description": "Indicador de turbidez"},
    "tds": {"unit": "ppm", "description": "Sólidos disueltos totales"},
    "temp_c": {"unit": "C", "description": "Temperatura ambiente"},
    "humidity": {"unit": "%", "description": "Humedad relativa"},
}


@dataclass(frozen=True)
class ReadingPayload:
    location_key: str
    location_name: str
    lat: float
    lon: float
    measured_at_ms: int
    status: int
    ph: float | None
    ntu: float | None
    tds: float | None
    temp_c: float | None
    humidity: float | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "location_key": self.location_key,
            "location_name": self.location_name,
            "lat": self.lat,
            "lon": self.lon,
            "measured_at_ms": self.measured_at_ms,
            "status": self.status,
            "ph": self.ph,
            "ntu": self.ntu,
            "tds": self.tds,
            "temp_c": self.temp_c,
            "humidity": self.humidity,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ReadingPayload":
        return cls(
            location_key=str(data.get("location_key")),
            location_name=str(data.get("location_name")),
            lat=float(data.get("lat")),
            lon=float(data.get("lon")),
            measured_at_ms=int(data.get("measured_at_ms")),
            status=int(data.get("status")),
            ph=float(data.get("ph")) if data.get("ph") is not None else None,
            ntu=float(data.get("ntu")) if data.get("ntu") is not None else None,
            tds=float(data.get("tds")) if data.get("tds") is not None else None,
            temp_c=float(data.get("temp_c")) if data.get("temp_c") is not None else None,
            humidity=float(data.get("humidity")) if data.get("humidity") is not None else None,
        )


def _escape_sql(value: str) -> str:
    return value.replace("'", "''")


class Local3NFStore:
    def __init__(self):
        self.db = SQLStore(database_name="water_quality_3nf")
        self.location_ids: dict[str, int] = {}
        self.metric_type_ids: dict[str, int] = {}
        self.device_id: int | None = None

    def start(self):
        self.db.start()

        self.db.create_table(
            "locations",
            {
                "id": "INTEGER PRIMARY KEY",
                "location_key": "TEXT UNIQUE",
                "name": "TEXT",
                "lat": "REAL",
                "lon": "REAL",
            },
        )

        self.db.create_table(
            "devices",
            {
                "id": "INTEGER PRIMARY KEY",
                "device_uid": "TEXT UNIQUE",
                "board_model": "TEXT",
                "firmware_version": "TEXT",
                "created_at": "TEXT",
            },
        )

        self.db.create_table(
            "metric_types",
            {
                "id": "INTEGER PRIMARY KEY",
                "code": "TEXT UNIQUE",
                "unit": "TEXT",
                "description": "TEXT",
            },
        )

        self.db.create_table(
            "readings",
            {
                "id": "INTEGER PRIMARY KEY",
                "location_id": "INTEGER",
                "device_id": "INTEGER",
                "status": "INTEGER",
                "measured_at_ms": "INTEGER",
                "created_at": "TEXT",
            },
        )

        self.db.create_table(
            "reading_metrics",
            {
                "id": "INTEGER PRIMARY KEY",
                "reading_id": "INTEGER",
                "metric_type_id": "INTEGER",
                "metric_value": "REAL",
            },
        )

        self.db.create_table(
            "sync_queue",
            {
                "id": "INTEGER PRIMARY KEY",
                "reading_id": "INTEGER UNIQUE",
                "payload_json": "TEXT",
                "attempts": "INTEGER",
                "last_error": "TEXT",
                "created_at": "TEXT",
                "updated_at": "TEXT",
            },
        )

        self._seed_metric_types()
        self._seed_locations()
        self._ensure_device()
        self._ensure_indexes()

    def _ensure_indexes(self):
        statements = [
            "CREATE INDEX IF NOT EXISTS idx_readings_loc_ts ON readings(location_id, measured_at_ms DESC)",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_metric_unique ON reading_metrics(reading_id, metric_type_id)",
            "CREATE INDEX IF NOT EXISTS idx_metric_type ON reading_metrics(metric_type_id)",
        ]

        for statement in statements:
            try:
                self.db.execute_sql(statement)
            except Exception as exc:
                print(f"[3NF] Aviso al crear índice: {exc}")

    def _last_insert_id(self) -> int | None:
        row = self.db.execute_sql("SELECT last_insert_rowid() AS id")
        if not row:
            return None
        return int(row[0].get("id"))

    def _seed_metric_types(self):
        for code, meta in METRIC_DEFINITIONS.items():
            safe_code = _escape_sql(code)
            existing = self.db.read("metric_types", condition=f"code = '{safe_code}'") or []
            if existing:
                self.metric_type_ids[code] = int(existing[0]["id"])
                continue

            self.db.store(
                "metric_types",
                {
                    "code": code,
                    "unit": meta["unit"],
                    "description": meta["description"],
                },
                create_table=False,
            )

            inserted_id = self._last_insert_id()
            if inserted_id is not None:
                self.metric_type_ids[code] = inserted_id

    def _seed_locations(self):
        for loc_key, loc in VALID_LOCATIONS.items():
            safe_key = _escape_sql(loc_key)
            existing = self.db.read("locations", condition=f"location_key = '{safe_key}'") or []
            if existing:
                self.location_ids[loc_key] = int(existing[0]["id"])
                continue

            self.db.store(
                "locations",
                {
                    "location_key": loc_key,
                    "name": loc["name"],
                    "lat": float(loc["lat"]),
                    "lon": float(loc["lon"]),
                },
                create_table=False,
            )

            inserted_id = self._last_insert_id()
            if inserted_id is not None:
                self.location_ids[loc_key] = inserted_id

    def _ensure_device(self):
        safe_uid = _escape_sql(DEVICE_UID)
        existing = self.db.read("devices", condition=f"device_uid = '{safe_uid}'") or []
        if existing:
            self.device_id = int(existing[0]["id"])
            return

        self.db.store(
            "devices",
            {
                "device_uid": DEVICE_UID,
                "board_model": "Arduino UNO Q",
                "firmware_version": "dashboard-water-v2",
                "created_at": datetime.datetime.utcnow().isoformat(),
            },
            create_table=False,
        )

        self.device_id = self._last_insert_id()

    def save_reading(self, payload: ReadingPayload) -> int | None:
        location_id = self.location_ids.get(payload.location_key)
        if location_id is None:
            self._seed_locations()
            location_id = self.location_ids.get(payload.location_key)

        if location_id is None:
            raise ValueError(f"Clave de ubicación desconocida: {payload.location_key}")

        if self.device_id is None:
            self._ensure_device()

        self.db.store(
            "readings",
            {
                "location_id": int(location_id),
                "device_id": int(self.device_id) if self.device_id is not None else None,
                "status": int(payload.status),
                "measured_at_ms": int(payload.measured_at_ms),
                "created_at": datetime.datetime.utcnow().isoformat(),
            },
            create_table=False,
        )

        reading_id = self._last_insert_id()
        if reading_id is None:
            return None

        metrics = {
            "ph": payload.ph,
            "ntu": payload.ntu,
            "tds": payload.tds,
            "temp_c": payload.temp_c,
            "humidity": payload.humidity,
        }

        for code, value in metrics.items():
            if value is None:
                continue

            metric_type_id = self.metric_type_ids.get(code)
            if metric_type_id is None:
                continue

            self.db.store(
                "reading_metrics",
                {
                    "reading_id": int(reading_id),
                    "metric_type_id": int(metric_type_id),
                    "metric_value": float(value),
                },
                create_table=False,
            )

        return int(reading_id)

    def list_recent(self, location_key: str, limit: int = 50) -> list[dict[str, Any]]:
        safe_key = _escape_sql(location_key)
        safe_limit = max(1, min(int(limit), 200))

        query = f"""
            SELECT
                r.id,
                r.measured_at_ms,
                r.status,
                MAX(CASE WHEN mt.code = 'ph' THEN rm.metric_value END) AS ph,
                MAX(CASE WHEN mt.code = 'ntu' THEN rm.metric_value END) AS ntu,
                MAX(CASE WHEN mt.code = 'tds' THEN rm.metric_value END) AS tds,
                MAX(CASE WHEN mt.code = 'temp_c' THEN rm.metric_value END) AS temp_c,
                MAX(CASE WHEN mt.code = 'humidity' THEN rm.metric_value END) AS humidity
            FROM readings r
            JOIN locations l ON l.id = r.location_id
            LEFT JOIN reading_metrics rm ON rm.reading_id = r.id
            LEFT JOIN metric_types mt ON mt.id = rm.metric_type_id
            WHERE l.location_key = '{safe_key}'
            GROUP BY r.id, r.measured_at_ms, r.status
            ORDER BY r.measured_at_ms DESC
            LIMIT {safe_limit}
        """

        rows = self.db.execute_sql(query) or []
        return [
            {
                "id": row.get("id"),
                "ts": row.get("measured_at_ms"),
                "status": row.get("status"),
                "ph": row.get("ph"),
                "ntu": row.get("ntu"),
                "tds": row.get("tds"),
                "tempC": row.get("temp_c"),
                "humidity": row.get("humidity"),
            }
            for row in rows
        ]

    def queue_unsynced(self, reading_id: int, payload: ReadingPayload, reason: str):
        now_iso = datetime.datetime.utcnow().isoformat()
        payload_json = json.dumps(payload.to_dict(), ensure_ascii=True)
        safe_reason = reason[:300] if reason else "sincronizacion_fallida"

        existing = self.db.read("sync_queue", condition=f"reading_id = {int(reading_id)}") or []
        if existing:
            attempts = int(existing[0].get("attempts", 0)) + 1
            self.db.update(
                "sync_queue",
                {
                    "attempts": attempts,
                    "last_error": safe_reason,
                    "payload_json": payload_json,
                    "updated_at": now_iso,
                },
                condition=f"reading_id = {int(reading_id)}",
            )
            return

        self.db.store(
            "sync_queue",
            {
                "reading_id": int(reading_id),
                "payload_json": payload_json,
                "attempts": 1,
                "last_error": safe_reason,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            create_table=False,
        )

    def list_sync_queue(self, limit: int = 20) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 100))
        query = (
            "SELECT id, reading_id, payload_json, attempts, last_error "
            "FROM sync_queue ORDER BY id ASC "
            f"LIMIT {safe_limit}"
        )
        return self.db.execute_sql(query) or []

    def remove_sync_queue_item(self, item_id: int):
        self.db.delete("sync_queue", condition=f"id = {int(item_id)}")

    def pending_sync_count(self) -> int:
        rows = self.db.execute_sql("SELECT COUNT(*) AS count FROM sync_queue") or []
        if not rows:
            return 0
        return int(rows[0].get("count", 0))


class SupabaseRPCSync:
    def __init__(self):
        self.enabled = bool(
            requests is not None and SUPABASE_SYNC_ENABLED and SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
        )

    def reason_if_disabled(self) -> str:
        if requests is None:
            return "requests no instalado"
        if not SUPABASE_SYNC_ENABLED:
            return "SUPABASE_SYNC_ENABLED=false"
        if not SUPABASE_URL:
            return "SUPABASE_URL vacío"
        if not SUPABASE_SERVICE_ROLE_KEY:
            return "SUPABASE_SERVICE_ROLE_KEY vacío"
        return ""

    def push(self, payload: ReadingPayload) -> bool:
        if not self.enabled:
            return False

        if requests is None:
            return False

        endpoint = f"{SUPABASE_URL.rstrip('/')}/rest/v1/rpc/{SUPABASE_RPC_INGEST}"
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        rpc_payload = {
            "p_location_key": payload.location_key,
            "p_location_name": payload.location_name,
            "p_lat": payload.lat,
            "p_lon": payload.lon,
            "p_device_uid": DEVICE_UID,
            "p_status": payload.status,
            "p_measured_at_ms": payload.measured_at_ms,
            "p_ph": payload.ph,
            "p_ntu": payload.ntu,
            "p_tds": payload.tds,
            "p_temp_c": payload.temp_c,
            "p_humidity": payload.humidity,
        }

        try:
            response = requests.post(endpoint, headers=headers, json=rpc_payload, timeout=8)
            if response.ok:
                return True
            print(f"[Supabase] Sync failed ({response.status_code}): {response.text}")
            return False
        except Exception as exc:
            print(f"[Supabase] Sync exception: {exc}")
            return False


class ReadingStore:
    def __init__(self):
        self.local = Local3NFStore()
        self.remote = SupabaseRPCSync()

    def start(self):
        self.local.start()

    def mode(self) -> str:
        if self.remote.enabled:
            return "supabase_primary+local_fallback"
        return "local_3nf_buffered"

    def save(self, payload: ReadingPayload) -> dict[str, Any]:
        local_id = self.local.save_reading(payload)
        synced = self.remote.push(payload)

        queued = False
        queue_reason = ""
        if not synced and local_id is not None:
            queue_reason = self.remote.reason_if_disabled() or "envio_fallido"
            self.local.queue_unsynced(local_id, payload, queue_reason)
            queued = True

        return {
            "local_id": local_id,
            "synced": synced,
            "queued": queued,
            "queue_reason": queue_reason,
            "queue_pending": self.local.pending_sync_count(),
            "mode": self.mode(),
        }

    def retry_unsynced(self, limit: int = 20) -> dict[str, Any]:
        if not self.remote.enabled:
            return {
                "attempted": 0,
                "synced": 0,
                "pending": self.local.pending_sync_count(),
                "enabled": False,
                "reason": self.remote.reason_if_disabled(),
            }

        attempted = 0
        synced = 0

        for item in self.local.list_sync_queue(limit=limit):
            attempted += 1
            item_id = int(item.get("id"))
            try:
                payload_json = item.get("payload_json") or "{}"
                payload = ReadingPayload.from_dict(json.loads(payload_json))
            except Exception:
                self.local.remove_sync_queue_item(item_id)
                continue

            if self.remote.push(payload):
                synced += 1
                self.local.remove_sync_queue_item(item_id)

        return {
            "attempted": attempted,
            "synced": synced,
            "pending": self.local.pending_sync_count(),
            "enabled": True,
        }

    def list_recent(self, location_key: str, limit: int = 50) -> list[dict[str, Any]]:
        return self.local.list_recent(location_key, limit=limit)
