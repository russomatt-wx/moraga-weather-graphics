from PIL import Image,ImageFilter
import numpy as np
from pathlib import Path
src=Path("1F9E2AE6-6D16-4CE3-B329-F602DA154D9D.png")
im=Image.open(src).convert("RGB")
w,h=im.size
# Uploaded image is a screenshot: isolate the branded illustration above navigation.
# Original banner begins near 19% of height, logo artwork is in left 35%.
# Preserve original cloud, sun and mountain; remove navy backdrop via color key.
x0,y0,x1,y1=map(int,(w*.045,h*.185,w*.365,h*.34))
crop=np.asarray(im.crop((x0,y0,x1,y1))).astype(np.float32)
# Dark navy is background; alpha is derived from brightness above local dark backdrop.
lum=np.max(crop,axis=2)
a=np.clip((lum-29)/115,0,1)
a=np.power(a,1.15)
# remove faint screenshot artifacts near boundaries
from PIL import Image
alpha=Image.fromarray(np.uint8(a*255)).filter(ImageFilter.GaussianBlur(.5))
out=Image.fromarray(np.uint8(crop),'RGB').convert('RGBA')
out.putalpha(alpha)
out.save('diablo-original-transparent.png',optimize=True)
print('Processed',im.size,'crop',(x0,y0,x1,y1),'output',out.size)
