#!/usr/bin/env python3
"""Moraga GEFS / ECMWF EPS ensemble temperature spread (next 11 days).

Phone-first chart: median line plus the 10th-90th percentile range of each ensemble,
one label per day. Writes moraga_ensemble_range.png and moraga_ensemble_range.json.
Data: Open-Meteo ensemble API. Fails closed (no file change) if either ensemble is short.
"""
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import dwl_chart_style as dwl

dwl.apply()

ROOT = Path(__file__).resolve().parents[1]
TZ = ZoneInfo("America/Los_Angeles")
import os
LAT, LON = float(os.environ.get("DWL_LAT", "37.8201932")), float(os.environ.get("DWL_LON", "-122.1193876"))
SITE = os.environ.get("DWL_SITE_NAME", "Moraga")
OUT = os.environ.get("DWL_OUT", "moraga")  # file prefix (may include a folder, e.g. lab/soma)
DAYS = 11
MODELS = {  # label: (Open-Meteo model, colour)
    "GEFS": ("ncep_gefs_seamless", dwl.SERIES[2]),
    "ECMWF EPS": ("ecmwf_ifs025_ensemble", dwl.GOLD),
}


def fetch(model):
    params = {"latitude": LAT, "longitude": LON, "hourly": "temperature_2m", "models": model,
              "forecast_days": DAYS, "temperature_unit": "fahrenheit", "timezone": "America/Los_Angeles"}
    url = "https://ensemble-api.open-meteo.com/v1/ensemble?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "DiabloWeatherLab/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            break
        except (OSError, ValueError):
            if attempt == 3:
                raise
            time.sleep(5 * 2 ** attempt)
    h = data["hourly"]
    members = [k for k in h if k.startswith("temperature_2m")]
    if len(members) < 10:
        raise RuntimeError(f"{model}: only {len(members)} members")
    times = [datetime.fromisoformat(t).replace(tzinfo=TZ) for t in h["time"]]
    grid = np.array([[np.nan if v is None else v for v in h[m]] for m in members], dtype=float)
    return times, grid, len(members)


def main():
    now = datetime.now(TZ).replace(minute=0, second=0, microsecond=0)
    end = now + timedelta(days=DAYS - 0.5)
    fig, ax = plt.subplots(figsize=(6.4, 5.6))
    summary = {}
    for label, (model, color) in MODELS.items():
        times, grid, n = fetch(model)
        keep = [i for i, t in enumerate(times) if now <= t <= end and np.isfinite(grid[:, i]).sum() >= 5]
        if len(keep) < 48:
            raise RuntimeError(f"{label}: insufficient forecast hours ({len(keep)})")
        t = [times[i] for i in keep]
        g = grid[:, keep]
        lo, med, hi = (np.nanpercentile(g, q, axis=0) for q in (10, 50, 90))
        ax.fill_between(t, lo, hi, color=color, alpha=.2, linewidth=0, zorder=2)
        ax.plot(t, med, color=color, linewidth=2.6, label=f"{label} median", zorder=4)
        summary[label] = {"members": n, "time": [x.isoformat() for x in t],
                          "p10": np.round(lo, 1).tolist(), "median": np.round(med, 1).tolist(), "p90": np.round(hi, 1).tolist()}
    # A grey patch in the legend explains the shading once.
    ax.fill_between([], [], [], color=dwl.MUTED, alpha=.35, label="10–90% range")

    ax.text(0, 1.25, f"{SITE} ensemble spread", transform=ax.transAxes, fontsize=19, fontweight="bold", color=dwl.TEXT, va="bottom")
    ax.text(0, 1.16, "Hourly temperature, °F · GEFS vs ECMWF EPS", transform=ax.transAxes, fontsize=14, color=dwl.MUTED, va="bottom")
    ax.legend(loc="lower left", bbox_to_anchor=(0, 1.0), ncol=3, fontsize=12, frameon=False, handlelength=1.4, columnspacing=1.0, borderaxespad=.3)

    # One label per day (weekday letter over date), centred on noon, separators at midnight.
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=[12], tz=TZ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%a\n%-d", tz=TZ))
    ax.xaxis.set_minor_locator(mdates.HourLocator(byhour=[0], tz=TZ))
    ax.grid(axis="x", which="minor", color=dwl.GRID, linestyle=":", linewidth=1, alpha=.5)
    ax.tick_params(axis="x", which="major", length=0, labelsize=12, pad=6)
    for lab in ax.get_xticklabels():
        lab.set_fontweight("semibold")
    plt.setp(ax.get_xticklabels(), linespacing=1.1)
    ax.tick_params(axis="y", labelsize=14)
    ax.yaxis.set_major_locator(plt.MaxNLocator(6))
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.0f}°"))
    ax.grid(axis="y", color=dwl.GRID, alpha=.45, linestyle="--")
    ax.set_xlim(now, end)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    # Weekday as a single letter keeps 11 days legible at phone width.
    fig.canvas.draw()
    ax.set_xticks(ax.get_xticks())
    ax.set_xticklabels([l.get_text()[0] + "\n" + l.get_text().split("\n")[-1] for l in ax.get_xticklabels()])
    members = " · ".join(f"{k} {v['members']} members" for k, v in summary.items())
    ax.text(0, -.2, f"{members} · Open-Meteo · updated {datetime.now(TZ):%b %-d, %-I:%M %p} PT",
            transform=ax.transAxes, fontsize=10.5, color=dwl.MUTED, va="top")
    fig.savefig(ROOT / f"{OUT}_ensemble_range.png", dpi=200, bbox_inches="tight", pad_inches=.25, facecolor=dwl.BG)
    plt.close(fig)
    (ROOT / f"{OUT}_ensemble_range.json").write_text(json.dumps({
        "generated_utc": datetime.now(timezone.utc).isoformat(), "source": "Open-Meteo ensemble API",
        "location": {"latitude": LAT, "longitude": LON}, "percentiles": [10, 50, 90], "models": summary}) + "\n")
    print(f"Wrote {OUT}_ensemble_range.png")


if __name__ == "__main__":
    main()
