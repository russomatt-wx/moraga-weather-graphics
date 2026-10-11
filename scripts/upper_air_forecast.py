#!/usr/bin/env python3
"""Moraga regional upper-air guidance from explicit ECMWF and GFS Open-Meteo model requests."""
import json, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

LAT,LON=37.8201932,-122.1193876
LOCAL=ZoneInfo("America/Los_Angeles")
MODELS={"ECMWF":"ecmwf_ifs025","GFS":"ncep_gfs_seamless"}
FIELDS="geopotential_height_500hPa,temperature_850hPa"
fig,axes=plt.subplots(2,1,figsize=(12,8),sharex=True,layout="constrained")
colors={"ECMWF":"#e07832","GFS":"#2474a6"}
results={}
for label,model in MODELS.items():
    query=urllib.parse.urlencode({"latitude":LAT,"longitude":LON,"hourly":FIELDS,"models":model,"timezone":"America/Los_Angeles","forecast_days":10})
    req=urllib.request.Request("https://api.open-meteo.com/v1/forecast?"+query,headers={"User-Agent":"MoragaWeatherObservatory/1.0"})
    try:
        with urllib.request.urlopen(req,timeout=50) as response: payload=json.load(response)
        h=payload["hourly"]
        x=[datetime.fromisoformat(t).replace(tzinfo=LOCAL) for t in h["time"]]
        z=[float(v) if v is not None else float("nan") for v in h["geopotential_height_500hPa"]]
        t=[float(v) if v is not None else float("nan") for v in h["temperature_850hPa"]]
        axes[0].plot(x,z,label=label,color=colors[label],linewidth=2.2)
        axes[1].plot(x,t,label=label,color=colors[label],linewidth=2.2)
        results[label]={"model":model,"hours":len(x),"grid_latitude":payload.get("latitude"),"grid_longitude":payload.get("longitude")}
    except Exception as exc:
        results[label]={"error":str(exc)}
if not any("hours" in v for v in results.values()): raise RuntimeError("No verified upper-air model response: "+str(results))
axes[0].set_title("500 hPa geopotential height | ridge and trough evolution",loc="left",fontweight="bold")
axes[0].set_ylabel("Geopotential height (m)")
axes[1].set_title("850 hPa temperature | air-mass evolution",loc="left",fontweight="bold")
axes[1].set_ylabel("Temperature (°C)")
for ax in axes:
    ax.grid(alpha=.22)
    ax.legend(loc="best",frameon=True)
axes[1].xaxis.set_major_locator(mdates.DayLocator(interval=1,tz=LOCAL))
axes[1].xaxis.set_major_formatter(mdates.DateFormatter("%a %b %d",tz=LOCAL))
axes[1].tick_params(axis="x",rotation=30)
fig.suptitle("MORAGA | 10-DAY UPPER-AIR MODEL FORECAST",fontweight="bold",fontsize=17)
fig.savefig("moraga_upper_air_10day.png",dpi=165,facecolor="white",bbox_inches="tight",pad_inches=.3)
plt.close(fig)
Path("moraga_upper_air_10day.json").write_text(json.dumps({"generated_utc":datetime.now(timezone.utc).isoformat(),"requested_latitude":LAT,"requested_longitude":LON,"models":results},indent=2)+"\n")
