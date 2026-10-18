#!/usr/bin/env python3
"""Render verified KCAMORAG71 observations, never model or synthetic data."""
import datetime as dt
import io
import os
import pathlib
import sys
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np

STATION = "KCAMORAG71"
ZONE = ZoneInfo("America/Los_Angeles")
OUTPUT = pathlib.Path("moraga_station_observations.png")


def observations():
    key = os.getenv("WU_API_KEY", "").strip()
    if not key:
        raise RuntimeError("WU_API_KEY is not configured; leaving existing station image untouched.")
    today = dt.datetime.now(ZONE).date()
    points = {}
    for days_back in (2, 1, 0):
        day = today - dt.timedelta(days=days_back)
        query = urllib.parse.urlencode(dict(stationId=STATION, format="json", units="e", date=day.strftime("%Y%m%d"), apiKey=key))
        url = "https://api.weather.com/v2/pws/history/all?" + query
        req = urllib.request.Request(url, headers={"User-Agent": "MoragaWeatherObservatory/1.0"})
        with urllib.request.urlopen(req, timeout=30) as response:
            import json
            records = json.load(response).get("observations", [])
        for record in records:
            try:
                timestamp = dt.datetime.fromisoformat(record["obsTimeUtc"].replace("Z", "+00:00")).astimezone(ZONE)
                imp = record.get("imperial") or {}
                temp = float(imp["temp"])
                dew = float(imp["dewpt"]) if imp.get("dewpt") is not None else float("nan")
                rain = float(imp.get("precipRate", 0) or 0)
                if not (-40 < temp < 130):
                    continue
                points[timestamp] = (temp, dew, max(0, rain))
            except (ValueError, KeyError, TypeError):
                continue
    if len(points) < 12:
        raise RuntimeError("Too few verified station observations; preserving existing chart.")
    return sorted(points.items())


def draw(points):
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
    x = [t for t, _ in points]
    y = np.array([v[0] for _, v in points])
    dew = np.array([v[1] for _, v in points])
    rain = np.array([v[2] for _, v in points])
    fig, ax = plt.subplots(figsize=(12, 5.8), dpi=160, facecolor="#142438")
    ax.set_facecolor("#142438")
    fig.subplots_adjust(left=.075, right=.925, top=.79, bottom=.19)
    ax.plot(x, y, color="#f5a76b", lw=2.6, label="Temperature", zorder=5)
    ax.plot(x, dew, color="#7fc8f3", lw=2.0, label="Dew point", zorder=4)
    start = x[0].date()
    end = x[-1].date()
    day = start
    while day <= end:
        dawn = dt.datetime.combine(day, dt.time(6, 30), ZONE)
        dusk = dt.datetime.combine(day, dt.time(19, 0), ZONE)
        night_start = dt.datetime.combine(day, dt.time.min, ZONE)
        night_end = night_start + dt.timedelta(days=1)
        ax.axvspan(night_start, dawn, color="#8ba9d0", alpha=.11, lw=0)
        ax.axvspan(dusk, night_end, color="#8ba9d0", alpha=.11, lw=0)
        ax.axvline(night_start, color="#7b91a8", alpha=.35, lw=.8)
        indices = [i for i, t in enumerate(x) if t.date() == day]
        if indices:
            for j, kind in ((max(indices, key=lambda k: y[k]), "H"), (min(indices, key=lambda k: y[k]), "L")):
                ax.scatter(x[j], y[j], s=36, color="#ffd28a" if kind == "H" else "#9fdefb", edgecolors="#142438", zorder=8)
                ax.annotate(f"{kind} {y[j]:.0f}°", (x[j], y[j]), xytext=(0, 10 if kind == "H" else -16),
                            textcoords="offset points", ha="center", color="#f4f8ff", fontsize=9, weight="bold", zorder=9)
        day += dt.timedelta(days=1)
    ax.set_xlim(x[0], x[-1])
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=(0, 6, 12, 18), tz=ZONE))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%a %I %p", tz=ZONE))
    ax.tick_params(axis="x", labelrotation=0, labelsize=8, colors="#c8d9e8", length=0, pad=10)
    ax.tick_params(axis="y", colors="#c8d9e8", length=0)
    ax.set_ylabel("Temperature / dew point (°F)", color="#c8d9e8", weight="bold")
    ax.grid(axis="y", color="#567086", alpha=.28)
    for spine in ax.spines.values(): spine.set_visible(False)
    if np.nanmax(rain) > 0:
        ax2 = ax.twinx()
        ax2.bar(x, rain, width=0.012, color="#5cc9d8", alpha=.35, label="Rain rate")
        ax2.set_ylabel("Rain rate (in/hr)", color="#a5cbd8")
        ax2.tick_params(colors="#a5cbd8", length=0)
        for spine in ax2.spines.values(): spine.set_visible(False)
    fig.text(.075, .955, "MORAGA  |  KCAMORAG71", fontsize=16, color="#f3f7fb", weight="bold")
    fig.text(.075, .902, "Verified station observations · Pacific time · shaded periods indicate approximate nighttime", fontsize=9, color="#a9bfd2")
    fig.legend(loc="upper left", bbox_to_anchor=(.075, .855), ncol=3, frameon=False,
               labelcolor="#e1ecf5", fontsize=10)
    fig.savefig(OUTPUT, dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)


if __name__ == "__main__":
    try:
        draw(observations())
        print("Rendered verified observations to", OUTPUT)
    except Exception as exc:
        print("No replacement generated:", exc, file=sys.stderr)
        sys.exit(1)
