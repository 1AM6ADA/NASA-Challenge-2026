"""Clean raw FIRMS CSVs into per-year point files with grid ids (pandas only).

Keeps vegetation-fire detections (type 0) above the confidence floor
(MODIS >= 30, VIIRS nominal/high); near-real-time files, which have no type flag,
lose the static sources known from the standard archive and tags each point with a ~1 km cell
(0.01 deg) and a 0.25 deg tile. Writes data/clean/points_<year>.pkl.
Usage: python3 pipeline/02_clean.py [region ...]   (default: every completely downloaded region)
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
from regions import loaded_regions

ONLY = sys.argv[1:] or loaded_regions(ROOT)
OUT = ROOT / "data/clean"
OUT.mkdir(parents=True, exist_ok=True)

SENSOR = {"MODIS": "MODIS", "VIIRS_SNPP": "VIIRS_SNPP", "VIIRS_NOAA20": "VIIRS_NOAA20", "VIIRS_NOAA21": "VIIRS_NOAA21"}
USE = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "frp", "daynight", "type"]


def sensor_of(source):
    for k in SENSOR:
        if source.startswith(k):
            return SENSOR[k]
    raise ValueError(source)


frames = []
for src_dir in sorted(p for r in ONLY for p in (ROOT / "data/raw").glob(f"*/{r}")):
    source = src_dir.parent.name
    if source in ("modis", "viirs"):  # empty placeholder folders
        continue
    for f in sorted([*src_dir.glob("*/*.csv"), *src_dir.glob("*/*.csv.gz")]):
        if f.stat().st_size < (60 if f.suffix == ".gz" else 200):  # header-only file
            continue
        d = pd.read_csv(f, usecols=lambda c: c in USE, dtype={"confidence": str, "acq_time": int})
        if "type" not in d:  # near-real-time files carry no fire-type flag
            d["type"] = -1
        d["sensor"] = sensor_of(source)
        d["nrt"] = source.endswith("_NRT")
        frames.append(d)
    print(source, src_dir.name, "read")

df = pd.concat(frames, ignore_index=True)
is_modis = df["sensor"] == "MODIS"
conf_ok = np.where(is_modis, pd.to_numeric(df["confidence"], errors="coerce") >= 30, df["confidence"].isin(["n", "h"]))
df = df[conf_ok]
df["ix"] = np.floor(df["longitude"] * 100).astype(np.int32)
df["iy"] = np.floor(df["latitude"] * 100).astype(np.int32)


def cell_key(d):  # one integer per (sensor family, 0.01 degree cell)
    fam = (d["sensor"] != "MODIS").astype(np.int64)
    return fam * 10**9 + (d["ix"].astype(np.int64) + 18000) * 20000 + (d["iy"].astype(np.int64) + 9000)


# Near-real-time files cannot tell vegetation fires from gas flares and industrial sources.
# The standard archive can, so cells it flags as non-vegetation become a static-source mask.
static = set(cell_key(df[(~df["nrt"]) & (df["type"] > 0)]).unique())
drop = df["nrt"] & cell_key(df).isin(static)
print(f"static-source mask: {len(static)} cells; removed {int(drop.sum())} of {int(df['nrt'].sum())} near-real-time detections")
df = df[~drop & ((df["type"] == 0) | df["nrt"])].drop(columns=["type", "nrt"])
df = df.rename(columns={"latitude": "lat", "longitude": "lon", "acq_date": "date", "acq_time": "time",
                        "satellite": "sat", "confidence": "conf"})
df["date"] = pd.to_datetime(df["date"])
df["tx"] = np.floor(df["lon"] * 4).astype(np.int16)
df["ty"] = np.floor(df["lat"] * 4).astype(np.int16)
for c in ("sensor", "sat", "conf", "daynight"):
    df[c] = df[c].astype("category")

for y, g in df.groupby(df["date"].dt.year):
    g.reset_index(drop=True).to_pickle(OUT / f"points_{y}.pkl")

last = {s: str(g["date"].max().date()) for s, g in df.groupby("sensor", observed=True)}
(ROOT / "data/agg").mkdir(parents=True, exist_ok=True)
(ROOT / "data/agg/last_dates.json").write_text(json.dumps(last))
print(len(df), "points kept;", df.groupby(["sensor", "sat"], observed=True).size().to_dict())
print("last dates:", last)
