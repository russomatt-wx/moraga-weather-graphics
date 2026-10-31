#!/usr/bin/env python3
"""Pre-publication checks for Moraga forecast artifacts. Never replace good live data with invalid output."""
import json
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

def require(condition, message):
    if not condition:
        raise ValueError(message)

def load(path):
    return json.loads(Path(path).read_text())

f=load("moraga_forecast_10day.json")
r=load("moraga_rainfall_10day.json")
now=datetime.now(timezone.utc)
today=now.astimezone(ZoneInfo("America/Los_Angeles")).date()
dates=f.get("dates",[])
require(len(dates)==10 and len(set(dates))==10,"Forecast must contain ten unique dates")
parsed=[datetime.strptime(d,"%Y-%m-%d").date() for d in dates]
require(parsed==[today+timedelta(days=i) for i in range(10)],"Forecast dates must be ten consecutive days starting today")
stamp=datetime.fromisoformat(f["generated_utc"].replace("Z","+00:00"))
require(abs((now-stamp).total_seconds())<7200,"Forecast generation timestamp is not recent")
require(r.get("dates",[])[:10]==dates,"Rainfall and temperature forecast dates disagree")
models=f.get("temperature_models",{})
require(len(models)>=2,"Fewer than two temperature models available")
for name,model in models.items():
    require(model.get("dates")==dates,f"{name}: misaligned dates")
    for field in ("high_f","low_f"):
        vals=model.get(field,[])
        require(len(vals)==10,f"{name}: incomplete {field}")
        for value in vals:
            if value is not None:
                require(isinstance(value,(int,float)) and math.isfinite(value) and -20<=value<=125,f"{name}: invalid {field} value")
    require(any(isinstance(x,(int,float)) for x in model["high_f"]),f"{name}: no valid highs")
    require(any(isinstance(x,(int,float)) for x in model["low_f"]),f"{name}: no valid lows")
for date in dates:
    c=f.get("daily_conditions",{}).get(date)
    require(isinstance(c,dict) and c.get("icon") and c.get("label"),f"Missing condition: {date}")
    pop=f.get("ensemble_rain_probability_pct",{}).get(date)
    if pop is not None:
        require(isinstance(pop,(int,float)) and math.isfinite(pop) and 0<=pop<=100,f"Invalid PoP: {date}")
require(Path("moraga_rainfall_10day.png").stat().st_size>10000,"Rainfall graphic missing or empty")
print("Forecast publication preflight passed:",dates[0],"through",dates[-1],";",len(models),"temperature models")
