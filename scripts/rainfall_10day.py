import math
#!/usr/bin/env python3
"""Publish a 14-day Moraga daily model precipitation comparison.
Source: Open-Meteo deterministic forecast and ensemble-mean APIs.
Daily totals are midnight-to-midnight America/Los_Angeles; units inches.
"""
import json, urllib.parse, urllib.request, time, os
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import dwl_chart_style as dwl
dwl.apply()


LAT, LON = (float(os.environ.get('WX_FORECAST_LAT', '37.8201932')), float(os.environ.get('WX_FORECAST_LON', '-122.1193876')))  # Location-specific model collection
TZ = "America/Los_Angeles"
BASE = {"latitude": LAT, "longitude": LON, "daily": "precipitation_sum",
        "timezone": TZ, "precipitation_unit": "inch", "forecast_days": 14}
SOURCES = [
    ("ECMWF", "https://api.open-meteo.com/v1/forecast", "ecmwf_ifs025"),
    ("GFS", "https://api.open-meteo.com/v1/forecast", "ncep_gfs_seamless"),
    ("ICON", "https://api.open-meteo.com/v1/forecast", "icon_seamless"),
    ("GEM", "https://api.open-meteo.com/v1/forecast", "gem_seamless"),
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
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                payload = json.load(resp)
            break
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    daily = payload["daily"]
    if "hourly" in payload and "temperature_2m_max" in daily:
        hourly = payload["hourly"]
        hourly_results[model] = {"time": hourly.get("time", []), "precipitation_mm": hourly.get("precipitation", []), "cloud_cover_pct": hourly.get("cloud_cover", [])}
    values = daily["precipitation_sum"]
    if not daily["time"] or len(values) != len(daily["time"]):
        raise ValueError(f"Unexpected forecast length: {model}")
    # Preserve valid days even when a model returns an invalid daily value.
    cleaned = []
    for v in values:
        if v is None:
            cleaned.append(None)
        elif not isinstance(v, (float, int)) or not float("-inf") < v < float("inf"):
            cleaned.append(None)
        elif v < -0.005:
            cleaned.append(None)
        else:
            cleaned.append(max(0.0, v))
    values = cleaned
    if "temperature_2m_max" in daily:
        highs, lows = daily["temperature_2m_max"], daily["temperature_2m_min"]
        if len(highs) != len(daily["time"]) or len(lows) != len(daily["time"]):
            raise ValueError("Unexpected temperature forecast length")
        temperature_results[model] = {"dates": daily["time"], "high_f": highs, "low_f": lows}
    return daily["time"], values

def fetch_rain_probability():
    """Open-Meteo daily precipitation probability, derived from ensemble guidance.

    Fail closed: an unavailable probability never becomes an invented zero or
    a rain icon based on a lone deterministic precipitation forecast.
    """
    params = {"latitude": LAT, "longitude": LON, "daily": "precipitation_probability_max",
              "timezone": TZ, "forecast_days": 14}
    url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "MoragaWeatherGraphics/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        payload = json.load(resp)
    daily = payload["daily"]
    dates = daily["time"]
    probabilities = daily["precipitation_probability_max"]
    if len(dates) != len(probabilities):
        raise ValueError("Rain probability date/value length mismatch")
    if any(p is not None and (not isinstance(p, (int, float)) or p < 0 or p > 100) for p in probabilities):
        raise ValueError("Invalid precipitation probability")
    return dict(zip(dates, probabilities))

results, errors = {}, {}
# Use a fixed 14-day calendar, not the horizon of whichever model responds first.
start_day = datetime.now(ZoneInfo(TZ)).date()
dates = [(start_day + timedelta(days=i)).isoformat() for i in range(14)]
for name, url, model in SOURCES:
    try:
        d, vals = get(url, model)
        # Shorter-range models retain nulls beyond their available horizon.
        results[name] = [dict(zip(d, vals)).get(day) for day in dates]
    except Exception as exc:
        errors[name] = str(exc)
if not results:
    raise RuntimeError("No valid model data: " + str(errors))
try:
    ensemble_rain_probability = fetch_rain_probability()
except Exception as exc:
    ensemble_rain_probability = {}
    errors["ensemble_rain_probability"] = str(exc)
# Ensemble member distributions: actual daily accumulation probabilities, not
# probability of any single wet hour. Keep model families equally weighted.
def ensemble_daily(model):
    params={"latitude":LAT,"longitude":LON,"hourly":"precipitation",
            "models":model,"timezone":TZ,"precipitation_unit":"inch",
            "forecast_days":14}
    url="https://ensemble-api.open-meteo.com/v1/ensemble?"+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers={"User-Agent":"MoragaWeatherGraphics/1.0"})
    with urllib.request.urlopen(req,timeout=70) as response:
        payload=json.load(response)
    hourly=payload["hourly"]
    keys=[k for k in hourly if k.startswith("precipitation_member")]
    out={}
    for day in dates:
        ix=[i for i,t in enumerate(hourly["time"]) if t.startswith(day)]
        if len(ix)<20:continue
        totals=[]
        for key in keys:
            vals=hourly[key]
            sample=[vals[i] for i in ix]
            if len(sample)==len(ix) and all(isinstance(v,(float,int)) and math.isfinite(v) and v>=0 for v in sample):
                totals.append(sum(sample))
        if len(totals)>=10:
            out[day]={"mean":sum(totals)/len(totals),
                      "thresholds":{str(t):sum(v>=t for v in totals)/len(totals) for t in (.01,.10,.25,.50)},
                      "members":len(totals)}
    return out

ensemble_temperature={}
def ensemble_temperature_daily(model):
    params={"latitude":LAT,"longitude":LON,"hourly":"temperature_2m","models":model,
            "timezone":TZ,"temperature_unit":"fahrenheit","forecast_days":10}
    url="https://ensemble-api.open-meteo.com/v1/ensemble?"+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers={"User-Agent":"MoragaWeatherGraphics/1.0"})
    with urllib.request.urlopen(req,timeout=70) as response:
        hourly=json.load(response)["hourly"]
    keys=[k for k in hourly if k.startswith("temperature_2m_member")]
    highs,lows=[],[]
    for day in dates[:10]:
        ix=[i for i,t in enumerate(hourly["time"]) if t.startswith(day)]
        h,l=[],[]
        if len(ix)>=20:
            for key in keys:
                values=[hourly[key][i] for i in ix]
                if all(isinstance(v,(int,float)) and math.isfinite(v) for v in values):
                    h.append(max(values));l.append(min(values))
        highs.append(sorted(h)[len(h)//2] if len(h)>=10 else None)
        lows.append(sorted(l)[len(l)//2] if len(l)>=10 else None)
    return {"dates":dates[:10],"high_f":highs,"low_f":lows}

ensemble_members={}
for label,model in (("EPS","ecmwf_ifs025_ensemble"),("GEFS","ncep_gefs_seamless")):
    try:ensemble_members[label]=ensemble_daily(model)
    except Exception as exc:errors[label+"_members"]=str(exc)
for label,model in (("EPS","ecmwf_ifs025_ensemble"),("GEFS","ncep_gefs_seamless")):
    try: ensemble_temperature[label]=ensemble_temperature_daily(model)
    except Exception as exc: errors[label+"_temperature"]=str(exc)
# Moraga PoP v1: fraction of complete EPS/GEFS member daily totals >= 0.01 in.
# Equal model-family weighting avoids over-weighting GEFS by member count.
# Published PoP is retained only as an independent benchmark.
model_derived_pop={}
for day in dates:
    families={name:days[day] for name,days in ensemble_members.items()
              if day in days and days[day]["members"]>=10}
    if len(families)==2:
        model_derived_pop[day]=round(100*sum(v["thresholds"]["0.01"] for v in families.values())/2)
    else:
        model_derived_pop[day]=None
benchmark_pop=ensemble_rain_probability
ensemble_rain_probability={day:value for day,value in model_derived_pop.items() if value is not None}
rain_guidance={}
for i,day in enumerate(dates):
    available={name:series[day] for name,series in ensemble_members.items() if day in series}
    deterministic=[results[name][i] for name in ("ECMWF","GFS","ICON","GEM") if name in results and isinstance(results[name][i],(int,float))]
    ens_mean=sum(v["mean"] for v in available.values())/len(available) if available else None
    det_mean=sum(deterministic)/len(deterministic) if deterministic else None
    share=.25 if i<3 else .60 if i<7 else .80
    if ens_mean is None:share=0
    if det_mean is None:share=1
    expected=(ens_mean*share if ens_mean is not None else 0)+(det_mean*(1-share) if det_mean is not None else 0)
    thresholds={str(t):round(100*sum(v["thresholds"][str(t)] for v in available.values())/len(available)) for t in (.01,.10,.25,.50)} if available else {}
    rain_guidance[day]={"expected_inches":round(expected,3) if available or deterministic else None,
        "ensemble_share":share if available and deterministic else (1 if available else 0),
        "ensemble_threshold_pct":thresholds,"ensemble_models":list(available),
        "ensemble_members":sum(v["members"] for v in available.values()),
        "derived_pop_pct":model_derived_pop[day], "pop_method":"EPS/GEFS equal-family member fraction >=0.01 in",
        "pop_status":"available" if model_derived_pop[day] is not None else "missing_ensemble_family"}

now = datetime.now(timezone.utc)
# Shared light chart style: readable on mobile, matching the observatory's other graphics.
fig, ax = plt.subplots(figsize=(9, 10.5), dpi=160, facecolor="#071b2c")
ax.set_facecolor("#071b2c")
colors = {"ECMWF":"#19dcf6","GFS":"#ffbf2e","ICON":"#37d67a",
          "GEM":"#f472b6","EPS mean":"#5aa9ff",
          "GEFS mean":"#a78bfa"}
for name, vals in results.items():
    available=[v for v in vals if isinstance(v,(float,int))]
    if not available: continue
    ax.plot(range(len(vals)), vals, label=f"{name}  {sum(available):.2f} in",
            marker="o", markersize=6, linewidth=3 if "mean" not in name else 2.8,
            linestyle="--" if "mean" in name else "-",color=colors[name])
ax.set_xlim(-.35,13.35)
ax.set_xticks(range(14))
ax.set_xticklabels([datetime.fromisoformat(d).strftime("%b %-d") for d in dates],
                   rotation=55,ha="right",fontsize=15,fontweight="semibold")
ax.tick_params(axis="y",labelsize=15)
ax.set_ylabel("Daily rainfall (inches)",fontsize=15,fontweight="bold",labelpad=12)
max_daily = max((float(v) for vals in results.values() for v in vals if isinstance(v, (float, int))), default=0.0)
# Keep a consistent scale between routine updates; expand only for exceptional rainfall.
axis_ceiling = max(1.0, math.ceil(max_daily / 0.2) * 0.2)
ax.set_ylim(0, axis_ceiling)
ax.set_yticks([round(i * 0.2, 2) for i in range(int(round(axis_ceiling / 0.2)) + 1)])
ax.grid(axis="y",color="#5f7f96",alpha=.48,linestyle="--",linewidth=.8)
ax.grid(axis="x",which="major",color="#5f7f96",linestyle="--",linewidth=1,alpha=.48)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
fig.suptitle("MORAGA  |  14-DAY RAINFALL",fontsize=23,fontweight="bold",
             x=.085,ha="left",y=.974)
fig.text(.085,.915,"Model comparison  ·  Daily precipitation",fontsize=14,color="#9fb6c8")
handles,labels=ax.get_legend_handles_labels()
fig.legend(handles,labels,loc="upper left",bbox_to_anchor=(.085,.885),
           ncol=2,fontsize=16,frameon=False,labelcolor="#f2f8ff",
           columnspacing=2.5,handlelength=2.3,labelspacing=.75)
fig.text(.085,.026,
         f"Updated {now:%b %d %H:%M} UTC  ·  Open-Meteo  ·  Gaps indicate unavailable model days",
         fontsize=11,color="#9fb6c8")
fig.subplots_adjust(left=.085,right=.98,bottom=.18,top=.72)
out=Path("moraga_rainfall_10day.png")
fig.savefig(out,facecolor=fig.get_facecolor())
plt.close(fig)
Path("moraga_rainfall_10day.json").write_text(json.dumps({
    "generated_utc": now.isoformat(), "timezone": TZ, "latitude": LAT, "longitude": LON,
    "dates": dates, "model_daily_inches": results, "ensemble_rain_probability_pct": {day: model_derived_pop[day] for day in dates}, "benchmark_open_meteo_pop_pct": benchmark_pop, "errors": errors,
    "source": "Open-Meteo", "note": "API does not explicitly expose model initialization times here; generated time is not initialization time."
}, indent=2))
print(f"Saved {out}; available models: {', '.join(results)}; errors: {errors}")

def daily_conditions(dates, results, hourly_results, ensemble_rain_probability):
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
        # Distinguish morning clearing from afternoon sky; avoid calling a sunny
        # morning "overcast" solely because models favor later cloud development.
        morning = [c for h, c in sky if 8 <= h <= 11]
        afternoon = [c for h, c in sky if 12 <= h <= 17]
        morning_cloud = sum(morning) / len(morning) if morning else None
        afternoon_cloud = sum(afternoon) / len(afternoon) if afternoon else None
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
        # Apply time-of-day descriptions only where the signal is material.
        # This does not override the ensemble precipitation icon gate below.
        if morning_cloud is not None and afternoon_cloud is not None:
            if morning_cloud <= 45 and afternoon_cloud >= 75:
                icon, label = "🌤️", "AM sun, PM clouds"
            elif morning_cloud >= 75 and afternoon_cloud <= 45:
                icon, label = "🌤️", "AM clouds, PM sun"
            elif morning_cloud <= 35 and afternoon_cloud <= 55:
                icon, label = "🌤️", "Mostly sunny"
        support = [(n, a, h) for n, a, h in available if a >= 0.05]
        wet = [(n, sum(1 for _, r in h if isinstance(r, (float, int)) and r >= 0.004))
               for n, a, h in available if any(isinstance(r, (float, int)) and r >= 0.004 for _, r in h)]
        if len(support) >= 2 and len(support) / len(available) >= 0.6 and len(wet) >= 2 and sum(n for _, n in wet) / len(wet) >= 3:
            icon, label = "🌧️", "Rain likely"
        elif len(support) >= 2 and len(support) / len(available) >= 0.4:
            icon, label = "🌦️", "Chance of showers"
        elif available and len(wet) / len(available) >= 0.4:
            icon, label = "🌦️", "Chance of showers"
        # Ensemble-derived probability is the mandatory rain-icon gate.
        # Deterministic outliers (e.g. NAM alone) must not trigger rain icons.
        probability = ensemble_rain_probability.get(day)
        if probability is None or probability < 20:
            if icon in ("🌧️", "🌦️"):
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
        elif icon not in ("🌧️", "🌦️"):
            icon, label = "🌦️", "Chance of showers"
        output[day] = {"icon": icon, "label": label,
                       "morning_cloud_pct": round(morning_cloud) if morning_cloud is not None else None,
                       "afternoon_cloud_pct": round(afternoon_cloud) if afternoon_cloud is not None else None,
                       "cloud_model_count": len(by_name)}
    return output

conditions = daily_conditions(dates, results, hourly_results, ensemble_rain_probability)
assert len(conditions) == len(dates)
assert all(v["icon"] and v["label"] for v in conditions.values())

forecast_dates = dates[:10]
# Keep the forecast anchored to the Pacific local day; publication validation
# rejects any missing or shifted day before updating the live site.
assert len(forecast_dates) == 10 and forecast_dates[0] == datetime.now(ZoneInfo(TZ)).date().isoformat()
Path(os.environ.get("WX_FORECAST_OUTPUT", "moraga_forecast_10day.json")).write_text(json.dumps({
    "generated_utc": now.isoformat(), "timezone": TZ, "latitude": LAT, "longitude": LON,
    "dates": forecast_dates, "rain_guidance": {day:rain_guidance[day] for day in forecast_dates}, "temperature_models": {**ensemble_temperature, **{name: {**temperature_results[model], "dates": temperature_results[model]["dates"][:10], "high_f": temperature_results[model]["high_f"][:10], "low_f": temperature_results[model]["low_f"][:10]} for name, url, model in SOURCES if model in temperature_results}},
    "model_daily_inches": {name: values[:10] for name, values in results.items()}, "ensemble_rain_probability_pct": {day: model_derived_pop[day] for day in forecast_dates}, "benchmark_open_meteo_pop_pct": {day:benchmark_pop.get(day) for day in forecast_dates}, "rain_probability_method":"EPS/GEFS equal-family daily member fraction >=0.01 in", "daily_conditions": {day: conditions[day] for day in forecast_dates}, "hourly_conditions": {name: hourly_results[model] for name, url, model in SOURCES if model in hourly_results}, "errors": errors,
    "method": "Available ECMWF, GFS, ICON, GEM temperature guidance; location-specific calibration is applied only when verified observations are available. Displayed ranges are deterministic model spread, not probability intervals.",
    "source": "Open-Meteo", "note": "Model inputs are not bias-corrected; website skill weighting is provisional, based on hourly temperature errors. Generated timestamp is retrieval time, not model initialization."
}, indent=2))
