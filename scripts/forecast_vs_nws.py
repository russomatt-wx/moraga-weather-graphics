#!/usr/bin/env python3
"""Score Diablo Weather Lab vs the National Weather Service on next-day highs and lows, per location.

Truth: NOAA URMA observed daily high/low at each location (verification/town_observed_noaa.json).
Only days where both forecasts were saved and the observation is complete are scored, so the
comparison is like-for-like.

Writes verification/forecast_vs_nws.json.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V = ROOT / "verification"


def load(name):
    try:
        return json.loads((V / name).read_text())
    except (OSError, ValueError):
        return {}


def main():
    obs, nws, dwl = load("town_observed_noaa.json"), load("nws_forecast_archive.json"), load("dwl_forecast_archive.json")
    names = {l["id"]: l.get("short") or l["neighborhood"] for l in json.loads((ROOT / "locations.json").read_text())["locations"]}
    towns, all_rows = {}, []
    for t in sorted(set(nws) & set(dwl) & set(obs)):
        rows = []
        for d, o in obs[t].items():
            a, b = dwl[t].get(d), nws[t].get(d)
            if not a or not b or o.get("samples", 0) < 22:
                continue
            r = {"date": d, "obs_high": o["high_f"], "obs_low": o["low_f"], "dwl_high": a["high_f"], "dwl_low": a["low_f"], "nws_high": b["high_f"], "nws_low": b.get("low_f")}
            rows.append(r)
        if not rows:
            continue
        mae = lambda k, ob: round(sum(abs(r[k] - r[ob]) for r in rows if r[k] is not None) / max(1, sum(1 for r in rows if r[k] is not None)), 2)
        towns[t] = {"name": names.get(t, t), "days": len(rows),
                    "dwl_high_mae": mae("dwl_high", "obs_high"), "nws_high_mae": mae("nws_high", "obs_high"),
                    "dwl_low_mae": mae("dwl_low", "obs_low"), "nws_low_mae": mae("nws_low", "obs_low"),
                    "dwl_wins": sum(1 for r in rows if abs(r["dwl_high"] - r["obs_high"]) + abs(r["dwl_low"] - r["obs_low"]) < abs(r["nws_high"] - r["obs_high"]) + abs((r["nws_low"] if r["nws_low"] is not None else r["obs_low"]) - r["obs_low"]))}
        all_rows += rows
    out = {"generated_utc": datetime.now(timezone.utc).isoformat(timespec="minutes"), "truth": "NOAA URMA observed daily high/low",
           "lead": "next day (forecasts saved the evening before)", "towns": towns}
    if all_rows:
        n = len(all_rows)
        out["overall"] = {"location_days": n,
                          "dwl_high_mae": round(sum(abs(r["dwl_high"] - r["obs_high"]) for r in all_rows) / n, 2),
                          "nws_high_mae": round(sum(abs(r["nws_high"] - r["obs_high"]) for r in all_rows) / n, 2),
                          "dwl_low_mae": round(sum(abs(r["dwl_low"] - r["obs_low"]) for r in all_rows) / n, 2),
                          "nws_low_mae": round(sum(abs(r["nws_low"] - r["obs_low"]) for r in all_rows if r["nws_low"] is not None) / max(1, sum(1 for r in all_rows if r["nws_low"] is not None)), 2)}
    (V / "forecast_vs_nws.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out.get("overall", {"location_days": 0})))


if __name__ == "__main__":
    main()
