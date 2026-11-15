"""Export the harmonized matrix and chart series for the website.

web/data/meta.json      tiles, months, month sources, calibration summary
web/data/matrix.bin     uint16 little-endian, tiles x months, row-major (harmonized cell-days x scale)
web/data/series.json    region monthly totals: raw MODIS, raw VIIRS, harmonized
"""
import json

import numpy as np
from harmonize_lib import ROOT
from regions import REGIONS, loaded_regions

OUT = ROOT / "web/data"
OUT.mkdir(parents=True, exist_ok=True)

z = np.load(ROOT / "data/agg/harmonized.npz")
H, CAL, M, V, T, tiles = z["H"], z["CAL"], z["M"], z["V"], z["T"], z["tiles"]
N20, N21, R20, R21 = z["N20"], z["N21"], z["R20"], z["R21"]
meta = json.loads((ROOT / "data/agg/harmonized_meta.json").read_text())
cal = json.loads((ROOT / "data/agg/calibration_metrics.json").read_text())

keep = H.sum(1) > 0  # drop tiles that never burn
H, CAL, M, V, T, tiles = H[keep], CAL[keep], M[keep], V[keep], T[keep], tiles[keep]
N20, N21, R20, R21 = N20[keep], N21[keep], R20[keep], R21[keep]

SCALE = int(min(32, 65535 // (H.max() + 1)))  # fixed-point: cell-days x SCALE, so small rescaled counts keep their fractions
assert SCALE >= 1
(OUT / "matrix.bin").write_bytes(np.rint(H * SCALE).astype("<u2").tobytes())

months = meta["months"]
loaded = set(loaded_regions(ROOT))
coverage = [{"name": n, "bbox": list(b), "loaded": n in loaded} for n, b in REGIONS.items()]
(OUT / "meta.json").write_text(json.dumps({
    "coverage": coverage,
    "scale": SCALE,
    "tile_size": 0.25,
    "tiles": tiles.tolist(),          # [tx, ty]; lon0 = tx * 0.25, lat0 = ty * 0.25
    "months": months,
    "source": meta["source"],
    "model": meta["model"],
    "viirs_last_full": meta["viirs_last_full"],
    "modis_last_full": meta["modis_last_full"],
    "partial": meta["partial"],
    "calibration": {"train": cal["train"], "test": cal["test"],
                    "metrics_on_test": cal["metrics_on_test"], "noaa": cal["noaa"]},
}, separators=(",", ":")))

def est_series(N):
    """Region totals of a NOAA estimate; null before the satellite flew (stored as -1 per tile)."""
    tot = np.where(N < 0, 0, N).sum(0)
    return [None if (N[:, i] < 0).all() else int(round(t)) for i, t in enumerate(tot)]


(OUT / "series.json").write_text(json.dumps({
    "noaa20_raw": R20.sum(0).round().astype(int).tolist(),
    "noaa21_raw": R21.sum(0).round().astype(int).tolist(),
    "noaa20_cal": est_series(N20),
    "noaa21_cal": est_series(N21),
    "months": months,
    "modis_raw": M.sum(0).round().astype(int).tolist(),
    "viirs_raw": V.sum(0).round().astype(int).tolist(),
    "harmonized": H.sum(0).round().astype(int).tolist(),
    "modis_cal": CAL.sum(0).round().astype(int).tolist(),
}, separators=(",", ":")))

print(f"{len(tiles)} burning tiles x {len(months)} months -> "
      f"{(OUT / 'matrix.bin').stat().st_size / 1e6:.1f} MB matrix.bin")
