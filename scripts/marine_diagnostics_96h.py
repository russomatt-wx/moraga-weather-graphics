#!/usr/bin/env python3
"""Moraga mesoscale diagnostics. Model past is NOT surface observations."""
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import requests
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import dwl_chart_style as dwl
dwl.apply()


ROOT=Path(__file__).resolve().parents[1]
ZONE=ZoneInfo("America/Los_Angeles")
URL="https://api.open-meteo.com/v1/forecast"
LOCATIONS={"SFO":(37.619,-122.375),"ACV":(40.978,-124.109),"SAC":(38.513,-121.493),"WMC":(40.901,-117.806),"Coastal proxy":(37.50,-122.50)}
VARIABLES="pressure_msl,boundary_layer_height"

SESSION=requests.Session()
def retrieve(name,coords):
    # One keep-alive session with retries: single slow Open-Meteo responses were failing whole runs.
    params={"latitude":coords[0],"longitude":coords[1],"hourly":VARIABLES,"past_hours":48,"forecast_hours":49,
       "timezone":"America/Los_Angeles","models":"best_match"}
    for attempt in range(4):
        try:
            r=SESSION.get(URL,params=params,timeout=(20,60))
            r.raise_for_status();j=r.json();break
        except (requests.exceptions.RequestException,ValueError):
            if attempt==3:raise
            time.sleep(5*(2**attempt))
    if "hourly" not in j: raise RuntimeError(f"{name}: no hourly data: {j}")
    return j

def series(data,key):
    h=data["hourly"]
    if key not in h: raise RuntimeError(f"Missing {key}")
    return {t:float(v) for t,v in zip(h["time"],h[key]) if v is not None}

def chart(times,values,cutoff,title,ylabel,filename,footnote,reference=None):
    """Phone-first chart: ~6.4 in wide so text stays readable when the PNG is shown ~330 px wide."""
    import matplotlib.dates as mdates, textwrap
    ts=[datetime.fromisoformat(t).replace(tzinfo=ZONE) for t in times]
    vals=np.array(values,dtype=float)
    fig,ax=plt.subplots(figsize=(6.4,5.4))
    fig.patch.set_facecolor(dwl.BG);ax.set_facecolor(dwl.BG)
    past=np.array([t<=cutoff for t in ts]); future=np.array([t>=cutoff for t in ts])
    ax.plot(np.array(ts)[past],vals[past],color=dwl.PAST,linewidth=3,label="Recent")
    ax.plot(np.array(ts)[future],vals[future],color=dwl.FUTURE,linewidth=3,label="Forecast")
    ax.axvline(cutoff,color=dwl.NOW,linestyle="--",linewidth=1.4,label="Now")
    if reference is not None:
        ax.axhline(reference,color=dwl.ACCENT,linestyle=(0,(5,4)),linewidth=2.6,alpha=.95,zorder=2)
        ax.annotate(f"Moraga {reference:g} ft",xy=(.99,reference),xycoords=("axes fraction","data"),xytext=(-3,7),textcoords="offset points",ha="right",va="bottom",fontsize=13,fontweight="bold",color="#d6f5ff",bbox=dict(boxstyle="round,pad=0.2",facecolor=dwl.BG,edgecolor="none",alpha=.88),zorder=5)
    if "pressure_gradient" in filename:
        ax.axhline(0,color=dwl.ACCENT,linewidth=2.4,alpha=.95,zorder=2)
    main,_,sub=title.partition("|")
    ax.text(0,1.24,main.strip(),transform=ax.transAxes,fontsize=19,fontweight="bold",color=dwl.TEXT,va="bottom")
    if sub: ax.text(0,1.15,sub.strip(),transform=ax.transAxes,fontsize=14,color=dwl.MUTED,va="bottom")
    ax.legend(loc="lower left",bbox_to_anchor=(0,1.0),ncol=3,fontsize=13,frameon=False,handlelength=1.6,columnspacing=1.2,borderaxespad=.3)
    ax.set_ylabel(ylabel,fontsize=14)
    ax.grid(axis="y",color=dwl.GRID,alpha=.45,linestyle="--")
    ax.tick_params(labelsize=15,pad=6)
    ax.xaxis.set_major_locator(mdates.DayLocator(interval=1,tz=ZONE))
    ax.grid(axis="x",which="major",color=dwl.GRID,linestyle=":",linewidth=1.1,alpha=.48)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%a",tz=ZONE))
    ax.yaxis.set_major_locator(plt.MaxNLocator(6))
    ax.spines["top"].set_visible(False);ax.spines["right"].set_visible(False)
    ax.text(0,-.13,textwrap.fill(footnote,width=62),transform=ax.transAxes,fontsize=11.5,color=dwl.MUTED,va="top")
    fig.savefig(ROOT/filename,dpi=200,bbox_inches="tight",pad_inches=.25,facecolor=fig.get_facecolor())
    plt.close(fig)

def main():
    d={name:retrieve(name,coord) for name,coord in LOCATIONS.items()}
    pressure={name:series(d[name],"pressure_msl") for name in ("SFO","ACV","SAC","WMC")}
    pbl=series(d["Coastal proxy"],"boundary_layer_height")
    common=sorted(set(pressure["SFO"]) & set(pressure["ACV"]) & set(pressure["SAC"]) & set(pressure["WMC"]) & set(pbl))
    now=datetime.now(ZONE)
    cutoff=now.replace(minute=0,second=0,microsecond=0)
    start=cutoff.timestamp()-48*3600; end=cutoff.timestamp()+48*3600
    common=[t for t in common if start<=datetime.fromisoformat(t).replace(tzinfo=ZONE).timestamp()<=end]
    if len(common)<75: raise RuntimeError(f"Insufficient model time coverage: {len(common)} hours")
    gradient=[pressure["SFO"][t]-pressure["SAC"][t] for t in common]
    winnemucca=[pressure["SFO"][t]-pressure["WMC"][t] for t in common]
    north_south=[pressure["ACV"][t]-pressure["SFO"][t] for t in common]
    pbl_ft=[pbl[t]*3.28084 for t in common]
    if not all(np.isfinite(winnemucca)) or not all(np.isfinite(gradient)) or not all(np.isfinite(north_south)) or not all(np.isfinite(pbl_ft)): raise RuntimeError("Nonfinite model values")
    chart(common,gradient,cutoff,"SFO − Sacramento | Onshore pressure gradient","Pressure difference (hPa)","moraga_pressure_gradient_96h.png",
      "MODEL-BASED recent 48 h and next 48 h. Positive = coast higher pressure; not station observations.")
    chart(common,winnemucca,cutoff,"SFO − Winnemucca | Onshore / offshore gradient","Pressure difference (hPa)","moraga_winnemucca_pressure_gradient_96h.png",
      "MODEL-BASED 48 h history + 48 h forecast. Positive favors onshore; negative favors offshore. Not observations.")
    chart(common,north_south,cutoff,"Arcata − SFO | North–south pressure gradient","Pressure difference (hPa)","moraga_north_south_pressure_gradient_96h.png",
      "MODEL-BASED recent 48 h and next 48 h. Positive = higher pressure to the north; not observed METAR pressures.")
    chart(common,pbl_ft,cutoff,"Coastal boundary-layer height | Marine-layer proxy","Height (ft above ground)","moraga_marine_layer_proxy_96h.png",
      "MODEL PBL HEIGHT, NOT OBSERVED MARINE INVERSION OR CLOUD TOP. Coastal grid point; 650 ft reference is Moraga elevation.",650)
    payload={"generated_utc":datetime.now(timezone.utc).isoformat(),"source":"Open-Meteo best_match model",
       "note":"Recent 48h is model-based, not station observations. Boundary-layer height is NOT marine inversion depth.",
       "time_local":common,"sfo_minus_sac_hpa":gradient,"sfo_minus_wmc_hpa":winnemucca,"acv_minus_sfo_hpa":north_south,"coastal_pbl_height_ft_agl":pbl_ft,
       "cutoff_local":cutoff.isoformat(),"locations":LOCATIONS}
    (ROOT/"moraga_marine_diagnostics_96h.json").write_text(json.dumps(payload,indent=2)+"\n")
if __name__=="__main__":main()
