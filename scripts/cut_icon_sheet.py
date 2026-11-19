"""Cut the icon sheet into individual transparent PNGs (240x168 canvas, like the current set)."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

SRC = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('weather-icons/source/icon-sheet.png')
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
sheet = Image.open(SRC).convert('RGB')
A = np.asarray(sheet).astype(float)

# (row y-band without labels, [column centres]) per sheet row
ROWS = {
    'core': ((76, 166), [341, 480, 617, 755, 895, 1035, 1172, 1310, 1446]),
    'precip': ((232, 324), [341, 480, 617, 754, 893, 1032, 1170, 1310, 1448]),
    'wintry': ((396, 480), [350, 504, 656, 811, 963, 1113, 1268, 1427]),
    'night': ((696, 774), [341, 480, 620, 755, 891, 1028, 1168, 1306, 1443]),
}
NAMES = {
    'core': ['sunny', 'mostlySunny', 'partlyCloudy', 'mostlyCloudy', 'cloudy', 'fog', 'haze', 'windy', 'breezy'],
    'precip': ['lightRain', 'rain', 'heavyRain', 'showers', 'scatteredShowers', 'rainLikely', 'tstorms', 'strongTstorms', 'severeTstorms'],
    'wintry': ['lightSnow', 'snow', 'heavySnow', 'rainSnow', 'snowShowers', 'sleet', 'freezingRain', 'wintryMix'],
    'night': ['clearNight', 'mostlyClearNight', 'partlyCloudyNight', 'mostlyCloudyNight', 'cloudyNight', 'nightShowers', 'nightRain', 'nightTstorms', 'nightSnow'],
}
HALF = 68


def cut(y0, y1, cx):
    x0, x1 = max(cx - HALF, 268), min(cx + HALF, 1504)
    a = A[y0:y1, x0:x1]
    # Background: per-row median of the crop's left and right edge strips (the sheet has a soft gradient).
    edge = np.concatenate([a[:, :6], a[:, -6:]], axis=1)
    bg = np.median(edge, axis=1, keepdims=True)
    diff = a - bg
    # Artwork is brighter / more saturated than the navy background: alpha from the largest channel lift.
    lift = np.clip(diff.max(axis=2), 0, None)
    alpha = np.clip((lift - 10) / 60, 0, 1)
    # Un-mix the background so edges don't keep a navy fringe.
    al = alpha[..., None]
    rgb = np.where(al > 0.02, (a - bg * (1 - al)) / np.maximum(al, 0.02), 0)
    rgb = np.clip(rgb, 0, 255)
    img = Image.fromarray(np.dstack([rgb, alpha * 255]).astype('uint8'), 'RGBA')
    # Drop isolated specks (label fragments / noise): keep pixels whose neighbourhood has artwork.
    m = img.split()[3].filter(ImageFilter.MaxFilter(3))
    return img, m


W, H, MAXW, MAXH = 240, 168, 228, 158
for row, ((y0, y1), cols) in ROWS.items():
    for name, cx in zip(NAMES[row], cols):
        img, _ = cut(y0, y1, cx)
        bbox = img.split()[3].point(lambda v: 255 if v > 40 else 0).getbbox()
        art = img.crop(bbox)
        s = min(MAXW / art.width, MAXH / art.height)
        art = art.resize((round(art.width * s), round(art.height * s)), Image.LANCZOS)
        out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        out.alpha_composite(art, ((W - art.width) // 2, (H - art.height) // 2))
        out.save(OUT / f'{name}.png', optimize=True)
print('done')
