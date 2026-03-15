from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = Path(__file__).resolve().parent
MOCK_DATA_FILE = BASE_DIR.parent / "dataset" / "events.json"
REAL_DATA_FILE = BASE_DIR.parent / "dataset" / "real_events.json"
CNEOS_API_URL = "https://ssd-api.jpl.nasa.gov/fireball.api"

SCIENTIFIC_SOURCES: list[dict[str, Any]] = [
    {
        "id": "global-meteor-network",
        "name": "Global Meteor Network",
        "category": "Observation",
        "role": "Primary meteor observation dataset",
        "integration_status": "planned",
        "access": "Community network exports/API",
    },
    {
        "id": "nasa-fireball-api",
        "name": "NASA Fireball API",
        "category": "Event Catalogue",
        "role": "Fireball event catalogue",
        "integration_status": "live",
        "access": CNEOS_API_URL,
    },
    {
        "id": "american-meteor-society",
        "name": "American Meteor Society",
        "category": "Reports",
        "role": "Real-time meteor reports",
        "integration_status": "planned",
        "access": "AMS fireball reports feed/API",
    },
    {
        "id": "iau-meteor-data-centre",
        "name": "IAU Meteor Data Centre",
        "category": "Classification",
        "role": "Meteor shower classification",
        "integration_status": "planned",
        "access": "IAU MDC datasets",
    },
    {
        "id": "jpl-horizons-api",
        "name": "JPL Horizons API",
        "category": "Orbital Mechanics",
        "role": "Planetary positions and orbit calculations",
        "integration_status": "planned",
        "access": "JPL Horizons API",
    },
    {
        "id": "sonotaco-meteor-orbit-db",
        "name": "SonotaCo Meteor Orbit Database",
        "category": "Reference Orbit Data",
        "role": "Reference meteor orbit dataset",
        "integration_status": "planned",
        "access": "SonotaCo dataset releases",
    },
    {
        "id": "edmond-database",
        "name": "EDMOND Database",
        "category": "Multi-station Observations",
        "role": "European multi-station meteor observations",
        "integration_status": "planned",
        "access": "EDMOND data publications",
    },
    {
        "id": "nasa-meteoroid-environment-office",
        "name": "NASA Meteoroid Environment Office Dataset",
        "category": "Environment Modelling",
        "role": "Meteoroid environment modelling",
        "integration_status": "planned",
        "access": "NASA MEO public resources",
    },
]

STACK_PROFILE: dict[str, Any] = {
    "frontend": [
        "React / Next.js",
        "Tailwind CSS",
        "CesiumJS",
        "Three.js",
        "Plotly.js",
    ],
    "backend": [
        "Python",
        "FastAPI",
        "NumPy",
        "SciPy",
        "Pandas",
    ],
    "astronomy_scientific": [
        "Astropy",
        "Skyfield",
    ],
    "database_storage": [
        "PostgreSQL",
        "Redis (optional cache)",
    ],
    "deployment": {
        "frontend_hosting": "Vercel",
        "backend_hosting": "Render / Railway",
        "database_hosting": "Supabase / Neon",
        "version_control": "GitHub",
    },
}


class DataSourceError(RuntimeError):
    """Raised when a dataset cannot be loaded or fetched."""


def resolve_source(source: Literal["auto", "mock", "real"]) -> Literal["mock", "real"]:
    if source == "mock":
        return "mock"
    if source == "real":
        return "real"

    if REAL_DATA_FILE.exists():
        try:
            real_events = _load_json(REAL_DATA_FILE)
            if real_events:
                return "real"
        except DataSourceError:
            pass
    return "mock"


def _load_json(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise DataSourceError(f"Missing dataset file: {path.name}")
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    if not isinstance(payload, list):
        raise DataSourceError(f"Invalid dataset format in {path.name}")
    return payload


def _save_json(path: Path, data: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _signed_coordinate(value: Any, direction: Any) -> float | None:
    coord = _as_float(value)
    if coord is None:
        return None
    dir_text = str(direction or "").strip().upper()
    if dir_text in {"S", "W"}:
        coord = -abs(coord)
    return coord


def _parse_observed_date(observed_at: str) -> date:
    return datetime.fromisoformat(observed_at.replace("Z", "+00:00")).date()


def _parse_query_date(raw_date: str, field_name: str) -> date:
    try:
        return datetime.strptime(raw_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"{field_name} must be YYYY-MM-DD"
        ) from exc


def _event_date_bounds(events: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    parsed_dates: list[date] = []
    for event in events:
        observed_at = str(event.get("observed_at", "")).strip()
        if not observed_at:
            continue
        try:
            parsed_dates.append(_parse_observed_date(observed_at))
        except ValueError:
            continue

    if not parsed_dates:
        return None, None

    min_date = min(parsed_dates).isoformat()
    max_date = max(parsed_dates).isoformat()
    return min_date, max_date


def _build_trajectory(lat: float, lon: float, peak_alt_km: float) -> list[dict[str, Any]]:
    lat_offset = -0.9 if lat >= 0 else 0.9
    lon_offset = -1.2 if lon >= 0 else 1.2
    altitudes = [
        peak_alt_km,
        peak_alt_km * 0.82,
        peak_alt_km * 0.64,
        peak_alt_km * 0.46,
        max(18.0, peak_alt_km * 0.30),
    ]
    points: list[dict[str, Any]] = []
    for idx, alt in enumerate(altitudes):
        progress = (len(altitudes) - 1 - idx) / (len(altitudes) - 1)
        points.append(
            {
                "lat": round(lat + lat_offset * progress, 3),
                "lon": round(lon + lon_offset * progress, 3),
                "alt_km": round(alt, 1),
            }
        )
    return points


def fetch_cneos_events(limit: int) -> list[dict[str, Any]]:
    query = urlencode(
        {
            "limit": limit,
            "req-loc": "true",
            "req-alt": "true",
            "req-vel": "true",
            "sort": "-date",
        }
    )
    url = f"{CNEOS_API_URL}?{query}"
    try:
        with urlopen(url, timeout=30) as response:
            if response.status >= 400:
                raise DataSourceError(f"CNEOS returned HTTP {response.status}")
            payload = json.loads(response.read().decode("utf-8"))
    except URLError as exc:
        raise DataSourceError(f"Failed to fetch CNEOS data: {exc}") from exc
    fields = payload.get("fields", [])
    rows = payload.get("data", [])
    if not fields or not rows:
        raise DataSourceError("CNEOS returned no usable rows")

    events: list[dict[str, Any]] = []
    for idx, row in enumerate(rows):
        entry = {field: row[i] if i < len(row) else None for i, field in enumerate(fields)}
        lat = _signed_coordinate(entry.get("lat"), entry.get("lat-dir"))
        lon = _signed_coordinate(entry.get("lon"), entry.get("lon-dir"))
        if lat is None or lon is None:
            continue

        observed_raw = str(entry.get("date") or "").strip()
        if not observed_raw:
            continue
        observed_at = observed_raw.replace(" ", "T")
        if "Z" not in observed_at:
            observed_at = f"{observed_at}Z"

        velocity = _as_float(entry.get("vel")) or 19.0
        peak_alt_km = _as_float(entry.get("alt")) or 80.0
        energy_kt = _as_float(entry.get("energy"))
        impact_e = _as_float(entry.get("impact-e"))

        velocity_profile = [
            round(max(velocity * 1.0, 0.5), 2),
            round(max(velocity * 0.92, 0.5), 2),
            round(max(velocity * 0.85, 0.5), 2),
            round(max(velocity * 0.77, 0.5), 2),
        ]
        trajectory_points = _build_trajectory(lat, lon, peak_alt_km)

        event = {
            "id": 1_000_000 + idx,
            "name": f"CNEOS Fireball {observed_raw[:10]} #{idx + 1}",
            "observed_at": observed_at,
            "station": "NASA CNEOS Fireball Dataset",
            "source": "real",
            "energy_kt": energy_kt,
            "impact_energy_kt": impact_e,
            "lat_start": trajectory_points[0]["lat"],
            "lon_start": trajectory_points[0]["lon"],
            "lat_end": trajectory_points[-1]["lat"],
            "lon_end": trajectory_points[-1]["lon"],
            "velocity_km_s": velocity_profile,
            "trajectory_points": trajectory_points,
        }
        events.append(event)

    if not events:
        raise DataSourceError("CNEOS returned rows, but none had valid coordinates")

    return events


def load_events(source: Literal["auto", "mock", "real"] = "auto") -> list[dict[str, Any]]:
    resolved = resolve_source(source)
    if resolved == "mock":
        return _load_json(MOCK_DATA_FILE)
    return _load_json(REAL_DATA_FILE)


def get_event_by_id(
    event_id: int, source: Literal["auto", "mock", "real"] = "auto"
) -> dict[str, Any]:
    for event in load_events(source):
        if event["id"] == event_id:
            return event
    raise HTTPException(status_code=404, detail=f"Event {event_id} not found")


def apply_filters(
    events: list[dict[str, Any]],
    q: str | None,
    date_from: str | None,
    date_to: str | None,
    station: str | None,
) -> list[dict[str, Any]]:
    filtered = events

    if q:
        q_lower = q.lower()
        filtered = [event for event in filtered if q_lower in event["name"].lower()]

    if station:
        station_lower = station.lower()
        filtered = [
            event for event in filtered if station_lower in str(event["station"]).lower()
        ]

    if date_from:
        from_date = _parse_query_date(date_from, "date_from")
        filtered = [
            event
            for event in filtered
            if _parse_observed_date(str(event["observed_at"])) >= from_date
        ]

    if date_to:
        to_date = _parse_query_date(date_to, "date_to")
        filtered = [
            event
            for event in filtered
            if _parse_observed_date(str(event["observed_at"])) <= to_date
        ]

    return filtered


def dataset_summary(source: Literal["auto", "mock", "real"]) -> dict[str, Any]:
    resolved_source = resolve_source(source)
    events = load_events(source)
    min_date, max_date = _event_date_bounds(events)
    return {
        "source_requested": source,
        "source_resolved": resolved_source,
        "event_count": len(events),
        "min_date": min_date,
        "max_date": max_date,
        "latest_available_date": max_date,
    }


app = FastAPI(title="Meteor MVP API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home() -> dict[str, str]:
    return {"message": "Meteor API running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sources")
def get_sources() -> dict[str, Any]:
    integrated = sum(1 for source in SCIENTIFIC_SOURCES if source["integration_status"] == "live")
    return {
        "total_sources": len(SCIENTIFIC_SOURCES),
        "integrated_sources": integrated,
        "planned_sources": len(SCIENTIFIC_SOURCES) - integrated,
        "sources": SCIENTIFIC_SOURCES,
    }


@app.get("/stack")
def get_stack() -> dict[str, Any]:
    return STACK_PROFILE


@app.get("/data-status")
def data_status() -> dict[str, Any]:
    real_exists = REAL_DATA_FILE.exists()
    real_count = 0
    if real_exists:
        try:
            real_count = len(_load_json(REAL_DATA_FILE))
        except DataSourceError:
            real_count = 0
    return {
        "real_data_available": real_exists and real_count > 0,
        "real_event_count": real_count,
        "mock_event_count": len(_load_json(MOCK_DATA_FILE)),
        "auto_dataset_range": dataset_summary("auto"),
    }


@app.get("/dataset-range")
def get_dataset_range(
    source: Literal["auto", "mock", "real"] = Query(default="auto"),
) -> dict[str, Any]:
    try:
        return dataset_summary(source)
    except DataSourceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/sync-real-events")
def sync_real_events(
    limit: int = Query(default=1500, ge=100, le=20000),
) -> dict[str, Any]:
    try:
        events = fetch_cneos_events(limit)
        _save_json(REAL_DATA_FILE, events)
    except DataSourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "message": "Real NASA CNEOS dataset synced",
        "saved_events": len(events),
        "dataset_file": str(REAL_DATA_FILE),
    }


@app.get("/events")
def get_events(
    source: Literal["auto", "mock", "real"] = Query(default="auto"),
    q: str | None = Query(default=None, description="Search by event name"),
    date_from: str | None = Query(default=None, description="Filter from YYYY-MM-DD"),
    date_to: str | None = Query(default=None, description="Filter to YYYY-MM-DD"),
    station: str | None = Query(default=None, description="Filter by station name"),
) -> list[dict[str, Any]]:
    try:
        events = load_events(source)
    except DataSourceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return apply_filters(events, q, date_from, date_to, station)


@app.get("/events/{event_id}")
def get_event(
    event_id: int,
    source: Literal["auto", "mock", "real"] = Query(default="auto"),
) -> dict[str, Any]:
    return get_event_by_id(event_id, source)


@app.get("/trajectory/{event_id}")
def get_trajectory(
    event_id: int,
    source: Literal["auto", "mock", "real"] = Query(default="auto"),
) -> dict[str, Any]:
    event = get_event_by_id(event_id, source)
    return {
        "event_id": event_id,
        "name": event["name"],
        "points": event["trajectory_points"],
    }


@app.get("/compare")
def compare_events(
    left: int = Query(..., description="Left event id"),
    right: int = Query(..., description="Right event id"),
    source: Literal["auto", "mock", "real"] = Query(default="auto"),
) -> dict[str, Any]:
    left_event = get_event_by_id(left, source)
    right_event = get_event_by_id(right, source)

    return {
        "left": {
            "id": left_event["id"],
            "name": left_event["name"],
            "velocity_km_s": left_event["velocity_km_s"],
            "avg_velocity_km_s": round(
                sum(left_event["velocity_km_s"]) / len(left_event["velocity_km_s"]), 2
            ),
        },
        "right": {
            "id": right_event["id"],
            "name": right_event["name"],
            "velocity_km_s": right_event["velocity_km_s"],
            "avg_velocity_km_s": round(
                sum(right_event["velocity_km_s"]) / len(right_event["velocity_km_s"]), 2
            ),
        },
    }
