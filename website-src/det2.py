import numpy as np,sys
from PIL import Image
from scipy import ndimage as nd
S={'adventure':'/tmp/upd/04_Adventure_Bomber_Maps/references/adventure_ui_user_approved_original.png','heroes':'/tmp/upd/17_Supplement_Heroes_Collection/references/neon_shinobi_heroes_roster_dashboard.png',
'codex':'/tmp/upd/16_Codex_Knowledge_Hub/references/codex_tab_reference.png','chat':'/tmp/upd/15_Chat_System/references/chat_ui_reference.png','dojo':'/tmp/upd/09_Dojo/reference.png'}
for k,f in S.items():
    a=np.array(Image.open(f).convert('RGB')).astype(int);r,g,b=a[...,0],a[...,1],a[...,2];W=a.shape[1]
    m=(r>220)&(g>130)&(g<215)&(b<90)
    lab,n=nd.label(m[:120,int(W*.55):]);best=None
    for s in nd.find_objects(lab):
        w=s[1].stop-s[1].start;h=s[0].stop-s[0].start
        if w>100 and h>22 and (best is None or w*h>best[0]):best=(w*h,(s[1].start+int(W*.55),s[0].start,s[1].stop+int(W*.55),s[0].stop))
    # ryo: find coin (gold circle) near top right
    x0,x1=int(W*.12),int(W*.72)
    col=(a[6:80,x0:x1].max(2)>130).sum(0)>2;grp=[];st=None;gap=0
    for i,v in enumerate(col):
        if v:
            if st is None:st=i
            e=i;gap=0
        elif st is not None:
            gap+=1
            if gap>10:grp.append((st+x0,e+x0));st=None
    if st is not None:grp.append((st+x0,e+x0))
    grp=[g for g in grp if g[1]-g[0]>14]
    print(k,a.shape[1],a.shape[0],'chest',best and best[1],'nav',len(grp),grp)
