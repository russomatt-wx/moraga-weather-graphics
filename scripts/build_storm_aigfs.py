#!/usr/bin/env python3
"""NOAA AIGFS genuine GRIB2 Pacific composite, using NOMADS indexed byte ranges."""
import json,time,random
from datetime import datetime,timezone,timedelta
from pathlib import Path
import requests,numpy as np,eccodes
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.tri as tri
import cartopy.crs as ccrs
import cartopy.feature as cf

OUT=Path("storm_maps");OUT.mkdir(exist_ok=True)
HOURS=(24,48,72,120,168,240)
SESSION=requests.Session()
SESSION.headers.update({"User-Agent":"MoragaWeatherObservatory/1.0 (research weather maps)"})
def get(url,headers=None):
    for attempt in range(3):
        try:
            r=SESSION.get(url,headers=headers,timeout=(12,70))
            r.raise_for_status()
            return r
        except requests.RequestException:
            if attempt==2: raise
            time.sleep(3*(attempt+1))
def grib_subset(url,patterns):
    idx=get(url+".idx").text.splitlines()
    rows=[]
    for line in idx:
        parts=line.split(":")
        if len(parts)>5 and any(p in line for p in patterns):
            rows.append((int(parts[1]),line))
    # Some accumulation fields occur more than once (different intervals).
    # Select exactly one matching message per requested field.
    selected=[]
    for pattern in patterns:
        matches=[row for row in rows if pattern in row[1]]
        if not matches: raise ValueError(f"Missing required GRIB field {pattern}")
        # Prefer the shortest available accumulation interval, if present.
        matches.sort(key=lambda r: (0 if "6 hour acc" in r[1] else 1, r[0]))
        selected.append(matches[0])
    rows=selected
    allrows=sorted((int(line.split(":")[1]),line) for line in idx if len(line.split(":"))>5)
    chunks=[]
    for start,line in rows:
        next_starts=[p for p,_ in allrows if p>start]
        end=min(next_starts)-1 if next_starts else None
        rg=f"bytes={start}-{end}" if end is not None else f"bytes={start}-"
        r=get(url,headers={"Range":rg})
        if r.status_code!=206: raise RuntimeError(f"NOMADS did not honor GRIB byte range: {r.status_code}")
        chunks.append(r.content)
    if len(chunks)!=len(patterns): raise ValueError("Incomplete requested GRIB fields")
    result={}
    for raw in chunks:
        import tempfile,os
        with tempfile.NamedTemporaryFile(suffix=".grib2",delete=False) as f:
            f.write(raw); path=f.name
        try:
            with open(path,"rb") as fh:
                gid=eccodes.codes_grib_new_from_file(fh)
                if gid is None:raise ValueError("Empty GRIB message")
                try:
                    name=eccodes.codes_get(gid,"shortName")
                    level=eccodes.codes_get(gid,"level")
                    lat=eccodes.codes_get_array(gid,"latitudes")
                    lon=eccodes.codes_get_array(gid,"longitudes")
                    vals=eccodes.codes_get_array(gid,"values")
                    date=eccodes.codes_get(gid,"validityDate")
                    hour=eccodes.codes_get(gid,"validityTime")
                    result[(name,level)]=(lat,lon,vals,date,hour)
                finally:eccodes.codes_release(gid)
        finally:os.unlink(path)
    return result
def render(run,cycle,step):
    root=f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod/aigfs.{run}/{cycle}/model/atmos/grib2/aigfs.t{cycle}z"
    sfc=grib_subset(root+f".sfc.f{step:03d}.grib2",[":PRMSL:mean sea level:",":APCP:surface:"])
    pres=grib_subset(root+f".pres.f{step:03d}.grib2",[":HGT:500 mb:",":HGT:1000 mb:"])
    data={**sfc,**pres}
    # Key levels are derived from the GRIB metadata, never a substituted model.
    def find(name,level=None):
        matches=[v for (n,l),v in data.items() if n==name and (level is None or l==level)]
        if len(matches)!=1:raise ValueError(f"Missing or ambiguous AIGFS {name}/{level}")
        return matches[0]
    lat,lon,p,date,valid=find("prmsl")
    def aligned(name,level=None):
        la,lo,v,d,t=find(name,level)
        if len(v)!=len(p) or (d,t)!=(date,valid) or not np.array_equal(la,lat) or not np.array_equal(lo,lon):
            raise ValueError("Inconsistent AIGFS grids or forecast validity")
        return v
    rain=aligned("tp")
    z500=aligned("gh",500);z1000=aligned("gh",1000)
    # GRIB2 HGT is already geopotential height in metres; no g conversion.
    thick=(z500-z1000)/10
    pressure=p/100
    if not (900<np.nanmedian(pressure)<1100 and 450<np.nanmedian(thick)<620):
        raise ValueError("AIGFS units validation failed")
    lon=np.where(lon>180,lon-360,lon)
    keep=(lon>=-175)&(lon<=-105)&(lat>=20)&(lat<=65)
    if keep.sum()<1000:raise ValueError("Insufficient Pacific coverage")
    x,y=lon[keep],lat[keep]
    mesh=tri.Triangulation(x,y)
    fig=plt.figure(figsize=(11,8.8),facecolor="white")
    ax=fig.add_axes([.04,.10,.91,.79],projection=ccrs.PlateCarree())
    ax.set_extent([-175,-105,20,65])
    ax.add_feature(cf.COASTLINE,linewidth=.55)
    ax.add_feature(cf.BORDERS,linewidth=.4)
    ax.add_feature(cf.STATES,linewidth=.3)
    ax.tricontourf(mesh,thick[keep],levels=np.arange(480,611,3),cmap="coolwarm",alpha=.25,extend="both")
    cs=ax.tricontour(mesh,pressure[keep],levels=np.arange(948,1056,4),colors="#3c536b",linewidths=.7)
    ax.clabel(cs,cs.levels[::2],fontsize=7,fmt="%d")
    # APCP is the forecast accumulation period from NOAA, not a rate.
    rr=np.maximum(rain[keep],0)
    if np.nanmax(rr)>.1:
        ax.tricontourf(mesh,rr,levels=[.1,1,2.5,5,10,20,40,80,160,500],cmap="YlGnBu",alpha=.65,extend="max")
    ax.plot(-122.12,37.82,"ko",ms=4);ax.text(-121.6,38.4,"Moraga",fontsize=9)
    fig.text(.05,.95,f"NOAA AIGFS | Pacific Storm Tracker | +{step}h",fontsize=18,weight="bold")
    fig.text(.05,.915,"Accumulated precipitation (mm) · MSLP (hPa) · 1000–500 hPa thickness (dam)",fontsize=10)
    fig.text(.05,.035,f"Run {run} {cycle}Z | Valid {date} {valid:04d} UTC | Source: NOAA NOMADS",fontsize=10)
    file=OUT/f"aigfs_f{step:03d}.png"
    fig.savefig(file,dpi=120,bbox_inches="tight")
    plt.close(fig)
    return {"hour":step,"file":str(file),"valid_date":date,"valid_time":valid,"cycle":f"{run}{cycle}"}
def main():
    now=datetime.now(timezone.utc)
    results=[]
    for age in (8,14,20,26,32):
        t=now-timedelta(hours=age)
        cycle=(t.hour//6)*6
        run=t.strftime("%Y%m%d")
        try:
            for step in HOURS:
                try:results.append(render(run,f"{cycle:02d}",step))
                except Exception as e:print(f"AIGFS +{step}: {e}",flush=True)
                time.sleep(2)
            if results:break
        except Exception as e:print(f"AIGFS cycle {run} {cycle}: {e}",flush=True)
    if not results:raise SystemExit("No validated AIGFS output; preserving previous maps")
    # Merge with existing ECMWF manifest when present, without claiming unavailable data.
    path=OUT/"manifest.json"
    try:manifest=json.loads(path.read_text())
    except (FileNotFoundError,ValueError):manifest={"models":{}}
    manifest["generated_utc"]=datetime.now(timezone.utc).isoformat()
    manifest.setdefault("models",{})["aigfs"]={"label":"NOAA AIGFS","maps":results}
    path.write_text(json.dumps(manifest,indent=2))
if __name__=="__main__":main()
