#!/usr/bin/env python3
"""Moraga weather discussion written by Gemini from the NWS point forecast.

Source: the NWS forecast for Moraga's grid (MTR 96,105), the same feed the site's NWS
comparison uses. Writes public/weather-discussion.json, which the Weather Outlook card
shows for Moraga locations. If anything fails, the previous file is left untouched.

Needs the GEMINI_API_KEY repository secret. GEMINI_MODEL (repository variable) overrides
the model name.
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

from google import genai
from google.genai import types

# Moraga's NWS forecast grid (api.weather.gov/points/37.8202,-122.1194 -> MTR 96,105).
WEATHER_API_URL = "https://api.weather.gov/gridpoints/MTR/96,105/forecast"
CITY = "Moraga"
OUT = os.path.join("public", "weather-discussion.json")
MODEL = os.environ.get("GEMINI_MODEL") or "gemini-3.8-flash"

SYSTEM_PROMPT = """You are the lead editorial meteorologist for a premium consumer weather app. Write a punchy, plain-English weather discussion (~130-150 words) for mobile readers based on the provided forecast data.

Rules:
- Effortless, authoritative, and editorial. No filler greetings.
- Refer to the city name once, and focus on universal sensory cues (air feel, wind, light, clothing) rather than mentioning local parks, roads, or landmarks.
- Structure:
  1. Hook (1 bold sentence): Overall vibe or biggest shift.
  2. Immediate Window (2-3 sentences): Next 6-12 hours (temps, wind, sky, what to wear).
  3. Next Window (2 sentences): Transition to Tonight (for AM updates) or Tomorrow (for PM updates).
  4. Looking Ahead (1 sentence): 2-3 day trend takeaway."""


def fetch_forecast():
    """The NWS forecast periods only (the raw response is mostly map geometry and metadata)."""
    req = urllib.request.Request(WEATHER_API_URL, headers={"User-Agent": "DiabloWeatherLab-discussion/1.0", "Accept": "application/geo+json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as res:
                data = json.loads(res.read().decode())
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))
    props = data["properties"]
    keep = ("name", "startTime", "isDaytime", "temperature", "temperatureUnit", "windSpeed", "windDirection",
            "shortForecast", "detailedForecast")
    periods = []
    for p in props["periods"][:8]:  # about four days
        row = {k: p.get(k) for k in keep}
        row["chanceOfRain"] = (p.get("probabilityOfPrecipitation") or {}).get("value")
        periods.append(row)
    return {"city": CITY, "updated": props.get("updateTime") or props.get("generatedAt"), "periods": periods}


def generate_discussion(forecast_data, period_label):
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    response = client.models.generate_content(
        model=MODEL,
        contents=f"Write the {period_label} update for {CITY} using this forecast data:\n{json.dumps(forecast_data)}",
        config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT, temperature=0.7),
    )
    return (response.text or "").strip()


def main():
    if not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY secret is not set; keeping the existing discussion.")
    hour = datetime.now(timezone.utc).hour
    period = "Morning Briefing" if 10 <= hour <= 18 else "Evening Update"
    text = generate_discussion(fetch_forecast(), period)
    words = len(re.findall(r"\S+", text))
    if words < 60 or words > 260:
        sys.exit(f"Discussion length looks wrong ({words} words); keeping the existing one.")
    os.makedirs("public", exist_ok=True)
    output = {"updated_at": datetime.now(timezone.utc).isoformat(), "period": period, "city": CITY,
              "model": MODEL, "discussion": text}
    with open(OUT, "w") as f:
        json.dump(output, f, indent=2)
        f.write("\n")
    print(f"{period}: {words} words")


if __name__ == "__main__":
    main()
