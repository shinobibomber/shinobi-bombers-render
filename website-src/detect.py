import numpy as np,sys
from PIL import Image
from scipy import ndimage as nd
U='/mnt/user-data/uploads/'
S={'home':'1793481009081_image.png','summon':'1793483225922_image.png','fusion':'fusion_uploaded_reference.png','market':'marketplace_enhanced_reference.png','boss':'boss_hunt_uploaded_reference.png','guild':'Guild_Home_Original_Reference.png','newchest':'chest_global_header_integration_reference.png'}
for k,f in S.items():
    a=np.array(Image.open(U+f).convert('RGB')).astype(int);r,g,b=a[...,0],a[...,1],a[...,2];W=a.shape[1]
    # gold chest button: saturated orange-yellow filled region in header
    m=(r>220)&(g>140)&(g<215)&(b<90)
    lab,n=nd.label(m[:130,int(W*.6):]);best=None
    for s in nd.find_objects(lab):
        w=s[1].stop-s[1].start;h=s[0].stop-s[0].start
        if w>120 and h>25 and (best is None or w*h>best[0]):best=(w*h,(s[1].start+int(W*.6),s[0].start,s[1].stop+int(W*.6),s[0].stop))
    # nav groups
    x0,x1=int(W*.14),int(W*.73) if k!='home' else 1190
    col=(a[6:85,x0:x1].max(2)>120).sum(0)>2;grp=[];st=None;gap=0
    for i,v in enumerate(col):
        if v:
            if st is None:st=i
            e=i;gap=0
        elif st is not None:
            gap+=1
            if gap>12:grp.append((st+x0,e+x0));st=None
    if st is not None:grp.append((st+x0,e+x0))
    grp=[g for g in grp if g[1]-g[0]>14]
    print(k,'chest',best and best[1],'nav',len(grp),grp)
