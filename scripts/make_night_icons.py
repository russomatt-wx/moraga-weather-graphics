"""Create night versions of the illustrated weather icons.

Every day icon with a sun gets a night twin: a drawn crescent moon placed behind
the same illustrated cloud / rain artwork from weather-icons/clear/, so day and
night icons share one style and the moon can never be mistaken for a sun.
Output: weather-icons/clear/night/<name>.png
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SRC = Path("weather-icons/clear")
OUT = SRC / "night"
OUT.mkdir(exist_ok=True)
WITH_SUN = ["sun", "mostlySun", "partly", "clearing", "showersSun", "slightRain"]


def sunness(rgb):
    """0..1 weight for warm (yellow/orange) sun pixels; clouds, rain and greys score ~0."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    warm = np.clip((r - b) / 120.0, 0, 1) * np.clip((g - b) / 80.0 + .2, 0, 1)
    return np.clip(sat * 1.6, 0, 1) * warm


def craters(h, w, seed=3):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    tex = np.zeros((h, w))
    for _ in range(14):
        cy, cx, r = rng.uniform(0, h), rng.uniform(0, w), rng.uniform(w * .03, w * .09)
        d = np.hypot(yy - cy, xx - cx) / r
        tex -= np.clip(1 - d, 0, 1) ** 1.5 * rng.uniform(.10, .22)
    return Image.fromarray(np.uint8(np.clip(tex + 1, 0, 1) * 255)).filter(ImageFilter.GaussianBlur(2))


def crescent(size=220):
    """Clear-night icon: a lit crescent with subtle craters and a cool glow."""
    S = size
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    cy = cx = S / 2
    r = S * .30
    d = np.hypot(yy - cy, xx - cx)
    cut_d = np.hypot(yy - cy + r * .28, xx - cx - r * .58)
    aa = lambda v: np.clip(v, 0, 1)
    body = aa(r - d + .5) * aa(cut_d - r * .92 + .5)          # anti-aliased crescent mask
    # 3D shading: brighter toward the lit (lower-left) limb.
    light = aa(1 - np.hypot(yy - (cy + r * .35), xx - (cx - r * .45)) / (r * 1.9))
    tex = np.asarray(craters(S, S, seed=11)).astype(float) / 255
    base = np.stack([232, 238, 250], -1)
    col = base * (0.70 + 0.30 * light[..., None]) * (0.86 + 0.14 * tex[..., None])
    # Halo follows the lit crescent only (blurred body mask), so the dark limb stays invisible.
    halo = np.asarray(Image.fromarray(np.uint8(body * 255)).filter(ImageFilter.GaussianBlur(S * .045))).astype(float) / 255
    glow = np.clip(halo * .75, 0, .55)
    alpha = np.maximum(body, glow)
    rgb = np.where(body[..., None] > 0.02, col, np.stack([160, 200, 240], -1) * np.ones_like(col))
    img = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")
    return img.crop(img.getbbox())


def place(canvas, img, width, x, y, solid=False):
    img = img.copy()
    h = round(img.height * width / img.width)
    img = img.resize((width, h), Image.LANCZOS)
    if solid:
        # Cloud bodies were keyed from a dark background and are slightly see-through;
        # firm them up so the moon behind does not show through.
        a = np.asarray(img).astype(float)
        lum = a[..., :3].mean(-1) / 255
        body = np.clip((lum - .45) / .2, 0, 1)          # bright cloud body only, not rain or haze
        firm = 255 * (a[..., 3] / 255) ** 0.55
        a[..., 3] = a[..., 3] * (1 - body) + firm * body
        # Drop the faint dark haze left between rain streaks by the background removal.
        # Rain art carries a faint blue mist around the streaks; keep only the streaks themselves.
        blue = (a[..., 2] - a[..., 0]) > 60
        a[..., 3] = np.where(blue, a[..., 3] * np.clip((a[..., 3] - 60) / 50, 0, 1), a[..., 3])
        # Dark, semi-transparent fringe left by the background removal.
        a[..., 3] = np.where((lum < .4) & (a[..., 3] < 170), 0, a[..., 3])
        img = Image.fromarray(a.astype(np.uint8), "RGBA")
    canvas.alpha_composite(img, (x, y))


def compose(cloud_name, moon_size, cloud_width, cloud_xy, moon_xy=(6, 0)):
    """Crescent moon tucked behind an illustrated cloud (night version of a sun+cloud icon)."""
    canvas = Image.new("RGBA", (300, 260), (0, 0, 0, 0))
    moon = crescent(size=moon_size * 2)  # crescent() draws the moon at ~60% of its canvas
    canvas.alpha_composite(moon, moon_xy)
    place(canvas, Image.open(SRC / f"{cloud_name}.png").convert("RGBA"), cloud_width, *cloud_xy, solid=True)
    return canvas.crop(canvas.getbbox())


# name -> (cloud artwork, moon size, cloud width, cloud position)
RECIPES = {
    "mostlySun": ("cloudy", 108, 170, (80, 104)),
    "partly": ("cloudy", 98, 220, (40, 84)),
    "clearing": ("cloudy", 98, 220, (40, 84)),
    "showersSun": ("chance", 94, 230, (34, 68)),
    "slightRain": ("chance", 94, 230, (34, 68)),
}

for name in WITH_SUN:
    img = crescent(size=220) if name == "sun" else compose(*RECIPES[name])
    img.save(OUT / f"{name}.png", optimize=True)
    print(name, img.size)
