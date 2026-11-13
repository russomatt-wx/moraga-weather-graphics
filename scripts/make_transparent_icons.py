"""Create transparent versions of weather-icons/*.png (which have dark square
backgrounds) using colour-to-alpha against a smoothly estimated background.
Output: weather-icons/clear/<name>.png"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

SRC = Path("weather-icons"); OUT = SRC / "clear"; OUT.mkdir(exist_ok=True)
for f in sorted(SRC.glob("*.png")):
    im = np.asarray(Image.open(f).convert("RGB")).astype(float)
    h, w, _ = im.shape
    # Background: the dark vignette. Estimate from a heavy blur of the image with
    # bright content suppressed (per-pixel minimum over a large window).
    pil = Image.open(f).convert("RGB")
    bg = pil.filter(ImageFilter.MinFilter(31)).filter(ImageFilter.GaussianBlur(24))
    bg = np.minimum(np.asarray(bg).astype(float), im)
    a = np.max((im - bg) / np.maximum(255 - bg, 1), axis=2)
    a = np.clip((a - 0.04) / 0.96, 0, 1)          # drop residual background noise
    a = np.clip(a * 1.35, 0, 1)                    # keep cloud bodies solid
    safe = np.maximum(a, 1e-3)[..., None]
    rgb = np.clip((im - (1 - a[..., None]) * bg) / safe, 0, 255)
    out = np.dstack([rgb, a * 255]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    img = img.crop(img.getbbox() or (0, 0, w, h))
    img.save(OUT / f.name, optimize=True)
    print(f.name, img.size)
