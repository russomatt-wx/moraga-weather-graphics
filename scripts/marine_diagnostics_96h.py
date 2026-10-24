#!/usr/bin/env python3
"""Moraga mesoscale diagnostics. Model past is NOT surface observations."""
import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import requests
import numpy as np
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


ROOT=Path(__file__).resolve().parents[1]
ZONE=ZoneInfo("America/Los_Angeles")
URL="https://api.open-meteo.com/v1/forecast"
LOCATIONS={"SFO":(37.619,-122.375),"ACV":(40.978,-124.109),"SAC":(38.513,-121.493),"WMC":(40.901,-117.806),"Coastal proxy":(37.50,-122.50)}
VARIABLES="pressure_msl,boundary_layer_height"

def retrieve(name,coords):
    r=requests.get(URL,params={"latitude":coords[0],"longitude":coords[1],
       "hourly":VARIABLES,"past_hours":48,"forecast_hours":49,
       "timezone":"America/Los_Angeles","models":"best_match"},timeout=50)
    r.raise_for_status()
    j=r.json()
    if "hourly" not in j: raise RuntimeError(f"{name}: no hourly data: {j}")
    return j

def series(data,key):
    h=data["hourly"]
    if key not in h: raise RuntimeError(f"Missing {key}")
    return {t:float(v) for t,v in zip(h["time"],h[key]) if v is not None}

def chart(times,values,cutoff,title,ylabel,filename,footnote,reference=None):
    ts=[datetime.fromisoformat(t).replace(tzinfo=ZONE) for t in times]
    vals=np.array(values,dtype=float)
    fig,ax=plt.subplots(figsize=(9,7.8),layout="constrained")
    fig.patch.set_facecolor("#ffffff");ax.set_facecolor("#f8fafc")
    past=np.array([t<=cutoff for t in ts])
    future=np.array([t>=cutoff for t in ts])
    ax.plot(np.array(ts)[past],vals[past],color="#1663a8",linewidth=2.5,label="Recent model analysis")
    ax.plot(np.array(ts)[future],vals[future],color="#e87722",linewidth=2.5,label="Model forecast")
    ax.axvline(cutoff,color="#333",linestyle="--",linewidth=1.2,label="Now")
    if reference is not None: ax.axhline(reference,color="#7b8794",linestyle=":",linewidth=1,label=f"{reference:g} ft reference")
    if "pressure_gradient" in filename:
        ax.axhline(0,color="#475569",linewidth=1.3)
        ax.axhspan(0,max(1,float(np.nanmax(vals))*1.15),color="#dbeafe",alpha=.24,zorder=0)
        ax.axhspan(min(-1,float(np.nanmin(vals))*1.15),0,color="#ffedd5",alpha=.25,zorder=0)
    ax.set_title(title,fontsize=18,weight="bold",loc="left",pad=15)
    ax.set_xlabel("")
    ax.set_ylabel(ylabel)
    ax.grid(axis="y",color="#cbd5e1",alpha=.7)
    ax.tick_params(labelsize=16)
    for tick in ax.get_xticklabels()+ax.get_yticklabels(): tick.set_fontweight("semibold")
    ax.spines["top"].set_visible(False);ax.spines["right"].set_visible(False)
    ax.legend(loc="upper left",ncol=2,fontsize=14)
    import matplotlib.dates as mdates
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=(6,),tz=ZONE))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%a %b %d\n%I %p",tz=ZONE))
    plt.setp(ax.get_xticklabels(),rotation=0,ha="center")
    fig.text(.01,.005,footnote,fontsize=10,color="#525d69")
    fig.savefig(ROOT/filename,dpi=155,bbox_inches="tight",facecolor=fig.get_facecolor())
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
    chart(common,gradient,cutoff,"SFO − Sacramento | Onshore pressure gradient","Sea-level pressure difference (hPa)","moraga_pressure_gradient_96h.png",
      "MODEL-BASED recent 48 h and next 48 h. Positive = coast higher pressure; not station observations.")
    chart(common,winnemucca,cutoff,"SFO − Winnemucca | Regional onshore / offshore gradient","Sea-level pressure difference (hPa)","moraga_winnemucca_pressure_gradient_96h.png",
      "MODEL-BASED 48 h history + 48 h forecast. Positive favors onshore; negative favors offshore. Not observations.")
    chart(common,north_south,cutoff,"Arcata (ACV) − SFO | North–south pressure gradient","Sea-level pressure difference (hPa)","moraga_north_south_pressure_gradient_96h.png",
      "MODEL-BASED recent 48 h and next 48 h. Positive = higher pressure to the north; not observed METAR pressures.")
    chart(common,pbl_ft,cutoff,"Coastal boundary-layer height | Marine-layer proxy","Boundary-layer height (feet AGL)","moraga_marine_layer_proxy_96h.png",
      "MODEL PBL HEIGHT, NOT OBSERVED MARINE INVERSION OR CLOUD TOP. Coastal grid point; 650 ft reference is Moraga elevation.",650)
    payload={"generated_utc":datetime.now(timezone.utc).isoformat(),"source":"Open-Meteo best_match model",
       "note":"Recent 48h is model-based, not station observations. Boundary-layer height is NOT marine inversion depth.",
       "time_local":common,"sfo_minus_sac_hpa":gradient,"sfo_minus_wmc_hpa":winnemucca,"acv_minus_sfo_hpa":north_south,"coastal_pbl_height_ft_agl":pbl_ft,
       "cutoff_local":cutoff.isoformat(),"locations":LOCATIONS}
    (ROOT/"moraga_marine_diagnostics_96h.json").write_text(json.dumps(payload,indent=2)+"\n")
if __name__=="__main__":main()
