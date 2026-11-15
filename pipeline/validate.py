"""Sanity checks on the built data. Exit code 1 if any hard check fails; warnings do not fail.

Usage: python3 pipeline/validate.py
"""
import json
import sys

import numpy as np
from harmonize_lib import ROOT

WEB = ROOT / "web/data"
errors, warnings = [], []


def check(ok, msg):
    if not ok:
        errors.append(msg)


meta = json.loads((WEB / "meta.json").read_text())
series = json.loads((WEB / "series.json").read_text())
countries = json.loads((WEB / "countries.json").read_text())
cal = json.loads((ROOT / "data/agg/calibration_metrics.json").read_text())
months, tiles, scale = meta["months"], meta["tiles"], meta["scale"]

check(months[0] == "2000-11", f"series starts at {months[0]}, expected 2000-11")
ym = [int(m[:4]) * 12 + int(m[5:7]) for m in months]
check(all(b - a == 1 for a, b in zip(ym, ym[1:])), "months are not contiguous")
check(len(meta["source"]) == len(months), "one source label per month expected")

raw = np.frombuffer((WEB / "matrix.bin").read_bytes(), dtype="<u2")
check(raw.size == len(tiles) * len(months), f"matrix.bin has {raw.size} values, expected {len(tiles) * len(months)}")
if raw.size == len(tiles) * len(months):
    mat = raw.reshape(len(tiles), len(months)) / scale
    check(raw.max() < 65535, "matrix.bin saturates the uint16 range")
    check((mat.sum(1) > 0).all(), "a tile that never burns was exported")
    tot = mat.sum(0)
    diff = np.abs(tot - np.array(series["harmonized"])).max()
    check(diff <= len(tiles) / scale + 1, f"series.json disagrees with matrix.bin by {diff:.0f}")
    full = np.array([m != (meta["partial"] or {}).get("month") for m in months])
    check((tot[full] > 0).all(), "a complete month has zero fire")
    r = tot[1:] / np.maximum(tot[:-1], 1)
    jumps = [months[i + 1] for i in np.where(full[1:] & full[:-1] & ((r > 6) | (r < 1 / 6)))[0]]
    if jumps:
        warnings.append(f"month-to-month total changes more than 6x at {jumps[:8]}")

check(all(0 <= t < len(tiles) for c in countries for t in c["tiles"]), "a country points at a tile that does not exist")
check(len(countries) > 0, "no countries")
test = cal["metrics_on_test"][cal["chosen"]]
check(test["region_r2"] > 0.9, f"chosen MODIS calibration has region R2 {test['region_r2']:.2f} on held-out months")
check(abs(test["region_bias_pct"]) < 10, f"chosen MODIS calibration is biased {test['region_bias_pct']:.1f}%")
for k, v in cal["noaa"].items():
    m = v["metrics_on_test"][v["model"]]
    if m["region_r2"] < 0.9 or abs(m["region_bias_pct"]) > 15:
        warnings.append(f"{k} calibration is weak: R2 {m['region_r2']:.2f}, bias {m['region_bias_pct']:.1f}%")
loaded = [c["name"] for c in meta["coverage"] if c["loaded"]]
check(bool(loaded), "no region is marked as loaded")

for w in warnings:
    print("warning:", w)
for e in errors:
    print("ERROR:", e)
print(f"{len(tiles)} tiles x {len(months)} months, regions {loaded}, model {cal['chosen']}: "
      f"{'FAILED' if errors else 'ok'} ({len(errors)} errors, {len(warnings)} warnings)")
sys.exit(1 if errors else 0)
