#!/usr/bin/env python3
"""Publish a 10-day Moraga daily model precipitation comparison.
Source: Open-Meteo deterministic forecast and ensemble-mean APIs.
Daily totals are midnight-to-midnight America/Los_Angeles; units inches.
"""
import json, urllib.parse, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

LAT, LON = 37.8201932, -122.1193876  # KCAMORAG71 user-provided station coordinates
TZ = "America/Los_Angeles"
BASE = {"latitude": LAT, "longitude": LON, "daily": "precipitation_sum",
        "timezone": TZ, "precipitation_unit": "inch", "forecast_days": 10}
SOURCES = [
    ("ECMWF", "https://api.open-meteo.com/v1/forecast", "ecmwf_ifs025"),
    ("GFS", "https://api.open-meteo.com/v1/forecast", "ncep_gfs_seamless"),
    ("EPS mean", "https://ensemble-api.open-meteo.com/v1/ensemble", "ecmwf_ifs025_ensemble_mean"),
    ("GEFS mean", "https://ensemble-api.open-meteo.com/v1/ensemble", "ncep_gefs_ensemble_mean_seamless"),
]
temperature_results = {}
hourly_results = {}
def get(url, model):
    params = {**BASE, "models": model}
    if "ensemble" not in url:
        params.update(daily="precipitation_sum,temperature_2m_max,temperature_2m_min", hourly="precipitation,cloud_cover", temperature_unit="fahrenheit")
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(url + "?" + q, headers={"User-Agent": "MoragaWeatherGraphics/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        payload = json.load(resp)
    daily = payload["daily"]
    if "hourly" in payload and "temperature_2m_max" in daily:
        hourly = payload["hourly"]
        hourly_results[model] = {"time": hourly.get("time", []), "precipitation_mm": hourly.get("precipitation", []), "cloud_cover_pct": hourly.get("cloud_cover", [])}
    values = daily["precipitation_sum"]
    if len(daily["time"]) != 10 or len(values) != 10:
        raise ValueError(f"Unexpected forecast length: {model}")
    if any(v is not None and (not isinstance(v, (float,int)) or v < 0) for v in values):
        raise ValueError(f"Invalid precipitation values: {model}")
    if "temperature_2m_max" in daily:
        highs, lows = daily["temperature_2m_max"], daily["temperature_2m_min"]
        if len(highs) != 10 or len(lows) != 10:
            raise ValueError("Unexpected temperature forecast length")
        temperature_results[model] = {"dates": daily["time"], "high_f": highs, "low_f": lows}
    return daily["time"], values

results, errors = {}, {}
dates = None
for name, url, model in SOURCES:
    try:
        d, vals = get(url, model)
        if dates is None:
            dates = d
        if dates != d:
            raise ValueError("Date mismatch")
        results[name] = vals
    except Exception as exc:
        errors[name] = str(exc)
if not results:
    raise RuntimeError("No valid model data: " + str(errors))
now = datetime.now(timezone.utc)
fig, ax = plt.subplots(figsize=(13, 6.3), dpi=160)
colors = {"ECMWF":"#0e7490", "GFS":"#e87922", "EPS mean":"#2563eb", "GEFS mean":"#9333ea"}
for name, vals in results.items():
    ax.plot(range(10), vals, label=f"{name}  |  10d {sum(v for v in vals if v is not None):.2f} in",
            marker="o", markersize=5, linewidth=2.4 if "mean" not in name else 2,
            linestyle="--" if "mean" in name else "-", color=colors[name])
ax.set_xticks(range(10), [datetime.fromisoformat(d).strftime("%a %b %-d") for d in dates])
ax.set_ylabel("Daily precipitation (inches)")
ax.set_ylim(bottom=0)
ax.grid(axis="y", alpha=.2)
ax.legend(loc="upper left", fontsize=9, ncol=2)
fig.suptitle("MORAGA  |  10-DAY MODEL RAINFALL COMPARISON", fontsize=16, fontweight="bold")
ax.set_title("ECMWF · GFS · EPS mean · GEFS mean  |  Local calendar days (Pacific time)", fontsize=10)
fig.text(.09, .035, f"Generated {now:%Y-%m-%d %H:%M} UTC  •  Open-Meteo model data  •  KCAMORAG71 requested coordinates  •  Missing: {', '.join(errors) or 'none'}", fontsize=8)
fig.tight_layout(rect=[0,.06,1,.92])
out = Path("moraga_rainfall_10day.png")
fig.savefig(out, bbox_inches="tight", facecolor="white")
Path("moraga_rainfall_10day.json").write_text(json.dumps({
    "generated_utc": now.isoformat(), "timezone": TZ, "latitude": LAT, "longitude": LON,
    "dates": dates, "model_daily_inches": results, "errors": errors,
    "source": "Open-Meteo", "note": "API does not explicitly expose model initialization times here; generated time is not initialization time."
}, indent=2))
print(f"Saved {out}; available models: {', '.join(results)}; errors: {errors}")

Path("moraga_forecast_10day.json").write_text(json.dumps({
    "generated_utc": now.isoformat(), "timezone": TZ, "latitude": LAT, "longitude": LON,
    "dates": dates, "temperature_models": {name: temperature_results[model] for name, url, model in SOURCES if model in temperature_results},
    "model_daily_inches": results, "hourly_conditions": {name: hourly_results[model] for name, url, model in SOURCES if model in hourly_results}, "errors": errors,
    "method": "Daily ECMWF/GFS model inputs. Website applies paired KCAMORAG71 hourly skill weights separately for highs and lows and by forecast lead; sparse or unverified leads retain equal weights. Displayed ranges are deterministic model spread, not probability intervals.",
    "source": "Open-Meteo", "note": "Model inputs are not bias-corrected; website skill weighting is provisional, based on hourly temperature errors. Generated timestamp is retrieval time, not model initialization."
}, indent=2))
