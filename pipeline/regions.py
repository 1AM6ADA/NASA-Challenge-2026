"""Download regions as W,S,E,N boxes. Together they tile the globe's land; only some are downloaded."""
import json

REGIONS = {
    "central_asia": (46, 34, 88, 56),
    "europe": (-25, 35, 46, 72),
    "north_asia": (46, 56, 180, 82),
    "east_asia": (88, 18, 150, 56),
    "south_asia": (60, 5, 100, 34),
    "southeast_asia": (95, -12, 155, 18),
    "oceania": (110, -48, 180, -12),
    "africa": (-20, -36, 60, 35),
    "north_america": (-170, 15, -50, 84),
    "latin_america": (-118, -56, -30, 15),
}


def area_string(region):
    return "world" if region == "world" else ",".join(str(v) for v in REGIONS[region])


def loaded_regions(root):
    """Regions whose download finished (marker written by 01_world.py); half-downloaded ones stay out.

    03_aggregate.py records the list in data/agg/loaded_regions.json so a clone without data/raw still knows it.
    """
    done = root / "data/raw/_done"
    if done.exists():
        return [n for n in REGIONS if (done / n).exists()]
    return json.loads((root / "data/agg/loaded_regions.json").read_text())
