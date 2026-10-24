#!/usr/bin/env python3
"""Moraga regional upper-air guidance from explicit ECMWF and GFS Open-Meteo model requests."""
import json, urllib.parse, urllib.request
import numpy as np
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
# Shared high-legibility typography for charts embedded on narrow screens.
plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 14,
    "font.weight": "semibold",
    "axes.titlesize": 17,
    "axes.titleweight": "bold",
    "axes.labelsize": 14,
    "axes.labelweight": "bold",
    "xtick.labelsize": 12,
    "ytick.labelsize": 12,
    "legend.fontsize": 12,
})

import matplotlib.dates as mdates

LAT,LON=37.8201932,-122.1193876
LOCAL=ZoneInfo("America/Los_Angeles")
MODELS={"ECMWF":"ecmwf_ifs025","GFS":"ncep_gfs_seamless"}
FIELDS="geopotential_height_500hPa,temperature_850hPa"
fig,axes=plt.subplots(2,1,figsize=(9,10),sharex=True,layout="constrained")
colors={"ECMWF":"#d56b16","GFS":"#087e9a"}
fig.patch.set_facecolor("#ffffff")
for axis in axes:axis.set_facecolor("#f8fafc")
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
# Actual ensemble means from Open-Meteo's ensemble-mean API.
# Do not substitute deterministic forecasts if ensemble data is unavailable.
ENSEMBLES={"EPS":"ecmwf_ifs025_ensemble_mean","GEFS":"ncep_gefs_ensemble_mean_seamless"}
for label, model in ENSEMBLES.items():
    query=urllib.parse.urlencode({"latitude":LAT,"longitude":LON,
        "hourly":FIELDS,"models":model,"timezone":"America/Los_Angeles","forecast_days":10})
    req=urllib.request.Request("https://ensemble-api.open-meteo.com/v1/ensemble?"+query,
        headers={"User-Agent":"MoragaWeatherObservatory/1.0"})
    try:
        with urllib.request.urlopen(req,timeout=50) as response: payload=json.load(response)
        h=payload["hourly"]
        x=[datetime.fromisoformat(v).replace(tzinfo=LOCAL) for v in h["time"]]
        def mean_field(field):
            # Support the ensemble-mean endpoint's field naming.
            keys=[field+"_mean",field]
            key=next((k for k in keys if k in h),None)
            if key is None: raise ValueError(f"Missing ensemble mean {field}; fields={list(h)}")
            values=np.array([float(v) if v is not None else np.nan for v in h[key]])
            if len(values)!=len(x) or np.isfinite(values).sum()<24:
                raise ValueError(f"Insufficient ensemble mean data for {field}: {np.isfinite(values).sum()}/{len(values)} valid")
            return values
        z=mean_field("geopotential_height_500hPa")
        t=mean_field("temperature_850hPa")
        for axis,values in ((axes[0],z),(axes[1],t)):
            axis.plot(x,values,label=label+" mean",color=colors["ECMWF" if label=="EPS" else "GFS"],
                      linewidth=2.3,linestyle=(0,(6,3)))
        results[label]={"model":model,"source":"Open-Meteo ensemble-mean",
                        "hours":len(x),"grid_latitude":payload.get("latitude"),
                        "grid_longitude":payload.get("longitude")}
    except Exception as exc:
        results[label]={"error":str(exc)}
        print(f"{label} ensemble mean unavailable: {exc}")
if not any("hours" in v for v in results.values()): raise RuntimeError("No verified upper-air model response: "+str(results))
axes[0].set_title("500 hPa geopotential height | ridge and trough evolution",loc="left",fontweight="bold")
axes[0].set_ylabel("Geopotential height (m)")
axes[1].set_title("850 hPa temperature | air-mass evolution",loc="left",fontweight="bold")
axes[1].set_ylabel("Temperature (°C)")
for ax in axes:
    ax.grid(axis="y",color="#cbd5e1",alpha=.75)
    ax.grid(axis="x",which="major",color="#94a3b8",linestyle=":",linewidth=1.1,alpha=.65)
    ax.tick_params(labelsize=15)
    for tick in ax.get_xticklabels()+ax.get_yticklabels(): tick.set_fontweight("semibold")
    ax.spines["top"].set_visible(False);ax.spines["right"].set_visible(False)
    ax.legend(loc="best",frameon=True,fontsize=14)
axes[1].xaxis.set_major_locator(mdates.DayLocator(interval=1,tz=LOCAL))
axes[1].xaxis.set_major_formatter(mdates.DateFormatter("%a %b %d",tz=LOCAL))
axes[1].tick_params(axis="x",rotation=30)
fig.suptitle("MORAGA | 10-DAY UPPER-AIR MODEL FORECAST",fontweight="bold",fontsize=18)
fig.savefig("moraga_upper_air_10day.png",dpi=165,facecolor="white",bbox_inches="tight",pad_inches=.3)
plt.close(fig)
Path("moraga_upper_air_10day.json").write_text(json.dumps({"generated_utc":datetime.now(timezone.utc).isoformat(),"requested_latitude":LAT,"requested_longitude":LON,"models":results},indent=2)+"\n")
