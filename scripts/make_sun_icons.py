#!/usr/bin/env python3
"""Sunrise / sunset icons built from the illustrated sun in the forecast icon set (weather-icons/v5/sun.png),
so they share its glossy style: the sun half-set on a glowing horizon, with a soft arrow (up for sunrise,
down for sunset; sunset sun warmed toward red). Writes weather-icons/v5/sunrise.png and sunset.png (240x168)."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parents[1]
W, H = 240, 168
SUN = Image.open(ROOT / "weather-icons/v5/sun.png").convert("RGBA")


def warm(img, amount):
    a = np.asarray(img).astype(float)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    a[..., 1] = g * (1 - .38 * amount)
    a[..., 2] = b * (1 - .5 * amount)
    a[..., 0] = np.minimum(255, r * (1 + .04 * amount))
    return Image.fromarray(a.clip(0, 255).astype("uint8"), "RGBA")


def glow_line(draw_size, y, x0, x1, colors):
    layer = Image.new("RGBA", draw_size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for k, (w, c) in enumerate(((12, colors[0] + (45,)), (6, colors[0] + (110,)), (3, colors[1] + (235,)))):
        d.line([(x0, y), (x1, y)], fill=c, width=w)
    return layer.filter(ImageFilter.GaussianBlur(1.2)), layer


def arrow(up, colors):
    """Glossy arrow: gradient fill, white rim highlight, soft shadow."""
    s = 4  # supersample
    w, h = 44 * s, 40 * s
    shape = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(shape)
    head = [(w / 2, 2 * s), (w - 4 * s, 20 * s), (w / 2 + 7 * s, 20 * s), (w / 2 + 7 * s, h - 2 * s),
            (w / 2 - 7 * s, h - 2 * s), (w / 2 - 7 * s, 20 * s), (4 * s, 20 * s)]
    d.polygon(head, fill=255)
    shape = shape.filter(ImageFilter.GaussianBlur(s * .6))
    if not up:
        shape = shape.transpose(Image.FLIP_TOP_BOTTOM)
    grad = Image.new("RGBA", (w, h))
    gd = ImageDraw.Draw(grad)
    c0, c1 = colors
    for yy in range(h):
        t = yy / h
        gd.line([(0, yy), (w, yy)], fill=tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3)) + (255,))
    art = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    art.paste(grad, (0, 0), shape)
    rim = ImageChops.subtract(shape, shape.filter(ImageFilter.MinFilter(s * 2 + 1)))
    hl = Image.new("RGBA", (w, h), (255, 255, 255, 0)); hl.putalpha(rim.point(lambda v: int(v * .55)))
    art = Image.alpha_composite(art, hl)
    shadow = Image.new("RGBA", (w, h), (60, 20, 0, 0)); shadow.putalpha(shape.filter(ImageFilter.GaussianBlur(s * 2)).point(lambda v: int(v * .45)))
    out = Image.new("RGBA", (w, h + 4 * s), (0, 0, 0, 0))
    out.alpha_composite(shadow, (0, 3 * s)); out.alpha_composite(art, (0, 0))
    return out.resize((int(w / s * 1.25), int((h + 4 * s) / s * 1.25)), Image.LANCZOS)


def make(kind):
    sunrise = kind == "sunrise"
    sun = SUN.copy()
    bbox = sun.getbbox()
    sun = sun.crop(bbox)
    scale = 196 / sun.width
    sun = sun.resize((int(sun.width * scale), int(sun.height * scale)), Image.LANCZOS)
    if not sunrise:
        sun = warm(sun, 1.0)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    horizon = 128
    sx, sy = (W - sun.width) // 2, horizon - sun.height // 2 - 4
    half = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    half.alpha_composite(sun, (sx, sy))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rectangle([0, 0, W, horizon], fill=255)
    half.putalpha(ImageChops.multiply(half.getchannel("A"), mask))
    canvas.alpha_composite(half)
    cols = ((255, 190, 90), (255, 236, 170)) if sunrise else ((255, 110, 80), (255, 200, 150))
    blur, line = glow_line((W, H), horizon + 2, 8, W - 8, cols)
    canvas.alpha_composite(blur); canvas.alpha_composite(line)
    a = arrow(sunrise, ((255, 247, 210), (255, 176, 46)) if sunrise else ((255, 214, 150), (255, 90, 70)))
    canvas.alpha_composite(a, ((W - a.width) // 2, 0))
    canvas.save(ROOT / f"weather-icons/v5/{kind}.png", optimize=True)


for k in ("sunrise", "sunset"):
    make(k)
print("ok")
