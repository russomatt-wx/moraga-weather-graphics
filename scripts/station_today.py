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
# The private collector owns the one persistent local-day high/low record.
# Do not reconstruct competing extrema from the current web page or latest sample.
url="https://api.github.com/repos/russomatt-wx/moraga-weather/contents/observations/KCAMORAG71_daily_canonical.json"
req=urllib.request.Request(url,headers={"Authorization":f"Bearer {token}","Accept":"application/vnd.github+json","User-Agent":"MoragaWeatherObservatory"})
with urllib.request.urlopen(req,timeout=25) as response:
    payload=json.load(response)
canonical=json.loads(base64.b64decode(payload["content"]).decode("utf-8-sig"))
record=canonical.get("days",{}).get(date)
if not record or not isinstance(record.get("high_f"),(int,float)) or not isinstance(record.get("low_f"),(int,float)):
    raise RuntimeError("No canonical station extrema available for today")
last=datetime.fromisoformat(record["last_observation_utc"].replace("Z","+00:00"))
if last>now+timedelta(minutes=5):
    raise RuntimeError("Canonical observation timestamp is in the future")
age_minutes=(now-last).total_seconds()/60
if age_minutes>45:
    print(f"::warning::Canonical observations delayed by {age_minutes:.0f} minutes; retaining verified extrema")
high=float(record["high_f"])
low=float(record["low_f"])
if not (-30<=low<=high<=130):
    raise RuntimeError("Invalid canonical high/low")
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
# Owner-confirmed rainfall is a dated minimum, never a permanent override.
# Use it only when the upstream daily summary is missing or lower.
try:
    confirmation_url="https://api.github.com/repos/russomatt-wx/moraga-weather/contents/climate/rainfall_confirmations.json"
    confirmation_req=urllib.request.Request(confirmation_url,headers={"Authorization":f"Bearer {token}","Accept":"application/vnd.github+json","User-Agent":"MoragaWeatherObservatory"})
    with urllib.request.urlopen(confirmation_req,timeout=25) as response:
        confirmation_payload=json.load(response)
    confirmation_data=json.loads(base64.b64decode(confirmation_payload["content"]).decode("utf-8-sig"))
    confirmed=confirmation_data.get("days",{}).get(date,{})
    minimum=confirmed.get("total_in")
    if isinstance(minimum,(int,float)) and not isinstance(minimum,bool) and 0<=minimum<=30 and (rainfall is None or rainfall<float(minimum)):
        rainfall=round(float(minimum),2)
        rain_source="owner_confirmed_minimum"
        rain_as_of=confirmed.get("as_of_utc")
except Exception as exc:
    print("Rainfall confirmation unavailable:",type(exc).__name__)

data={"date":date,"station":"KCAMORAG71","generated_utc":now.isoformat(),
      "last_observation_utc":last.isoformat(),
      "high_f":high,"low_f":low,
      "rainfall_in":rainfall,
      "rainfall_source":rain_source,"rainfall_as_of_utc":rain_as_of,
      "rainfall_note":"Validated daily rainfall from station summary or climate ledger" if rainfall is not None else
                      "Daily rainfall awaiting validated station accumulation; rolling precipitation readings cannot be summed"}
Path("moraga_station_today.json").write_text(json.dumps(data,indent=2)+"\n")
print("Published daily station summary",date,last.isoformat())
