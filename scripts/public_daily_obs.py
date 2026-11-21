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
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import locations  # noqa: E402
TOWNS = locations.towns()
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
    """The location being forecast: its trusted station's position and elevation, else the location's
    own coordinates with terrain elevation from Open-Meteo."""
    if station:
        try:
            s = get(f"{WORKER}/station?id={station}")
            return float(s["lat"]), float(s["lon"]), float(s.get("elevation_ft") or 0)
        except Exception:
            pass
    loc = locations.by_id()[town]
    # Terrain elevation of the NWS 2.5 km grid cell at the location (public, no rate limit issues).
    pt = get(f"https://api.weather.gov/points/{loc['lat']},{loc['lon']}")["properties"]
    grid = get(pt["forecastGridData"])["properties"]
    el = float(grid["elevation"]["value"]) * 3.281
    return loc["lat"], loc["lon"], el


def choose(only=None, prev=None):
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
    out = dict(prev or {})
    for town, wu in TOWNS.items():
        if only and town not in only:
            continue
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
    hourly = {}
    for t, f in temps:
        hourly.setdefault(t.replace(minute=0, second=0, microsecond=0), []).append(f)
    hourly = {h: sum(v) / len(v) for h, v in hourly.items()}
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
    return out, hourly


HEALTH = ROOT / "verification" / "public_station_health.json"


def reference_hourly(town):
    """The town's trusted station, hourly means, last 7 days (test phase only: used to grade public stations)."""
    out = {}
    for k in range(8):
        day = (datetime.now(TZ) - timedelta(days=k)).strftime("%Y-%m-%d")
        try:
            req = urllib.request.Request(f"{WORKER}/dayobs?city={town}&date={day}", headers={"User-Agent": H["User-Agent"]})
            d = json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            continue
        for t, temp, *_ in d.get("obs", []):
            if temp is None:
                continue
            h = datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(TZ).replace(minute=0, second=0, microsecond=0)
            out.setdefault(h, []).append(temp)
    return {h: sum(v) / len(v) for h, v in out.items()}


def grade(station, town, hourly, ref, neighbours):
    """Offsets by day / night vs the trusted station and vs the other public stations; a status."""
    cut = datetime.now(TZ) - timedelta(days=7)
    hrs = [h for h in hourly if h >= cut]
    expected = 7 * 24
    def offsets(other, part):
        d = [hourly[h] - other[h] for h in hrs if h in other and (9 <= h.hour <= 16 if part == "day" else (h.hour >= 21 or h.hour <= 5))]
        return (round(sum(d) / len(d), 1), len(d)) if len(d) >= 12 else (None, len(d))
    day_ref, nd = offsets(ref, "day")
    night_ref, nn = offsets(ref, "night")
    nb = {}
    for h in hrs:
        vals = [n[h] for n in neighbours if h in n]
        if len(vals) >= 2:
            nb[h] = median(vals)
    day_nb, _ = offsets(nb, "day") if nb else (None, 0)
    night_nb, _ = offsets(nb, "night") if nb else (None, 0)
    reports = round(100 * len(hrs) / expected)
    issues, status = [], "ok"
    if reports < 75:
        issues.append(f"reports only {reports}% of hours"); status = "watch" if reports >= 50 else "drop"
    for label, dv, nv in (("vs trusted station", day_ref, night_ref), ("vs neighbours", day_nb, night_nb)):
        if dv is None or nv is None:
            continue
        if dv - nv >= 3:
            issues.append(f"runs {dv - nv:.0f}° warmer by day than at night {label} (sun on the sensor?)")
            status = "drop" if dv - nv >= 5 else max(status, "watch", key=["ok", "watch", "drop"].index)
        if abs(dv) >= 4 and abs(nv) >= 4 and (dv > 0) == (nv > 0):
            issues.append(f"offset about {(dv + nv) / 2:+.0f}° at all hours {label}")
            status = "drop" if min(abs(dv), abs(nv)) >= 6 else max(status, "watch", key=["ok", "watch", "drop"].index)
    return {"station": station["id"], "name": station["name"], "town": town, "miles": station["miles"], "delev_ft": station.get("delev_ft"),
            "reports_pct": reports, "day_vs_trusted": day_ref, "night_vs_trusted": night_ref, "day_vs_neighbours": day_nb,
            "night_vs_neighbours": night_nb, "status": status, "issues": issues}


def main():
    try:
        choice = json.loads(CHOICE.read_text())
    except (OSError, ValueError):
        choice = None
    missing = [t for t in TOWNS if not (choice or {}).get(t)]
    if missing:
        choice = choose(missing, choice or {})
    try:
        obs = json.loads(OUT.read_text())
    except (OSError, ValueError):
        obs = {}
    cache, health = {}, []
    for town in TOWNS:
        per = {}
        for s in choice[town]["stations"]:
            if s["id"] not in cache:
                try:
                    cache[s["id"]] = station_days(s["id"])
                except Exception as exc:
                    print(s["id"], "unavailable", type(exc).__name__)
                    cache[s["id"]] = ({}, {})
        ref = reference_hourly(town)
        for s in choice[town]["stations"]:
            others = [cache[o["id"]][1] for o in choice[town]["stations"] if o["id"] != s["id"]]
            g = grade(s, town, cache[s["id"]][1], ref, others)
            health.append(g)
            print("health", g["station"], g["status"], g["issues"])
            if g["status"] == "drop":
                continue  # a failing station never feeds the training data
            for day, hl in cache[s["id"]][0].items():
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
    HEALTH.write_text(json.dumps({"generated_utc": datetime.now(timezone.utc).isoformat(), "window_days": 7,
                                  "method": "Hourly means over the last 7 days. Day = 9 AM-4 PM, night = 9 PM-5 AM Pacific. "
                                            "Trusted station = the location's chosen station (test phase). Drop: offset of 6+ F at all hours, "
                                            "5+ F warmer by day than at night, or under 50% of hours reported.",
                                  "stations": health}, indent=1) + "\n")


if __name__ == "__main__":
    main()
