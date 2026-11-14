#!/usr/bin/env python3
"""Publish explicit RRFS CONUS guidance; fail closed rather than silently use GFS."""
import csv,json,math,pathlib,time,urllib.parse,urllib.request
from datetime import datetime,timezone
ROOT=pathlib.Path("hrrr-data");ROOT.mkdir(exist_ok=True)
LAT,LON=37.8201932,-122.1193876
try:
    import requests
    SESSION=requests.Session()
    SESSION.headers.update({"User-Agent":"MoragaWeatherObservatory/1.0","Accept":"application/json"})
except ImportError:
    SESSION=None
def get_json(url):
    # One keep-alive session: repeated fresh TLS handshakes to Open-Meteo time out on GitHub runners.
    if SESSION is not None:
        r=SESSION.get(url,timeout=(20,75));r.raise_for_status();return r.json()
    with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"MoragaWeatherObservatory/1.0","Accept":"application/json"}),timeout=75) as f:
        return json.load(f)
def fetch(model):
    params={"latitude":LAT,"longitude":LON,"models":model,"hourly":"temperature_2m,precipitation","temperature_unit":"fahrenheit","precipitation_unit":"inch","forecast_hours":72,"timezone":"UTC"}
    url="https://api.open-meteo.com/v1/forecast?"+urllib.parse.urlencode(params)
    # Retry transient TLS handshake, gateway, and network timeouts before declaring failure.
    last_error=None
    for attempt in range(4):
        try:
            d=get_json(url)
            break
        except Exception as exc:
            last_error=exc
            if attempt==3:
                raise RuntimeError(f"RRFS provider unavailable after 4 attempts: {last_error}") from exc
            time.sleep((attempt+1)*5)
    h=d.get("hourly") or {};t=h.get("time") or [];temp=h.get("temperature_2m") or [];rain=h.get("precipitation") or []
    if not (len(t)>=48 and len(t)==len(temp)==len(rain)):raise ValueError("Missing 48 hours of model data")
    rows=[]
    for a,b,c in zip(t,temp,rain):
        if b is None or c is None or not math.isfinite(float(b)) or not math.isfinite(float(c)):raise ValueError("Incomplete forecast values")
        rows.append((a,float(b),float(c)))
    return rows,url
def main():
    stamp=datetime.now(timezone.utc).isoformat()
    try:
        rrfs,url=fetch("ncep_rrfs_conus")
        gfs,_=fetch("ncep_gfs_global")
        common={x[0]:x[1] for x in gfs}
        matched=[(v,common[t]) for t,v,_ in rrfs if t in common]
        if len(matched)<24 or all(abs(a-b)<0.0001 for a,b in matched[:48]):
            raise ValueError("RRFS series not independently distinguishable from GFS")
        # Open-Meteo model selection is explicit; run initialization timestamp is not verified.
        with (ROOT/"short_range.csv").open("w",newline="") as f:
            w=csv.writer(f);w.writerow(["valid_time_utc","temperature_2m","precipitation"]);w.writerows(rrfs)
        meta={"status":"available","model":"RRFS CONUS","source_model":"ncep_rrfs_conus","source_url":url,"retrieved_utc":stamp,"source_verified":True,"initialization_verified":False,"note":"Explicit RRFS selection and GFS independence screening; model cycle time not independently verified."}
    except Exception as e:
        # Keep the last verified RRFS run if it is still recent (the page applies its own
        # freshness check); otherwise publish "unavailable" rather than stale guidance.
        try:
            prev=json.loads((ROOT/"short_range_metadata.json").read_text())
            age=datetime.now(timezone.utc)-datetime.fromisoformat(prev["retrieved_utc"])
            if prev.get("status")=="available" and (ROOT/"short_range.csv").exists() and age.total_seconds()<6*3600:
                print("refresh failed; keeping last verified RRFS run from",prev["retrieved_utc"],"-",e)
                return
        except Exception:
            pass
        (ROOT/"short_range.csv").unlink(missing_ok=True)
        meta={"status":"unavailable","retrieved_utc":stamp,"source_verified":False,"reason":str(e)}
    (ROOT/"short_range_metadata.json").write_text(json.dumps(meta,indent=2)+"\n")
    print(meta["status"],meta.get("reason","RRFS data published"))
if __name__=="__main__":main()
