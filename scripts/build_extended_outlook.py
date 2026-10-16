"""Publish cautious day 11–16 GEFS ensemble guidance for Moraga."""
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

LAT, LON = 37.8201932, -122.1193876
params = {
    "latitude": LAT, "longitude": LON,
    "hourly": "temperature_2m,precipitation",
    "models": "gfs_seamless", "forecast_days": 16,
    "temperature_unit": "fahrenheit", "precipitation_unit": "inch",
    "timezone": "America/Los_Angeles",
}
url = "https://ensemble-api.open-meteo.com/v1/ensemble?" + urllib.parse.urlencode(params)
request = urllib.request.Request(url, headers={"User-Agent": "MoragaWeatherObservatory/1.0"})
with urllib.request.urlopen(request, timeout=55) as response:
    data = json.load(response)
hourly = data["hourly"]
times = hourly["time"]
if len(times) < 24 * 15:
    raise RuntimeError("Incomplete extended forecast horizon")
temp_members = {k.removeprefix("temperature_2m_"): v for k, v in hourly.items() if k.startswith("temperature_2m_member")}
rain_members = {k.removeprefix("precipitation_"): v for k, v in hourly.items() if k.startswith("precipitation_member")}
members = sorted(set(temp_members) & set(rain_members))
if len(members) < 10:
    raise RuntimeError(f"Insufficient GEFS members: {len(members)}")
dates = list(dict.fromkeys(t[:10] for t in times))
if len(dates) < 16:
    raise RuntimeError("Missing extended forecast days")
out = []
for date in dates[10:16]:
    indices = [i for i, t in enumerate(times) if t.startswith(date)]
    highs, wet = [], []
    for member in members:
        t = [temp_members[member][i] for i in indices]
        p = [rain_members[member][i] for i in indices]
        if not t or any(x is None for x in t) or any(x is None for x in p):
            continue
        highs.append(max(t))
        wet.append(sum(max(0, x) for x in p) >= 0.01)
    if len(highs) < 10:
        raise RuntimeError(f"Insufficient complete members on {date}")
    sorted_highs = sorted(highs)
    def percentile(frac):
        pos = frac * (len(sorted_highs) - 1)
        lo = math.floor(pos)
        hi = math.ceil(pos)
        return sorted_highs[lo] * (hi - pos) + sorted_highs[hi] * (pos - lo) if lo != hi else sorted_highs[lo]
    out.append({
        "date": date,
        "temperature_f_p10": round(percentile(0.1), 1),
        "temperature_f_p90": round(percentile(0.9), 1),
        "rain_member_fraction": round(mean(wet), 3),
        "members": len(highs),
    })
result = {
    "generated_utc": datetime.now(timezone.utc).isoformat(),
    "source": "Open-Meteo GEFS ensemble, station coordinates",
    "latitude": LAT, "longitude": LON,
    "days": out,
    "caveat": "Uncalibrated ensemble member fractions and high-temperature spread, not deterministic forecasts",
}
Path("moraga_extended_outlook.json").write_text(json.dumps(result, indent=2) + "\n")
print("Published", len(out), "days with", len(members), "ensemble members")
