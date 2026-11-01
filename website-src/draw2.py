import sys;sys.path.insert(0,'.')
from spec import *
from PIL import Image,ImageDraw
for k in ['adventure','heroes','codex','chat','dojo','boss-hunt']:
    s=SCREENS[k];im=Image.open(s.get('src') or U+s['file']).convert('RGB');d=ImageDraw.Draw(im)
    for (x0,x1) in s['nav']:d.rectangle((x0-10,s['navy'][0],x1+10,s['navy'][1]),outline=(0,255,255),width=2)
    d.rectangle(s['chest'],outline=(255,0,0),width=2);d.rectangle(s['ryo'],outline=(255,0,0),width=2)
    for h in HS[k]:d.rectangle(h[1],outline=(0,255,0),width=2)
    im.save(f'chk_{k}.png')
