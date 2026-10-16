"""Pacific surface pressure + 1000–500 hPa thickness + NOAA WPC Day-1 fronts.
Forecast-valid composite (not an observed surface analysis). Fails closed on bad data.
"""
import json
import time
import random
from datetime import datetime, timezone
from pathlib import Path
import requests
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature

OUT=Path("pacific_synoptic.png")
META=Path("pacific_synoptic.json")
# Compact regional grid: 125W–175W and 20N–65N.
lons=np.linspace(-175,-105,29)
lats=np.linspace(20,65,19)
lon2,lat2=np.meshgrid(lons,lats)
coords=list(zip(lat2.ravel(),lon2.ravel()))
rows=[]
session=requests.Session()
for offset in range(0,len(coords),30):
    batch=coords[offset:offset+30]
    params={
      "latitude":",".join(f"{lat:.2f}" for lat,_ in batch),
      "longitude":",".join(f"{lon:.2f}" for _,lon in batch),
      "hourly":"pressure_msl,geopotential_height_500hPa,geopotential_height_1000hPa",
      "forecast_days":2,"timezone":"GMT","models":"gfs_seamless"
    }
    for attempt in range(4):
        try:
            response=session.get("https://api.open-meteo.com/v1/gfs",params=params,timeout=(15,45))
            response.raise_for_status()
            break
        except (requests.exceptions.Timeout,requests.exceptions.ConnectionError) as exc:
            if attempt==3:raise RuntimeError(f"GFS batch {offset//30+1} failed after four attempts") from exc
            time.sleep(min(20,3*(2**attempt))+random.uniform(0,2))
        except requests.exceptions.HTTPError as exc:
            if response.status_code not in (429,500,502,503,504) or attempt==3:raise
            time.sleep(min(30,5*(2**attempt))+random.uniform(0,2))
    data=response.json()
    if isinstance(data,dict):data=[data]
    if len(data)!=len(batch):raise RuntimeError("Incomplete model grid")
    rows.extend(data)
# Select a common future valid time from actual API output.
times=rows[0]["hourly"]["time"]
now=datetime.now(timezone.utc)
candidates=[(i,datetime.fromisoformat(t).replace(tzinfo=timezone.utc)) for i,t in enumerate(times)]
idx,valid=next(((i,t) for i,t in candidates if t>=now and t.hour%6==0), (None,None))
if idx is None:raise RuntimeError("No future 6-hour valid time")
fields={}
for key in ("pressure_msl","geopotential_height_500hPa","geopotential_height_1000hPa"):
    values=np.array([r["hourly"][key][idx] if r["hourly"][key][idx] is not None else np.nan for r in rows],dtype=float)
    fields[key]=values.reshape(lat2.shape)
    if np.isfinite(values).mean()<.97:raise RuntimeError("Missing model data: "+key)
pressure=fields["pressure_msl"]
thickness=(fields["geopotential_height_500hPa"]-fields["geopotential_height_1000hPa"])/10
if not (940<np.nanmin(pressure)<1080 and 460<np.nanmean(thickness)<610):raise RuntimeError("Unexpected field units")
# NOAA WPC Day-1 frontal positions are forecasts, not analyzed fronts.
fronts_url="https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/natl_fcst_wx_chart/MapServer/2/query"
fr=requests.get(fronts_url,params={"where":"1=1","outFields":"*","returnGeometry":"true","outSR":"4326","f":"geojson"},timeout=45)
fr.raise_for_status()
features=fr.json().get("features",[])
if not features:raise RuntimeError("WPC front feed empty")
fig=plt.figure(figsize=(14,9),facecolor="#0c1929")
ax=plt.axes(projection=ccrs.PlateCarree())
ax.set_extent([-175,-105,20,65],crs=ccrs.PlateCarree())
ax.set_facecolor("#11283b")
ax.add_feature(cfeature.LAND,facecolor="#20394b",zorder=0)
ax.add_feature(cfeature.COASTLINE,edgecolor="#8baec3",linewidth=.65)
ax.add_feature(cfeature.BORDERS,edgecolor="#55758a",linewidth=.45)
ax.add_feature(cfeature.STATES,edgecolor="#55758a",linewidth=.35)
p=ax.contour(lon2,lat2,pressure,levels=np.arange(960,1050,4),colors="#c7d7e4",linewidths=.75,alpha=.76,transform=ccrs.PlateCarree())
ax.clabel(p,fmt="%d",fontsize=10,inline=True,inline_spacing=7)
t=ax.contour(lon2,lat2,thickness,levels=np.arange(480,610,6),colors="#f5ba70",linewidths=1.0,linestyles="dashed",transform=ccrs.PlateCarree())
ax.clabel(t,fmt="%d",fontsize=10,inline=True,inline_spacing=7)
# Emphasize the classic 540-dam 1000–500 hPa thickness reference.
# Draw after the other contours so it remains visually dominant.
line540=ax.contour(lon2,lat2,thickness,levels=[540],colors="#42d9ff",
                   linewidths=2.2,linestyles="solid",transform=ccrs.PlateCarree(),zorder=5)
if line540.allsegs[0]:
    ax.clabel(line540,fmt={540:"540"},fontsize=11,inline=True,
              inline_spacing=9,colors="#42d9ff",use_clabeltext=True)

palette={"cold":"#64baff","warm":"#fa7775","stationary":"#bb8dff","occluded":"#cc8fff"}
drawn=0
for f in features:
    name=str(f.get("properties",{})).lower()
    color=next((v for k,v in palette.items() if k in name),None)
    if not color:continue
    geom=f.get("geometry",{})
    typ=geom.get("type","")
    lines=[geom["coordinates"]] if typ=="LineString" else geom.get("coordinates",[]) if typ=="MultiLineString" else []
    for line in lines:
        a=np.asarray(line)
        if len(a)>1:
            ax.plot(a[:,0],a[:,1],color=color,lw=2.5,transform=ccrs.PlateCarree(),zorder=6)
            drawn+=1
if not drawn:raise RuntimeError("WPC fronts unavailable or unsupported")
ax.plot(-122.13,37.83,"o",ms=5,color="#ffd37e",transform=ccrs.PlateCarree(),zorder=8)
ax.text(-121.5,38.4,"MORAGA",color="#ffe4ac",fontsize=9,transform=ccrs.PlateCarree())
fig.text(.06,.95,"PACIFIC SYNOPTIC • SURFACE + THICKNESS",color="white",fontsize=19,weight="bold")
fig.text(.06,.915,"GFS pressure (white, hPa) · 1000–500 hPa thickness (amber dashed, dam) · 540 line (cyan) · WPC Day-1 front positions (lines only)",color="#b6d0e2",fontsize=10)
fig.text(.06,.04,f"GFS valid {valid:%d %b %Y %HZ}  |  WPC fronts: Day-1 forecast (valid time may differ)  |  Sources: Open-Meteo/GFS, NOAA WPC",color="#bed1df",fontsize=9)
fig.subplots_adjust(left=.04,right=.98,bottom=.08,top=.89)
fig.savefig(OUT,dpi=175,facecolor=fig.get_facecolor())
META.write_text(json.dumps({"gfs_valid_utc":valid.isoformat(),"front_source":"NOAA WPC Day-1 forecast; different valid time possible","front_segments":drawn}))
print("Wrote",OUT,valid,drawn)
