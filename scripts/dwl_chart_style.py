"""Diablo Weather Lab chart theme.

Every chart script calls ``apply()`` once before plotting so all published PNGs
share the website's look: deep-navy background, cyan accents, Outfit type.
Colours mirror the design tokens in css/site.css; change them in both places.
"""
from pathlib import Path

import matplotlib
from matplotlib import font_manager

# Page / chart chrome (matches css/site.css :root tokens)
BG = "#071b2c"        # chart background, blends into site panels
PANEL = "#0d2a40"     # legend boxes and annotation chips
TEXT = "#f2f8ff"
MUTED = "#9fb6c8"
GRID = "#5f7f96"
SPINE = "#2e5570"
ACCENT = "#19dcf6"    # site cyan
GOLD = "#ffbf2e"      # site gold (forecast / "today")

# Data series, in order of use. Distinguishable on navy and for common colour-vision deficiencies.
SERIES = ["#19dcf6", "#ffbf2e", "#5aa9ff", "#ff7a59", "#a78bfa", "#37d67a", "#f472b6"]
PAST = "#5aa9ff"      # recent model analysis
FUTURE = GOLD         # model forecast
NOW = "#c9dbe8"       # "now" marker

FONT_DIR = Path(__file__).resolve().parents[1] / "fonts"


def _register_fonts():
    names = set()
    for f in sorted(FONT_DIR.glob("Outfit-*.ttf")):
        font_manager.fontManager.addfont(str(f))
        names.add(font_manager.FontProperties(fname=str(f)).get_name())
    return "Outfit" in names


def apply():
    """Set matplotlib defaults for every chart on the site."""
    has_outfit = _register_fonts()
    from cycler import cycler
    matplotlib.rcParams.update({
        "font.family": ["Outfit", "DejaVu Sans"] if has_outfit else ["DejaVu Sans"],
        "font.size": 14,
        "font.weight": "medium",
        "text.color": TEXT,
        "axes.titlesize": 18,
        "axes.titleweight": "semibold",
        "axes.titlecolor": TEXT,
        "axes.titlelocation": "left",
        "axes.labelsize": 14,
        "axes.labelweight": "medium",
        "axes.labelcolor": MUTED,
        "axes.facecolor": BG,
        "axes.edgecolor": SPINE,
        "axes.linewidth": 1.1,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.prop_cycle": cycler(color=SERIES),
        "axes.grid": False,
        "grid.color": GRID,
        "grid.alpha": .35,
        "grid.linestyle": "-",
        "grid.linewidth": .8,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "xtick.labelcolor": MUTED,
        "ytick.labelcolor": MUTED,
        "xtick.labelsize": 12.5,
        "ytick.labelsize": 12.5,
        "lines.linewidth": 2.6,
        "lines.solid_capstyle": "round",
        "legend.fontsize": 12,
        "legend.frameon": True,
        "legend.facecolor": PANEL,
        "legend.edgecolor": SPINE,
        "legend.framealpha": .92,
        "legend.labelcolor": TEXT,
        "figure.facecolor": BG,
        "savefig.facecolor": BG,
        "savefig.edgecolor": BG,
    })
