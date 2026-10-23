"""Build a validated Moraga GEFS/EPS extended outlook without fabricating EPS day 16."""
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

LAT, LON = 37.8201932, -122.1193876
MODELS = {"gefs": ("ncep_gefs_seamless", 16), "eps": ("ecmwf_ifs025_ensemble", 15)}

def fetch(model, horizon):
    params = {"latitude": LAT, "longitude": LON,
              "hourly": "temperature_2m,precipitation",
              "models": model, "forecast_days": horizon,
              "temperature_unit": "fahrenheit", "precipitation_unit": "inch",
              "timezone": "America/Los_Angeles"}
    url = "https://ensemble-api.open-meteo.com/v1/ensemble?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "MoragaWeatherObservatory/1.0"})
    with urllib.request.urlopen(req, timeout=55) as response:
        data = json.load(response)
    hourly = data["hourly"]
    times = hourly["time"]
    temps = {k.removeprefix("temperature_2m_"): v for k, v in hourly.items() if k.startswith("temperature_2m_member")}
    rain = {k.removeprefix("precipitation_"): v for k, v in hourly.items() if k.startswith("precipitation_member")}
    members = sorted(set(temps) & set(rain))
    if len(members) < 10:
        raise RuntimeError(f"{model}: insufficient members ({len(members)})")
    return times, temps, rain, members

def percentile(values, frac):
    a = sorted(values)
    pos = frac * (len(a) - 1)
    lo, hi = math.floor(pos), math.ceil(pos)
    return a[lo] * (hi-pos) + a[hi] * (pos-lo) if lo != hi else a[lo]

def daily(dataset, date):
    times, temps, rain, members = dataset
    indices = [i for i, t in enumerate(times) if t.startswith(date)]
    if len(indices) < 20:
        return None
    highs, lows, wet = [], [], []
    for member in members:
        try:
            t = [temps[member][i] for i in indices]
            p = [rain[member][i] for i in indices]
        except IndexError:
            continue
        if any(x is None or not isinstance(x, (int, float)) for x in t+p):
            continue
        highs.append(max(t))
        lows.append(min(t))
        wet.append(sum(max(0, x) for x in p) >= 0.01)
    if len(highs) < 10:
        return None
    return {"temperature_f_p10": percentile(highs, .1),
            "temperature_f_median": percentile(highs, .5),
            "temperature_low_f_median": percentile(lows, .5),
            "temperature_f_p90": percentile(highs, .9),
            "rain_member_fraction": mean(wet), "members": len(highs)}

gefs = fetch(*MODELS["gefs"])
eps = fetch(*MODELS["eps"])
dates = list(dict.fromkeys(t[:10] for t in gefs[0]))
if len(dates) < 16:
    raise RuntimeError("GEFS does not cover 16 local dates")
out = []
for date in dates[10:16]:
    g, e = daily(gefs, date), daily(eps, date)
    if not g:
        raise RuntimeError(f"Missing complete GEFS guidance for {date}")
    if not e and date != dates[15]:
        raise RuntimeError(f"Missing complete EPS guidance for {date}")
    # Both ensemble systems have equal weight, irrespective of member count.
    # EPS is only available through day 15; label the final GEFS-only day.
    models = {"gefs": g}
    if e:
        models["eps"] = e
    blend = {}
    for key in ("temperature_f_p10", "temperature_f_median",
                "temperature_low_f_median", "temperature_f_p90",
                "rain_member_fraction"):
        blend[key] = round(mean(m[key] for m in models.values()), 3)
    blend.update({"date": date, "models": models,
                  "blend_method": "equal_model_weight" if e else "gefs_only",
                  "members": sum(m["members"] for m in models.values())})
    out.append(blend)
result = {"generated_utc": datetime.now(timezone.utc).isoformat(),
          "source": "Open-Meteo GEFS and ECMWF IFS EPS ensembles",
          "latitude": LAT, "longitude": LON, "days": out,
          "caveat": "Equal-weight model-level ensemble summary, not calibrated precipitation probability. EPS has a 15-day horizon; the final day may be GEFS-only."}
Path("moraga_extended_outlook.json").write_text(json.dumps(result, indent=2)+"\n")
print("Validated", len(out), "extended outlook days; EPS/GEFS days:", sum(bool(d["models"].get("eps")) for d in out))
