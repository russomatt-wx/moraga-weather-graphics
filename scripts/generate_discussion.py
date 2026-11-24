#!/usr/bin/env python3
"""Weather Outlook for every location, written by Gemini from each location's NWS point forecast.

For each location in locations.json: NWS points API -> that grid's forecast -> Gemini -> one
discussion. Locations that share a forecast grid and a city share one Gemini call. Writes
public/weather-discussion.json:

  {"updated_at", "period", "model",
   "locations": {outlook_key: {"city", "grid", "discussion", "updated_at"}}}

A location whose forecast or Gemini call fails keeps its previous discussion. The run fails
(and nothing is written) only if fewer than half the locations got a fresh discussion.

Needs the GEMINI_API_KEY repository secret. GEMINI_MODEL (repository variable) overrides the
model name; GEMINI_PAUSE (seconds between calls) helps stay under per-minute rate limits.
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "weather-discussion.json"
MODEL = os.environ.get("GEMINI_MODEL") or "gemini-3.8-flash"
PAUSE = float(os.environ.get("GEMINI_PAUSE") or 4)
UA = {"User-Agent": "DiabloWeatherLab-discussion/1.0", "Accept": "application/geo+json"}
sys.path.insert(0, str(Path(__file__).resolve().parent))
import locations  # noqa: E402

SYSTEM_PROMPT = """You are the lead editorial meteorologist for a premium consumer weather app. Write a punchy, plain-English weather discussion (~130-150 words) for mobile readers based on the provided forecast data.

Rules:
- Effortless, authoritative, and editorial. No filler greetings.
- Refer to the city name once, and focus on universal sensory cues (air feel, wind, light, clothing) rather than mentioning local parks, roads, or landmarks.
- Structure:
  1. Hook (1 bold sentence): Overall vibe or biggest shift.
  2. Immediate Window (2-3 sentences): Next 6-12 hours (temps, wind, sky, what to wear).
  3. Next Window (2 sentences): Transition to Tonight (for AM updates) or Tomorrow (for PM updates).
  4. Looking Ahead (1 sentence): 2-3 day trend takeaway."""


def get(url):
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as res:
                return json.loads(res.read().decode())
        except Exception:
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def forecast_for(lat, lon):
    """(grid id, forecast periods) for a point. Only the periods go to Gemini: the raw response
    is mostly map geometry and metadata."""
    point = get(f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}")["properties"]
    grid = f"{point['gridId']} {point['gridX']},{point['gridY']}"
    props = get(point["forecast"])["properties"]
    keep = ("name", "startTime", "isDaytime", "temperature", "temperatureUnit", "windSpeed", "windDirection",
            "shortForecast", "detailedForecast")
    periods = []
    for p in props["periods"][:8]:  # about four days
        row = {k: p.get(k) for k in keep}
        row["chanceOfRain"] = (p.get("probabilityOfPrecipitation") or {}).get("value")
        periods.append(row)
    return grid, periods


def write_one(client, city, periods, period_label):
    response = client.models.generate_content(
        model=MODEL,
        contents=f"Write the {period_label} update for {city} using this forecast data:\n"
                 + json.dumps({"city": city, "periods": periods}),
        config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT, temperature=0.7),
    )
    text = (response.text or "").strip()
    words = len(re.findall(r"\S+", text))
    if words < 60 or words > 260:
        raise ValueError(f"length looks wrong ({words} words)")
    return text


def main():
    if not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY secret is not set; keeping the existing discussions.")
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    now = datetime.now(timezone.utc)
    period = "Morning Briefing" if 10 <= now.hour <= 18 else "Evening Update"
    try:
        old = json.loads(OUT.read_text()).get("locations", {})
    except (OSError, ValueError, AttributeError):
        old = {}

    locs = locations.load()
    written, fresh, failed = {}, {}, []
    for l in locs:
        key, city = l.get("outlook_key") or l["key"], l.get("place") or l["neighborhood"]
        try:
            grid, periods = forecast_for(l["lat"], l["lon"])
            cache_key = (grid, city)
            if cache_key not in written:
                written[cache_key] = write_one(client, city, periods, period)
                time.sleep(PAUSE)
            fresh[key] = {"city": city, "grid": grid, "discussion": written[cache_key], "updated_at": now.isoformat()}
        except Exception as exc:
            failed.append(key)
            print(f"{key}: {type(exc).__name__}: {str(exc)[:160]}")
        time.sleep(0.3)

    print(f"{period}: {len(fresh)}/{len(locs)} locations, {len(written)} Gemini calls, failed: {failed or 'none'}")
    if len(fresh) < len(locs) / 2:
        sys.exit("Too many locations failed; keeping the existing discussions.")
    merged = {k: v for k, v in old.items() if isinstance(v, dict)}
    merged.update(fresh)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"updated_at": now.isoformat(), "period": period, "model": MODEL,
                               "locations": dict(sorted(merged.items()))}, indent=1) + "\n")


if __name__ == "__main__":
    main()
