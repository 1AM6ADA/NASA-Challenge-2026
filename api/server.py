"""Website plus a CSV endpoint for raw hotspots (standard library + pandas only).

Run from the project root:  python3 api/server.py [port]
The charts need nothing from here: everything is precomputed in web/data.
"""
import functools
import os
import gzip
import io
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
MAX_ROWS = 2_000_000
COLS = ["date", "time", "lat", "lon", "sensor", "sat", "conf", "frp", "daynight"]


@functools.lru_cache(maxsize=4)
def year_points(year):
    f = ROOT / f"data/clean/points_{year}.pkl"
    return pd.read_pickle(f) if f.exists() else None


@functools.lru_cache(maxsize=1)
def country_rings():
    f = ROOT / "data/boundaries/countries.json"
    return {k: [np.array(r) for r in v] for k, v in json.loads(f.read_text()).items()} if f.exists() else {}


def inside(rings, lon, lat):
    """Even-odd ray casting over one or more rings of (lon, lat); holes fall out of the parity."""
    ok = np.zeros(len(lon), dtype=bool)
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            (xi, yi), (xj, yj) = ring[i], ring[j]
            if yi != yj:
                ok ^= ((yi > lat) != (yj > lat)) & (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
            j = i
    return ok


def points_csv(q):
    if "country" in q:
        rings = country_rings().get(q["country"][0])
        if not rings:
            raise ValueError("unknown country")
    else:
        poly = [tuple(map(float, p.split(","))) for p in q["polygon"][0].split(";")]
        if len(poly) < 3:
            raise ValueError("polygon needs at least 3 vertices")
        rings = [np.array(poly)]
    start, end = pd.Timestamp(q["start"][0]), pd.Timestamp(q["end"][0])
    sensor = q.get("sensor", ["all"])[0].upper()
    allpts = np.concatenate(rings)
    xs, ys = allpts[:, 0], allpts[:, 1]
    parts = []
    for y in range(start.year, end.year + 1):
        d = year_points(y)
        if d is None:
            continue
        m = d["date"].between(start, end) & d["lon"].between(xs.min(), xs.max()) & d["lat"].between(ys.min(), ys.max())
        if sensor in ("MODIS", "VIIRS"):
            m &= d["sensor"].astype(str).str.startswith(sensor)
        parts.append(d.loc[m, COLS])
    df = pd.concat(parts) if parts else pd.DataFrame(columns=COLS)
    df = df[inside(rings, df["lon"].to_numpy(), df["lat"].to_numpy())].sort_values(["date", "time"]).head(MAX_ROWS)
    buf = io.StringIO()
    df.to_csv(buf, index=False, date_format="%Y-%m-%d")
    return buf.getvalue().encode()


@functools.lru_cache(maxsize=64)
def gzipped(path, mtime):
    return gzip.compress(Path(path).read_bytes(), 6)


COMPRESS = {".json", ".bin", ".js", ".css", ".html", ".svg"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT / "web"), **k)

    def end_headers(self):
        # static assets are rebuilt rarely: let the browser reuse them, but always revalidate
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        """Serve text and data files gzipped when the browser accepts it."""
        path = Path(self.translate_path(self.path))
        if (path.is_file() and path.suffix in COMPRESS and "gzip" in self.headers.get("Accept-Encoding", "")
                and self.command == "GET"):
            body = gzipped(str(path), path.stat().st_mtime)
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(str(path)))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return None
        return super().send_head()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path != "/api/points.csv":
            return super().do_GET()
        try:
            body = points_csv(parse_qs(u.query))
        except Exception as e:
            self.send_error(400, str(e))
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/csv")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"http://localhost:{port}")
    ThreadingHTTPServer((os.environ.get("HOST", "127.0.0.1"), port), Handler).serve_forever()
