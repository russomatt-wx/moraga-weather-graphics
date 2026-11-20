#!/usr/bin/env python3
"""Current-conditions estimate test: NOAA RTMA vs the Weather Underground stations (hourly job).

Each run takes the latest NOAA Real-Time Mesoscale Analysis (RTMA rapid update, 2.5 km grid, public
domain), reads temperature / dew point / wind / gust / cloud cover at each station's own location, and
logs it next to that station's live reading. The report scores the raw estimate and a learned
correction (each town's average error in the same situation - day or night, calm or breezy - taken only
from earlier hours, so the score is honest) to see whether the estimate could replace licensed station
data in a paid app.

Writes verification/nowcast_log.json (60 days) and verification/nowcast_report.json.
"""
import json
import math
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import mean

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[1]
LOG = ROOT / "verification" / "nowcast_log.json"
REPORT = ROOT / "verification" / "nowcast_report.json"
WORKER = "https://moraga-live-observations.russo-matt.workers.dev"
BUCKET = "https://noaa-rtma-pds.s3.amazonaws.com"
TOWNS = {  # worker city key: (name, WU station)
    "moraga": ("Moraga", "KCAMORAG71"), "lafayette": ("Lafayette", "KCAWALNU6"), "danville": ("Sycamore Valley", "KCADANVI207"),
    "greenbrook": ("Greenbrook", "KCADANVI224"), "brentwood": ("Brentwood", "KCABRENT202"),
    "sacramento": ("East Sacramento", "KCASACRA200"), "sausalito": ("Marin City", "KCASAUSA88"),
}
FIELDS = [("TMP:2 m above ground", "2t"), ("DPT:2 m above ground", "2d"), ("WIND:10 m above ground", "10si"),
          ("GUST:10 m above ground", "i10fg"), ("TCDC:entire atmosphere", "tcc")]
UA = {"User-Agent": "DiabloWeatherLab-nowcast/1.0"}


def fetch(url, headers=None, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=60) as r:
                return r.read()
        except Exception as exc:
            if k == tries - 1:
                raise
            time.sleep(4 * (k + 1))


def latest_analysis():
    """Newest RTMA rapid-update analysis file (today, else yesterday)."""
    for back in (0, 1):
        day = (datetime.now(timezone.utc) - timedelta(days=back)).strftime("%Y%m%d")
        xml = fetch(f"{BUCKET}/?list-type=2&prefix=rtma2p5_ru.{day}/&max-keys=1000").decode()
        keys = [k for k in (x.split("</Key>")[0] for x in xml.split("<Key>")[1:]) if k.endswith("2dvaranl_ndfd.grb2")]
        if keys:
            return sorted(keys)[-1]
    raise SystemExit("No RTMA analysis found")


def download_fields(key):
    """Byte-range download of just the needed fields (about 30 MB instead of 80)."""
    idx = fetch(f"{BUCKET}/{key}.idx").decode().splitlines()
    rows = [line.split(":") for line in idx]
    parts = []
    for i, r in enumerate(rows):
        name = r[3] + ":" + r[4]
        if any(name.startswith(f) for f, _ in FIELDS):
            start = int(r[1])
            end = int(rows[i + 1][1]) - 1 if i + 1 < len(rows) else ""
            parts.append(fetch(f"{BUCKET}/{key}", {"Range": f"bytes={start}-{end}"}))
    tmp = tempfile.NamedTemporaryFile(suffix=".grb2", delete=False)
    tmp.write(b"".join(parts))
    tmp.close()
    return tmp.name


def grids(path):
    out, lat, lon = {}, None, None
    for _, short in FIELDS:
        try:
            ds = xr.open_dataset(path, engine="cfgrib", backend_kwargs={"filter_by_keys": {"shortName": short}, "indexpath": ""})
        except Exception as exc:
            print("field missing", short, type(exc).__name__)
            continue
        v = list(ds.data_vars)[0]
        out[short] = ds[v].values
        if lat is None:
            lat, lon = ds.latitude.values, np.where(ds.longitude.values > 180, ds.longitude.values - 360, ds.longitude.values)
    return out, lat, lon


def rh(tc, dc):
    return 100 * math.exp(17.625 * dc / (243.04 + dc)) / math.exp(17.625 * tc / (243.04 + tc))


def sun_up(lat, lon, when):
    """Rough solar elevation > 0 (good enough to split day / night)."""
    doy = when.timetuple().tm_yday
    decl = 23.44 * math.sin(math.radians(360 / 365 * (doy - 81)))
    hour = when.hour + when.minute / 60 + lon / 15
    ha = 15 * (hour - 12)
    el = math.degrees(math.asin(math.sin(math.radians(lat)) * math.sin(math.radians(decl)) +
                                math.cos(math.radians(lat)) * math.cos(math.radians(decl)) * math.cos(math.radians(ha))))
    return el > 0


def load(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def report(rows):
    """Raw and learned-correction errors per town, overall and by day / night."""
    out = {}
    for key, (name, station) in TOWNS.items():
        mine = sorted((r for r in rows if r["town"] == key and r.get("obs_t") is not None and r.get("est_t") is not None), key=lambda r: r["valid"])
        if not mine:
            continue
        raw, cor = [], []
        for i, r in enumerate(mine):
            err = r["est_t"] - r["obs_t"]
            raw.append((r, err))
            # Learned correction: mean error over the previous 14 days in the same regime (day/night, calm/breezy).
            regime = (r["day"], r["est_wind"] < 6)
            prior = [p["est_t"] - p["obs_t"] for p in mine[:i]
                     if (p["day"], p["est_wind"] < 6) == regime and p["valid"] >= (datetime.fromisoformat(r["valid"]) - timedelta(days=14)).isoformat()]
            if len(prior) >= 6:
                cor.append((r, err - mean(prior)))

        def stats(pairs, day=None):
            e = [x for r, x in pairs if day is None or r["day"] == day]
            return None if not e else {"n": len(e), "mae_f": round(mean(abs(x) for x in e), 2), "bias_f": round(mean(e), 2),
                                       "within_2f_pct": round(100 * sum(abs(x) <= 2 for x in e) / len(e))}
        wind = [abs(r["est_wind"] - r["obs_wind"]) for r in mine if r.get("obs_wind") is not None]
        out[key] = {"name": name, "station": station, "hours": len(mine), "first": mine[0]["valid"], "last": mine[-1]["valid"],
                    "raw": {"all": stats(raw), "day": stats(raw, True), "night": stats(raw, False)},
                    "corrected": {"all": stats(cor), "day": stats(cor, True), "night": stats(cor, False)},
                    "wind_mae_mph": round(mean(wind), 1) if wind else None}
    return out


def main():
    key = latest_analysis()
    valid = datetime.strptime(key.split("/")[0].split(".")[1] + key.split("/")[1].split(".t")[1][:4], "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
    print("RTMA analysis", key, "valid", valid.isoformat())
    g, lat, lon = grids(download_fields(key))
    coords = load(ROOT / "verification" / "station_coords.json", {})
    rows = load(LOG, [])
    seen = {(r["town"], r["valid"]) for r in rows}
    for town, (name, station) in TOWNS.items():
        if (town, valid.isoformat()) in seen:
            continue
        if station not in coords:
            try:
                s = json.loads(fetch(f"{WORKER}/station?id={station}"))
                if s.get("lat") is not None:
                    coords[station] = [s["lat"], s["lon"]]
            except Exception as exc:
                print(station, "coordinates unavailable", type(exc).__name__)
        if station not in coords:
            continue
        la, lo = coords[station]
        i = np.unravel_index(np.argmin((lat - la) ** 2 + ((lon - lo) * math.cos(math.radians(la))) ** 2), lat.shape)
        val = {k: float(v[i]) for k, v in g.items()}
        try:
            ob = json.loads(fetch(f"{WORKER}/observations?city={town}"))
        except Exception:
            ob = {}
        obs_time = ob.get("observed_utc")
        fresh = obs_time and abs((datetime.fromisoformat(obs_time.replace("Z", "+00:00")) - valid).total_seconds()) <= 45 * 60
        t_c, d_c = val.get("2t", np.nan) - 273.15, val.get("2d", np.nan) - 273.15
        row = {"town": town, "station": station, "valid": valid.isoformat(), "day": sun_up(la, lo, valid),
               "est_t": round(t_c * 9 / 5 + 32, 1), "est_rh": round(rh(t_c, d_c)), "est_wind": round(val.get("10si", 0) * 2.23694, 1),
               "est_gust": round(val.get("i10fg", 0) * 2.23694, 1) if "i10fg" in val else None,
               "est_cloud_pct": round(val["tcc"]) if "tcc" in val else None,
               "obs_t": ob.get("temperature_f") if fresh else None, "obs_rh": ob.get("humidity_pct") if fresh else None,
               "obs_wind": ob.get("wind_mph") if fresh else None, "obs_time": obs_time, "obs_station": ob.get("station")}
        rows.append(row)
        print(f"{name:16s} est {row['est_t']}°F {row['est_rh']}% {row['est_wind']} mph | station {row['obs_t']}°F {row['obs_rh']}% {row['obs_wind']} mph")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    rows = [r for r in rows if r["valid"] >= cutoff]
    (ROOT / "verification" / "station_coords.json").write_text(json.dumps(coords, indent=1) + "\n")
    LOG.write_text(json.dumps(rows) + "\n")
    rep = report(rows)
    REPORT.write_text(json.dumps({"generated_utc": datetime.now(timezone.utc).isoformat(), "source": "NOAA RTMA rapid update (2.5 km analysis)",
                                  "method": "Estimate at each station's location vs that station's reading within 45 minutes. Corrected = minus the town's mean error "
                                            "in the same regime (day/night, calm/breezy) over the previous 14 days (needs 6+ prior hours).",
                                  "towns": rep}, indent=1) + "\n")
    for k, v in rep.items():
        print(v["name"], v["hours"], "h | raw", v["raw"]["all"], "| corrected", v["corrected"]["all"])


if __name__ == "__main__":
    main()
