#!/bin/bash
# Keep the world download going unattended: restart it if it exits early or stalls, stop when every
# region is done or the disk is nearly full. Safe to interrupt; downloaded windows are never repeated.
cd "$(dirname "$0")/.."
while true; do
  free=$(df --output=avail -BG . | tail -1 | tr -dc 0-9)
  if [ "$free" -lt 12 ]; then echo "$(date) low disk (${free} GB), stopping" >> logs/world.log; break; fi
  python3 pipeline/01_world.py >> logs/world.log 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 60
    if [ -z "$(find data/raw -name '*.csv.gz' -mmin -20 -print -quit)" ]; then
      echo "$(date) no new files for 20 min, restarting the downloader" >> logs/world.log
      kill "$pid" 2>/dev/null; break
    fi
  done
  wait "$pid" 2>/dev/null
  if [ "$(ls data/raw/_done | wc -l)" -ge 10 ]; then echo "$(date) all regions complete" >> logs/world.log; break; fi
  sleep 120
done
