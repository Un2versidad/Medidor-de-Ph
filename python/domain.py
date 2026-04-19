from __future__ import annotations

PH_GREEN_MIN, PH_GREEN_MAX = 6.5, 8.5
PH_YELLOW_MIN, PH_YELLOW_MAX = 6.0, 9.0
NTU_GREEN = 1.0
NTU_YELLOW = 5.0
TDS_GREEN = 600.0
TDS_YELLOW = 900.0

VALID_LOCATIONS = {
    "chiriqui": {"name": "Chiriquí", "lat": 8.4310, "lon": -82.4260},
    "cocle": {"name": "Coclé", "lat": 8.5189, "lon": -80.3577},
    "panama_oeste": {"name": "Panamá Oeste", "lat": 8.8810, "lon": -79.7840},
    "colon": {"name": "Colón", "lat": 9.3598, "lon": -79.9009},
    "panama_este": {"name": "Panamá Este", "lat": 9.1670, "lon": -79.0970},
    "panama": {"name": "Panamá", "lat": 8.9936, "lon": -79.5197},
    "darien": {"name": "Darién", "lat": 8.0330, "lon": -77.7290},
    "panama_norte_chilibre": {"name": "Panamá Norte (Chilibre)", "lat": 9.1550, "lon": -79.6130},
}

STATUS_LABEL = {
    0: "Apta (Verde)",
    1: "Tolerable (Amarillo)",
    2: "NO APTA (Rojo)",
}


def compute_status(ph: float, ntu: float, tds: float | None = None) -> int:
    if ph is None or ntu is None:
        return 1

    ph_bad = ph < PH_YELLOW_MIN or ph > PH_YELLOW_MAX
    ph_warn = ph < PH_GREEN_MIN or ph > PH_GREEN_MAX
    ntu_bad = ntu > NTU_YELLOW
    ntu_warn = ntu > NTU_GREEN

    tds_bad = tds is not None and tds > TDS_YELLOW
    tds_warn = tds is not None and tds > TDS_GREEN

    if ph_bad or ntu_bad or tds_bad:
        return 2
    if ph_warn or ntu_warn or tds_warn:
        return 1
    return 0
