#!/usr/bin/env python3
"""Publish a compact daily station summary, without generating a chart."""
import base64, csv, io, json, os, urllib.request
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

now=datetime.now(timezone.utc)
local=now.astimezone(ZoneInfo("America/Los_Angeles"))
date=local.date().isoformat()
token=os.environ["WEATHER_REPO_TOKEN"]
url=f"https://api.github.com/repos/russomatt-wx/moraga-weather/contents/observations/KCAMORAG71_{date}.csv"
req=urllib.request.Request(url,headers={"Authorization":f"Bearer {token}","Accept":"application/vnd.github+json","User-Agent":"MoragaWeatherObservatory"})
with urllib.request.urlopen(req,timeout=25) as response:
    payload=json.load(response)
rows=list(csv.DictReader(io.StringIO(base64.b64decode(payload["content"]).decode("utf-8-sig"))))
values=[]
rain=[]
for row in rows:
    try:
        ts=datetime.fromisoformat(row["timestamp_utc"].replace("Z","+00:00"))
        if ts.astimezone(ZoneInfo("America/Los_Angeles")).date().isoformat()!=date: continue
        temp=float(row["temperature_f"])
        if not -40<temp<130: continue
        values.append((ts,temp))
        if row.get("precip_observation_in") not in ("",None):
            rain.append(float(row["precip_observation_in"]))
    except (KeyError,ValueError,TypeError): continue
if not values: raise RuntimeError("No verified readings today")
last=max(ts for ts,_ in values)
if now-last>timedelta(minutes=60): raise RuntimeError("Station observations stale; retaining previous summary")
# Source precip_observation_in is not a validated daily accumulation.
# Never sum repeated observation reports into a false daily rainfall total.
rainfall=0.0 if rain and all(v==0 for v in rain) else None
data={"date":date,"station":"KCAMORAG71","generated_utc":now.isoformat(),"last_observation_utc":last.isoformat(),"high_f":max(v for _,v in values),"low_f":min(v for _,v in values),"rainfall_in":rainfall,"rainfall_note":"No rainfall reported in available observations" if rainfall==0 else "Daily rainfall total unavailable; source observations are not validated daily increments"}
Path("moraga_station_today.json").write_text(json.dumps(data,indent=2)+"\n")
print("Published daily station summary",date,last.isoformat())
