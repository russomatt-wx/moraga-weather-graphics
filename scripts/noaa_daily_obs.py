#!/usr/bin/env python3
"""Daily observed high / low for each location from NOAA's URMA analysis (public domain).

URMA is the delayed, quality-controlled version of NOAA's 2.5 km Real-Time Mesoscale Analysis. For
each Pacific calendar day it reads the 24 hourly 2 m temperature analyses at each location's forecast
point and keeps the highest and lowest. This gives the 10-day forecast learning a verification source
that is free to use in a paid app (the Weather Underground stations are not).

Writes verification/town_observed_noaa.json: {town: {YYYY-MM-DD: {high_f, low_f, samples}}}.
Usage: python scripts/noaa_daily_obs.py [days_back]   (default 4; first run backfills more)
"""
import json
import math
import sys
import tempfile
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "verification" / "town_observed_noaa.json"
TZ = ZoneInfo("America/Los_Angeles")
BUCKET = "https://noaa-urma-pds.s3.amazonaws.com"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import locations  # noqa: E402
TOWNS = [l["id"] for l in locations.load()]
UA = {"User-Agent": "DiabloWeatherLab-urma/1.0"}


def fetch(url, headers=None, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=90) as r:
                return r.read()
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(4 * (k + 1))


def temperature_grid(hour_utc):
    """2 m temperature (K) grid for one URMA hour, downloading only that field."""
    key = f"urma2p5.{hour_utc:%Y%m%d}/urma2p5.t{hour_utc:%H}z.2dvaranl_ndfd.grb2_wexp"
    idx = fetch(f"{BUCKET}/{key}.idx").decode().splitlines()
    rows = [line.split(":") for line in idx]
    for i, r in enumerate(rows):
        if r[3] == "TMP" and r[4] == "2 m above ground":
            end = int(rows[i + 1][1]) - 1
            data = fetch(f"{BUCKET}/{key}", {"Range": f"bytes={r[1]}-{end}"})
            break
    else:
        raise ValueError("no TMP field")
    tmp = tempfile.NamedTemporaryFile(suffix=".grb2", delete=False)
    tmp.write(data)
    tmp.close()
    ds = xr.open_dataset(tmp.name, engine="cfgrib", backend_kwargs={"indexpath": ""})
    v = ds[list(ds.data_vars)[0]].values
    lat, lon = ds.latitude.values, np.where(ds.longitude.values > 180, ds.longitude.values - 360, ds.longitude.values)
    Path(tmp.name).unlink(missing_ok=True)
    return v, lat, lon


def points():
    pts = {}
    for t in TOWNS:
        try:
            f = json.loads((ROOT / f"{t}_forecast_10day.json").read_text())
            pts[t] = (float(f["latitude"]), float(f["longitude"]))
        except (OSError, ValueError, KeyError, TypeError):
            print(t, "no forecast point")
    return pts


def main():
    days_back = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    try:
        obs = json.loads(OUT.read_text())
    except (OSError, ValueError):
        obs = {}
    pts = points()
    today = datetime.now(TZ).date()
    index = None
    for k in range(days_back, 0, -1):
        day = today - timedelta(days=k)
        ds = day.isoformat()
        if all(ds in obs.get(t, {}) for t in pts):
            continue
        start = datetime(day.year, day.month, day.day, tzinfo=TZ).astimezone(timezone.utc)
        end = datetime(*(day + timedelta(days=1)).timetuple()[:3], tzinfo=TZ).astimezone(timezone.utc)
        temps = {t: [] for t in pts}
        h = start
        while h < end:
            try:
                g, lat, lon = temperature_grid(h)
                if index is None:
                    index = {t: np.unravel_index(np.argmin((lat - la) ** 2 + ((lon - lo) * math.cos(math.radians(la))) ** 2), lat.shape) for t, (la, lo) in pts.items()}
                for t, i in index.items():
                    temps[t].append(float(g[i]) * 9 / 5 - 459.67)
            except Exception as exc:
                print(ds, h.strftime("%H"), "missing", type(exc).__name__)
            h += timedelta(hours=1)
        for t, vals in temps.items():
            if len(vals) >= 22:  # nearly the whole day
                obs.setdefault(t, {})[ds] = {"high_f": round(max(vals), 1), "low_f": round(min(vals), 1), "samples": len(vals)}
        print(ds, {t: obs.get(t, {}).get(ds) for t in pts})
    cutoff = (today - timedelta(days=120)).isoformat()
    obs = {t: {d: v for d, v in sorted(days.items()) if d >= cutoff} for t, days in obs.items()}
    OUT.write_text(json.dumps(obs, indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
