#!/usr/bin/env python3
"""Per-town forecast verification for Lafayette, Sycamore Valley (Danville) and Greenbrook.

Moraga is verified against KCAMORAG71 elsewhere. Each other town is verified against its own
hand-picked Weather Underground station, never against Moraga:

1. Archive each model's day-ahead (lead-1) daily high/low forecast from the town's published
   feed ({town}_forecast_10day.json). Past snapshots come from that file's git history, so the
   record starts with weeks of data, and each run adds new snapshots.
2. Fetch each day's observed high/low/rain from the live-observations worker (/daily), which reads
   the station's Weather Underground history (the API key never leaves the worker).
3. Score every model (MAE and mean bias) and choose a bias-correction strength by walk-forward
   testing: each test day is corrected only from earlier days, and a correction is kept only if it
   beats the uncorrected forecast.

Writes verification/town_forecast_archive.json, verification/town_observed.json and
verification/{town}_model_daily_verification.json (same schema as model_daily_verification_latest.json).
"""
import json
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "verification"
OUT.mkdir(exist_ok=True)
TZ = ZoneInfo("America/Los_Angeles")
WORKER = "https://moraga-live-observations.russo-matt.workers.dev/daily"
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import locations  # noqa: E402
TOWNS = {k: v for k, v in locations.towns(include_moraga=False).items() if v}  # station towns (scored against their own station)
# Every other location learns its corrections from NOAA URMA (and nearby public stations): licence-free.
ALL_TOWNS = [l["id"] for l in locations.load() if l["id"] != "moraga"]
MIN_SAMPLES = 200          # of ~288 five-minute observations in a day
BACKFILL_DAYS = 35
FACTORS = [0, .25, .5, .75, 1.0]


def load(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True).stdout


def snapshots(town, since_days):
    """Yield published feeds for a town from git history (oldest first), then the working copy."""
    name = f"{town}_forecast_10day.json"
    try:
        commits = git("log", f"--since={since_days}.days", "--format=%H", "--", name).split()
    except subprocess.CalledProcessError:
        commits = []
    for sha in reversed(commits):
        try:
            yield json.loads(git("show", f"{sha}:{name}"))
        except (subprocess.CalledProcessError, ValueError):
            continue
    current = load(ROOT / name, None)
    if current:
        yield current


def add_snapshot(archive, town, feed):
    """Keep each model's earliest forecast issued on the local day before the valid date."""
    try:
        issued = datetime.fromisoformat(feed["generated_utc"].replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return 0
    issued_day = issued.astimezone(TZ).date()
    target = (issued_day + timedelta(days=1)).isoformat()
    added = 0
    for model, m in (feed.get("temperature_models") or {}).items():
        dates = m.get("dates") or []
        if target not in dates:
            continue
        i = dates.index(target)
        hi, lo = (m.get("high_f") or [None])[i], (m.get("low_f") or [None])[i]
        if not isinstance(hi, (int, float)) or not isinstance(lo, (int, float)):
            continue
        slot = archive.setdefault(town, {}).setdefault(target, {})
        old = slot.get(model)
        if old is None or issued.isoformat() < old["issued_utc"]:
            slot[model] = {"high_f": round(hi, 1), "low_f": round(lo, 1), "issued_utc": issued.isoformat()}
            added += old is None
    return added


PREVIOUS_RUNS = {"ECMWF": "ecmwf_ifs025", "GFS": "gfs_seamless", "ICON": "icon_seamless", "GEM": "gem_seamless"}


def backfill_previous_runs(archive, town, lat, lon, days=60):
    """Fill days without an archived snapshot from Open-Meteo's previous-runs archive (day-ahead runs).
    Deterministic models only; an archived feed snapshot always takes precedence."""
    params = {"latitude": lat, "longitude": lon, "hourly": "temperature_2m_previous_day1",
              "models": ",".join(PREVIOUS_RUNS.values()), "temperature_unit": "fahrenheit",
              "timezone": "America/Los_Angeles", "past_days": days, "forecast_days": 1}
    url = "https://previous-runs-api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "DiabloWeatherLab/1.0"}), timeout=60) as r:
            hourly = json.load(r)["hourly"]
    except Exception as exc:  # optional: the archive simply starts later without it
        print(f"{town}: previous-runs backfill unavailable ({type(exc).__name__})")
        return 0
    today = datetime.now(TZ).date().isoformat()
    added = 0
    for name, model in PREVIOUS_RUNS.items():
        values = hourly.get(f"temperature_2m_previous_day1_{model}")
        if not values:
            continue
        by_day = {}
        for t, v in zip(hourly["time"], values):
            if v is not None:
                by_day.setdefault(t[:10], []).append(v)
        for day, vals in by_day.items():
            if day >= today or len(vals) < 22:
                continue
            slot = archive.setdefault(town, {}).setdefault(day, {})
            if name not in slot:
                slot[name] = {"high_f": round(max(vals), 1), "low_f": round(min(vals), 1), "issued_utc": "previous_runs_day1"}
                added += 1
    return added


def observed_day(town, day):
    url = f"{WORKER}?city={town}&date={day}"
    req = urllib.request.Request(url, headers={"User-Agent": "DiabloWeatherLab-verification/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(4 * (attempt + 1))
        except (OSError, ValueError):
            time.sleep(4 * (attempt + 1))
    return None


def full_day(ob):
    """A usable station day: readings spanning nearly the whole day, at any reporting interval
    (5-minute stations give ~288 readings, 15-minute stations ~96)."""
    try:
        span = (datetime.fromisoformat(ob["last_utc"].replace("Z", "+00:00")) - datetime.fromisoformat(ob["first_utc"].replace("Z", "+00:00"))).total_seconds() / 3600
    except (KeyError, ValueError, AttributeError):
        return ob.get("samples", 0) >= MIN_SAMPLES
    return span >= 22.5 and ob.get("samples", 0) >= 80


def walk_forward(errors):
    """Pick the bias-correction strength that would have helped most on unseen days."""
    tests = []
    for i in range(5, len(errors)):
        bias = mean(errors[:i])
        tests.append((errors[i], bias))
    if len(tests) < 3:
        return None
    mae = {f: mean(abs(e - f * b) for e, b in tests) for f in FACTORS}
    best = min(FACTORS, key=lambda f: (mae[f], f))
    raw = mae[0]
    if best and (raw - mae[best] <= .15 or (raw - mae[best]) / raw < .05):
        best = 0
    return {"factor": best, "holdout_days": len(tests), "raw_holdout_mae_f": round(raw, 3),
            "selected_holdout_mae_f": round(mae[best], 3), "method": "walk_forward_prior_days_only", "lead_specific": False}


def score(town, archive, observed, source="station"):
    rows = []
    for day, models in sorted(archive.get(town, {}).items()):
        ob = observed.get(town, {}).get(day)
        if not ob:
            continue
        for model, f in models.items():
            rows.append({"model": model.lower(), "valid_local_date": day, "issued_utc": f["issued_utc"],
                         "observed_high_f": ob["high_f"], "observed_low_f": ob["low_f"],
                         "high_error_f": round(f["high_f"] - ob["high_f"], 2), "low_error_f": round(f["low_f"] - ob["low_f"], 2),
                         "observation_count": ob["samples"]})
    scores, calibration = {}, {}
    for model in sorted({r["model"] for r in rows}):
        mine = sorted((r for r in rows if r["model"] == model), key=lambda r: r["valid_local_date"])
        hi, lo = [r["high_error_f"] for r in mine], [r["low_error_f"] for r in mine]
        scores[model] = {"verified_days": len(mine), "high_mae_f": round(mean(map(abs, hi)), 2), "low_mae_f": round(mean(map(abs, lo)), 2),
                         "high_bias_f": round(mean(hi), 2), "low_bias_f": round(mean(lo), 2)}
        for phase, errs in (("high", hi), ("low", lo)):
            wf = walk_forward(errs)
            if wf:
                calibration.setdefault(model, {})[phase] = {**wf, "verified_days": len(errs)}
    return {"generated_utc": datetime.now(timezone.utc).isoformat(), "status": "verified_daily_extremes" if rows else "collecting",
            "town": town, "station": TOWNS[town] if source == "station" else ("public stations" if source == "public_stations" else "NOAA URMA"), "verified_against": source, "model_scores": scores, "calibration": calibration,
            "method": "Earliest archived day-ahead model forecast per target local date (from the published town feed); observed daily high/low from the town's "
                      + (f"Weather Underground station ({TOWNS[town]}) covering at least 22.5 hours of the day" if source == "station"
                         else "nearby public stations (NWS feed; see public_stations.json), averaged after a neighbour check" if source == "public_stations"
                         else "point in NOAA's URMA 2.5 km analysis (hourly, 22+ hours of the Pacific day; public domain)"),
            "note": "Each town is verified against its own station; Moraga corrections are never transferred.",
            "matches": rows[-90:]}


def main():
    archive_path, observed_path = OUT / "town_forecast_archive.json", OUT / "town_observed.json"
    archive, observed = load(archive_path, {}), load(observed_path, {})
    today = datetime.now(TZ).date()
    for town in ALL_TOWNS:
        since = 3 if archive.get(town) else BACKFILL_DAYS
        added = sum(add_snapshot(archive, town, feed) for feed in snapshots(town, since))
        if len(archive.get(town, {})) < 30:
            feed = load(ROOT / f"{town}_forecast_10day.json", {})
            if feed.get("latitude") is not None:
                added += backfill_previous_runs(archive, town, feed["latitude"], feed["longitude"])
        # Observed days: every archived day before today that is missing, plus the last 2 days (late data).
        want = {d for d in archive.get(town, {}) if d < today.isoformat() and d not in observed.get(town, {})}
        want |= {(today - timedelta(days=k)).isoformat() for k in (1, 2)}
        if town not in TOWNS:
            want = set()  # no private station: NOAA / public-station tracks only
        got = 0
        for day in sorted(want):
            ob = observed_day(town, day)
            if ob and full_day(ob) and ob.get("station") == TOWNS[town]:
                observed.setdefault(town, {})[day] = {k: ob.get(k) for k in ("high_f", "low_f", "precip_in", "samples")}
                got += 1
        # Keep 120 days.
        cutoff = (today - timedelta(days=120)).isoformat()
        archive[town] = {d: v for d, v in archive.get(town, {}).items() if d >= cutoff}
        observed[town] = {d: v for d, v in observed.get(town, {}).items() if d >= cutoff}
        if town in TOWNS:
            result = score(town, archive, observed)
            (OUT / f"{town}_model_daily_verification.json").write_text(json.dumps(result, indent=1) + "\n")
            print(f"{town}: +{added} forecasts, +{got} observed days, {len(result['matches'])} matches, models {list(result['model_scores'])}")
        else:
            print(f"{town}: +{added} forecasts (NOAA/public tracks)")
        time.sleep(1.5)  # be gentle with the previous-runs archive
        # Second track: the same forecasts verified against NOAA's URMA analysis (licence-free for a paid app).
        noaa = load(OUT / "town_observed_noaa.json", {})
        if noaa.get(town):
            nres = score(town, archive, noaa, source="noaa_urma")
            (OUT / f"{town}_model_daily_verification_noaa.json").write_text(json.dumps(nres, indent=1) + "\n")
            print(f"{town} (NOAA track): {len(nres['matches'])} matches")
        # Third track: nearby public stations (NWS feed) - licence-friendly and scalable.
        pub = load(OUT / "town_observed_public.json", {})
        if pub.get(town):
            pres = score(town, archive, pub, source="public_stations")
            (OUT / f"{town}_model_daily_verification_public.json").write_text(json.dumps(pres, indent=1) + "\n")
            print(f"{town} (public-station track): {len(pres['matches'])} matches")
    archive_path.write_text(json.dumps(archive, indent=1, sort_keys=True) + "\n")
    observed_path.write_text(json.dumps(observed, indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
