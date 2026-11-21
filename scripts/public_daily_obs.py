#!/usr/bin/env python3
"""Daily observed high / low per location from nearby PUBLIC stations (NOAA/NWS feed: airports,
CWOP citizen stations, agency networks) - the licence-friendly training source that scales.

Station choice uses only public information: up to 3 stations within 3 miles of the location, at a
similar elevation (within 350 ft, so ridge-top sites are skipped), that reported temperature recently.
Each run reads the last 7 days (the NWS API keeps about a week), works out each station's Pacific-day
high and low (only days covered for 22+ hours), drops a station that disagrees with the others by more
than 6 F, and averages the rest.

Writes verification/public_stations.json (the chosen stations) and verification/town_observed_public.json.
"""
import json
import math
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CHOICE = ROOT / "verification" / "public_stations.json"
OUT = ROOT / "verification" / "town_observed_public.json"
TZ = ZoneInfo("America/Los_Angeles")
H = {"User-Agent": "DiabloWeatherLab-public-obs/1.0", "Accept": "application/geo+json"}
WORKER = "https://moraga-live-observations.russo-matt.workers.dev"
TOWNS = {"moraga": "KCAMORAG71", "lafayette": "KCAWALNU6", "danville": "KCADANVI207", "greenbrook": "KCADANVI224",
         "brentwood": "KCABRENT202", "sacramento": "KCASACRA200", "sausalito": "KCASAUSA88"}
MAX_MI, MAX_DELEV_FT, PER_TOWN = 3.0, 350, 3


def get(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60) as r:
                return json.load(r)
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(3 * (k + 1))


def miles(a, b, c, d):
    return math.hypot((a - c) * 69, (b - d) * 69 * math.cos(math.radians(a)))


def town_point(town, station):
    """The location being forecast: the town station's position and elevation (public metadata)."""
    s = get(f"{WORKER}/station?id={station}")
    return float(s["lat"]), float(s["lon"]), float(s.get("elevation_ft") or 0)


def choose():
    stations, url = [], "https://api.weather.gov/stations?state=CA&limit=500"
    for _ in range(40):
        d = get(url)
        for f in d.get("features", []):
            p, c = f["properties"], f["geometry"]["coordinates"]
            elev = (p.get("elevation") or {}).get("value")
            stations.append({"id": p["stationIdentifier"], "name": p.get("name", ""), "lat": c[1], "lon": c[0],
                             "elev_ft": None if elev is None else elev * 3.281})
        nxt = (d.get("pagination") or {}).get("next")
        if not nxt or not d.get("features"):
            break
        url = nxt
    out = {}
    for town, wu in TOWNS.items():
        la, lo, el = town_point(town, wu)
        cands = sorted((dict(s, miles=round(miles(la, lo, s["lat"], s["lon"]), 2)) for s in stations), key=lambda s: s["miles"])
        picked = []
        for s in cands:
            if s["miles"] > MAX_MI or len(picked) >= PER_TOWN:
                break
            if s["elev_ft"] is None or abs(s["elev_ft"] - el) > MAX_DELEV_FT:
                continue
            try:  # must be reporting temperature
                o = get(f"https://api.weather.gov/stations/{s['id']}/observations?limit=5")
                if not any((f["properties"].get("temperature") or {}).get("value") is not None for f in o.get("features", [])):
                    continue
            except Exception:
                continue
            picked.append({k: s[k] for k in ("id", "name", "miles")} | {"elev_ft": round(s["elev_ft"]), "delev_ft": round(s["elev_ft"] - el)})
        out[town] = {"point": [la, lo, round(el)], "stations": picked}
        print(town, "->", [(p["id"], p["name"][:24], p["miles"], p["delev_ft"]) for p in picked])
    out["_chosen_utc"] = datetime.now(timezone.utc).isoformat()
    CHOICE.write_text(json.dumps(out, indent=1) + "\n")
    return out


def station_days(sid):
    """{date: (high, low)} for complete Pacific days in the last week."""
    start = (datetime.now(timezone.utc) - timedelta(days=8)).strftime("%Y-%m-%dT%H:%M:%SZ")
    url, temps = f"https://api.weather.gov/stations/{sid}/observations?start={start}&limit=500", []
    for _ in range(10):
        d = get(url)
        feats = d.get("features", [])
        for f in feats:
            p = f["properties"]
            v = (p.get("temperature") or {}).get("value")
            if v is not None and (p.get("temperature") or {}).get("qualityControl") not in ("X", "Q"):
                temps.append((datetime.fromisoformat(p["timestamp"]).astimezone(TZ), v * 9 / 5 + 32))
        nxt = (d.get("pagination") or {}).get("next")
        if not nxt or not feats:
            break
        url = nxt
    by = {}
    for t, f in temps:
        by.setdefault(t.date().isoformat(), []).append((t, f))
    out = {}
    today = datetime.now(TZ).date().isoformat()
    for day, vals in by.items():
        if day >= today:
            continue
        ts = sorted(t for t, _ in vals)
        span = (ts[-1] - ts[0]).total_seconds() / 3600
        hours = len({t.hour for t in ts})
        if span >= 22 and hours >= 20:
            fs = [f for _, f in vals]
            out[day] = (max(fs), min(fs))
    return out


def main():
    try:
        choice = json.loads(CHOICE.read_text())
    except (OSError, ValueError):
        choice = None
    if not choice or any(not choice.get(t) for t in TOWNS):
        choice = choose()
    try:
        obs = json.loads(OUT.read_text())
    except (OSError, ValueError):
        obs = {}
    cache = {}
    for town in TOWNS:
        per = {}
        for s in choice[town]["stations"]:
            if s["id"] not in cache:
                try:
                    cache[s["id"]] = station_days(s["id"])
                except Exception as exc:
                    print(s["id"], "unavailable", type(exc).__name__)
                    cache[s["id"]] = {}
            for day, hl in cache[s["id"]].items():
                per.setdefault(day, {})[s["id"]] = hl
        for day, vals in per.items():
            hi = {k: v[0] for k, v in vals.items()}
            lo = {k: v[1] for k, v in vals.items()}
            if len(vals) >= 3:  # quality check against the others
                keep = [k for k in vals if abs(hi[k] - median(hi.values())) <= 6 and abs(lo[k] - median(lo.values())) <= 6]
            else:
                keep = list(vals)
            if not keep:
                continue
            obs.setdefault(town, {})[day] = {"high_f": round(sum(hi[k] for k in keep) / len(keep), 1),
                                            "low_f": round(sum(lo[k] for k in keep) / len(keep), 1),
                                            "samples": len(keep), "stations": keep}
        print(town, {d: (v["high_f"], v["low_f"], v["stations"]) for d, v in sorted(obs.get(town, {}).items())[-3:]})
    cutoff = (datetime.now(TZ).date() - timedelta(days=120)).isoformat()
    obs = {t: {d: v for d, v in sorted(days.items()) if d >= cutoff} for t, days in obs.items()}
    OUT.write_text(json.dumps(obs, indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
