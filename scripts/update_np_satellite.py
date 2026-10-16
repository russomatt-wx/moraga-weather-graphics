"""Download and validate latest Northern Pacific NOAA GOES-West satellite frames."""
import re
from pathlib import Path
from urllib.request import Request, urlopen

BASE = "https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/np/"
def fetch(url):
    with urlopen(Request(url, headers={"User-Agent":"Mozilla/5.0"}), timeout=45) as response:
        return response.read()

for product, output in [("GEOCOLOR", "satellite_np_geocolor.jpg"), ("13", "satellite_np_ir.jpg")]:
    directory = BASE + product + "/"
    listing = fetch(directory).decode("utf-8")
    names = sorted(set(re.findall(r'([0-9]{11}_GOES18-ABI-np-' + product + r'-900x540\\.jpg)', listing)))
    if not names:
        raise RuntimeError("No timestamped 900x540 frames found in " + directory)
    name = names[-1]
    image = fetch(directory + name)
    if len(image) < 20000 or not image.startswith(bytes([255, 216, 255])):
        raise RuntimeError("Invalid JPEG for " + product)
    Path(output).write_bytes(image)
    print(product, name, len(image), "bytes")
