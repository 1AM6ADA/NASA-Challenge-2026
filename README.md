# Burning Calendar

Harmonized MODIS + VIIRS hotspot calendar (NASA Space Apps 2026). The website is also the presentation.

## Run
    python3 pipeline/01_ingest.py central_asia MODIS_SP VIIRS_SNPP_SP   # needs FIRMS_MAP_KEY in .env, resumable
    python3 pipeline/02_clean.py        # raw CSV -> data/clean/points_<year>.pkl
    python3 pipeline/03_aggregate.py    # 1 km cell-days -> tile x month
    python3 pipeline/04_calibrate.py    # MODIS vs VIIRS on the overlap, pick model
    python3 pipeline/05_harmonize.py    # one series, VIIRS-equivalent
    python3 pipeline/06_export.py       # web/data/*
    python3 pipeline/07_countries.py    # country membership for the "Country" tool
    python3 api/server.py               # http://localhost:8000  (story) and /explore.html (explorer)

Needs Python 3 with pandas and numpy only. The charts read precomputed files in web/data;
the server only streams raw hotspots for the CSV download.

## Method
Counting unit: unique 1 km cell-days with fire. MODIS (Terra+Aqua) is calibrated to VIIRS SNPP on
2012-02..2018-12, tested on 2019-01..2026-07. Pre-Aqua months (2000-11..2002-06) are first scaled
from Terra to Terra+Aqua. See data/agg/calibration_metrics.json.

## World coverage
pipeline/regions.py splits the globe into ten boxes. 01_ingest.py takes any of them
(`python3 pipeline/01_ingest.py europe MODIS_SP VIIRS_SNPP_SP ...`); 02 to 07 pick up every region that has data.
The map already covers the world and shows which boxes are loaded. Only central_asia is downloaded so far.

## Data in this repository
Committed: `web/data/` (what the site reads), `data/agg/` (tile x month counts, calibration, harmonized series) and
`data/boundaries/`. With these, `python3 pipeline/04_calibrate.py` ... `07_countries.py` and the site work right after
`git clone`; no download is needed.

Not committed (too large for GitHub): `data/raw/` (1.6 GB FIRMS downloads) and `data/clean/` (2 GB per-year points).
The site works without `data/clean/`, only the "download hotspots as CSV" endpoint then returns no rows.
To rebuild them: put `FIRMS_MAP_KEY=...` in `.env`, run `01_world.py`, `02_clean.py`, `03_aggregate.py`, then 04 to 07.

## Docker
    docker compose up -d --build                           # site on http://localhost:8000
    docker compose --profile pipeline run --rm pipeline    # re-run steps 04-07 on the committed data/
