"""Download the globe region by region: resumable, gzip, with a disk guard and a status file.

Per region: MODIS and Suomi NPP standard archives (the long record), NOAA-20 from 2023 (calibration
overlap) and the near-real-time sources. A region gets a marker in data/raw/_done/ only when every
window arrived, so the website never shows half a region as loaded.
Usage: python3 pipeline/01_world.py [region ...]     (default: all regions, smallest first)
"""
import importlib
import json
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

ing = importlib.import_module("01_ingest")
ROOT = ing.ROOT
ORDER = ["europe", "south_asia", "east_asia", "southeast_asia", "oceania", "north_asia", "latin_america", "north_america", "africa"]
SOURCES = ["MODIS_SP", "VIIRS_SNPP_SP", "VIIRS_NOAA20_SP", "MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT"]
RANGE = dict(ing.SOURCE_RANGE, VIIRS_NOAA20_SP=(date(2023, 1, 1), date(2026, 9, 1)))
WORKERS = 8
MIN_FREE_GB = 12
DONE = ROOT / "data/raw/_done"
STATUS = ROOT / "logs/world_status.json"


def windows(region):
    for s in SOURCES:
        d, last = RANGE[s]
        while d <= last:
            yield (s, region, d)
            d += timedelta(days=5)


def free_gb():
    return shutil.disk_usage(ROOT).free / 1e9


def main():
    regions = sys.argv[1:] or ORDER
    DONE.mkdir(parents=True, exist_ok=True)
    t0, rows_total, done_total = time.time(), 0, 0
    for region in regions:
        if (DONE / region).exists():
            print(region, "already complete", flush=True)
            continue
        jobs = list(windows(region))
        for attempt in range(3):  # failed windows get two more passes
            failed, finished = [], 0
            with ThreadPoolExecutor(WORKERS) as ex:
                for job, res in zip(jobs, ex.map(ing.job, jobs)):
                    finished += 1
                    if res == "fail":
                        failed.append(job)
                    elif res.startswith("ok"):
                        rows_total += int(res.split()[1])
                    if finished % 40 == 0 or finished == len(jobs):
                        done_total += 40 if finished % 40 == 0 else finished % 40
                        st = {"region": region, "attempt": attempt + 1, "region_done": finished, "region_total": len(jobs),
                              "failed_so_far": len(failed), "rows": rows_total, "free_gb": round(free_gb(), 1),
                              "elapsed_h": round((time.time() - t0) / 3600, 2), "updated": time.strftime("%H:%M:%S")}
                        STATUS.write_text(json.dumps(st))
                        print(json.dumps(st), flush=True)
                        if free_gb() < MIN_FREE_GB:
                            print(f"stopping: only {free_gb():.1f} GB free", flush=True)
                            ex.shutdown(wait=False, cancel_futures=True)
                            return
            if not failed:
                break
            jobs = failed
        if failed:
            print(region, "incomplete,", len(failed), "windows failed; rerun to retry", flush=True)
            continue
        (DONE / region).write_text(time.strftime("%Y-%m-%d %H:%M"))
        print(region, "COMPLETE", flush=True)


if __name__ == "__main__":
    main()
