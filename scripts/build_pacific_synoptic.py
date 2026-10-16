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
from matplotlib.colors import LinearSegmentedColormap, Normalize
from matplotlib.cm import ScalarMappable
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
fig=plt.figure(figsize=(14,9),facecolor="white")
ax=plt.axes(projection=ccrs.PlateCarree())
ax.set_extent([-175,-105,20,65],crs=ccrs.PlateCarree())
ax.set_facecolor("white")
ax.add_feature(cfeature.LAND,facecolor="#fafafa",zorder=0)
ax.add_feature(cfeature.COASTLINE,edgecolor="#777777",linewidth=.65)
ax.add_feature(cfeature.BORDERS,edgecolor="#aaaaaa",linewidth=.45)
ax.add_feature(cfeature.STATES,edgecolor="#55758a",linewidth=.35)
p=ax.contour(lon2,lat2,pressure,levels=np.arange(960,1050,4),colors="#242424",linewidths=.8,alpha=.86,transform=ccrs.PlateCarree())
ax.clabel(p,fmt="%d",fontsize=10,inline=True,inline_spacing=7)
# Cool thickness values are purple/blue; warm values green/yellow/orange/red.
levels=np.arange(480,611,6)
cmap=LinearSegmentedColormap.from_list("thickness_rainbow",[
    (0.00,"#7716ad"),(0.20,"#983dff"),(0.35,"#2368ff"),
    (0.46,"#008ee6"),(0.55,"#00b76d"),(0.64,"#a8d900"),
    (0.73,"#ffdd00"),(0.82,"#ff9400"),(0.92,"#f33218"),(1.0,"#c90020")
])
norm=Normalize(vmin=504,vmax=594)
colors=[cmap(norm(float(v))) for v in levels]
t=ax.contour(lon2,lat2,thickness,levels=levels,colors=colors,
             linewidths=1.2,linestyles="dashed",transform=ccrs.PlateCarree())
ax.clabel(t,fmt="%d",fontsize=10,inline=True,inline_spacing=7)
# Keep 540 dam prominent, but avoid overwhelming nearby contours.
line540=ax.contour(lon2,lat2,thickness,levels=[540],colors="#0069c9",
                   linewidths=2.7,linestyles="solid",
                   transform=ccrs.PlateCarree(),zorder=5)
if len(line540.allsegs[0]):
    ax.clabel(line540,fmt={540:"540"},fontsize=12,inline=True,
              inline_spacing=8,colors="#0069c9",use_clabeltext=True)
ax.plot(-122.13,37.83,"o",ms=5,color="#222222",transform=ccrs.PlateCarree(),zorder=8)
ax.text(-121.5,38.4,"MORAGA",color="#222222",fontsize=9,transform=ccrs.PlateCarree())
fig.text(.06,.96,"PACIFIC SYNOPTIC • SURFACE + 1000–500 mb THICKNESS",
         color="#111111",fontsize=18,weight="bold")
fig.text(.06,.924,"GFS sea-level pressure (black, hPa)  •  1000–500 mb thickness (colored dashed, dam)  •  540 dam (blue solid)",
         color="#333333",fontsize=10)
fig.text(.06,.025,f"GFS valid {valid:%d %b %Y %HZ}  |  Source: Open-Meteo / GFS",
         color="#333333",fontsize=9)
fig.subplots_adjust(left=.04,right=.98,bottom=.13,top=.895)
bar_ax=fig.add_axes([.095,.085,.77,.018])
sm=ScalarMappable(norm=norm,cmap=cmap)
cb=fig.colorbar(sm,cax=bar_ax,orientation="horizontal",ticks=np.arange(504,595,6))
cb.ax.tick_params(labelsize=8)
fig.text(.875,.086,"dam",fontsize=9,color="#333333")
fig.savefig(OUT,dpi=175,facecolor="white")
META.write_text(json.dumps({"gfs_valid_utc":valid.isoformat(),
 "fields":["sea-level pressure","1000-500 mb thickness"],"fronts":False,
 "thickness_color_range_dam":[504,594],"highlight_dam":540}))
print("Wrote",OUT,valid)
