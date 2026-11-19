#!/usr/bin/env python3
"""Paddle conditions for SF Bay Area coast and bay spots -> paddle_conditions.json (hourly workflow).

Per spot: hourly wind (speed, gust, direction), waves/swell (coast spots), sea-surface temperature,
next tides (NOAA CO-OPS high/low predictions), active NWS marine/coastal alerts, and a go / caution /
no-go rating for now and for every 3-hour block over the next 3 days. Any single source failing only
blanks that part; the previous file is kept if wind data is missing entirely.
"""
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "paddle_conditions.json"
TZ = ZoneInfo("America/Los_Angeles")
S = requests.Session()
S.headers["User-Agent"] = "DiabloWeatherLab-paddle/1.0"

# id, name, area, kind (coast = open ocean surf; bay = protected water), lat, lon, NOAA tide station
SPOTS = [
    ("ocean-beach", "Ocean Beach", "SF Coast", "coast", 37.760, -122.513, "9414290"),
    ("muir-beach", "Muir Beach", "Marin", "coast", 37.860, -122.576, "9414290"),
    ("stinson", "Stinson Beach", "Marin", "coast", 37.900, -122.645, "9414958"),
    ("linda-mar", "Pacifica · Linda Mar", "Peninsula Coast", "coast", 37.594, -122.503, "9414131"),
    ("pillar-point", "Half Moon Bay · Pillar Point Harbor", "Peninsula Coast", "bay", 37.497, -122.488, "9414131"),
    ("richardson-bay", "Sausalito · Richardson Bay Marina", "Inside the Bay", "bay", 37.866, -122.495, "9414806"),
    ("crissy-field", "Crissy Field", "Inside the Bay", "bay", 37.806, -122.464, "9414290"),
    ("aquatic-park", "Aquatic Park", "Inside the Bay", "bay", 37.807, -122.424, "9414290"),
    ("clipper-cove", "Clipper Cove · Treasure Island", "Inside the Bay", "bay", 37.814, -122.367, "9414750"),
    ("berkeley-marina", "Berkeley Marina", "Inside the Bay", "bay", 37.866, -122.317, "9414816"),
    ("crown-beach", "Alameda · Crown Beach", "Inside the Bay", "bay", 37.763, -122.270, "9414750"),
]


def get(url, params, tries=4, headers=None):
    for k in range(tries):
        try:
            r = S.get(url, params=params, timeout=(15, 60), headers=headers or {})
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            if k == tries - 1:
                print("FAILED", url.split("?")[0], type(exc).__name__, str(exc)[:120])
                return None
            time.sleep(4 * (k + 1))


def multi(url, params):
    """Open-Meteo multi-location call -> list aligned with SPOTS."""
    p = dict(params, latitude=",".join(str(s[4]) for s in SPOTS), longitude=",".join(str(s[5]) for s in SPOTS))
    d = get(url, p)
    if d is None:
        return [None] * len(SPOTS)
    return d if isinstance(d, list) else [d]


def compass(deg):
    if deg is None:
        return ""
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][round((deg % 360) / 45) % 8]


def rate(kind, wind, gust, wave, alerts):
    """0 = go, 1 = caution, 2 = no-go, with the reason."""
    ev = " ".join(alerts).lower()
    if "gale" in ev or "storm warning" in ev or "hazardous seas" in ev:
        return 2, "Gale or storm warning"
    w, g = wind or 0, gust or 0
    if kind == "bay":
        if w >= 15 or g >= 22:
            return 2, "Strong wind"
        level, why = (1, "Breezy, choppy") if (w >= 10 or g >= 16) else (0, "Light wind")
        if "small craft" in ev and level < 1:
            level, why = 1, "Small craft advisory"
        return level, why
    wave = wave or 0
    if "high surf" in ev:
        return 2, "High surf advisory"
    if wave >= 6 or w >= 18 or g >= 25:
        return 2, "Large surf" if wave >= 6 else "Strong wind"
    if wave >= 3.5 or w >= 12 or g >= 18:
        return 1, "Moderate surf" if wave >= 3.5 else "Breezy"
    if "small craft" in ev or "rip current" in ev or "beach hazard" in ev:
        return 1, "Advisory in effect"
    return 0, "Small surf, light wind"


def main():
    now = datetime.now(TZ)
    wind = multi("https://api.open-meteo.com/v1/forecast", {
        "hourly": "wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation_probability",
        "wind_speed_unit": "mph", "temperature_unit": "fahrenheit", "timezone": "America/Los_Angeles", "forecast_days": 3})
    marine = multi("https://marine-api.open-meteo.com/v1/marine", {
        "hourly": "wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature",
        "length_unit": "imperial", "timezone": "America/Los_Angeles", "forecast_days": 3})
    if not any(wind):
        prev = OUT.exists()
        raise SystemExit("No wind data" + ("; keeping previous file" if prev else ""))

    tides = {}
    for st in sorted({s[6] for s in SPOTS}):
        d = get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", {
            "product": "predictions", "interval": "hilo", "datum": "MLLW", "station": st, "time_zone": "lst_ldt",
            "units": "english", "format": "json", "begin_date": now.strftime("%Y%m%d"), "range": "72",
            "application": "DiabloWeatherLab"})
        tides[st] = [{"t": p["t"], "type": "High" if p["type"] == "H" else "Low", "ft": round(float(p["v"]), 1)}
                     for p in (d or {}).get("predictions", [])]
        print("tides", st, len(tides[st]))
    water = {}
    for st in ("9414290", "9414750", "9414131"):
        d = get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", {
            "product": "water_temperature", "station": st, "date": "latest", "units": "english",
            "time_zone": "lst_ldt", "format": "json", "application": "DiabloWeatherLab"})
        try:
            water[st] = round(float(d["data"][-1]["v"]))
        except Exception:
            pass
    # Open-coast water temperature from NDBC buoys (model SST runs warm near shore).
    buoy = {}
    for b in ("46026", "46237", "46012"):
        try:
            r = S.get(f"https://www.ndbc.noaa.gov/data/realtime2/{b}.txt", timeout=(15, 40))
            r.raise_for_status()
            for line in r.text.splitlines()[2:8]:
                v = line.split()[14]
                if v != "MM":
                    buoy[b] = round(float(v) * 9 / 5 + 32)
                    break
        except Exception as exc:
            print("buoy", b, type(exc).__name__)
    print("water", water, "buoys", buoy)

    spots = []
    for idx, (sid, name, area, kind, lat, lon, tide_st) in enumerate(SPOTS):
        alerts, details = [], []
        a = get("https://api.weather.gov/alerts/active", {"point": f"{lat},{lon}"}, headers={"Accept": "application/geo+json"})
        for f in (a or {}).get("features", []):
            p = f.get("properties", {})
            if p.get("event") and p.get("status") == "Actual" and p["event"] not in alerts:
                alerts.append(p["event"])
                details.append({"event": p["event"], "onset": p.get("onset"), "ends": p.get("ends") or p.get("expires"),
                                "headline": (p.get("headline") or "").split(" by NWS")[0],
                                "description": (p.get("description") or "")[:1200]})
        w, m = wind[idx] or {}, marine[idx] or {}
        wh, mh = w.get("hourly", {}), m.get("hourly", {})
        times = wh.get("time", [])
        stamp = now.strftime("%Y-%m-%dT%H:00")
        start = next((i for i, t in enumerate(times) if t >= stamp), 0)
        mt = mh.get("time", [])

        def mval(key, t):
            if t in mt:
                v = mh.get(key, [None] * len(mt))[mt.index(t)]
                return v
            return None

        def at(i):
            t = times[i]
            wave = mval("wave_height", t) if kind == "coast" else None
            sst = mval("sea_surface_temperature", t)
            r, why = rate(kind, wh["wind_speed_10m"][i], wh["wind_gusts_10m"][i], wave, alerts if i == start else [x for x in alerts if "advisory" not in x.lower()])
            return {"time": t, "wind": round(wh["wind_speed_10m"][i] or 0), "gust": round(wh["wind_gusts_10m"][i] or 0),
                    "dir": compass(wh["wind_direction_10m"][i]),
                    "wave_ft": None if wave is None else round(wave, 1),
                    "period_s": None if kind != "coast" else (lambda v: None if v is None else round(v))(mval("swell_wave_period", t) or mval("wave_period", t)),
                    "swell_dir": None if kind != "coast" else compass(mval("swell_wave_direction", t)),
                    "sst_f": None if sst is None else round(sst * 9 / 5 + 32),
                    "air_f": None if wh.get("temperature_2m") is None else round(wh["temperature_2m"][i]),
                    "rating": r, "why": why}

        if not times:
            continue
        cur = at(start)
        blocks = [at(i) for i in range(start, min(len(times), start + 72), 3)]
        next_tides = [x for x in tides.get(tide_st, []) if x["t"] >= now.strftime("%Y-%m-%d %H:%M")][:4]
        if kind == "coast":
            water_f = buoy.get("46012" if lat < 37.7 else "46026") or buoy.get("46237") or water.get(tide_st) or cur["sst_f"]
        else:
            water_f = water.get(tide_st) or water.get("9414750") or water.get("9414290") or buoy.get("46237") or cur["sst_f"]
        # Best upcoming window: first daylight block rated go (7 AM - 5 PM).
        best = next((b for b in blocks if b["rating"] == 0 and 7 <= int(b["time"][11:13]) <= 17), None)
        spots.append({"id": sid, "name": name, "area": area, "kind": kind, "lat": lat, "lon": lon, "now": cur,
                      "blocks": blocks, "tides": next_tides, "tide_station": tide_st, "water_f": water_f,
                      "alerts": alerts, "alert_details": details, "best": best["time"] if best else None})
        print(name, cur["rating"], cur["why"], cur["wind"], cur["gust"], cur["wave_ft"], len(next_tides), alerts)
    OUT.write_text(json.dumps({"generated_utc": datetime.now(timezone.utc).isoformat(), "spots": spots,
                               "sources": "Open-Meteo forecast + marine, NOAA CO-OPS tides and water temperature, NWS alerts"}, indent=1) + "\n")


if __name__ == "__main__":
    main()
