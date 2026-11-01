"""Header controls added for the game integration (wallet pill + Ryo '+'), with text boxes for the baked-in
wallet address and gem count so live mode can cover demo account values. Coordinates are in each screen's
native pixel space. Used by build.py (fresh builds) and patch_header_data.py (patch an existing build)."""
import numpy as np
from PIL import Image
HDR={'home':((1384,12,1420,50),(1450,60,1652,106)),'summon':((1418,8,1454,46),(1478,56,1652,100)),'fusion':((1248,13,1286,49),(1316,61,1516,107)),
 'market':((1370,15,1408,53),(1442,65,1652,113)),'boss-hunt':((1254,14,1292,50),(1320,60,1498,102)),'guild':((1238,12,1274,48),(1304,58,1504,106)),
 'adventure':((1254,13,1294,53),(1322,59,1522,107)),'heroes':((1192,11,1226,47),(1264,57,1470,109)),'codex':((1398,4,1434,42),(1468,48,1652,94)),
 'chat':((1426,4,1462,42),(1480,48,1656,94)),'dojo':((1338,13,1372,43),(1588,11,1748,49))}
def _box(a,x0,y0,x1,y1,thr=175):
    m=a[y0:y1,x0:x1].min(2)>thr;ys,xs=np.nonzero(m)
    if not len(xs):return None
    return [int(x0+xs.min()),int(y0+ys.min()),int(x0+xs.max()+1),int(y0+ys.max()+1)]
def header_extras(k,img_path):
    plus,wal=HDR[k];a=np.array(Image.open(img_path).convert('RGB')).astype(int)
    w=wal[2]-wal[0];wt=_box(a,wal[0]+int(w*.30),wal[1]+4,wal[2]-int(w*.17),wal[3]-4)
    if k=='dojo':gt=_box(a,1440,plus[1],1515,plus[3])
    else:gt=_box(a,wal[0]+int(w*.28),plus[1]-2,wal[2]-int(w*.22),plus[3]+2)
    def bg(b,right=False):
        xs=slice(b[2]+2,b[2]+7) if right else slice(max(0,b[0]-6),b[0]-2)
        return '#%02x%02x%02x'%tuple(int(v) for v in np.median(a[b[1]:b[3],xs].reshape(-1,3),0))
    hs=[dict(id='wallet',r=list(wal),c='sbg-h',a='wallet',l='Wallet and game sign-in'),dict(id='ryoplus',r=list(plus),c='sbg-h',a='deposit',l='Add Ryo')]
    txt={}
    for key,b in (('wallet',wt),('gems',gt)):
        if b:txt[key]=dict(x=b[0]-3,y=b[1]-3,w=b[2]-b[0]+6,h=b[3]-b[1]+6,bg=bg(b,key=='gems'),fs=round((b[3]-b[1])*1.32))
    return hs,txt
