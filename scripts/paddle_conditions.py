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

# id, name (beach / marina), city, area, kind (coast = open ocean surf; bay = protected water), lat, lon, NOAA tide station
SPOTS = [
    ("ocean-beach", "Ocean Beach", "San Francisco", "SF Coast", "coast", 37.760, -122.513, "9414290"),
    ("muir-beach", "Muir Beach", "Muir Beach", "Marin", "coast", 37.860, -122.576, "9414290"),
    ("stinson", "Stinson Beach", "Stinson Beach", "Marin", "coast", 37.900, -122.645, "9414958"),
    ("linda-mar", "Linda Mar Beach", "Pacifica", "Peninsula Coast", "coast", 37.594, -122.503, "9414131"),
    ("pillar-point", "Pillar Point Harbor", "Half Moon Bay", "Peninsula Coast", "bay", 37.497, -122.488, "9414131"),
    ("richardson-bay", "Richardson Bay Marina", "Sausalito", "SF Bay", "bay", 37.866, -122.495, "9414806"),
    ("crissy-field", "Crissy Field", "San Francisco", "SF Coast", "bay", 37.806, -122.464, "9414290"),
    ("aquatic-park", "Aquatic Park", "San Francisco", "SF Bay", "bay", 37.807, -122.424, "9414290"),
    ("clipper-cove", "Clipper Cove", "Treasure Island, San Francisco", "SF Bay", "bay", 37.814, -122.367, "9414750"),
    ("berkeley-marina", "Berkeley Marina", "Berkeley", "SF Bay", "bay", 37.866, -122.317, "9414816"),
    ("crown-beach", "Crown Beach", "Alameda", "SF Bay", "bay", 37.763, -122.270, "9414750"),
]


# NOAA CO-OPS gauges around the Bay (name, lat, lon). Not all carry a water-temperature sensor and
# sensors go offline; the job checks them all every hour and uses whichever are reporting.
WATER_GAUGES = {
    "9414290": ("San Francisco (Fort Point)", 37.8063, -122.4659),
    "9414305": ("San Francisco North Point Pier", 37.8104, -122.4126),
    "9414317": ("San Francisco Pier 22½", 37.7899, -122.3870),
    "9414806": ("Sausalito", 37.8467, -122.4767),
    "9414819": ("Sausalito Coast Guard", 37.8603, -122.4817),
    "9414863": ("Richmond", 37.9283, -122.4000),
    "9414816": ("Berkeley", 37.8650, -122.3070),
    "9414764": ("Oakland Inner Harbor", 37.7950, -122.2820),
    "9414750": ("Alameda", 37.7717, -122.3000),
    "9414392": ("Oyster Point", 37.6650, -122.3770),
    "9414688": ("San Leandro Marina", 37.6950, -122.1920),
    "9414523": ("Redwood City", 37.5067, -122.2117),
    "9414131": ("Pillar Point Harbor", 37.5025, -122.4822),
    "9415020": ("Point Reyes", 37.9961, -122.9767),
}


def km(lat1, lon1, lat2, lon2):
    from math import radians, sin, cos, asin, sqrt
    p1, p2, dl, dp = radians(lat1), radians(lat2), radians(lon2 - lon1), radians(lat2 - lat1)
    return 6371 * 2 * asin(sqrt(sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2))


def nearest_water(water, lat, lon, exclude=("9415020",)):
    """Closest reporting bay gauge -> (temp F, source dict) or (None, None)."""
    best = None
    for st, w in water.items():
        if st in exclude:
            continue
        name, glat, glon = WATER_GAUGES[st]
        d = km(lat, lon, glat, glon)
        if best is None or d < best[0]:
            best = (d, st, name, w)
    if not best or best[0] > 16:  # nothing within 10 miles: use a buoy instead
        return None, None
    d, st, name, w = best
    return w["f"], {"name": "NOAA " + name + " gauge", "station": st, "miles": round(d * 0.621, 1), "observed": w["t"]}



def angle_diff(a, b):
    d = abs((a - b) % 360)
    return 360 - d if d > 180 else d


def current_stations():
    """NOAA tidal-current prediction stations in the Bay Area: [(id, bin, name, lat, lon)]."""
    d = get("https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json", {"type": "currentpredictions", "units": "english"}, tries=3)
    out = []
    for st in (d or {}).get("stations", []):
        try:
            lat, lon = float(st.get("lat")), float(st.get("lng"))
        except (TypeError, ValueError):
            continue
        if 37.4 < lat < 38.1 and -122.7 < lon < -122.1:
            out.append((str(st.get("id")), st.get("currbin"), st.get("name") or st.get("id"), lat, lon))
    print("current stations in the Bay:", len(out))
    return out


def current_series(sid, cbin, now):
    """Hourly predicted current (knots; + flood, - ebb) and the slack / max events for 72 h."""
    base = {"product": "currents_predictions", "station": sid, "begin_date": now.strftime("%Y%m%d"), "range": "72",
            "time_zone": "lst_ldt", "units": "english", "format": "json", "application": "DiabloWeatherLab"}
    if cbin not in (None, ""):
        base["bin"] = cbin
    hourly = get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", dict(base, interval="h"), tries=2)
    events = get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", dict(base, interval="MAX_SLACK"), tries=2)
    def rows(d):
        r = (d or {}).get("current_predictions", {})
        return r.get("cp", []) if isinstance(r, dict) else []
    series = {}
    flood_dir = ebb_dir = None
    for r in rows(hourly):
        try:
            series[r["Time"][:13].replace(" ", "T")] = float(r["Velocity_Major"])
            flood_dir = flood_dir if flood_dir is not None else float(r.get("meanFloodDir"))
            ebb_dir = ebb_dir if ebb_dir is not None else float(r.get("meanEbbDir"))
        except (KeyError, TypeError, ValueError):
            continue
    ev = []
    for r in rows(events):
        try:
            ev.append({"t": r["Time"], "type": r.get("Type", ""), "kt": round(float(r["Velocity_Major"]), 1)})
        except (KeyError, TypeError, ValueError):
            continue
    for r in rows(events):  # directions also come with the event list
        try:
            flood_dir = flood_dir if flood_dir is not None else float(r.get("meanFloodDir"))
            ebb_dir = ebb_dir if ebb_dir is not None else float(r.get("meanEbbDir"))
        except (TypeError, ValueError):
            pass
    if len(series) < 48:  # subordinate stations answer 'hourly' with just their event times
        series = {}
    if not series and len(ev) >= 2:
        # Subordinate stations publish only slack / max times: fill each hour with a cosine curve
        # between consecutive events (the standard rule-of-thumb shape of a tidal current).
        from math import cos, pi
        pts = [(datetime.strptime(e["t"], "%Y-%m-%d %H:%M"), e["kt"]) for e in ev]
        t = pts[0][0].replace(minute=0) + timedelta(hours=1)
        while t <= pts[-1][0]:
            k = next(i for i in range(len(pts) - 1) if pts[i][0] <= t <= pts[i + 1][0])
            (t0, v0), (t1, v1) = pts[k], pts[k + 1]
            f = (t - t0).total_seconds() / max(1, (t1 - t0).total_seconds())
            series[t.strftime("%Y-%m-%dT%H")] = v0 + (v1 - v0) * (1 - cos(pi * f)) / 2
            t += timedelta(hours=1)
    print("current", sid, "hourly points", len(series), "events", len(ev), "flood/ebb dir", flood_dir, ebb_dir)
    return series, flood_dir, ebb_dir, ev


def current_rating(kt, wind, wind_from, flood_dir, ebb_dir):
    """Caution for strong current or wind against current; No-go for very strong current."""
    if kt is None:
        return 0, ""
    speed = abs(kt)
    if speed >= 3:
        return 2, "Very strong current"
    toward = flood_dir if kt > 0 else ebb_dir
    if wind is not None and wind >= 12 and speed >= 1 and toward is not None and wind_from is not None:
        # Wind blowing toward (from + 180) opposite to the current's set: short, steep chop.
        if angle_diff((wind_from + 180) % 360, toward) >= 120:
            return 1, "Wind against current"
    if speed >= 1.5:
        return 1, "Strong current"
    return 0, ""


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
    p = dict(params, latitude=",".join(str(s[5]) for s in SPOTS), longitude=",".join(str(s[6]) for s in SPOTS))
    d = get(url, p)
    if d is None:
        return [None] * len(SPOTS)
    return d if isinstance(d, list) else [d]


def compass(deg):
    if deg is None:
        return ""
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][round((deg % 360) / 45) % 8]


# Open water upwind of each protected spot, in km, by the direction the wind blows FROM.
# Rough distances measured off the map; a short value means land or a breakwater upwind.
FETCH_KM = {
    "richardson-bay": {"N": 1.5, "NE": 2.5, "E": 3, "SE": 6, "S": 3, "SW": .4, "W": .3, "NW": .5},
    "crissy-field": {"N": 5, "NE": 8, "E": 5, "SE": .2, "S": .2, "SW": .2, "W": 6, "NW": 3},
    "aquatic-park": {"N": 4, "NE": 6, "E": 2, "SE": .2, "S": .2, "SW": .2, "W": 2.5, "NW": 4},
    "clipper-cove": {"N": .3, "NE": .5, "E": 1.5, "SE": 1.2, "S": .3, "SW": .3, "W": .3, "NW": .3},
    "berkeley-marina": {"N": 3, "NE": .3, "E": .2, "SE": .3, "S": 6, "SW": 12, "W": 15, "NW": 8},
    "crown-beach": {"N": .2, "NE": .2, "E": .3, "SE": 8, "S": 15, "SW": 15, "W": 8, "NW": .5},
    "pillar-point": {"N": .5, "NE": .5, "E": 1, "SE": 1.5, "S": 1.5, "SW": 1, "W": .5, "NW": .5},
}


def chop(spot_id, wind_mph, direction):
    """Estimated wind-chop height (ft) and period (s) from wind speed and fetch.
    Fetch-limited JONSWAP growth: Hs = 0.0016 U sqrt(F/g), Tp = 0.286 (gF/U^2)^(1/3) U/g,
    capped at a fully developed sea. A rough guide for protected water, not a measurement."""
    fetch = FETCH_KM.get(spot_id, {}).get(direction)
    if fetch is None or not wind_mph:
        return None, None
    u, f, g = wind_mph * 0.447, fetch * 1000, 9.81
    hs = min(0.0016 * u * (f / g) ** .5, 0.2433 * u * u / g)
    tp = 0.286 * (g * f / (u * u)) ** (1 / 3) * u / g
    return round(hs * 3.281, 1), round(tp, 1)


def rate(kind, wind, gust, wave, alerts):
    """0 = go, 1 = caution, 2 = no-go, with the reason."""
    ev = " ".join(alerts).lower()
    if "gale" in ev or "storm warning" in ev or "hazardous seas" in ev:
        return 2, "Gale or storm warning"
    w, g = wind or 0, gust or 0
    if kind == "bay":
        # Wind limits follow common paddling guidance: novices under ~10 kt (12 mph),
        # 10-15 kt for experienced paddlers, over 15 kt (17 mph) too much for SUP.
        if w >= 17 or g >= 25:
            return 2, "Strong wind"
        level, why = (1, "Breezy, choppy") if (w >= 12 or g >= 18) else (0, "Light wind")
        # Estimated wind chop: about 2.5 ft is too rough for a SUP; 1.5 ft is choppy.
        if wave is not None and wave >= 2.5:
            return 2, "Rough chop"
        if wave is not None and wave >= 1.5 and level < 1:
            level, why = 1, "Choppy"
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
        "hourly": "wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation_probability,weather_code",
        "wind_speed_unit": "mph", "temperature_unit": "fahrenheit", "timezone": "America/Los_Angeles", "forecast_days": 3})
    marine = multi("https://marine-api.open-meteo.com/v1/marine", {
        "hourly": "wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature",
        "length_unit": "imperial", "timezone": "America/Los_Angeles", "forecast_days": 3})
    if not any(wind):
        prev = OUT.exists()
        raise SystemExit("No wind data" + ("; keeping previous file" if prev else ""))

    tides = {}
    for st in sorted({s[7] for s in SPOTS}):
        d = get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", {
            "product": "predictions", "interval": "hilo", "datum": "MLLW", "station": st, "time_zone": "lst_ldt",
            "units": "english", "format": "json", "begin_date": now.strftime("%Y%m%d"), "range": "72",
            "application": "DiabloWeatherLab"})
        tides[st] = [{"t": p["t"], "type": "High" if p["type"] == "H" else "Low", "ft": round(float(p["v"]), 1)}
                     for p in (d or {}).get("predictions", [])]
        print("tides", st, len(tides[st]))
    # Bay water temperature: every NOAA gauge around the Bay that may carry a water sensor. Each
    # bay spot uses the nearest one with a reading from the last 3 hours (see nearest_water below).
    water = {}
    for st, (wname, wlat, wlon) in WATER_GAUGES.items():
        d = get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", {
            "product": "water_temperature", "station": st, "date": "latest", "units": "english",
            "time_zone": "lst_ldt", "format": "json", "application": "DiabloWeatherLab"}, tries=2)
        try:
            row = d["data"][-1]
            when = datetime.strptime(row["t"], "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
            v = float(row["v"])
            if now - when <= timedelta(hours=3) and 35 < v < 85:
                water[st] = {"f": round(v), "t": row["t"]}
        except Exception:
            pass
    print("water gauges reporting:", {k: (WATER_GAUGES[k][0], v["f"]) for k, v in water.items()},
          "| silent:", [WATER_GAUGES[k][0] for k in WATER_GAUGES if k not in water])
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
    cstations = current_stations()
    cseries = {}

    spots = []
    for idx, (sid, name, city, area, kind, lat, lon, tide_st) in enumerate(SPOTS):
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
        cinfo = None
        if kind == "bay" and cstations:
            dist, cst = min(((km(lat, lon, c[3], c[4]), c) for c in cstations), key=lambda x: x[0])
            if dist <= 3:  # Raccoon Strait (3.8 km) is far stronger than inside Richardson Bay
                if cst[0] not in cseries:
                    cseries[cst[0]] = current_series(cst[0], cst[1], now)
                ser, fdir, edir, cev = cseries[cst[0]]
                if ser:
                    cinfo = {"series": ser, "flood": fdir, "ebb": edir, "events": cev,
                             "src": {"name": cst[2], "station": cst[0], "miles": round(dist * 0.621, 1)}}
            print(name, "current station:", cst[2], cst[0], round(dist, 1), "km", "used" if cinfo else "not used")
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
            chop_ft, chop_s = chop(sid, wh["wind_speed_10m"][i], compass(wh["wind_direction_10m"][i])) if kind == "bay" else (None, None)
            r, why = rate(kind, wh["wind_speed_10m"][i], wh["wind_gusts_10m"][i], wave if kind == "coast" else chop_ft, alerts if i == start else [x for x in alerts if "advisory" not in x.lower()])
            ckt = None
            if cinfo:
                vals = [cinfo["series"].get(times[k][:13]) for k in range(i, min(i + 3, len(times)))]
                vals = [v for v in vals if v is not None]
                ckt = max(vals, key=abs) if vals else None  # strongest flow in the block
                cr, cwhy = current_rating(ckt, wh["wind_speed_10m"][i], wh["wind_direction_10m"][i], cinfo["flood"], cinfo["ebb"])
                if cr > r:
                    r, why = cr, cwhy
            # Rain: 3-hour peak chance. Lightning (thunderstorm codes 95-99) is No-go; rain likely is at least Caution.
            pp = [v for v in (wh.get("precipitation_probability") or [])[i:i + 3] if v is not None]
            rain = max(pp) if pp else None
            thunder = any((c or 0) >= 95 for c in (wh.get("weather_code") or [])[i:i + 3])
            if thunder:
                r, why = 2, "Thunderstorms"
            elif rain is not None and rain >= 50 and r < 1:
                r, why = 1, "Rain likely"
            return {"time": t, "wind": round(wh["wind_speed_10m"][i] or 0), "gust": round(wh["wind_gusts_10m"][i] or 0),
                    "dir": compass(wh["wind_direction_10m"][i]),
                    "wave_ft": None if wave is None else round(wave, 1),
                    "period_s": None if kind != "coast" else (lambda v: None if v is None else round(v))(mval("swell_wave_period", t) or mval("wave_period", t)),
                    "swell_dir": None if kind != "coast" else compass(mval("swell_wave_direction", t)),
                    "sst_f": None if sst is None else round(sst * 9 / 5 + 32),
                    "air_f": None if wh.get("temperature_2m") is None else round(wh["temperature_2m"][i]),
                    "chop_ft": chop_ft, "chop_s": chop_s,
                    "current_kt": None if ckt is None else round(ckt, 1),
                    "rain_pct": rain, "thunder": thunder, "rating": r, "why": why}

        if not times:
            continue
        cur = at(start)
        blocks = [at(i) for i in range(start, min(len(times), start + 72), 3)]
        next_tides = [x for x in tides.get(tide_st, []) if x["t"] >= now.strftime("%Y-%m-%d %H:%M")][:4]
        if kind == "coast":
            bid = "46012" if lat < 37.7 else "46026"
            if buoy.get(bid):
                water_f, water_src = buoy[bid], {"name": "NOAA buoy " + bid + " (offshore)", "station": bid}
            elif buoy.get("46237"):
                water_f, water_src = buoy["46237"], {"name": "NOAA buoy 46237 (San Francisco Bar)", "station": "46237"}
            else:
                water_f, water_src = cur["sst_f"], {"name": "forecast model (no buoy reading)"}
        else:
            water_f, water_src = nearest_water(water, lat, lon)
            if water_f is None:
                bid = "46012" if lat < 37.7 else "46237"
                water_f, water_src = (buoy[bid], {"name": "NOAA buoy " + bid + (" (Half Moon Bay)" if bid == "46012" else " (San Francisco Bar)"), "station": bid}) if buoy.get(bid) else (cur["sst_f"], {"name": "forecast model (no gauge reading)"})
        # Best upcoming window: first daylight block rated go (7 AM - 5 PM).
        best = next((b for b in blocks if b["rating"] == 0 and 7 <= int(b["time"][11:13]) <= 17), None)
        spots.append({"id": sid, "name": name, "city": city, "area": area, "kind": kind, "lat": lat, "lon": lon, "now": cur,
                      "blocks": blocks, "tides": next_tides, "tide_station": tide_st, "water_f": water_f, "water_src": water_src,
                      "current_src": cinfo["src"] if cinfo else None, "current_events": [e for e in (cinfo["events"] if cinfo else []) if e["t"] >= now.strftime("%Y-%m-%d %H:%M")][:4],
                      "alerts": alerts, "alert_details": details, "best": best["time"] if best else None})
        print(name, cur["rating"], cur["why"], cur["wind"], cur["gust"], cur["wave_ft"], len(next_tides), alerts, "| water", water_f, water_src)
    OUT.write_text(json.dumps({"generated_utc": datetime.now(timezone.utc).isoformat(), "spots": spots,
                               "sources": "Open-Meteo forecast + marine, NOAA CO-OPS tides and water temperature, NWS alerts"}, indent=1) + "\n")


if __name__ == "__main__":
    main()
