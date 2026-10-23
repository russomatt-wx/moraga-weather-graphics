#!/usr/bin/env python3
"""Render verified KCAMORAG71 observations, never model or synthetic data."""
import datetime as dt
import io
import os
import pathlib
import sys
import urllib.error
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
    """Read actual Xweather station CSVs from the private source repository."""
    import csv
    import json
    import base64
    token = os.getenv("WEATHER_REPO_TOKEN", "").strip()
    if not token:
        raise RuntimeError("WEATHER_REPO_TOKEN missing; cannot read private station archive.")
    points = {}
    today = dt.datetime.now(ZONE).date()
    for days_back in (2, 1, 0):
        day = today - dt.timedelta(days=days_back)
        path = f"observations/KCAMORAG71_{day.isoformat()}.csv"
        url = "https://api.github.com/repos/russomatt-wx/moraga-weather/contents/" + path
        req = urllib.request.Request(url, headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "User-Agent": "MoragaWeatherObservatory/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                continue
            raise
        raw = base64.b64decode(payload["content"]).decode("utf-8-sig")
        for record in csv.DictReader(io.StringIO(raw)):
            try:
                timestamp = dt.datetime.fromisoformat(record["timestamp_utc"].replace("Z", "+00:00")).astimezone(ZONE)
                if timestamp.date() != day or record.get("source", "").lower().find("xweather") < 0:
                    continue
                temp = float(record["temperature_f"])
                dew = float(record["dew_point_f"]) if record.get("dew_point_f") else float("nan")
                rate = float(record["precip_observation_in"]) if record.get("precip_observation_in") else float("nan")
                if -40 < temp < 130 and -50 < dew < 130:
                    points[timestamp] = (temp, dew, max(0, rate) if np.isfinite(rate) else float("nan"))
            except (ValueError, KeyError, TypeError):
                continue
    if len(points) < 12:
        raise RuntimeError("Too few verified Xweather station observations; preserving existing chart.")
    newest = max(points)
    if (dt.datetime.now(ZONE) - newest).total_seconds() > 3 * 3600:
        raise RuntimeError("Station archive is stale (>3 hours); preserving existing chart.")
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
    fig.subplots_adjust(left=.09, right=.90, top=.70, bottom=.19)
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
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=(6, 18), tz=ZONE))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%a %d %b\n%I %p", tz=ZONE))
    ax.tick_params(axis="x", labelrotation=0, labelsize=10, colors="#203449", length=0, pad=12)
    for tick in ax.get_xticklabels(): tick.set_fontweight("bold")
    ax.margins(y=.18)
    # Show high/low for EACH local calendar day, not just the entire 72-hour window.
    # Keep labels attached to the corresponding observation and inside the chart.
    from collections import defaultdict
    by_day = defaultdict(list)
    for i, timestamp in enumerate(x):
        if np.isfinite(y[i]):
            by_day[timestamp.date()].append(i)
    for day, indices in sorted(by_day.items()):
        high_idx = max(indices, key=lambda i: y[i])
        low_idx = min(indices, key=lambda i: y[i])
        for idx, label, dy in ((high_idx, "H", 17), (low_idx, "L", -19)):
            # At the right edge, place text to the left so it stays visible.
            near_right = (x[-1] - x[idx]).total_seconds() < 4 * 3600
            near_left = (x[idx] - x[0]).total_seconds() < 4 * 3600
            ha = "right" if near_right else ("left" if near_left else "center")
            dx = -8 if near_right else (8 if near_left else 0)
            ax.annotate(f"{label} {y[idx]:.1f}°F", xy=(x[idx], y[idx]),
                        xytext=(dx, dy), textcoords="offset points",
                        ha=ha, va="center", fontsize=9, fontweight="bold",
                        color="#a64021", zorder=8, clip_on=True,
                        bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="none", alpha=.92))
    if np.any(np.isfinite(rain) & (rain > 0)):
        ax2 = ax.twinx()
        # Matplotlib paints the second axes above the first unless their axes layers are reordered.
        # Put precipitation behind the temperature/dew-point axes, keeping the foreground transparent.
        ax2.set_zorder(ax.get_zorder() - 1)
        ax.patch.set_visible(False)
        # Rain values are individual Xweather reported precipitation observations, not a storm total.
        ax2.bar(x, np.nan_to_num(rain, nan=0.0), width=0.0025, color="#28a6bc", alpha=.55, label="Reported precipitation", zorder=2)
        ax2.set_ylabel("Reported precip. (in)", color="#205b6b", weight="bold", fontsize=11)
        ax2.tick_params(axis="y", colors="#205b6b", labelsize=10, length=0)
        for spine in ax2.spines.values(): spine.set_visible(False)
        ax2.set_ylim(bottom=0)
        from matplotlib.patches import Patch
        handles=[plt.Line2D([], [], color="#dd6033", lw=3.4, label="Temperature"),
                 plt.Line2D([], [], color="#1675aa", lw=3, label="Dew point"),
                 Patch(facecolor="#28a6bc", alpha=.55, label="Reported precipitation")]
    else:
        handles=[plt.Line2D([], [], color="#dd6033", lw=3.4, label="Temperature"),
                 plt.Line2D([], [], color="#1675aa", lw=3, label="Dew point")]
    fig.text(.09, .745, "Rainfall bars show individual reported observations, not a storm total.", fontsize=10, color="#476276")
    fig.text(.09, .945, "MORAGA  |  KCAMORAG71", fontsize=18, color="#172b41", weight="bold")
    fig.text(.09, .895, "Verified observations  ·  Pacific time (PDT/PST)", fontsize=11, color="#476276", weight="bold")
    fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(.09, .855),
               ncol=3, frameon=False, labelcolor="#203449", fontsize=11, columnspacing=1.5)
    fig.savefig(OUTPUT, dpi=170, facecolor=fig.get_facecolor())
    plt.close(fig)


if __name__ == "__main__":
    try:
        draw(observations())
        print("Rendered verified observations to", OUTPUT)
    except Exception as exc:
        print("No replacement generated:", exc, file=sys.stderr)
        sys.exit(1)
