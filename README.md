# Meteor Platform (Astrathon Multi-Source Build)

This build runs the ORION Astrathon meteor platform with live multi-source ingestion and backend-first computation.

## Integrated Datasets

- Global Meteor Network (GMN) daily trajectory summary
- NASA/JPL Fireball API (CNEOS)
- American Meteor Society (AMS) event listings
- FRIPON data-release pipeline feed
- IAU Meteor Data Centre stream list (for shower association)

## Technology Stack

- Frontend: React, Tailwind CSS, Globe + Plotly visualisation
- Backend: FastAPI, NumPy, SciPy, Pandas
- Astronomy libraries: Astropy, Skyfield
- Storage: SQLite/PostgreSQL via SQLAlchemy, optional Redis cache

## Project Structure

```text
meteor-project
|-- backend
|   |-- main.py
|   `-- requirements.txt
|-- dataset
|   |-- real_events.json          (NASA snapshot)
|   |-- gmn_events.json
|   |-- ams_events.json
|   |-- fripon_events.json
|   |-- iau_showers.json
|   |-- meteor.db
|   `-- subscribers.json
`-- frontend
    |-- src
    |   |-- App.jsx
    |   |-- App.css
    |   `-- main.jsx
    `-- package.json
```

## 1) Run Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Optional env vars:

- `DATABASE_URL`
- `REDIS_URL`
- `CACHE_TTL_SECONDS`
- SMTP vars for notifications (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_SENDER`)

Key API endpoints:

- `GET /health`
- `GET /sources`
- `GET /project-status`
- `GET /data-status`
- `GET /dataset-range?source=nasa|gmn|ams|fripon`
- `POST /sync-source/{source}?limit=...` where source is `nasa|gmn|ams|fripon|iau`
- `POST /sync-required-datasets?limit_per_event_source=...`
- `POST /sync-real-events?limit=...` (legacy alias for NASA sync)
- `GET /events?source=nasa|gmn|ams|fripon`
- `GET /process_meteor/{event_id}?source=...`
- `GET /fetch_orbit/{event_id}?source=...`
- `GET /compare_events?left=...&right=...&source=...`
- Notifications endpoints under `/notifications/*`

First-time data load:

1. Start backend
2. Open `http://127.0.0.1:8000/docs`
3. Run `POST /sync-required-datasets`

## 2) Run Frontend

```bash
cd frontend
copy .env.example .env
npm.cmd install
npm.cmd run dev
```

Frontend supports source selection (`NASA`, `GMN`, `AMS`, `FRIPON`) plus:

- `Sync Selected Source`
- `Sync Required Datasets`
- source-specific date-range validation and filtering

## 3) Demo Flow

1. Sync required datasets from UI or API
2. Select a source and open event catalogue
3. Visualize trajectory on globe and velocity profile
4. Run `/process_meteor` and inspect residual diagnostics + shower match
5. Run `/fetch_orbit` and inspect heliocentric elements
6. Compare two events and dispatch notification demo

## 4) Deploy Notes

- Frontend: Vercel (`VITE_API_URL` must point to backend URL)
- Backend: Render/Railway
- Database: Supabase/Neon PostgreSQL URL in `DATABASE_URL`
