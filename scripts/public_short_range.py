#!/usr/bin/env python3
"""Independent, source-labelled 24-hour forecast blends for Local Weather."""
import json, urllib.parse, urllib.request, os
from datetime import datetime, timezone
from pathlib import Path
LOCATIONS={"moraga":(37.8201932,-122.1193876),"lafayette":(37.890,-122.115),"danville":(37.813,-121.974),"greenbrook":(37.799,-121.970)}
MODELS={"HRRR":("https://api.open-meteo.com/v1/forecast","ncep_hrrr_conus",.40),"RRFS":("https://api.open-meteo.com/v1/forecast","ncep_rrfs",.25),"ECMWF":("https://api.open-meteo.com/v1/forecast","ecmwf_ifs025",.20),"GFS":("https://api.open-meteo.com/v1/forecast","ncep_gfs_seamless",.15)}
FIELDS=["temperature_2m","precipitation","precipitation_probability","weather_code"]
def fetch(url,params):
    request=urllib.request.Request(url+"?"+urllib.parse.urlencode(params),headers={"User-Agent":"MoragaWeatherObservatory/1.0"})
    with urllib.request.urlopen(request,timeout=25) as response:return json.load(response)
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
            elif field=="weather_code":values.append(max(entries,key=lambda x:x[1])[0])
            else:values.append(round(sum(v*w for v,w in entries)/sum(w for _,w in entries),3))
        output["hourly"][field]=values
    Path(name+"_short_range_24h.json").write_text(json.dumps(output,indent=2)+"\n")
    print(name,"sources",list(results),"failures",failures)
for name,(lat,lon) in LOCATIONS.items():\n    try:collect(name,lat,lon)\n    except Exception as exc:print("Short-range blend unavailable for",name,":",exc)
