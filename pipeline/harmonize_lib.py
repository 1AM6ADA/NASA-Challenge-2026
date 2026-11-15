"""Shared helpers for calibrating MODIS against VIIRS and building the harmonized series."""
import json

import numpy as np
import pandas as pd

ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent
AGG = ROOT / "data/agg/tile_month.pkl.xz"
LAST_DATES = ROOT / "data/agg/last_dates.json"

FIRST_MONTH = pd.Period("2000-11", "M")
AQUA_FULL = pd.Period("2002-08", "M")      # first month with both Terra and Aqua running
VIIRS_FIRST_FULL = pd.Period("2012-02", "M")  # SNPP starts 2012-01-20
TRAIN_END = pd.Period("2018-12", "M")
LAMBDA = 20.0  # shrinkage strength of tile ratios toward the regional ratio (cell-days)


def last_full_month(sensor):
    """Last month whose data run to within 3 days of month end."""
    d = pd.Timestamp(json.loads(LAST_DATES.read_text())[sensor])
    p = pd.Period(d, "M")
    return p if d.day >= p.days_in_month - 3 else p - 1


def load_dense(last_month):
    """Return tiles (T,2), months (list of Period), dict sensor -> float32 (T, Mo)."""
    df = pd.read_pickle(AGG)
    df["month"] = pd.to_datetime(df["month"]).dt.to_period("M")
    tiles = df[["tx", "ty"]].drop_duplicates().sort_values(["ty", "tx"]).to_numpy()
    tidx = {(int(x), int(y)): i for i, (x, y) in enumerate(tiles)}
    months = list(pd.period_range(FIRST_MONTH, last_month, freq="M"))
    midx = {m: i for i, m in enumerate(months)}
    out = {}
    for sensor, g in df.groupby("sensor"):
        a = np.zeros((len(tiles), len(months)), dtype=np.float32)
        g = g[g["month"].isin(midx)]
        ti = np.fromiter((tidx[(x, y)] for x, y in zip(g["tx"], g["ty"])), dtype=int, count=len(g))
        mi = np.fromiter((midx[m] for m in g["month"]), dtype=int, count=len(g))
        a[ti, mi] = g["n"].to_numpy(dtype=np.float32)
        out[sensor] = a
    return tiles, months, out


def cal_index(months):
    return np.array([m.month - 1 for m in months])


# ---- calibration models: fit(M, V, cal) -> params; predict(params, M, cal) -> V_hat ----

def fit_pooled_ratio(M, V, cal):
    k = np.ones(12)
    for c in range(12):
        sel = cal == c
        k[c] = V[:, sel].sum() / max(M[:, sel].sum(), 1.0)
    return {"k": k}


def predict_pooled_ratio(p, M, cal):
    return M * p["k"][cal][None, :]


def fit_tile_ratio(M, V, cal):
    pooled = fit_pooled_ratio(M, V, cal)["k"]
    sv = np.zeros((M.shape[0], 12))
    sm = np.zeros((M.shape[0], 12))
    for c in range(12):
        sel = cal == c
        sv[:, c] = V[:, sel].sum(1)
        sm[:, c] = M[:, sel].sum(1)
    k = (sv + LAMBDA * pooled[None, :]) / (sm + LAMBDA)
    return {"k": k}


def predict_tile_ratio(p, M, cal):
    return M * p["k"][:, cal]


def fit_loglog(M, V, cal):
    a, b, s = np.zeros(12), np.ones(12), np.ones(12)
    for c in range(12):
        sel = cal == c
        m, v = M[:, sel].ravel(), V[:, sel].ravel()
        use = (m > 0) | (v > 0)
        x, y = np.log1p(m[use]), np.log1p(v[use])
        b[c], a[c] = np.polyfit(x, y, 1)
        raw = np.where(m > 0, np.expm1(a[c] + b[c] * np.log1p(m)), 0.0)
        s[c] = v.sum() / max(raw.sum(), 1.0)  # remove back-transform bias
    return {"a": a, "b": b, "s": s}


def predict_loglog(p, M, cal):
    raw = np.expm1(p["a"][cal][None, :] + p["b"][cal][None, :] * np.log1p(M))
    return np.where(M > 0, raw, 0.0) * p["s"][cal][None, :]


MODELS = {
    "pooled_ratio": (fit_pooled_ratio, predict_pooled_ratio),
    "tile_ratio": (fit_tile_ratio, predict_tile_ratio),
    "loglog": (fit_loglog, predict_loglog),
}
