"""Shared access to locations.json (the single list of forecast locations) for the Python jobs."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load():
    return json.loads((ROOT / "locations.json").read_text())["locations"]


def by_id():
    return {l["id"]: l for l in load()}


def towns(include_moraga=True):
    """{id: trusted station} in list order."""
    return {l["id"]: l.get("station") for l in load() if include_moraga or l["id"] != "moraga"}


def coords():
    return {l["id"]: (l["lat"], l["lon"]) for l in load()}
