#!/usr/bin/env python3
"""Archive the National Weather Service's forecast for tomorrow at every location (free, public domain).

Run each evening. Saves tomorrow's daytime high and tonight's low (the low that ends tomorrow morning)
from the NWS point forecast, so the accuracy report can compare NWS with Diablo Weather Lab.

Writes verification/nws_forecast_archive.json: {location_id: {YYYY-MM-DD: {high_f, low_f, issued}}}
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "verification" / "nws_forecast_archive.json"
TZ = ZoneInfo("America/Los_Angeles")
UA = {"User-Agent": "DiabloWeatherLab-verification/1.0", "Accept": "application/geo+json"}
sys.path.insert(0, str(Path(__file__).resolve().parent))
import locations  # noqa: E402


def get(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.loads(r.read())
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(4 * (k + 1))


def main():
    try:
        arch = json.loads(OUT.read_text())
    except (OSError, ValueError):
        arch = {}
    now = datetime.now(TZ)
    today, tomorrow = now.date().isoformat(), (now + timedelta(days=1)).date().isoformat()
    ok = 0
    for l in locations.load():
        try:
            pt = get(f"https://api.weather.gov/points/{l['lat']:.4f},{l['lon']:.4f}")
            periods = get(pt["properties"]["forecast"])["properties"]["periods"]
            hi = next((p["temperature"] for p in periods if p["isDaytime"] and p["startTime"][:10] == tomorrow), None)
            lo = next((p["temperature"] for p in periods if not p["isDaytime"] and p["startTime"][:10] == today), None)
            if hi is not None:
                arch.setdefault(l["id"], {})[tomorrow] = {"high_f": hi, "low_f": lo, "issued": now.isoformat(timespec="minutes")}
                ok += 1
        except Exception as exc:
            print(l["id"], "failed:", type(exc).__name__, exc)
        time.sleep(0.3)
    cutoff = (now - timedelta(days=180)).date().isoformat()
    arch = {k: {d: v for d, v in sorted(days.items()) if d >= cutoff} for k, days in sorted(arch.items())}
    OUT.write_text(json.dumps(arch, indent=1) + "\n")
    print(f"NWS: archived {ok} locations for {tomorrow}")


if __name__ == "__main__":
    main()
