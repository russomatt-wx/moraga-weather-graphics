#!/usr/bin/env python3
"""Publish a 14-day Moraga daily model precipitation comparison.
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
        "timezone": TZ, "precipitation_unit": "inch", "forecast_days": 14}
SOURCES = [
    ("ECMWF", "https://api.open-meteo.com/v1/forecast", "ecmwf_ifs025"),
    ("GFS", "https://api.open-meteo.com/v1/forecast", "ncep_gfs_seamless"),
    ("ICON", "https://api.open-meteo.com/v1/forecast", "icon_seamless"),
    ("GEM", "https://api.open-meteo.com/v1/forecast", "gem_seamless"),
    ("NAM", "https://api.open-meteo.com/v1/forecast", "ncep_nam_conus"),
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
    if not daily["time"] or len(values) != len(daily["time"]):
        raise ValueError(f"Unexpected forecast length: {model}")
    if any(v is not None and (not isinstance(v, (float,int)) or v < 0) for v in values):
        raise ValueError(f"Invalid precipitation values: {model}")
    if "temperature_2m_max" in daily:
        highs, lows = daily["temperature_2m_max"], daily["temperature_2m_min"]
        if len(highs) != len(daily["time"]) or len(lows) != len(daily["time"]):
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
        if dates != d and name in ("ECMWF","GFS","EPS mean","GEFS mean"):
            raise ValueError("Date mismatch")
        if dates != d:
            vals = [dict(zip(d,vals)).get(day) for day in dates]
        results[name] = vals
    except Exception as exc:
        errors[name] = str(exc)
if not results:
    raise RuntimeError("No valid model data: " + str(errors))
now = datetime.now(timezone.utc)
fig, ax = plt.subplots(figsize=(13, 6.3), dpi=160)
colors = {"ECMWF":"#0e7490", "GFS":"#e87922", "ICON":"#059669", "GEM":"#db2777", "NAM":"#64748b", "EPS mean":"#2563eb", "GEFS mean":"#9333ea"}
for name, vals in results.items():
    ax.plot(range(len(vals)), vals, label=f"{name}  |  14d {sum(v for v in vals if v is not None):.2f} in",
            marker="o", markersize=5, linewidth=2.4 if "mean" not in name else 2,
            linestyle="--" if "mean" in name else "-", color=colors[name])
ax.set_xticks(range(len(dates)), [datetime.fromisoformat(d).strftime("%a %b %-d") for d in dates])
ax.set_ylabel("Daily precipitation (inches)")
ax.set_ylim(bottom=0)
ax.grid(axis="y", alpha=.2)
ax.legend(loc="upper left", fontsize=9, ncol=2)
fig.suptitle("MORAGA  |  14-DAY MODEL RAINFALL COMPARISON", fontsize=16, fontweight="bold")
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

def daily_conditions(dates, results, hourly_results):
    """Compute deterministic display labels before publishing, never in the browser."""
    by_name = {name: hourly_results[model] for name, _, model in SOURCES if model in hourly_results}
    output = {}
    for index, day in enumerate(dates):
        available = []
        sky = []
        for name, series in by_name.items():
            hours = []
            for j, stamp in enumerate(series.get("time", [])):
                if not stamp.startswith(day):
                    continue
                hour = int(stamp[11:13])
                rain = series.get("precipitation_mm", [])[j]
                cloud = series.get("cloud_cover_pct", [])[j]
                if 8 <= hour <= 18 and isinstance(cloud, (float, int)):
                    sky.append((hour, cloud))
                hours.append((hour, rain))
            amount = results.get(name, [None] * len(dates))[index]
            if len(hours) >= 20 and isinstance(amount, (float, int)):
                available.append((name, amount, hours))
        clouds = sum(c for _, c in sky) / len(sky) if sky else None
        if clouds is None:
            icon, label = "⛅", "Partly cloudy"
        elif clouds <= 10:
            icon, label = "☀️", "Sunny"
        elif clouds <= 25:
            icon, label = "🌤️", "Mostly sunny"
        elif clouds <= 50:
            icon, label = "⛅", "Partly cloudy"
        elif clouds <= 85:
            icon, label = "🌥️", "Mostly cloudy"
        else:
            icon, label = "☁️", "Overcast"
        support = [(n, a, h) for n, a, h in available if a >= 0.05]
        wet = [(n, sum(1 for _, r in h if isinstance(r, (float, int)) and r >= 0.004))
               for n, a, h in available if any(isinstance(r, (float, int)) and r >= 0.004 for _, r in h)]
        if len(support) >= 2 and len(support) / len(available) >= 0.6 and len(wet) >= 2 and sum(n for _, n in wet) / len(wet) >= 3:
            icon, label = "🌧️", "Rain likely"
        elif len(support) >= 2 and len(support) / len(available) >= 0.4:
            icon, label = "🌦️", "Chance of showers"
        elif available and len(wet) / len(available) >= 0.4:
            icon, label = "🌦️", "Chance of showers"
        # A small, credible rain signal should not be represented as entirely dry.
        # Reserve "Rain likely" for broad agreement; retain uncertainty otherwise.
        daily_amounts = [values[index] for values in results.values()
                         if index < len(values) and isinstance(values[index], (int, float))]
        mean_rain = sum(daily_amounts) / len(daily_amounts) if daily_amounts else 0
        if icon not in ("🌧️", "🌦️") and (mean_rain >= 0.01 or len(support) >= 1):
            icon, label = "🌦️", "Isolated showers possible"
        output[day] = {"icon": icon, "label": label}
    return output

conditions = daily_conditions(dates, results, hourly_results)
assert len(conditions) == len(dates)
assert all(v["icon"] and v["label"] for v in conditions.values())

forecast_dates = dates[:10]\nPath("moraga_forecast_10day.json").write_text(json.dumps({
    "generated_utc": now.isoformat(), "timezone": TZ, "latitude": LAT, "longitude": LON,
    "dates": forecast_dates, "temperature_models": {name: {**temperature_results[model], "dates": temperature_results[model]["dates"][:10], "high_f": temperature_results[model]["high_f"][:10], "low_f": temperature_results[model]["low_f"][:10]} for name, url, model in SOURCES if model in temperature_results},
    "model_daily_inches": {name: values[:10] for name, values in results.items()}, "daily_conditions": {day: conditions[day] for day in forecast_dates}, "hourly_conditions": {name: hourly_results[model] for name, url, model in SOURCES if model in hourly_results}, "errors": errors,
    "method": "Available ECMWF, GFS, ICON, GEM and NAM temperature guidance; website applies provisional KCAMORAG71 hourly skill weights separately for daytime and overnight, using lead-specific history where sufficient. Displayed ranges are deterministic model spread, not probability intervals.",
    "source": "Open-Meteo", "note": "Model inputs are not bias-corrected; website skill weighting is provisional, based on hourly temperature errors. Generated timestamp is retrieval time, not model initialization."
}, indent=2))
