"""Publish latest timestamped NOAA Northern Pacific imagery to GitHub Pages."""
from html.parser import HTMLParser
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from pathlib import Path

BASE = "https://www.star.nesdis.noaa.gov/GOES/sector.php?sat=G18&sector=np"
class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links=[]
    def handle_starttag(self, tag, attrs):
        if tag=="a":
            href=dict(attrs).get("href","")
            if href:
                self.links.append(href)

def fetch(url):
    with urlopen(Request(url, headers={"User-Agent":"Mozilla/5.0 MoragaWeatherObservatory"}), timeout=35) as r:
        return r.read()

parser=Links()
parser.feed(fetch(BASE).decode("utf-8"))
for product, output in [("GEOCOLOR","satellite_np_geocolor.jpg"),("13","satellite_np_ir.jpg")]:
    candidates=[urljoin(BASE, link) for link in parser.links if f"/np/{product}/" in link and link.endswith("900x540.jpg")]
    if not candidates:
        raise RuntimeError("NOAA did not publish timestamped "+product+" link")
    image=fetch(candidates[0])
    if len(image)<20000 or image[:3]!=b"\\xff\\xd8\\xff":
        raise RuntimeError("Invalid or incomplete NOAA "+product+" JPEG")
    Path(output).write_bytes(image)
    print(product, len(image), candidates[0])
