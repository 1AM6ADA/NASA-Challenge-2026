"""Unit tests (standard library unittest, no extra packages): python3 -m unittest discover -s tests"""
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(ROOT / "api"))
import harmonize_lib as hl  # noqa: E402
import regions  # noqa: E402


class CalibrationModels(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        self.cal = np.tile(np.arange(12), 6)            # 72 months
        self.M = rng.poisson(40, (30, 72)).astype(float)
        self.V = self.M * 2.0                            # VIIRS counts twice what MODIS does
        hl._TILES["block"] = np.repeat(np.arange(6), 5)  # 6 blocks of 5 tiles

    def test_ratio_models_recover_a_known_factor(self):
        for name in ("pooled_ratio", "tile_ratio", "block_ratio"):
            fit, predict = hl.MODELS[name]
            pred = predict(fit(self.M, self.V, self.cal), self.M, self.cal)
            self.assertAlmostEqual(pred.sum() / self.V.sum(), 1.0, places=2, msg=name)

    def test_tile_without_data_falls_back_to_the_pooled_ratio(self):
        M, V = self.M.copy(), self.V.copy()
        M[0], V[0] = 0, 0
        pooled = hl.fit_pooled_ratio(M, V, self.cal)["k"]
        for name in ("tile_ratio", "block_ratio"):
            k = hl.MODELS[name][0](M, V, self.cal)["k"]
            self.assertTrue(np.allclose(k[0], 2.0, atol=0.05), name)  # neighbours say 2, pooled says 2
        self.assertTrue(np.allclose(pooled, 2.0))

    def test_block_ratio_borrows_from_its_block_not_the_world(self):
        M, V = self.M.copy(), self.V.copy()
        V[5:10] = M[5:10] * 5.0      # block 1 behaves differently
        M[5], V[5] = 0, 0            # and one of its tiles has no data
        k = hl.fit_block_ratio(M, V, self.cal)["k"]
        self.assertGreater(k[5].mean(), k[0].mean() + 0.5)   # tile 5 leans toward its block's higher ratio

    def test_models_never_create_negative_counts(self):
        for name, (fit, predict) in hl.MODELS.items():
            self.assertTrue((predict(fit(self.M, self.V, self.cal), self.M, self.cal) >= 0).all(), name)


class Regions(unittest.TestCase):
    def test_regions_are_valid_boxes(self):
        for name, (w, s, e, n) in regions.REGIONS.items():
            self.assertTrue(-180 <= w < e <= 180 and -90 <= s < n <= 90, name)

    def test_loaded_regions_reads_the_committed_list_without_raw_data(self):
        import tempfile, json
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "data/agg").mkdir(parents=True)
            (root / "data/agg/loaded_regions.json").write_text(json.dumps(["europe"]))
            self.assertEqual(regions.loaded_regions(root), ["europe"])


class PolygonTest(unittest.TestCase):
    def test_point_in_polygon_with_a_hole(self):
        import server
        outer = np.array([[0, 0], [10, 0], [10, 10], [0, 10]], float)
        hole = np.array([[4, 4], [6, 4], [6, 6], [4, 6]], float)
        lon, lat = np.array([1.0, 5.0, 11.0]), np.array([1.0, 5.0, 5.0])
        self.assertEqual(server.inside([outer, hole], lon, lat).tolist(), [True, False, False])


@unittest.skipUnless((ROOT / "web/data/meta.json").exists(), "built data not present")
class BuiltData(unittest.TestCase):
    def test_validate_passes_on_the_committed_data(self):
        import subprocess
        r = subprocess.run([sys.executable, str(ROOT / "pipeline/validate.py")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
