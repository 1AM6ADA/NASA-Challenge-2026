"""Compare MODIS and VIIRS on their overlap, pick the best calibration, save it.

Train on 2012-02..2018-12, test on 2019-01..last full VIIRS month. Candidates are
a pooled ratio by calendar month, a tile ratio shrunk toward the pooled one, and a
log-log regression by calendar month. The Terra-only factor (to lift the 2000-11..2002-06
Terra-only months to a Terra+Aqua equivalent) is estimated on 2002-08..2011-12.
"""
import json
import pickle

import numpy as np
import pandas as pd
from harmonize_lib import (AQUA_FULL, MODELS, ROOT, TRAIN_END, VIIRS_FIRST_FULL, cal_index,
                           last_full_month, load_dense)

viirs_last = last_full_month("VIIRS_SNPP")
tiles, months, S = load_dense(viirs_last)
cal = cal_index(months)
M, V, T = S["MODIS"], S["VIIRS_SNPP"], S["MODIS_TERRA"]
print(f"{len(tiles)} tiles, {len(months)} months ({months[0]}..{months[-1]}), VIIRS last full {viirs_last}")

pos = {m: i for i, m in enumerate(months)}
train = np.arange(pos[VIIRS_FIRST_FULL], pos[TRAIN_END] + 1)
test = np.arange(pos[TRAIN_END] + 1, pos[viirs_last] + 1)


def metrics(pred, obs):
    err = pred - obs
    tot_p, tot_o = pred.sum(0), obs.sum(0)  # monthly totals over the whole region
    ss = ((tot_o - tot_o.mean()) ** 2).sum()
    return {
        "tile_mae": float(np.abs(err).mean() * 1000),  # per 1000 tile-months
        "tile_corr": float(np.corrcoef(pred.ravel(), obs.ravel())[0, 1]),
        "region_r2": float(1 - ((tot_p - tot_o) ** 2).sum() / ss),
        "region_mape_pct": float(np.mean(np.abs(tot_p - tot_o) / np.maximum(tot_o, 1)) * 100),
        "region_bias_pct": float((tot_p.sum() / tot_o.sum() - 1) * 100),
    }


results, fitted = {}, {}
raw = metrics(M[:, test], V[:, test])
results["raw_modis_no_calibration"] = raw
for name, (fit, predict) in MODELS.items():
    p = fit(M[:, train], V[:, train], cal[train])
    results[name] = metrics(predict(p, M[:, test], cal[test]), V[:, test])
    print(f"{name:14s}", {k: round(v, 3) for k, v in results[name].items()})
print(f"{'raw MODIS':14s}", {k: round(v, 3) for k, v in raw.items()})

# lowest region MAPE among models with small bias; tile-level error breaks ties
cands = {n: r for n, r in results.items() if n in MODELS and abs(r["region_bias_pct"]) < 15}
best = min(cands or {n: results[n] for n in MODELS},
           key=lambda n: results[n]["region_mape_pct"] + results[n]["tile_mae"] / 10)
print("chosen:", best)

# final fit on the whole overlap
allov = np.arange(pos[VIIRS_FIRST_FULL], pos[viirs_last] + 1)
final = MODELS[best][0](M[:, allov], V[:, allov], cal[allov])

# Terra-only -> Terra+Aqua factor by calendar month
both = np.arange(pos[AQUA_FULL], pos[VIIRS_FIRST_FULL])
f = np.array([M[:, both][:, cal[both] == c].sum() / max(T[:, both][:, cal[both] == c].sum(), 1.0)
              for c in range(12)])
print("terra->terra+aqua factor by month:", np.round(f, 2).tolist())


# ---- NOAA-20 / NOAA-21 -> Suomi NPP, so the record can continue after SNPP stops ----
def calibrate_noaa(name, start, train_end):
    X = S[name]
    i0, it, i1 = pos[pd.Period(start, "M")], pos[pd.Period(train_end, "M")], pos[viirs_last]
    tr, te = np.arange(i0, it + 1), np.arange(it + 1, i1 + 1)
    # Regions downloaded later have no NOAA record in the early training window; their SNPP counts
    # must not enter the fit (tiles without training data then fall back to the pooled ratio).
    seen = X[:, tr].sum(1) > 0
    Vf = V * seen[:, None]
    rows = X[:, i0:i1 + 1].sum(1) > 0  # judge only tiles this satellite was downloaded for
    res = {"raw_no_calibration": metrics(X[rows][:, te], V[rows][:, te])}
    for n, (fit, predict) in MODELS.items():
        res[n] = metrics(predict(fit(X[:, tr], Vf[:, tr], cal[tr]), X[:, te], cal[te])[rows], V[rows][:, te])
    cands = {n: r for n, r in res.items() if n in MODELS and abs(r["region_bias_pct"]) < 15}
    pick = min(cands or {n: res[n] for n in MODELS}, key=lambda n: res[n]["region_mape_pct"] + res[n]["tile_mae"] / 10)
    allov = np.arange(i0, i1 + 1)
    final = MODELS[pick][0](X[:, allov] * seen[:, None], Vf[:, allov], cal[allov])
    print(f"{name}: train {start}..{train_end}, test {months[it + 1]}..{viirs_last}, chosen {pick}")
    for n, r in res.items():
        print(f"   {n:24s}", {k: round(v, 3) for k, v in r.items()})
    return {"model": pick, "params": final, "train": f"{start}..{train_end}", "test": f"{months[it + 1]}..{viirs_last}", "metrics": res}


noaa = {"VIIRS_NOAA20": calibrate_noaa("VIIRS_NOAA20", "2018-04", "2022-12"),
        "VIIRS_NOAA21": calibrate_noaa("VIIRS_NOAA21", "2023-03", "2025-03")}

(ROOT / "data/agg/calibration.pkl").write_bytes(pickle.dumps(
    {"model": best, "params": final, "terra_factor": f, "viirs_last_full": str(viirs_last), "noaa": noaa}))
(ROOT / "data/agg/calibration_metrics.json").write_text(json.dumps(
    {"chosen": best, "train": "2012-02..2018-12", "test": f"2019-01..{viirs_last}",
     "metrics_on_test": results, "terra_factor": f.tolist(),
     "noaa": {k: {"model": v["model"], "train": v["train"], "test": v["test"], "metrics_on_test": v["metrics"]} for k, v in noaa.items()}}, indent=2))
