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
BLOCK_TILES = 8  # a block is 8 x 8 tiles (2 x 2 degrees); the middle level of the hierarchical model
LAMBDA_BLOCK = 60.0
_TILES = {}  # set by load_dense: block membership of the tile rows the models are fitted on


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
    _TILES["block"] = np.unique(np.stack([tiles[:, 0] // BLOCK_TILES, tiles[:, 1] // BLOCK_TILES], 1), axis=0, return_inverse=True)[1].ravel()
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


def fit_block_ratio(M, V, cal):
    """Tile ratio shrunk first toward its 2-degree block, and the block toward the pooled ratio.

    Tiles with little data borrow from their neighbours rather than from the whole region,
    which matters once several climates are in one fit. Falls back to the tile model without block info.
    """
    block = _TILES.get("block")
    if block is None or len(block) != M.shape[0]:
        return fit_tile_ratio(M, V, cal)
    pooled = fit_pooled_ratio(M, V, cal)["k"]
    nb = block.max() + 1
    sv_t, sm_t, sv_b, sm_b = (np.zeros((n, 12)) for n in (M.shape[0], M.shape[0], nb, nb))
    for c in range(12):
        sel = cal == c
        sv_t[:, c], sm_t[:, c] = V[:, sel].sum(1), M[:, sel].sum(1)
    np.add.at(sv_b, block, sv_t)
    np.add.at(sm_b, block, sm_t)
    k_block = (sv_b + LAMBDA_BLOCK * pooled[None, :]) / (sm_b + LAMBDA_BLOCK)
    return {"k": (sv_t + LAMBDA * k_block[block]) / (sm_t + LAMBDA)}


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
    "block_ratio": (fit_block_ratio, predict_tile_ratio),
    "loglog": (fit_loglog, predict_loglog),
}
