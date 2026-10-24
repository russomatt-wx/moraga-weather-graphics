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
    fig,axes=plt.subplots(3,1,figsize=(9,11),sharex=True,gridspec_kw={'height_ratios':[2.4,2.4,1.0]})
    fig.subplots_adjust(left=.10,right=.97,top=.87,bottom=.10,hspace=.38)
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
        axes[0].plot(x,temp,label=name,color=c,linewidth=3.4 if name=="Moraga" else 1.8,alpha=1 if name=="Moraga" else .75,zorder=5 if name=="Moraga" else 2)
        axes[1].plot(x,dew,label=name,color=c,linewidth=3.4 if name=="Moraga" else 1.8,alpha=1 if name=="Moraga" else .75,zorder=5 if name=="Moraga" else 2)
        result[name]={"times":[times[i].isoformat() for i in idx],"temperature_f":temp,"dewpoint_f":dew,"wind_mph":[h["wind_speed_10m"][i] for i in idx],"wind_direction_deg":[h["wind_direction_10m"][i] for i in idx]}
    # Moraga minus Oakland highlights the strength and evolution of the inland temperature gap.
    moraga=result["Moraga"]
    oakland=result["Oakland"]
    oak_by_time=dict(zip(oakland["times"],oakland["temperature_f"]))
    delta_times=[];delta=[]
    for stamp,value in zip(moraga["times"],moraga["temperature_f"]):
        other=oak_by_time.get(stamp)
        if value is not None and other is not None:
            delta_times.append(datetime.fromisoformat(stamp))
            delta.append(value-other)
    axes[2].plot(delta_times,delta,color="#d8502d",linewidth=2.5,zorder=3)
    axes[2].axhline(0,color="#64748b",linewidth=1.1,linestyle="--")
    axes[2].fill_between(delta_times,delta,0,where=[v>=0 for v in delta],color="#d8502d",alpha=.12)
    axes[2].fill_between(delta_times,delta,0,where=[v<0 for v in delta],color="#1674ad",alpha=.12)
    axes[2].set_title("Moraga − Oakland temperature gap",loc="left",weight="bold",fontsize=14,pad=8)
    axes[2].set_ylabel("ΔT (°F)")
    # Consistent midnight separators across all three panels, with day labels
    # above the temperature panel. The bottom axis retains 12-hour time ticks.
    midnight=mdates.HourLocator(byhour=[0],tz=TZ)
    from matplotlib.ticker import FuncFormatter
    for ax in axes:
        ax.xaxis.set_minor_locator(midnight)
        ax.grid(axis="x",which="minor",color="#b2c2d1",alpha=.75,linewidth=1)
    from datetime import timedelta
    start=delta_times[0].replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days=1)
    end=delta_times[-1]
    cursor=start
    while cursor<=end:
        axes[0].annotate(cursor.strftime("%a %b %-d"),xy=(cursor,1),xycoords=("data","axes fraction"),xytext=(4,3),textcoords="offset points",fontsize=9,color="#64748b",weight="bold",ha="left",va="bottom")
        cursor+=timedelta(days=1)
    axes[0].set_title("Temperature",loc="left",weight="bold",fontsize=16,pad=8)
    axes[0].set_ylabel("Temperature (°F)")
    axes[1].set_ylabel("Dew point (°F)")
    axes[1].set_title("Dew point",loc="left",weight="bold",fontsize=16,pad=8)
    for ax in axes:
        ax.grid(axis="y",color="#cbd5e1",alpha=.75);ax.grid(axis="x",which="major",color="#94a3b8",linestyle=":",linewidth=1.1,alpha=.65)
        ax.tick_params(labelsize=15)
        for tick in ax.get_xticklabels()+ax.get_yticklabels(): tick.set_fontweight("semibold")
        ax.spines["top"].set_visible(False);ax.spines["right"].set_visible(False)
        ax.grid(axis="x",color="#94a3b8",linestyle=":",alpha=.65)
        ax.tick_params(axis="both",labelsize=14,length=0,pad=6)
    axes[1].xaxis.set_major_locator(mdates.HourLocator(byhour=[0,12],tz=TZ))
    axes[1].xaxis.set_major_formatter(mdates.DateFormatter("%a\n%-I %p",tz=TZ))
    handles,labels=axes[0].get_legend_handles_labels()
    fig.legend(handles,labels,loc="upper center",bbox_to_anchor=(.52,.965),ncol=3,frameon=False,fontsize=14)
    fig.text(.075,.982,"BAY → VALLEY  |  96-HOUR MODEL FORECAST",fontsize=12,weight="bold",color="#27394a",va="top")
    fig.text(.075,.035,"Model guidance · Open-Meteo best match · Not live observations",fontsize=10,color="#617184")
    fig.savefig("moraga_marine_transect.png",dpi=155,bbox_inches="tight");plt.close(fig)
    # Compare actual independently requested model grids, not station measurements.
    models={"ECMWF":"ecmwf_ifs025","GFS":"ncep_gfs_seamless"}
    forecasts={};errors={}
    fig,ax=plt.subplots(figsize=(9,7.5),layout="constrained")
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
    ax.set_ylabel("2 m temperature (°F)");ax.grid(axis="y",color="#cbd5e1",alpha=.75);ax.grid(axis="x",which="major",color="#94a3b8",linestyle=":",linewidth=1.1,alpha=.65);ax.legend(fontsize=12)
    ax.tick_params(labelsize=13)
    ax.spines["top"].set_visible(False);ax.spines["right"].set_visible(False)
    ax.xaxis.set_major_locator(mdates.HourLocator(interval=12,tz=TZ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%a %b %d\
%I %p",tz=TZ))
    fig.savefig("moraga_temperature_model_comparison.png",dpi=155,bbox_inches="tight");plt.close(fig)
    Path("moraga_mesoscale_data.json").write_text(json.dumps({"generated_utc":datetime.now(timezone.utc).isoformat(),"source":"Open-Meteo model data, not station observations","transect":result,"temperature_models":forecasts,"errors":errors,"requested_station_coordinates":{"latitude":37.8201932,"longitude":-122.1193876},"verification_status":"pending_station_observations_and_archived_forecasts"},indent=2)+"\n")
if __name__=="__main__":main()
