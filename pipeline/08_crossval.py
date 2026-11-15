"""Does the MODIS -> VIIRS calibration travel? Leave one region out.

For each loaded region, fit the calibration on the tiles of the *other* regions (2012-02..2018-12) and score it on
the left-out region's held-out months (2019-01..last full VIIRS month). Only models that need no tile identity
can be applied to unseen tiles, so this tests the pooled ratio and the log-log fit. Also scores the shipped per-tile model on each region's own overlap years for comparison. Writes web/data/crossval.json.
"""
import json

import numpy as np
from harmonize_lib import (MODELS, ROOT, TRAIN_END, VIIRS_FIRST_FULL, cal_index, last_full_month, load_dense)
from regions import REGIONS, loaded_regions

viirs_last = last_full_month("VIIRS_SNPP")
tiles, months, S = load_dense(viirs_last)
cal = cal_index(months)
M, V = S["MODIS"], S["VIIRS_SNPP"]
pos = {m: i for i, m in enumerate(months)}
train = np.arange(pos[VIIRS_FIRST_FULL], pos[TRAIN_END] + 1)
test = np.arange(pos[TRAIN_END] + 1, pos[viirs_last] + 1)

names = loaded_regions(ROOT)
lon, lat = (tiles[:, 0] + 0.5) * 0.25, (tiles[:, 1] + 0.5) * 0.25
owner = np.full(len(tiles), -1)
for i, n in reversed(list(enumerate(names))):  # the first listed region wins in an overlap
    w, s, e, nn = REGIONS[n]
    owner[(lon >= w) & (lon < e) & (lat >= s) & (lat < nn)] = i


def metrics(pred, obs):
    tp, to = pred.sum(0), obs.sum(0)
    return {"region_r2": float(1 - ((tp - to) ** 2).sum() / ((to - to.mean()) ** 2).sum()),
            "region_mape_pct": float(np.mean(np.abs(tp - to) / np.maximum(to, 1)) * 100),
            "region_bias_pct": float((tp.sum() / to.sum() - 1) * 100)}


out = {"train": "2012-02..2018-12", "test": f"2019-01..{viirs_last}", "regions": []}
for i, n in enumerate(names):
    held, rest = owner == i, (owner >= 0) & (owner != i)
    if not held.any() or not rest.any():
        continue
    row = {"region": n, "tiles": int(held.sum()), "raw_modis": metrics(M[held][:, test], V[held][:, test])}
    for model in ("pooled_ratio", "loglog"):
        fit, predict = MODELS[model]
        row[model] = metrics(predict(fit(M[rest][:, train], V[rest][:, train], cal[train]), M[held][:, test], cal[test]), V[held][:, test])
    for model in ("tile_ratio", "block_ratio"):  # the shipped approach: fitted on the region's own overlap years
        fit, predict = MODELS[model]
        row[model + "_own_region"] = metrics(predict(fit(M[:, train], V[:, train], cal[train]), M[:, test], cal[test])[held], V[held][:, test])
    row["best"] = min(("pooled_ratio", "loglog"), key=lambda k: row[k]["region_mape_pct"])
    out["regions"].append(row)
    b, own = row[row["best"]], row["tile_ratio_own_region"]
    print(f"{n:14s} {row['tiles']:6d} tiles  raw MODIS bias {row['raw_modis']['region_bias_pct']:+.0f}%  "
          f"{row['best']}: R2 {b['region_r2']:.2f}, MAPE {b['region_mape_pct']:.1f}%, bias {b['region_bias_pct']:+.1f}%  | own-region tile_ratio: R2 {own['region_r2']:.2f}, MAPE {own['region_mape_pct']:.1f}%, bias {own['region_bias_pct']:+.1f}%")
(ROOT / "web/data/crossval.json").write_text(json.dumps(out, separators=(",", ":")))
