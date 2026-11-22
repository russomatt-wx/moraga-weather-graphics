#!/usr/bin/env python3
"""Build the site's location pieces from locations.json:
  - js/locations.js  (window.DWL_LOCATIONS, read by the pages)
  - the location picker in index.html (between <!--LOCSHEET:START--> and <!--LOCSHEET:END-->)
Run after editing locations.json; the "Build locations" workflow also runs it on every change."""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / "locations.json").read_text())
locs = data["locations"]

keep = ("key", "id", "neighborhood", "area", "region", "short", "heading", "place", "outlook_key", "lat", "lon", "sky_airports", "nws_office", "shore", "station")
js = "/* Generated from locations.json by scripts/build_locations.py - edit locations.json, not this file. */\n"
js += "window.DWL_LOCATIONS=" + json.dumps([{k: l.get(k) for k in keep} for l in locs], separators=(",", ":")) + ";\n"
js += "window.DWL_REGIONS=" + json.dumps(data["regions"]) + ";\n"
js += "window.DWL_LOC=Object.fromEntries(window.DWL_LOCATIONS.map(function(l){return [l.key,l]}));\n"
(ROOT / "js/locations.js").write_text(js)

e = lambda s: html.escape(str(s), quote=True)
parts = []
for region in data["regions"]:
    mine = [l for l in locs if l["region"] == region]
    if not mine:
        continue
    parts.append('<details class="dwl-loc-region" data-region="' + e(region) + '"><summary class="dwl-loc-group"><span>' + e(region) + '</span><small>' + str(len(mine)) + '</small></summary><div class="dwl-loc-list">')
    for l in mine:
        k, nb, area = l["key"], l["neighborhood"], l["area"]
        label = nb if nb == area else nb + ", " + area
        parts.append('<div class="public-location-item" data-search="' + e((nb + ' ' + area + ' ' + region).lower()) + '"><button type="button" class="public-location-choice" data-public-city="' + e(k) + '" aria-pressed="false">'
                     '<span class="local-neighborhood">' + e(nb) + '</span><span class="dwl-loc-now" data-loc-now="' + e(k) + '"></span>'
                     '<span class="local-city">' + e(area) + '</span></button>'
                     '<button type="button" class="public-location-favorite" data-favorite-city="' + e(k) + '" aria-label="Set ' + e(label) + ' as favorite" aria-pressed="false" title="Set as default location">☆</button></div>')
    parts.append('</div></details>')
search = ('<div class="dwl-loc-search"><input type="search" id="loc-search" placeholder="Search ' + str(len(locs)) + ' neighborhoods" aria-label="Search locations" autocomplete="off" enterkeyhint="search"></div>'
          '<p class="dwl-loc-empty" id="loc-empty" hidden>No matching neighborhood yet.</p>')
sheet = "<!--LOCSHEET:START-->" + search + "".join(parts) + "<!--LOCSHEET:END-->"

p = ROOT / "index.html"
h = p.read_text()
if "<!--LOCSHEET:START-->" in h:
    h = re.sub(r"<!--LOCSHEET:START-->.*?<!--LOCSHEET:END-->", lambda m: sheet, h, flags=re.S)
else:
    a = '<div class="public-locations" role="group" aria-label="Choose a forecast location">'
    i = h.index(a) + len(a)
    j = h.index("</div></div></div>", i)  # end of the list, panel and sheet
    h = h[:i] + sheet + h[j:]
p.write_text(h)
print(f"{len(locs)} locations in {len(data['regions'])} regions")
