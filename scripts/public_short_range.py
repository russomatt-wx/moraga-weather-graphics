#!/usr/bin/env python3
"""Independent, source-labelled 24-hour forecast blends for Local Weather."""
import json, time, urllib.parse, urllib.request, os
try:
    import requests
    SESSION=requests.Session();SESSION.headers["User-Agent"]="MoragaWeatherObservatory/1.0"
except ImportError:
    SESSION=None
from datetime import datetime, timezone
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import locations  # noqa: E402
LOCATIONS=locations.coords()
MODELS={"HRRR":("https://api.open-meteo.com/v1/forecast","ncep_hrrr_conus",.40),"RRFS":("https://api.open-meteo.com/v1/forecast","ncep_rrfs_conus",.25),"ECMWF":("https://api.open-meteo.com/v1/forecast","ecmwf_ifs025",.20),"GFS":("https://api.open-meteo.com/v1/forecast","ncep_gfs_global",.15)}
FIELDS=["temperature_2m","precipitation","precipitation_probability","weather_code","cloud_cover"]
LAYERS=["cloud_cover_low","cloud_cover_mid","cloud_cover_high"]
def effective_cover(hourly):
    """Cloud cover weighted by how much sun each layer blocks. Thin high cloud (cirrus) can cover 100% of the
    sky and still let ~90% of sunlight through, so total cover reads 'Cloudy' on a sunny day. Low cloud
    counts fully, mid 90%, high 30%. Falls back to total cover when a model has no layer data."""
    tot=hourly.get("cloud_cover") or []
    lo,mi,hi=(hourly.get(k) or [] for k in LAYERS)
    out=[]
    for i,t in enumerate(tot):
        L,M,H=(v[i] if i<len(v) and isinstance(v[i],(int,float)) else None for v in (lo,mi,hi))
        if None in (L,M,H):out.append(t);continue
        out.append(round(100*(1-(1-L/100)*(1-.9*M/100)*(1-.3*H/100)),1))
    hourly["cloud_cover"]=out
    return hourly
def fetch(url,params):
    # One keep-alive session with retries: fresh TLS handshakes to Open-Meteo time out on GitHub runners.
    for attempt in range(3):
        try:
            if SESSION is not None:
                r=SESSION.get(url,params=params,timeout=(20,60));r.raise_for_status();return r.json()
            request=urllib.request.Request(url+"?"+urllib.parse.urlencode(params),headers={"User-Agent":"MoragaWeatherObservatory/1.0"})
            with urllib.request.urlopen(request,timeout=25) as response:return json.load(response)
        except Exception:
            if attempt==2:raise
            time.sleep(4*(attempt+1))
PREFETCH={}
def prefetch(names):
    """One multi-location request per model (chunks of 25) instead of one per location."""
    for model,(endpoint,identifier,weight) in MODELS.items():
        for i in range(0,len(names),25):
            chunk=names[i:i+25]
            try:
                data=fetch(endpoint,{"latitude":",".join(str(LOCATIONS[n][0]) for n in chunk),"longitude":",".join(str(LOCATIONS[n][1]) for n in chunk),
                    "models":identifier,"hourly":",".join(FIELDS+LAYERS),"timezone":"America/Los_Angeles","temperature_unit":"fahrenheit","precipitation_unit":"inch","forecast_days":3})
                data=data if isinstance(data,list) else [data]
                for n,d in zip(chunk,data):PREFETCH[(n,model)]=d
            except Exception as exc:
                for n in chunk:PREFETCH[(n,model)]=exc
def collect(name,lat,lon):
    results={};failures={}
    for model,(endpoint,identifier,weight) in MODELS.items():
        try:
            data=PREFETCH.get((name,model))
            if isinstance(data,Exception):raise data
            if data is None:data=fetch(endpoint,{"latitude":lat,"longitude":lon,"models":identifier,"hourly":",".join(FIELDS+LAYERS),"timezone":"America/Los_Angeles","temperature_unit":"fahrenheit","precipitation_unit":"inch","forecast_days":3})
            hourly=effective_cover(data["hourly"])
            if not hourly.get("time") or not hourly.get("temperature_2m"):raise ValueError("missing hourly temperature")
            results[model]={"hourly":hourly,"weight":weight,"model":identifier}
        except Exception as exc:failures[model]=str(exc)[:180]
    # A model must actually return a supported hourly series. Never label fallback data HRRR.
    if not results:raise RuntimeError(name+": no short-range models available: "+str(failures))
    times=next(iter(results.values()))["hourly"]["time"]
    start=datetime.now().astimezone().astimezone(__import__("zoneinfo").ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%dT%H:00")
    times=[t for t in times if t>=start][:24]
    if len(times)<18:raise RuntimeError(name+": fewer than 18 forecast hours")
    output={"generated_utc":datetime.now(timezone.utc).isoformat(),"location":name,"latitude":lat,"longitude":lon,"model_sources":list(results),"failed_sources":failures,"hourly":{"time":times}}
    for field in FIELDS:
        values=[]
        for t in times:
            entries=[]
            for model,source in results.items():
                h=source["hourly"]
                if t not in h["time"]:continue
                idx=h["time"].index(t);v=h.get(field,[])
                if idx<len(v) and isinstance(v[idx],(int,float)):entries.append((v[idx],source["weight"]))
            if not entries:values.append(None)
            elif field=="weather_code":
                # Only carry codes the sky/rain logic below cannot infer: thunder or fog that a
                # weighted majority of models agree on. Sky and rain icons come from blended data.
                total=sum(w for _,w in entries)
                thunder=sum(w for v,w in entries if v>=95)/total
                fog=sum(w for v,w in entries if v in (45,48))/total
                values.append(95 if thunder>=.4 else 45 if fog>=.5 else None)
            else:values.append(round(sum(v*w for v,w in entries)/sum(w for _,w in entries),3))
        output["hourly"][field]=values
    # Sky condition from blended cloud cover, smoothed over 3 hours so one noisy model hour
    # cannot flip the icon between clear and overcast.
    cc=output["hourly"]["cloud_cover"]
    smooth=[]
    for i in range(len(cc)):
        win=[v for v in cc[max(0,i-1):i+2] if isinstance(v,(int,float))]
        smooth.append(round(sum(win)/len(win),1) if win else None)
    output["hourly"]["cloud_cover"]=smooth
    sky=lambda c:None if c is None else 0 if c<20 else 1 if c<45 else 2 if c<75 else 3
    output["hourly"]["weather_code"]=[w if w is not None else sky(c) for w,c in zip(output["hourly"]["weather_code"],smooth)]
    output["method"]="Weighted HRRR/RRFS/ECMWF/GFS blend. Sky icon from 3-hour smoothed blended cloud cover (layers weighted by how much sun they block: low 100%, mid 90%, high 30%); rain icon from blended rain chance; thunder/fog only when a weighted majority of models agree."
    path=Path(name+"_short_range_24h.json")
    # Don't replace a recent complete blend with one missing the high-resolution models.
    if any(m in failures for m in ("HRRR","RRFS")) and path.exists():
        try:
            prev=json.loads(path.read_text())
            age=(datetime.now(timezone.utc)-datetime.fromisoformat(prev["generated_utc"])).total_seconds()
            if age<2*3600 and not prev.get("failed_sources") and "method" in prev:
                print(name,"kept previous complete blend; this run failed",list(failures));return
        except Exception:pass
    path.write_text(json.dumps(output,indent=2)+"\n")
    print(name,"sources",list(results),"failures",failures)
# Locations with a trusted station refresh every run; the rest every 3 hours (Open-Meteo free-tier budget).
CORE={i for i,st in locations.towns().items() if st}
def due(name):
    if name in CORE:return True
    try:
        prev=json.loads(Path(name+"_short_range_24h.json").read_text())
        return (datetime.now(timezone.utc)-datetime.fromisoformat(prev["generated_utc"])).total_seconds()>2.75*3600
    except Exception:return True
DUE=[n for n in LOCATIONS if due(n)]
print("short-range due:",len(DUE),"of",len(LOCATIONS))
prefetch(DUE)
for name,(lat,lon) in LOCATIONS.items():
    if name not in DUE:continue
    try:
        collect(name,lat,lon)
    except Exception as exc:
        print("Short-range blend unavailable for",name,":",exc)
