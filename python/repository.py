from domain import VALID_LOCATIONS, compute_status


LATEST_LOOKBACK = "-30d"
LATEST_AGGR_WINDOW = "1h"
LATEST_AGGR_FUNC = "mean"
LATEST_LIMIT = 720


def read_samples(db, resource: str, start: str, aggr_window: str, limit: int = 200):
    samples = db.read_samples(
        measure=resource,
        start_from=start,
        aggr_window=aggr_window,
        aggr_func="mean",
        limit=limit,
    )
    return [{"ts": sample[1], "value": sample[2]} for sample in samples]


def _to_int_ts(raw):
    try:
        return int(raw)
    except Exception:
        return None


def _read_latest_metric(db, measure: str):
    try:
        samples = db.read_samples(
            measure=measure,
            start_from=LATEST_LOOKBACK,
            aggr_window=LATEST_AGGR_WINDOW,
            aggr_func=LATEST_AGGR_FUNC,
            limit=LATEST_LIMIT,
        )
    except Exception as exc:
        print(f"[Repository] Error leyendo medida '{measure}': {exc}")
        return None, None

    latest_value = None
    latest_ts = None
    for sample in samples:
        if len(sample) < 3:
            continue
        ts = _to_int_ts(sample[1])
        if ts is None:
            continue
        if latest_ts is None or ts > latest_ts:
            latest_ts = ts
            latest_value = sample[2]

    return latest_value, latest_ts


def latest_for_location(db, loc_key: str):
    ph_val, ph_ts = _read_latest_metric(db, f"ph_{loc_key}")
    ntu_val, ntu_ts = _read_latest_metric(db, f"ntu_{loc_key}")
    tds_val, tds_ts = _read_latest_metric(db, f"tds_{loc_key}")
    temp_val, temp_ts = _read_latest_metric(db, f"temp_{loc_key}")
    humidity_val, humidity_ts = _read_latest_metric(db, f"humidity_{loc_key}")

    timestamps = [ph_ts, ntu_ts, tds_ts, temp_ts, humidity_ts]
    valid_ts = [ts for ts in timestamps if ts is not None]
    measured_ts = max(valid_ts) if valid_ts else None
    status = compute_status(ph_val, ntu_val, tds_val) if (ph_val is not None and ntu_val is not None) else None

    return {
        "location": loc_key,
        "name": VALID_LOCATIONS[loc_key]["name"],
        "lat": VALID_LOCATIONS[loc_key]["lat"],
        "lon": VALID_LOCATIONS[loc_key]["lon"],
        "ph": ph_val,
        "ntu": ntu_val,
        "tds": tds_val,
        "tempC": temp_val,
        "humidity": humidity_val,
        "status": status,
        "ts": measured_ts,
    }


def latest_all(db):
    return {loc_key: latest_for_location(db, loc_key) for loc_key in VALID_LOCATIONS}
