"""Country membership for the study box, from the Natural Earth boundaries in world-atlas.

Writes
  web/data/countries.json        name, area (km2 of the part inside the box), burning-tile indices
  data/boundaries/countries.json rings per country, used by the CSV endpoint
Area is summed over *all* 0.25 deg cells of the box whose centre is inside the country, so it does
not depend on which tiles ever burned.
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
from regions import REGIONS, loaded_regions

_loaded = [REGIONS[n] for n in loaded_regions(ROOT)]
BOX = (min(b[0] for b in _loaded), min(b[1] for b in _loaded), max(b[2] for b in _loaded), max(b[3] for b in _loaded))  # union of loaded regions
S = 0.25

topo = json.loads((ROOT / "web/vendor/countries-50m.json").read_text())
sx, sy = topo["transform"]["scale"]
tx, ty = topo["transform"]["translate"]
arcs = []
for a in topo["arcs"]:
    x = y = 0
    pts = []
    for dx, dy in a:
        x += dx
        y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(np.array(pts))


def ring(idx):
    out = []
    for i in idx:
        pts = arcs[i] if i >= 0 else arcs[~i][::-1]
        out.extend(pts if not out else pts[1:])
    return np.array(out)


def rings_of(geom):
    polys = geom["arcs"] if geom["type"] == "MultiPolygon" else [geom["arcs"]]
    return [ring(r) for poly in polys for r in poly]


def parity(rings, lon, lat):
    """Even-odd point-in-polygon over all rings together (holes fall out of the parity)."""
    ok = np.zeros(lon.shape, dtype=bool)
    for r in rings:
        x0, y0 = r[:-1, 0], r[:-1, 1]
        x1, y1 = r[1:, 0], r[1:, 1]
        for a, b, c, d in zip(x0, y0, x1, y1):
            if a == c and b == d:
                continue
            cross = ((b > lat) != (d > lat)) & (lon < (c - a) * (lat - b) / (d - b) + a)
            ok ^= cross
    return ok


meta = json.loads((ROOT / "web/data/meta.json").read_text())
tile_index = {(x, y): i for i, (x, y) in enumerate(meta["tiles"])}
txs = np.arange(int(np.floor(BOX[0] / S)), int(np.ceil(BOX[2] / S)))
tys = np.arange(int(np.floor(BOX[1] / S)), int(np.ceil(BOX[3] / S)))
TX, TY = np.meshgrid(txs, tys)
lon, lat = (TX + 0.5) * S, (TY + 0.5) * S
area = S * 111.32 * np.cos(np.radians(lat)) * S * 110.57

countries, boundaries = [], {}
for g in topo["objects"]["countries"]["geometries"]:
    name = g.get("properties", {}).get("name")
    rs = rings_of(g)
    keep = [r for r in rs if r[:, 0].max() >= BOX[0] and r[:, 0].min() <= BOX[2]
            and r[:, 1].max() >= BOX[1] and r[:, 1].min() <= BOX[3]]
    if not name or not keep:
        continue
    inside = parity(keep, lon, lat)
    if not inside.any():
        continue
    idx = [tile_index[(int(x), int(y))] for x, y in zip(TX[inside], TY[inside]) if (int(x), int(y)) in tile_index]
    countries.append({"name": name, "km2": round(float(area[inside].sum())), "tiles": idx})
    boundaries[name] = [r.round(4).tolist() for r in keep]
    print(f"{name:28s} {len(idx):5d} burning tiles, {area[inside].sum():>12,.0f} km2")

countries.sort(key=lambda c: -c["km2"])
(ROOT / "web/data/countries.json").write_text(json.dumps(countries, separators=(",", ":")))
(ROOT / "data/boundaries").mkdir(parents=True, exist_ok=True)
(ROOT / "data/boundaries/countries.json").write_text(json.dumps(boundaries, separators=(",", ":")))
print(len(countries), "countries")
