"""Run the pipeline steps in order, with timing, stopping at the first failure.

Usage: python3 pipeline/run_all.py [--from 04] [--to 07] [--no-validate]
Downloading (01_*.py) is separate on purpose: it needs a FIRMS key and takes hours.
Steps 04-07 work on the committed data/agg; 02-03 need data/raw.
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = ["02_clean", "03_aggregate", "04_calibrate", "05_harmonize", "06_export", "07_countries"]

ap = argparse.ArgumentParser()
ap.add_argument("--from", dest="first", default="02")
ap.add_argument("--to", dest="last", default="07")
ap.add_argument("--no-validate", action="store_true")
a = ap.parse_args()

todo = [s for s in STEPS if a.first <= s[:2] <= a.last]
t0 = time.time()
for s in todo:
    t = time.time()
    print(f"\n=== {s} ===", flush=True)
    if subprocess.call([sys.executable, str(HERE / f"{s}.py")]) != 0:
        sys.exit(f"{s} failed")
    print(f"--- {s} took {time.time() - t:.0f} s", flush=True)
if not a.no_validate:
    print("\n=== validate ===")
    if subprocess.call([sys.executable, str(HERE / "validate.py")]) != 0:
        sys.exit("validation failed")
print(f"\nall done in {time.time() - t0:.0f} s")
