"""Normalize the illustrated weather icons to one canvas (240x168) with the artwork trimmed,
scaled to fit and centred, so every icon reads at the same size in cards and strips.
Run once after adding or redrawing icons: python scripts/normalize_icons.py"""
from pathlib import Path
from PIL import Image

W, H, MAXW, MAXH = 240, 168, 228, 158
for path in sorted(Path("weather-icons/clear").glob("*.png")) + sorted(Path("weather-icons/clear/night").glob("*.png")):
    im = Image.open(path).convert("RGBA")
    alpha = im.split()[3].point(lambda v: 255 if v > 12 else 0)
    art = im.crop(alpha.getbbox())
    s = min(MAXW / art.width, MAXH / art.height)
    art = art.resize((round(art.width * s), round(art.height * s)), Image.LANCZOS)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.alpha_composite(art, ((W - art.width) // 2, (H - art.height) // 2))
    out.save(path, optimize=True)
    print(path, art.size)
