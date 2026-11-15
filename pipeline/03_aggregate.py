"""Dedupe to 1 km cell-days and aggregate to tile x month (pandas only).

The counting unit is a unique (cell, day) with fire per sensor group, so the
375 m VIIRS pixels that fall in one 1 km cell on one day count once.
MODIS merges Terra + Aqua; MODIS_TERRA is kept for the pre-Aqua period.
"""
from pathlib import Path

import json

import pandas as pd
from regions import loaded_regions

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/agg/tile_month.pkl.xz"  # xz keeps it small enough for git (12 MB instead of 123 MB)

(ROOT / "data/agg/loaded_regions.json").write_text(json.dumps(loaded_regions(ROOT)))
parts = []
for f in sorted((ROOT / "data/clean").glob("points_*.pkl")):
    d = pd.read_pickle(f)
    d["sensor"] = d["sensor"].astype(str)
    d["sat"] = d["sat"].astype(str)
    groups = [d, d[(d["sensor"] == "MODIS") & (d["sat"] == "Terra")].assign(sensor="MODIS_TERRA")]
    for g in groups:
        cd = g.groupby(["sensor", "tx", "ty", "ix", "iy", "date"], as_index=False, observed=True)["frp"].max()
        cd["month"] = cd["date"].dt.to_period("M").dt.to_timestamp()
        agg = cd.groupby(["sensor", "tx", "ty", "month"], as_index=False).agg(n=("frp", "size"), frp_sum=("frp", "sum"))
        parts.append(agg)
    print(f.name, "done", flush=True)

res = pd.concat(parts, ignore_index=True)
# a month never spans two year files, so there is nothing to merge across parts
res = res.sort_values(["sensor", "month", "ty", "tx"]).reset_index(drop=True)
res.to_pickle(OUT)
print(res.groupby("sensor").agg(rows=("n", "size"), tiles=("tx", "nunique"), cell_days=("n", "sum"),
                                first=("month", "min"), last=("month", "max")))
