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
    """Phone-legible 72-hour chart with Pacific time and honest rainfall axis."""
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 12})
    x = [t for t, _ in points]
    y = np.array([v[0] for _, v in points])
    dew = np.array([v[1] for _, v in points])
    rain = np.array([v[2] for _, v in points])
    fig, ax = plt.subplots(figsize=(12, 6.1), dpi=170, facecolor="#ffffff")
    ax.set_facecolor("#f8fafc")
    fig.subplots_adjust(left=.075, right=.92, top=.79, bottom=.23)
    ax.plot(x, y, color="#dd6033", lw=3.4, label="Temperature", zorder=5)
    ax.plot(x, dew, color="#1675aa", lw=3.0, label="Dew point", zorder=4)
    ax.grid(axis="y", color="#c7d3dc", alpha=.65, linewidth=.9)
    ax.set_axisbelow(True)
    ax.set_ylabel("Temperature / dew point (°F)", color="#203449", weight="bold", fontsize=12)
    ax.tick_params(axis="y", labelsize=11, colors="#203449", length=0, pad=7)
    for tick in ax.get_yticklabels(): tick.set_fontweight("bold")
    for spine in ax.spines.values(): spine.set_visible(False)
    start = x[0].date()
    end = x[-1].date()
    day = start
    while day <= end:
        midnight = dt.datetime.combine(day, dt.time.min, ZONE)
        ax.axvline(midnight, color="#93a6b7", alpha=.65, lw=1)
        day += dt.timedelta(days=1)
    ax.set_xlim(x[0], x[-1])
    # Day + hour on each label; avoid overlapping text at phone width.
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=(0, 12), tz=ZONE))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%a %b %d\\n%I %p", tz=ZONE))
    ax.tick_params(axis="x", labelrotation=0, labelsize=10, colors="#203449", length=0, pad=12)
    for tick in ax.get_xticklabels(): tick.set_fontweight("bold")
    ax.margins(y=.12)
    if np.nanmax(rain) > 0:
        ax2 = ax.twinx()
        # Rain values from WU are precipRate, not accumulated rainfall.
        ax2.bar(x, rain, width=0.012, color="#28a6bc", alpha=.55, label="Rain rate", zorder=2)
        ax2.set_ylabel("Rain rate (in/hr)", color="#205b6b", weight="bold", fontsize=11)
        ax2.tick_params(axis="y", colors="#205b6b", labelsize=10, length=0)
        for spine in ax2.spines.values(): spine.set_visible(False)
        ax2.set_ylim(bottom=0)
        from matplotlib.patches import Patch
        handles=[plt.Line2D([], [], color="#dd6033", lw=3.4, label="Temperature"),
                 plt.Line2D([], [], color="#1675aa", lw=3, label="Dew point"),
                 Patch(facecolor="#28a6bc", alpha=.55, label="Rain rate")]
    else:
        handles=[plt.Line2D([], [], color="#dd6033", lw=3.4, label="Temperature"),
                 plt.Line2D([], [], color="#1675aa", lw=3, label="Dew point")]
    fig.text(.075, .945, "MORAGA  |  KCAMORAG71", fontsize=18, color="#172b41", weight="bold")
    fig.text(.075, .887, "Verified observations  ·  Pacific time (PDT/PST)", fontsize=11, color="#476276", weight="bold")
    fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(.075, .854),
               ncol=3, frameon=False, labelcolor="#203449", fontsize=12)
    fig.savefig(OUTPUT, dpi=170, facecolor=fig.get_facecolor())
    plt.close(fig)


if __name__ == "__main__":
    try:
        draw(observations())
        print("Rendered verified observations to", OUTPUT)
    except Exception as exc:
        print("No replacement generated:", exc, file=sys.stderr)
        sys.exit(1)
