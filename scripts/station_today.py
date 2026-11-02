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
for row in rows:
    try:
        ts=datetime.fromisoformat(row["timestamp_utc"].replace("Z","+00:00"))
        if ts.astimezone(ZoneInfo("America/Los_Angeles")).date().isoformat()!=date: continue
        temp=float(row["temperature_f"])
        if not -40<temp<130: continue
        values.append((ts,temp))
    except (KeyError,ValueError,TypeError): continue
if not values: raise RuntimeError("No verified readings today")
last=max(ts for ts,_ in values)

# Use the private Xweather daily summary first. It contains validated calendar-day
# totals including genuine zero; the climate ledger can lag until finalization.
rainfall=None
rain_source=None
rain_as_of=None
for source_path in ("observations/KCAMORAG71_daily_summary.json", "climate/ledger_latest.json"):
    source_url=f"https://api.github.com/repos/russomatt-wx/moraga-weather/contents/{source_path}"
    source_req=urllib.request.Request(source_url,headers={"Authorization":f"Bearer {token}","Accept":"application/vnd.github+json","User-Agent":"MoragaWeatherObservatory"})
    try:
        with urllib.request.urlopen(source_req,timeout=25) as response:
            source_payload=json.load(response)
        source=json.loads(base64.b64decode(source_payload["content"]).decode("utf-8-sig"))
        record=source.get("days",{}).get(date,{})
        candidate=record.get("daily_precipitation_in")
        if isinstance(candidate,(int,float)) and not isinstance(candidate,bool) and 0<=candidate<=30:
            rainfall=round(float(candidate),2)
            rain_source=record.get("precipitation_source","xweather_daily_summary")
            rain_as_of=record.get("updated_utc") or record.get("precipitation_as_of_utc")
            break
    except Exception as exc:
        print("Rainfall source unavailable:",source_path,type(exc).__name__)
data={"date":date,"station":"KCAMORAG71","generated_utc":now.isoformat(),
      "last_observation_utc":last.isoformat(),
      "high_f":max(v for _,v in values),"low_f":min(v for _,v in values),
      "rainfall_in":rainfall,
      "rainfall_source":rain_source,"rainfall_as_of_utc":rain_as_of,
      "rainfall_note":"Validated daily rainfall from station summary or climate ledger" if rainfall is not None else
                      "Daily rainfall awaiting validated station accumulation; rolling precipitation readings cannot be summed"}
Path("moraga_station_today.json").write_text(json.dumps(data,indent=2)+"\n")
print("Published daily station summary",date,last.isoformat())
