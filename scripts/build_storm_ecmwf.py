#!/usr/bin/env python3
"""ECMWF open-data Pacific composite. Genuine IFS/AIFS grids; no model substitution."""
import json, os, tempfile
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cf
import eccodes
from ecmwf.opendata import Client

OUT=Path("storm_maps"); OUT.mkdir(exist_ok=True)
HOURS=(24,48,72,120,168,240)
def read_grib(path):
    result={}
    with open(path,"rb") as fh:
        while True:
            gid=eccodes.codes_grib_new_from_file(fh)
            if gid is None: break
            try:
                name=eccodes.codes_get(gid,"shortName")
                level=eccodes.codes_get(gid,"level")
                typ=eccodes.codes_get(gid,"typeOfLevel")
                key=(name,level if typ=="isobaricInhPa" else 0)
                lat=eccodes.codes_get_array(gid,"latitudes")
                lon=eccodes.codes_get_array(gid,"longitudes")
                vals=eccodes.codes_get_array(gid,"values")
                valid=int(eccodes.codes_get(gid,"validityDate"))
                vtime=int(eccodes.codes_get(gid,"validityTime"))
                result[key]=(lat,lon,vals,valid,vtime)
            finally: eccodes.codes_release(gid)
    return result

def render(model,label,hour):
    client=Client(source="ecmwf",model=model,resol="0p25")
    with tempfile.TemporaryDirectory() as tmp:
        surface=os.path.join(tmp,"surface.grib2")
        upper=os.path.join(tmp,"upper.grib2")
        # Explicitly retrieve each forecast step, rather than displaying another model.
        opts=dict(stream="oper",type="fc",step=hour)
        client.retrieve(**opts,levtype="sfc",param=["msl","tp"],target=surface)
        client.retrieve(**opts,levtype="pl",levelist=[500,1000],param="z",target=upper)
        data={**read_grib(surface),**read_grib(upper)}
    for k in (("msl",0),("tp",0),("z",500),("z",1000)):
        if k not in data: raise ValueError(f"{label} +{hour}: missing {k}")
    lat,lon,msl,date,valid_time=data[("msl",0)]
    def field(key):
        la,lo,arr,dt,vt=data[key]
        if len(arr)!=len(msl) or not np.allclose(la,lat) or not np.allclose(lo,lon) or (dt,vt)!=(date,valid_time):
            raise ValueError("GRIB grids/valid times differ")
        return arr
    tp=field(("tp",0))*1000
    thick=(field(("z",500))-field(("z",1000)))/9.80665/10
    p=msl/100
    if not 900<np.nanmedian(p)<1100: raise ValueError("MSLP units invalid")
    if not 450<np.nanmedian(thick)<620: raise ValueError("Thickness units invalid")
    # Crop a North Pacific subset before plotting, reducing memory and publication size.
    lon=np.where(lon>180,lon-360,lon)
    keep=(lon>=-175)&(lon<=-105)&(lat>=20)&(lat<=65)
    if keep.sum()<1000: raise ValueError("Pacific grid too sparse")
    fig=plt.figure(figsize=(11,8.8),facecolor="#f9fbfd")
    ax=fig.add_axes([.04,.10,.91,.79],projection=ccrs.PlateCarree())
    ax.set_extent([-175,-105,20,65])
    ax.add_feature(cf.COASTLINE,linewidth=.55)
    ax.add_feature(cf.BORDERS,linewidth=.4)
    ax.add_feature(cf.STATES,linewidth=.3)
    # Use scatter on selected native grid points to avoid global-grid regridding.
    x,y=lon[keep],lat[keep]
    import matplotlib.tri as tri
    mesh=tri.Triangulation(x,y)
    levels=np.arange(480,610,3)
    ax.tricontourf(mesh,thick[keep],levels=levels,cmap="coolwarm",alpha=.27,extend="both")
    cs=ax.tricontour(mesh,p[keep],levels=np.arange(948,1056,4),colors="#3c536b",linewidths=.65)
    ax.clabel(cs,cs.levels[::2],fontsize=7,fmt="%d")
    rain=np.maximum(tp[keep],0)
    if np.nanmax(rain)>.05:
        ax.tricontourf(mesh,rain,levels=[.1,1,2.5,5,10,20,40,80,160,500],cmap="YlGnBu",alpha=.62,extend="max")
    ax.plot(-122.12,37.82,marker="o",markersize=4,color="black")
    ax.text(-121.6,38.4,"Moraga",fontsize=9)
    fig.text(.05,.95,f"{label}  |  Pacific storm tracker  |  +{hour}h",fontsize=18,weight="bold")
    fig.text(.05,.915,"6-hour step total precipitation (mm, shaded) • MSLP (hPa) • 1000–500 hPa thickness (dam, background)",fontsize=10)
    fig.text(.05,.035,f"Valid {date:08d} {valid_time:04d} UTC  |  ECMWF Open Data / CC BY 4.0",fontsize=10)
    target=OUT/f"{model.replace('-','_')}_f{hour:03d}.png"
    fig.savefig(target,dpi=120,bbox_inches="tight")
    plt.close(fig)
    return {"hour":hour,"file":str(target),"valid_date":date,"valid_time":valid_time}
manifest={"generated_utc":datetime.now(timezone.utc).isoformat(),"models":{}}
for model,label in (("aifs-single","ECMWF AIFS"),("ifs","ECMWF IFS")):
    entries=[]
    for h in HOURS:
        try: entries.append(render(model,label,h))
        except Exception as e: print(f"WARNING {model} +{h}: {e}",flush=True)
    manifest["models"][model]={"label":label,"maps":entries}
OUT.joinpath("manifest.json").write_text(json.dumps(manifest,indent=2))
if not any(x["maps"] for x in manifest["models"].values()):
    raise SystemExit("No ECMWF model maps generated; retaining previously published imagery")
