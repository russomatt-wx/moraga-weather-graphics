#!/usr/bin/env python3
"""Model-only East Bay transect and Moraga hourly outlook; never label model output as observations."""
import json, urllib.request, urllib.parse
from datetime import datetime,timezone
from pathlib import Path
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
from zoneinfo import ZoneInfo
TZ=ZoneInfo("America/Los_Angeles")
POINTS={"San Francisco":(37.7749,-122.4194),"Oakland":(37.8044,-122.2712),"Moraga":(37.8201932,-122.1193876),"Concord":(37.978,-122.031),"Sacramento":(38.5816,-121.4944)}
def fetch(lat,lon,model=None):
    q={"latitude":lat,"longitude":lon,"hourly":"temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,precipitation_probability","temperature_unit":"fahrenheit","wind_speed_unit":"mph","timezone":"America/Los_Angeles","past_hours":1,"forecast_hours":97}
    if model:q["models"]=model
    url="https://api.open-meteo.com/v1/forecast?"+urllib.parse.urlencode(q)
    with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"MoragaWeatherGraphics/1.0"}),timeout=45) as f: d=json.load(f)
    if "hourly" not in d:raise RuntimeError(str(d))
    return d["hourly"]
def main():
    now=datetime.now(TZ).replace(minute=0,second=0,microsecond=0)
    station={n:fetch(*p) for n,p in POINTS.items()}
    fig,axes=plt.subplots(2,1,figsize=(12,8),sharex=True,layout="constrained")
    colors=["#1674ad","#17a398","#d8502d","#9356ab","#d3a029"]
    for axis in axes:
        axis.set_facecolor("#f8fafc")
    fig.patch.set_facecolor("#ffffff")
    result={}
    for (name,h),c in zip(station.items(),colors):
        times=[datetime.fromisoformat(t).replace(tzinfo=TZ) for t in h["time"]]
        idx=[i for i,t in enumerate(times) if now<=t<=now+__import__("datetime").timedelta(hours=96)]
        if not idx:raise RuntimeError("No forecast coverage for "+name)
        x=[times[i] for i in idx]
        temp=[h["temperature_2m"][i] for i in idx]
        dew=[h["dew_point_2m"][i] for i in idx]
        axes[0].plot(x,temp,label=name,color=c,linewidth=2.4)
        axes[1].plot(x,dew,label=name,color=c,linewidth=2.4)
        result[name]={"times":[times[i].isoformat() for i in idx],"temperature_f":temp,"dewpoint_f":dew,"wind_mph":[h["wind_speed_10m"][i] for i in idx],"wind_direction_deg":[h["wind_direction_10m"][i] for i in idx]}
    axes[0].set_title("Bay-to-Valley marine intrusion | 96-hour temperature forecast",loc="left",weight="bold",fontsize=15)
    axes[0].set_ylabel("Temperature (°F)")
    axes[1].set_ylabel("Dew point (°F)")
    axes[1].set_title("Moisture gradient | 96-hour dew point forecast",loc="left",weight="bold")
    for ax in axes:
        ax.grid(axis="y",color="#cbd5e1",alpha=.75)
        ax.tick_params(labelsize=13)
        for tick in ax.get_xticklabels()+ax.get_yticklabels(): tick.set_fontweight("semibold")
        ax.spines["top"].set_visible(False);ax.spines["right"].set_visible(False)
        ax.legend(ncol=3,fontsize=12,loc="upper left")
    axes[1].xaxis.set_major_locator(mdates.HourLocator(interval=12,tz=TZ))
    axes[1].xaxis.set_major_formatter(mdates.DateFormatter("%a %b %d
%I %p",tz=TZ))
    fig.suptitle("MODEL FORECAST • Not live station observations • Open-Meteo best match",fontsize=10)
    fig.savefig("moraga_marine_transect.png",dpi=155,bbox_inches="tight");plt.close(fig)
    # Compare actual independently requested model grids, not station measurements.
    models={"ECMWF":"ecmwf_ifs025","GFS":"ncep_gfs_seamless"}
    forecasts={};errors={}
    fig,ax=plt.subplots(figsize=(12,6),layout="constrained")
    fig.patch.set_facecolor("#ffffff");ax.set_facecolor("#f8fafc")
    for name,model in models.items():
        try:
            h=fetch(*POINTS["Moraga"],model=model)
            times=[datetime.fromisoformat(t).replace(tzinfo=TZ) for t in h["time"]]
            idx=[i for i,t in enumerate(times) if now<=t<=now+__import__("datetime").timedelta(hours=48)]
            if len(idx)<30:raise RuntimeError("Insufficient forecast hours")
            ax.plot([times[i] for i in idx],[h["temperature_2m"][i] for i in idx],linewidth=2.3,label=name)
            forecasts[name]={"time":[times[i].isoformat() for i in idx],"temperature_f":[h["temperature_2m"][i] for i in idx]}
        except Exception as e:errors[name]=str(e)
    if not forecasts:raise RuntimeError("No model forecasts available: "+str(errors))
    ax.set_title("Moraga | 48-hour temperature model comparison",loc="left",weight="bold",fontsize=15)
    ax.set_ylabel("2 m temperature (°F)");ax.grid(axis="y",color="#cbd5e1",alpha=.75);ax.legend(fontsize=12)
    ax.tick_params(labelsize=13)
    ax.spines["top"].set_visible(False);ax.spines["right"].set_visible(False)
    ax.xaxis.set_major_locator(mdates.HourLocator(interval=12,tz=TZ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%a %b %d\
%I %p",tz=TZ))
    fig.savefig("moraga_temperature_model_comparison.png",dpi=155,bbox_inches="tight");plt.close(fig)
    Path("moraga_mesoscale_data.json").write_text(json.dumps({"generated_utc":datetime.now(timezone.utc).isoformat(),"source":"Open-Meteo model data, not station observations","transect":result,"temperature_models":forecasts,"errors":errors,"requested_station_coordinates":{"latitude":37.8201932,"longitude":-122.1193876},"verification_status":"pending_station_observations_and_archived_forecasts"},indent=2)+"
")
if __name__=="__main__":main()
