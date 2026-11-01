import sys;sys.path.insert(0,'.')
from spec import *
from PIL import Image,ImageDraw
for k,s in SCREENS.items():
    im=Image.open(U+s['file']).convert('RGB');d=ImageDraw.Draw(im)
    for (x0,x1) in s['nav']:d.rectangle((x0-10,s['navy'][0],x1+10,s['navy'][1]),outline=(0,255,255))
    d.rectangle(s['chest'],outline=(255,0,0),width=2);d.rectangle(s['ryo'],outline=(255,0,0),width=2)
    for h in HS[k]:d.rectangle(h[1],outline=(0,255,0),width=2)
    im.save(f'chk_{k}.png')
b=Image.open(U+'Guild_All_Categories_Concept_Board.png').convert('RGB');d=ImageDraw.Draw(b)
for r,_ in GUILD_CATS.values():d.rectangle(r,outline=(0,255,0),width=2)
b.save('chk_board.png')
