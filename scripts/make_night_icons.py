"""Create night versions of the illustrated weather icons.

Takes the transparent day icons in weather-icons/clear/ and repaints the sun as a
moon (cool silver-blue, soft craters, crescent for the clear-sky icon), leaving
clouds and rain untouched so day and night icons share one illustrated style.
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


for name in WITH_SUN:
    im = Image.open(SRC / f"{name}.png").convert("RGBA")
    a = np.asarray(im).astype(float)
    rgb, alpha = a[..., :3], a[..., 3]
    w = sunness(rgb)
    # Disk core vs. rays/glow: bright warm pixels are the disk.
    val = rgb.max(-1) / 255                      # brightness of the sun pixel (orange is bright in V)
    shade = rgb[..., 1] / 255                    # green channel carries the sun's 3D shading
    tex = np.asarray(craters(*w.shape)).astype(float) / 255
    moon_core = np.stack([238, 243, 252], -1) * (0.62 + 0.38 * shade[..., None]) * (0.82 + 0.18 * tex[..., None])
    moon_glow = np.stack([170, 205, 240], -1) * (0.45 + 0.55 * val[..., None])
    core = np.clip((val - .82) / .12, 0, 1)[..., None] * np.clip((shade - .35) / .2, 0, 1)[..., None]
    moon = moon_core * core + moon_glow * (1 - core)
    w3 = w[..., None]
    rgb2 = rgb * (1 - w3) + moon * w3
    # Rays fade: a moon glows, it does not shine rays.
    alpha2 = alpha * (1 - w * (1 - core[..., 0]) * .55)
    out = np.dstack([np.clip(rgb2, 0, 255), alpha2]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    if name == "sun":
        img = crescent(size=220)
    img.save(OUT / f"{name}.png", optimize=True)
    print(name, img.size)
