#!/usr/bin/env python3
"""Render real GFS total-column precipitable water at +12/+36 hours."""
import datetime as dt
from pathlib import Path
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import dwl_chart_style as dwl
dwl.apply()
import numpy as np
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from herbie import Herbie

HOURS = (12, 36)
OUT = Path(".")
def main():
    now = dt.datetime.now(dt.timezone.utc)
    # Use the most recent established GFS cycle, allowing time for NOAA publication.
    reference = now - dt.timedelta(hours=8)
    cycle = reference.replace(hour=(reference.hour // 6) * 6, minute=0, second=0, microsecond=0)
    for horizon in HOURS:
        target = now + dt.timedelta(hours=horizon)
        target = target.replace(minute=0, second=0, microsecond=0)
        target += dt.timedelta(hours=(-target.hour) % 3)
        dataset = None
        for back in (0, 6, 12):
            run = cycle - dt.timedelta(hours=back)
            hour = int((target - run).total_seconds() // 3600)
            try:
                h = Herbie(run.replace(tzinfo=None), model="gfs", product="pgrb2.0p25", fxx=hour, priority=["aws", "nomads"])
                dataset = h.xarray(":PWAT:")
                if dataset is not None:
                    break
            except Exception as exc:
                print(f"GFS {run} +{hour}: {exc}")
        if dataset is None:
            raise RuntimeError(f"No real GFS PWAT field available near +{horizon}h")
        key = next((k for k in dataset.data_vars if "pwat" in k.lower() or "precipitable" in k.lower()), None)
        if key is None:
            raise RuntimeError(f"PWAT variable missing: {list(dataset.data_vars)}")
        field = dataset[key].squeeze()
        lon = np.asarray(field.longitude)
        lat = np.asarray(field.latitude)
        pwat = np.asarray(field, dtype=float) / 25.4  # GRIB PWAT kg/m² = mm liquid water.
        if not np.isfinite(pwat).any():
            raise RuntimeError("Invalid PWAT field")
        fig = plt.figure(figsize=(9.2, 7.0), dpi=175, facecolor="#071b2c")
        ax = fig.add_axes([.055, .13, .91, .78], projection=ccrs.PlateCarree())
        ax.set_extent([-165, -112, 20, 60], crs=ccrs.PlateCarree())
        levels = np.arange(0, 2.76, .25)
        from matplotlib.colors import LinearSegmentedColormap
        # Low PWAT: brown/tan; moderate: yellow/green; high: turquoise/deep blue.
        moisture_colors = LinearSegmentedColormap.from_list(
            "moraga_pwat",
            [(0.00, "#805738"), (0.12, "#bc9262"), (0.23, "#ffe17c"),
             (0.36, "#b9dd56"), (0.48, "#31b665"), (0.62, "#008f9c"),
             (0.76, "#159bd6"), (0.88, "#176bc5"), (1.00, "#132d87")],
            N=256)
        m = ax.contourf(lon, lat, pwat, levels=levels, cmap=moisture_colors, extend="max", transform=ccrs.PlateCarree())
        ax.coastlines(resolution="110m", linewidth=.8)
        ax.add_feature(cfeature.BORDERS, linewidth=.4)
        ax.add_feature(cfeature.STATES, linewidth=.3)
        grid = ax.gridlines(draw_labels={"bottom":"x","left":"y"}, linewidth=.4, alpha=.25, color="#5f7f96")
        grid.top_labels = False
        grid.right_labels = False
        grid.xlabel_style = {"size": 11, "weight": "bold", "color": "#f2f8ff"}
        grid.ylabel_style = {"size": 11, "weight": "bold", "color": "#f2f8ff"}
        valid = run + dt.timedelta(hours=hour)
        local_valid = valid.astimezone(ZoneInfo("America/Los_Angeles"))
        lead = (valid - now).total_seconds() / 3600
        fig.text(.025, .987, "GFS | precipitable water", fontsize=18, weight="bold", ha="left", va="top", color="#f2f8ff")
        fig.text(.025, .947, f"Valid {local_valid:%a %b %d %I:%M %p %Z}  •  GFS f{hour:03d}  •  ~+{lead:.0f}h", fontsize=11, weight="bold", ha="left", va="top", color="#9fb6c8")
        cax = fig.add_axes([.075, .065, .85, .028])
        bar = fig.colorbar(m, cax=cax, orientation="horizontal")
        bar.set_label("Precipitable water (inches)", fontsize=12, weight="bold", color="#f2f8ff", labelpad=5)
        bar.ax.tick_params(labelsize=12, colors="#f2f8ff", pad=4)
        bar.outline.set_edgecolor("#9fb6c8")
        fig.savefig(OUT / f"gfs_pwat_f{horizon:03d}.png", facecolor="#071b2c", bbox_inches="tight", pad_inches=.15)
        plt.close(fig)
if __name__ == "__main__":
    main()
