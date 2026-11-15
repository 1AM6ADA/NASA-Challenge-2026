"""Clean raw FIRMS CSVs into per-year point files with grid ids (pandas only).

Keeps vegetation-fire detections (type 0) above the confidence floor
(MODIS >= 30, VIIRS nominal/high); near-real-time files, which have no type flag,
lose the static sources known from the standard archive and tags each point with a ~1 km cell
(0.01 deg) and a 0.25 deg tile. Writes data/clean/points_<year>.pkl.
Usage: python3 pipeline/02_clean.py [region ...]   (default: every completely downloaded region)
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
from regions import loaded_regions

ONLY = sys.argv[1:] or loaded_regions(ROOT)
OUT = Path(os.environ.get("CLEAN_OUT", ROOT / "data/clean"))
OUT.mkdir(parents=True, exist_ok=True)

SENSOR = {"MODIS": "MODIS", "VIIRS_SNPP": "VIIRS_SNPP", "VIIRS_NOAA20": "VIIRS_NOAA20", "VIIRS_NOAA21": "VIIRS_NOAA21"}
USE = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "frp", "daynight", "type"]


def sensor_of(source):
    for k in SENSOR:
        if source.startswith(k):
            return SENSOR[k]
    raise ValueError(source)


def clean_columns(df):
    df = df.rename(columns={"latitude": "lat", "longitude": "lon", "acq_date": "date", "acq_time": "time",
                            "satellite": "sat", "confidence": "conf"})
    df["date"] = pd.to_datetime(df["date"])
    df["tx"] = np.floor(df["lon"] * 4).astype(np.int16)
    df["ty"] = np.floor(df["lat"] * 4).astype(np.int16)
    for c in ("sensor", "sat", "conf", "daynight"):
        df[c] = df[c].astype("category")
    return df



def year_files(year):
    for r in ONLY:
        for src_dir in sorted((ROOT / "data/raw").glob(f"*/{r}")):
            source = src_dir.parent.name
            if source in ("modis", "viirs"):  # empty placeholder folders
                continue
            for f in sorted([*(src_dir / str(year)).glob("*.csv"), *(src_dir / str(year)).glob("*.csv.gz")]):
                if f.stat().st_size >= (60 if f.suffix == ".gz" else 200):  # skip header-only files
                    yield source, f


def years_present():
    return sorted({int(p.name) for r in ONLY for p in (ROOT / "data/raw").glob(f"*/{r}/*") if p.is_dir() and p.name.isdigit()})


def cell_key(d):  # one integer per (sensor family, 0.01 degree cell)
    fam = (d["sensor"] != "MODIS").astype(np.int64)
    return fam * 10**9 + (d["ix"].astype(np.int64) + 18000) * 20000 + (d["iy"].astype(np.int64) + 9000)


# Near-real-time files cannot tell vegetation fires from gas flares and industrial sources.
# The standard archive can, so cells it flags as non-vegetation become a static-source mask.
# Years are processed oldest first, one at a time (memory stays at one year, however many regions),
# and the near-real-time months come last, so the mask is complete when they are cleaned.
static = np.empty(0, dtype=np.int64)
last, total, by_sat = {}, 0, {}
pending = {}  # date year -> cleaned frames; a 5-day download window can run over New Year


def flush(upto):
    global total
    for y in sorted(k for k in pending if k <= upto):
        df = pd.concat(pending.pop(y), ignore_index=True)
        df.to_pickle(OUT / f"points_{y}.pkl")
        total += len(df)
        for s, g in df.groupby("sensor", observed=True):
            last[s] = max(last.get(s, ""), str(g["date"].max().date()))
        for k, n in df.groupby(["sensor", "sat"], observed=True).size().items():
            by_sat[k] = by_sat.get(k, 0) + int(n)


for year in years_present():
    frames = []
    for source, f in year_files(year):
        d = pd.read_csv(f, usecols=lambda c: c in USE, dtype={"confidence": str, "acq_time": int})
        if "type" not in d:  # near-real-time files carry no fire-type flag
            d["type"] = -1
        d["sensor"] = sensor_of(source)
        d["nrt"] = source.endswith("_NRT")
        frames.append(d)
    if not frames:
        continue
    df = pd.concat(frames, ignore_index=True)
    del frames
    is_modis = df["sensor"] == "MODIS"
    conf_ok = np.where(is_modis, pd.to_numeric(df["confidence"], errors="coerce") >= 30, df["confidence"].isin(["n", "h"]))
    df = df[conf_ok]
    df["ix"] = np.floor(df["longitude"] * 100).astype(np.int32)
    df["iy"] = np.floor(df["latitude"] * 100).astype(np.int32)
    static = np.union1d(static, cell_key(df[(~df["nrt"]) & (df["type"] > 0)]).unique())
    drop = df["nrt"] & cell_key(df).isin(static)
    print(f"{year}: static-source mask {len(static)} cells; removed {int(drop.sum())} of {int(df['nrt'].sum())} near-real-time detections", flush=True)
    df = df[~drop & ((df["type"] == 0) | df["nrt"])].drop(columns=["type", "nrt"])
    df = clean_columns(df)
    for y, g in df.groupby(df["date"].dt.year):
        pending.setdefault(int(y), []).append(g)
    flush(year)
flush(10**6)

(ROOT / "data/agg").mkdir(parents=True, exist_ok=True)
(ROOT / "data/agg/last_dates.json").write_text(json.dumps(last))
print(total, "points kept;", by_sat)
print("last dates:", last)
