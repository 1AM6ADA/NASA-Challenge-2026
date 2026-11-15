"""Download FIRMS active-fire hotspots in 5-day windows, resumable.

Usage: python3 pipeline/01_ingest.py REGION SOURCE [SOURCE ...]
Files land in data/raw/<SOURCE>/<REGION>/<YYYY>/<start>.csv; existing files are skipped.
"""
import gzip
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://firms.modaps.eosdis.nasa.gov"

from regions import REGIONS, area_string
# (first day, last day to request). Standard-processing archives lag a few months, so the
# near-real-time sources take over where SP runs dry; overlaps are harmless (deduped later).
TODAY = date.today()
SOURCE_RANGE = {
    "MODIS_SP": (date(2000, 11, 1), date(2026, 11, 1)),
    "VIIRS_SNPP_SP": (date(2012, 1, 20), date(2026, 11, 1)),
    "VIIRS_NOAA20_SP": (date(2018, 4, 1), date(2026, 9, 1)),
    "VIIRS_NOAA21_SP": (date(2023, 3, 1), date(2026, 9, 1)),
    "MODIS_NRT": (date(2026, 9, 1), TODAY),
    "VIIRS_SNPP_NRT": (date(2026, 8, 1), date(2026, 11, 3)),
    "VIIRS_NOAA20_NRT": (date(2026, 8, 1), TODAY),
    "VIIRS_NOAA21_NRT": (date(2026, 8, 1), TODAY),
}
WORKERS = 3
BUDGET = 4000  # stay under the 5000 / 10 min transaction limit


def load_key():
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("FIRMS_MAP_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("FIRMS_MAP_KEY missing in .env")


KEY = load_key()


def used_transactions():
    try:
        with urllib.request.urlopen(f"{BASE}/mapserver/mapkey_status/?MAP_KEY={KEY}", timeout=30) as r:
            return json.load(r)["current_transactions"]
    except Exception:
        return 0


def fetch(source, area, start):
    url = f"{BASE}/api/area/csv/{KEY}/{source}/{area}/5/{start.isoformat()}"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                text = r.read().decode()
            if text.startswith("latitude"):
                return text
        except Exception:
            pass
        time.sleep(5 * (attempt + 1))
    return None


def job(args):
    source, region, start = args
    folder = ROOT / "data/raw" / source / region / str(start.year)
    out = folder / f"{start.isoformat()}.csv.gz"
    if out.exists() or out.with_suffix("").exists():  # earlier runs wrote plain .csv
        return "skip"
    while used_transactions() > BUDGET:
        time.sleep(30)
    text = fetch(source, area_string(region), start)
    if text is None:
        return "fail"
    folder.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    with gzip.open(tmp, "wt") as fh:
        fh.write(text)
    tmp.rename(out)  # a half-written file never looks finished
    return f"ok {max(text.count(chr(10)) - 1, 0)}"


def main():
    region, sources = sys.argv[1], sys.argv[2:]
    jobs = []
    for s in sources:
        d, last = SOURCE_RANGE[s]
        while d <= last:
            jobs.append((s, region, d))
            d += timedelta(days=5)
    done = rows = fail = 0
    t0 = time.time()
    with ThreadPoolExecutor(WORKERS) as ex:
        for res in ex.map(job, jobs):
            done += 1
            if res == "fail":
                fail += 1
            elif res.startswith("ok"):
                rows += int(res.split()[1])
            if done % 25 == 0 or done == len(jobs):
                print(f"{time.strftime('%H:%M:%S')} {done}/{len(jobs)} windows, "
                      f"{rows} rows, {fail} failed, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
