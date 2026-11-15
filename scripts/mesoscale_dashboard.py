#!/usr/bin/env python3
"""Model-only East Bay transect and Moraga hourly outlook; never label model output as observations."""
import json, time
import requests
from datetime import datetime,timezone
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import dwl_chart_style as dwl
dwl.apply()

import matplotlib.dates as mdates
from zoneinfo import ZoneInfo
TZ=ZoneInfo("America/Los_Angeles")
POINTS={"San Francisco":(37.7749,-122.4194),"Oakland":(37.8044,-122.2712),"Moraga":(37.8201932,-122.1193876),"Concord":(37.978,-122.031),"Sacramento":(38.5816,-121.4944)}
SESSION=requests.Session()
SESSION.headers["User-Agent"]="MoragaWeatherGraphics/1.0"
def fetch(lat,lon,model=None):
    q={"latitude":lat,"longitude":lon,"hourly":"temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,precipitation_probability","temperature_unit":"fahrenheit","wind_speed_unit":"mph","timezone":"America/Los_Angeles","past_hours":1,"forecast_hours":97}
    if model:q["models"]=model
    # One keep-alive session for every request: repeated fresh TLS handshakes to
    # Open-Meteo were timing out on GitHub runners. Retry transient failures.
    for attempt in range(4):
        try:
            r=SESSION.get("https://api.open-meteo.com/v1/forecast",params=q,timeout=(20,60))
            if r.status_code in (429,500,502,503,504) and attempt<3: raise requests.exceptions.HTTPError(str(r.status_code))
            r.raise_for_status(); d=r.json()
            break
        except (requests.exceptions.ConnectionError,requests.exceptions.Timeout,requests.exceptions.HTTPError,ValueError):
            if attempt==3:raise
        time.sleep(5*(2**attempt))
    if "hourly" not in d:raise RuntimeError(str(d))
    return d["hourly"]
def main():
    now=datetime.now(TZ).replace(minute=0,second=0,microsecond=0)
    station={n:fetch(*p) for n,p in POINTS.items()}
    # Phone-first: ~6.4 in wide so text stays readable when shown ~330 px wide.
    fig,axes=plt.subplots(3,1,figsize=(6.4,9.6),sharex=True,gridspec_kw={'height_ratios':[2.4,2.4,1.1]})
    fig.subplots_adjust(left=.14,right=.97,top=.83,bottom=.08,hspace=.34)
    colors=["#5aa9ff","#19dcf6","#ffbf2e","#a78bfa","#ff7a59"]
    for axis in axes:
        axis.set_facecolor("#071b2c")
    fig.patch.set_facecolor("#071b2c")
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
    axes[2].plot(delta_times,delta,color="#ffbf2e",linewidth=2.5,zorder=3)
    axes[2].axhline(0,color="#5f7f96",linewidth=1.1,linestyle="--")
    axes[2].fill_between(delta_times,delta,0,where=[v>=0 for v in delta],color="#ffbf2e",alpha=.12)
    axes[2].fill_between(delta_times,delta,0,where=[v<0 for v in delta],color="#5aa9ff",alpha=.12)
    axes[2].set_title("Moraga − Oakland gap",loc="left",weight="bold",fontsize=16,pad=8)
    axes[2].set_ylabel("ΔT °F")
    # Consistent midnight separators across all three panels, with day labels
    # above the temperature panel. The bottom axis retains 12-hour time ticks.
    midnight=mdates.HourLocator(byhour=[0],tz=TZ)
    from matplotlib.ticker import FuncFormatter
    for ax in axes:
        ax.xaxis.set_minor_locator(midnight)
        ax.grid(axis="x",which="minor",color="#5f7f96",alpha=.485,linewidth=1)
    from datetime import timedelta
    start=delta_times[0].replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days=1)
    end=delta_times[-1]
    cursor=start
    # (Day names are on the bottom axis; no extra labels above the top panel.)
    axes[0].set_title("Temperature",loc="left",weight="bold",fontsize=17,pad=8)
    axes[0].set_ylabel("°F")
    axes[1].set_ylabel("°F")
    axes[1].set_title("Dew point",loc="left",weight="bold",fontsize=17,pad=8)
    for ax in axes:
        ax.grid(axis="y",color="#5f7f96",alpha=.485);ax.grid(axis="x",which="major",color="#5f7f96",linestyle=":",linewidth=1.1,alpha=.48)
        ax.tick_params(labelsize=15)
        for tick in ax.get_xticklabels()+ax.get_yticklabels(): tick.set_fontweight("semibold")
        ax.spines["top"].set_visible(False);ax.spines["right"].set_visible(False)
        ax.grid(axis="x",color="#5f7f96",linestyle=":",alpha=.48)
        ax.tick_params(axis="both",labelsize=15,length=0,pad=6)
        ax.yaxis.set_major_locator(plt.MaxNLocator(5))
    # One label per day, centred on noon, between the midnight separators.
    axes[2].xaxis.set_major_locator(mdates.HourLocator(byhour=[12],tz=TZ))
    axes[2].xaxis.set_major_formatter(mdates.DateFormatter("%a",tz=TZ))
    handles,labels=axes[0].get_legend_handles_labels()
    fig.legend(handles,labels,loc="upper left",bbox_to_anchor=(.11,.955),ncol=3,frameon=False,fontsize=14,handlelength=1.5,columnspacing=1.0)
    fig.text(.12,.995,"Bay → Valley · 96-hour model forecast",fontsize=17,weight="bold",color="#f2f8ff",va="top")
    fig.text(.12,.02,"Model guidance (Open-Meteo best match), not live observations",fontsize=11.5,color="#9fb6c8")
    fig.savefig("moraga_marine_transect.png",dpi=200,bbox_inches="tight",pad_inches=.25);plt.close(fig)
    # Compare actual independently requested model grids, not station measurements.
    models={"ECMWF":"ecmwf_ifs025","GFS":"ncep_gfs_seamless"}
    forecasts={};errors={}
    fig,ax=plt.subplots(figsize=(9,7.5),layout="constrained")
    fig.patch.set_facecolor("#071b2c");ax.set_facecolor("#071b2c")
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
    ax.set_ylabel("2 m temperature (°F)");ax.grid(axis="y",color="#5f7f96",alpha=.485);ax.grid(axis="x",which="major",color="#5f7f96",linestyle=":",linewidth=1.1,alpha=.48);ax.legend(fontsize=12)
    ax.tick_params(labelsize=13)
    ax.spines["top"].set_visible(False);ax.spines["right"].set_visible(False)
    ax.xaxis.set_major_locator(mdates.HourLocator(interval=12,tz=TZ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%a %b %-d\n%-I %p",tz=TZ))
    fig.savefig("moraga_temperature_model_comparison.png",dpi=155,bbox_inches="tight");plt.close(fig)
    Path("moraga_mesoscale_data.json").write_text(json.dumps({"generated_utc":datetime.now(timezone.utc).isoformat(),"source":"Open-Meteo model data, not station observations","transect":result,"temperature_models":forecasts,"errors":errors,"requested_station_coordinates":{"latitude":37.8201932,"longitude":-122.1193876},"verification_status":"pending_station_observations_and_archived_forecasts"},indent=2)+"\n")
if __name__=="__main__":main()
