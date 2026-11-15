"""Build the harmonized tile x month series, in VIIRS-equivalent (Suomi NPP) cell-days.

  2000-11..2002-06  Terra only      -> Terra+Aqua factor -> calibration
  2002-07..2012-01  MODIS           -> calibration
  2012-02..SNPP end VIIRS SNPP      (native)
  after SNPP        NOAA-20         -> calibration against SNPP (MODIS if NOAA-20 has no data)

The newest month is often incomplete. It is kept, flagged as partial in the metadata, and the
website compares it with a pro-rated normal instead of a full month.
"""
import calendar
import json
import pickle

import numpy as np
import pandas as pd
from harmonize_lib import (MODELS, ROOT, VIIRS_FIRST_FULL, cal_index, last_full_month, load_dense)

cal_pkg = pickle.loads((ROOT / "data/agg/calibration.pkl").read_bytes())
model = cal_pkg["model"]
predict = MODELS[model][1]
viirs_last = pd.Period(cal_pkg["viirs_last_full"], "M")
modis_last = last_full_month("MODIS")

# newest month with NOAA-20 data, and whether it is complete
last_dates = json.loads((ROOT / "data/agg/last_dates.json").read_text())
nd = pd.Timestamp(last_dates["VIIRS_NOAA20"])
dim = calendar.monthrange(nd.year, nd.month)[1]
partial = None
end_month = pd.Period(nd, "M")
if nd.day < dim - 3:                      # month still running
    if nd.day >= 3:
        partial = {"month": str(end_month), "through": str((nd - pd.Timedelta(days=1)).date()), "fraction": (nd.day - 1) / dim}
    else:
        end_month = end_month - 1

tiles, months, S = load_dense(end_month)
cal = cal_index(months)
M, V, T = S["MODIS"], S["VIIRS_SNPP"], S["MODIS_TERRA"]
pos = {m: i for i, m in enumerate(months)}

M_adj = M.copy()
pre = np.arange(0, pos[pd.Period("2002-07", "M")])
M_adj[:, pre] = T[:, pre] * cal_pkg["terra_factor"][cal[pre]][None, :]

H = predict(cal_pkg["params"], M_adj, cal).astype(np.float32)
CAL = H.copy()  # MODIS-derived estimate for every month, kept to show how well it tracks VIIRS
src = np.array(["modis_terra"] * len(months), dtype=object)
src[pos[pd.Period("2002-07", "M")]:] = "modis"
v_idx = np.arange(pos[VIIRS_FIRST_FULL], pos[viirs_last] + 1)
H[:, v_idx] = V[:, v_idx]
src[v_idx] = "viirs"

# NOAA estimates of Suomi NPP counts, for every month the satellite flew
noaa_cal = {}
for name, c in cal_pkg["noaa"].items():
    X = S[name]
    first = pos[pd.Period(next(m for m in months if X[:, pos[m]].sum() > 0), "M")]
    est = MODELS[c["model"]][1](c["params"], X, cal).astype(np.float32)
    est[:, :first] = np.nan
    noaa_cal[name] = est
after = np.arange(pos[viirs_last] + 1, len(months))
for i in after:
    n20 = noaa_cal["VIIRS_NOAA20"][:, i]
    if np.nansum(n20) > 0:
        H[:, i] = n20; src[i] = "noaa20"
    else:
        src[i] = "modis"

np.savez_compressed(ROOT / "data/agg/harmonized.npz", H=H, CAL=CAL, M=M, V=V, T=T, tiles=tiles,
                    N20=np.nan_to_num(noaa_cal["VIIRS_NOAA20"], nan=-1), N21=np.nan_to_num(noaa_cal["VIIRS_NOAA21"], nan=-1),
                    R20=S["VIIRS_NOAA20"], R21=S["VIIRS_NOAA21"])
(ROOT / "data/agg/harmonized_meta.json").write_text(json.dumps({
    "months": [str(m) for m in months], "source": src.tolist(), "model": model, "partial": partial,
    "viirs_last_full": str(viirs_last), "modis_last_full": str(modis_last)}))

tot = H.sum(0)
print(f"{len(tiles)} tiles x {len(months)} months ({months[0]}..{months[-1]}), model={model}, partial={partial}")
for i in after:
    n21 = noaa_cal["VIIRS_NOAA21"][:, i]
    print(months[i], src[i], "harmonized", int(tot[i]), "| NOAA-20 est", int(np.nansum(noaa_cal["VIIRS_NOAA20"][:, i])),
          "| NOAA-21 est", int(np.nansum(n21)), "| MODIS est", int(CAL[:, i].sum()))
