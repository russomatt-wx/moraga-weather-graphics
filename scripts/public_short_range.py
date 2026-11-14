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
LOCATIONS={"moraga":(37.8201932,-122.1193876),"lafayette":(37.890,-122.115),"danville":(37.813,-121.974),"greenbrook":(37.799,-121.970)}
MODELS={"HRRR":("https://api.open-meteo.com/v1/forecast","ncep_hrrr_conus",.40),"RRFS":("https://api.open-meteo.com/v1/forecast","ncep_rrfs_conus",.25),"ECMWF":("https://api.open-meteo.com/v1/forecast","ecmwf_ifs025",.20),"GFS":("https://api.open-meteo.com/v1/forecast","ncep_gfs_global",.15)}
FIELDS=["temperature_2m","precipitation","precipitation_probability","weather_code","cloud_cover"]
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
def collect(name,lat,lon):
    results={};failures={}
    for model,(endpoint,identifier,weight) in MODELS.items():
        try:
            data=fetch(endpoint,{"latitude":lat,"longitude":lon,"models":identifier,"hourly":",".join(FIELDS),"timezone":"America/Los_Angeles","temperature_unit":"fahrenheit","precipitation_unit":"inch","forecast_days":3})
            hourly=data["hourly"]
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
    output["method"]="Weighted HRRR/RRFS/ECMWF/GFS blend. Sky icon from 3-hour smoothed blended cloud cover; rain icon from blended rain chance; thunder/fog only when a weighted majority of models agree."
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
for name,(lat,lon) in LOCATIONS.items():
    try:
        collect(name,lat,lon)
    except Exception as exc:
        print("Short-range blend unavailable for",name,":",exc)
