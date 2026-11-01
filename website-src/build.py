import sys,json,os;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from header_controls import header_extras,HDR as HDR_SCREENS
from spec import *
import numpy as np
from PIL import Image,ImageFilter,ImageDraw
from scipy import ndimage as nd
SITE=os.environ.get('SB_SITE_OUT',os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','website'));OUT=os.path.join(SITE,'assets')+os.sep;os.makedirs(OUT,exist_ok=True)
REF=Image.open(U+'chest_global_header_integration_reference.png').convert('RGB')
# --- clean new chest button art (border box inside crop: x 10..232, y 5..54)
cb=REF.crop((1207,47,1447,110));cp=cb.load()
for y in range(12,46):
    c=cp[218,max(y,24)]
    for x in range(79,216):cp[x,y]=c
for y in range(0,10):
    for x in range(205,238):cp[x,y]=cp[239-x,y]
for y in range(10,23):
    for x in range(205,238):cp[x,y]=cp[x,y+14]
CB_BORDER=(10,5,232,54)
def feather(w,h,f):
    m=Image.new('L',(w,h),0);ImageDraw.Draw(m).rectangle((f,f,w-f-1,h-f-1),fill=255);return m.filter(ImageFilter.GaussianBlur(f/2))
def textbox(im,r,thr=150):
    a=np.array(im.crop(r).convert('L')).astype(int);ys,xs=np.nonzero(a>thr)
    if len(xs)==0:return None
    return (r[0]+xs.min(),r[1]+ys.min(),r[0]+xs.max()+1,r[1]+ys.max()+1)
def textcolor(im,r,thr=150):
    a=np.array(im.crop(r)).astype(int);l=a.mean(2);m=l>thr
    c=a[m].mean(0) if m.any() else (255,255,255);return '#%02x%02x%02x'%tuple(int(v) for v in c)
def erase(im,r,side='right',pad=2):
    x0,y0,x1,y1=r[0]-pad,r[1]-pad,r[2]+pad,r[3]+pad;p=im.load()
    for y in range(y0,y1):
        if side=='right':c=p[min(x1+2,im.width-1),y]
        elif side=='left':c=p[max(x0-2,0),y]
        else:
            a=p[max(x0-2,0),y];b=p[min(x1+2,im.width-1),y]
            for x in range(x0,x1):
                t=(x-x0)/max(1,x1-x0);p[x,y]=tuple(int(a[i]*(1-t)+b[i]*t) for i in range(3))
            continue
        for x in range(x0,x1):p[x,y]=c
    im.paste(im.crop((x0,y0,x1,y1)).filter(ImageFilter.GaussianBlur(1)),(x0,y0))
def lantern_glows(im,rect,maxn=10):
    a=np.array(im.crop(rect)).astype(int);r,g,b=a[...,0],a[...,1],a[...,2]
    m=(r>245)&(g>150)&(g<235)&(b<150);lab,n=nd.label(m);out=[]
    for i,s in enumerate(nd.find_objects(lab)):
        w=s[1].stop-s[1].start;h=s[0].stop-s[0].start;area=(lab[s]==i+1).sum()
        if 25<area<3000 and w<90 and h<110:out.append((area,rect[0]+(s[1].start+s[1].stop)//2,rect[1]+(s[0].start+s[0].stop)//2,max(w,h)))
    out.sort(reverse=True);return [dict(t='glow',x=x,y=y,w=max(44,int(m*2.6)),h=max(44,int(m*2.6)),s='--c:255,150,50;--d:%.1fs'%(0.9+(x%7)/6)) for _,x,y,m in out[:maxn]]
def fx(t,x,y,w,h,s=''):return dict(t=t,x=x,y=y,w=w,h=h,s=s)
def glow(cx,cy,w,h,c='255,150,50',d=1.2,o=1):return fx('glow',cx,cy,w,h,f'--c:{c};--d:{d}s;--o:{o}')
DATA={}
for k,s in SCREENS.items():
    im=Image.open(s.get('src') or U+s['file']).convert('RGB');W,H=s['W'],s['H'];live=[]
    # ryo pill text
    rx0,ry0,rx1,ry1=s['ryo'];tb=textbox(im,(rx0+s.get('ryoff',46),ry0+5,rx1-6,ry1-5),165)
    col=textcolor(im,tb,165);erase(im,tb,'right',3)
    live.append(dict(id='ryo',cls='lv-ryo',x=tb[0],y=tb[1]-3,w=s['ryo'][2]-tb[0]-4,h=tb[3]-tb[1]+6,fs=round((tb[3]-tb[1])*1.32),c=col))
    # chest: paste new art mapped onto old button box
    bx0,by0,bx1,by1=s['chest'];sx=(bx1-bx0)/(CB_BORDER[2]-CB_BORDER[0]);sy=(by1-by0)/(CB_BORDER[3]-CB_BORDER[1])
    tx0=round(bx0-CB_BORDER[0]*sx);ty0=round(by0-CB_BORDER[1]*sy);tw=round(cb.width*sx);th=round(cb.height*sy)
    art=cb.resize((tw,th),Image.LANCZOS);im.paste(art,(tx0,ty0),feather(tw,th,max(3,round(4*sx))))
    chest=dict(r=[tx0,ty0,tx0+tw,ty0+th],tx=round(79*sx),ty=round(13*sy),tw=round(136*sx),th=round(30*sy),fs=round(26*sy),dx=round(209*sx),dy=round(-4*sy),ds=round(22*sy))
    F=[]
    # screen-specific
    if k=='home':
        F+=[glow(271,271,180,180,'255,140,40',1),glow(1002,321,180,180,'255,140,40',.9),fx('moon',826,137,240,240),fx('zap',745,244,260,220),fx('shim',632,315,385,150,'--d:3.4s'),
            fx('embers',630,255,1211,262,'--c:255,170,60;--n:30'),glow(1482,530,200,170,'255,170,50',1.1,.55),fx('ring',1301,583,34,34),
            fx('avatar',1316,184,97,92),fx('bar',1494,214,74,15),fx('bar',1328,725,97,11),fx('bar',1312,777,64,12),fx('bar',1308,829,56,11),fx('bar',294,911,76,14),
            glow(442,901,80,80,'255,170,50',1.2,.8),glow(71,901,80,80,'255,90,40',1.4,.5),fx('twinkle',1552,500,0,0),fx('twinkle',1604,536,0,0,'--dl:.5s'),fx('twinkle',1474,566,0,0,'--dl:1s')]
        F+=lantern_glows(im,(25,124,1236,386),8)
    if k=='summon':
        tb=textbox(im,(1540,260,1640,288),170);col=textcolor(im,tb,170);erase(im,tb,'left',3)
        live.append(dict(id='cost',cls='lv-cost',x=tb[0],y=tb[1]-3,w=1640-tb[0],h=tb[3]-tb[1]+6,fs=round((tb[3]-tb[1])*1.32),c=col,align='left'))
        lb=textbox(im,(1415,305,1620,345),60) # dark text on gold
        lb=(1426,309,1575,341);erase(im,lb,'left',2)
        live.append(dict(id='slabel',cls='lv-slabel',x=1426,y=307,h=36,w=200,fs=30,c='#2a1406',align='left'))
        tm=textbox(im,(158,616,262,642),170);col=textcolor(im,tm,170);erase(im,tm,'right',3)
        live.append(dict(id='ltimer',cls='lv-timer',x=tm[0],y=tm[1]-3,w=266-tm[0],h=tm[3]-tm[1]+6,fs=round((tm[3]-tm[1])*1.32),c=col,align='left'))
        F+=[glow(808,375,380,380,'255,170,40',1.6,.75),fx('ellipse',808,490,340,84,'--c:255,190,60'),glow(620,302,70,96,'60,160,255',.6),glow(1012,302,70,96,'60,160,255',.7),
            fx('moon',1010,150,200,200),fx('shim',590,150,560,90,'--d:4s'),fx('embers',765,380,640,360,'--c:255,190,80;--n:28')]
        F+=[fx('bar',1540,435+35*i,100,18) for i in range(5)]
        F+=[fx('twinkle',1612,153,0,0),glow(155,560,240,220,'255,160,40',1.8,.45),glow(990,840,640,140,'255,120,200',2.6,.35)]
        F+=lantern_glows(im,(300,200,1240,560),10)
        # tab sprites
        sel=im.crop((1275,204,1364,248)).copy();uns=im.crop((1371,204,1455,248)).copy()
        for sp in (sel,uns):
            t=textbox(sp,(10,8,sp.width-10,sp.height-8),150)
            if t:erase(sp,t,'left',3)
        sel.save(OUT+'sm-tab-on.webp','WEBP',quality=84,method=6);uns.save(OUT+'sm-tab-off.webp','WEBP',quality=84,method=6)
        for i,(x0,x1) in enumerate([(700,835),(838,968),(968,1092),(1090,1205),(1200,1322),(1318,1442)]):im.crop((x0,775,x1,906)).save(OUT+f'hero{i}.webp','WEBP',quality=84,method=6)
    if k=='fusion':
        tb=textbox(im,(50,314,330,342),150);col=textcolor(im,tb,150);erase(im,tb,'right',3)
        live.append(dict(id='fcount',cls='lv-fcount',x=tb[0],y=tb[1]-3,w=480,h=tb[3]-tb[1]+6,fs=round((tb[3]-tb[1])*1.32),c=col,align='left'))
        F+=[glow(1260,505,300,330,'60,255,110',1.3,.8),fx('ellipse',1260,610,200,46,'--c:90,255,140'),fx('embers',1260,510,140,230,'--c:90,255,130;--n:22'),
            fx('chev',1125,488,70,52),glow(1410,408,70,90,'60,160,255',.6),glow(1398,480,50,60,'60,160,255',.75),fx('moon',985,113,150,150),
            fx('shim',318,170,330,95,'--d:3.6s'),glow(730,460,220,190,'255,80,30',1.1,.6),fx('spinc',495,165,58,58)]
        F+=lantern_glows(im,(600,100,1536,240),8)+lantern_glows(im,(840,330,1180,620),4)
        for i in range(6):im.crop((100,598+60*i,154,652+60*i)).save(OUT+f'fav{i}.webp','WEBP',quality=84,method=6)
    if k=='market':
        F+=[fx('moon',843,135,190,190),glow(1028,483,240,260,'190,80,255',1.6,.5),glow(1390,470,330,300,'200,60,255',1.8,.55),fx('shim',230,175,340,100,'--d:3.8s'),
            fx('embers',1385,420,420,300,'--c:220,110,255;--n:18'),fx('bar',1230,603,104,30)]
        F+=lantern_glows(im,(0,95,1672,245),12)+lantern_glows(im,(1150,250,1620,580),5)
    if k=='boss-hunt':
        tb=textbox(im,(918,312,986,336),150);col=textcolor(im,tb,150);erase(im,tb,'right',2)
        live.append(dict(id='btimer',cls='lv-btimer',x=tb[0],y=tb[1]-3,w=984-tb[0],h=tb[3]-tb[1]+6,fs=round((tb[3]-tb[1])*1.32),c=col,align='left'))
        F+=[fx('moon',585,362,190,190),fx('ellipse',680,638,330,92,'--c:255,40,50'),glow(680,560,330,330,'255,40,30',1.0,.6),fx('embers',680,520,520,330,'--c:255,90,40;--n:30'),
            fx('bar',518,292,924,16),glow(203,142,90,90,'255,80,30',.8),fx('shim',380,150,280,70,'--d:3.8s'),glow(570,425,90,40,'255,60,60',1.1,.6)]
        F+=lantern_glows(im,(220,345,998,718),8)+lantern_glows(im,(500,90,1080,200),6)
    if k=='guild':
        F+=[fx('moon',885,112,150,150),glow(1240,770,170,120,'200,60,255',1.4,.8),glow(1242,768,40,22,'255,40,120',.7),fx('bar',290,487,104,9),
            fx('bar',644,790,95,9),fx('bar',644,843,95,9),fx('bar',644,898,100,9),fx('bar',1260,910,268,16),fx('badge',184,548,22,22),fx('shim',356,150,265,90,'--d:3.8s'),
            fx('embers',1250,330,520,220,'--c:255,160,60;--n:16'),glow(1302,240,60,60,'255,240,200',2,.5)]
        F+=lantern_glows(im,(990,215,1512,425),8)+lantern_glows(im,(500,90,1536,210),8)
    def lvbox(id,r,side='both',thr=150,cls=None,align='left',w=None,pad=2,c=None):
        tb=textbox(im,r,thr) or r;col=c or textcolor(im,tb,thr);erase(im,tb,side,pad)
        live.append(dict(id=id,cls=cls or 'lv-'+id,x=tb[0],y=tb[1]-3,w=w or (tb[2]-tb[0]+40),h=tb[3]-tb[1]+6,fs=round((tb[3]-tb[1])*1.32),c=col,align=align))
    if k=='adventure':
        erase(im,(372,170,684,206),'both',1)
        live.append(dict(id='stitle',cls='lv-stitle',x=372,y=168,w=316,h=40,fs=30,c='#ffffff'))
        lvbox('enemies',(750,184,812,212),'both',120,w=80)
        lvbox('reward',(906,184,1016,212),'both',150,w=150)
        lvbox('team',(1404,776,1484,808),'both',150,w=90)
        F+=[fx('moon',884,113,130,130),fx('shim',160,162,175,60,'--d:3.6s'),glow(46,168,60,60,'255,60,60',1.3,.7),fx('embers',896,480,1240,520,'--c:255,180,90;--n:20'),
            glow(1290,530,60,80,'60,160,255',.9,.6),glow(1460,410,80,180,'120,200,255',2.2,.4),glow(330,300,80,180,'120,200,255',2.6,.35)]
        F+=lantern_glows(im,(272,218,1520,754),12)+lantern_glows(im,(0,780,270,1024),6)
    if k=='heroes':
        F+=[fx('moon',662,108,110,110),fx('shim',180,165,300,90,'--d:3.8s'),glow(714,191,90,90,'255,120,40',1.1,.8),glow(1130,197,80,80,'90,170,255',1.4,.6),
            fx('embers',900,170,700,110,'--c:255,170,80;--n:14'),fx('bar',1110,440,206,10),fx('bar',1102,665,152,10)]
        F+=lantern_glows(im,(380,90,1536,220),8)
    if k=='codex':
        F+=[fx('moon',848,122,130,130),fx('shim',310,140,260,90,'--d:3.8s'),glow(1060,175,100,100,'255,120,40',1.2,.7),glow(1265,170,70,70,'255,80,200',1.5,.5),
            fx('embers',1400,140,400,120,'--c:255,170,80;--n:12'),glow(140,800,160,200,'255,140,50',1.3,.7),fx('twinkle',1600,236,0,0),fx('twinkle',1622,446,0,0,'--dl:.6s'),fx('twinkle',1612,700,0,0,'--dl:1.2s')]
        F+=lantern_glows(im,(500,80,1250,200),8)
    if k=='chat':
        F+=[fx('moon',818,108,120,120),fx('shim',150,128,220,80,'--d:3.8s'),glow(280,122,70,60,'255,60,140',1.2,.7),glow(352,296,90,90,'255,170,40',1.2,.7),
            fx('badge',246,277,22,22),fx('badge',248,388,22,22),fx('badge',248,441,22,22),fx('badge',248,607,22,22),glow(1060,488,200,60,'170,90,255',2,.4),glow(974,758,80,80,'255,120,200',1.6,.5),
            glow(966,627,70,60,'255,120,40',1.1,.7)]
        F+=lantern_glows(im,(300,80,1260,190),8)+lantern_glows(im,(0,700,280,941),4)
    if k=='dojo':
        F+=[fx('moon',720,96,150,150),fx('shim',235,160,360,80,'--d:3.8s'),glow(640,380,260,260,'60,255,120',1.6,.55),glow(345,722,200,140,'60,140,255',1.4,.6),
            fx('embers',640,330,360,240,'--c:120,255,150;--n:16'),fx('twinkle',1582,250,0,0),glow(1236,826,60,60,'255,190,60',1.2,.8)]
        F+=lantern_glows(im,(40,228,432,450),6)+lantern_glows(im,(880,140,1190,300),6)+lantern_glows(im,(0,90,1774,240),8)
        erase(im,(934,487,1144,516),'left',2)
        live.append(dict(id='upcost',cls='lv-upcost',x=900,y=486,w=276,h=32,fs=19,c='#ffffff',align='center'))
    if k=='heroes':
        erase(im,(1238,848,1414,884),'both',1)
        live.append(dict(id='trainlbl',cls='lv-trainlbl',x=1240,y=848,w=200,h=36,fs=26,c='#2a1406',align='left'))
    px=im.load();samp=lambda x,y:'#%02x%02x%02x'%px[x,y]
    bgs={}
    if k=='market':bgs=dict(stats=samp(1510,690),el=samp(1268,752),price=samp(1340,878),panel=samp(1180,610))
    if k=='guild':bgs=dict(note=samp(1010,500),quest=samp(860,899))
    if k=='boss-hunt':bgs=dict(hp=samp(40,300),hpt=samp(230,324),rec=samp(1040,972))
    if k=='chat':bgs=dict(title=samp(560,214),inp=samp(760,852),list=samp(760,820))
    if k=='heroes':bgs=dict(card=samp(130,520),panel=samp(1300,780),lvl=samp(120,505))
    if k=='dojo':bgs=dict(chip=samp(1520,300),hired=samp(760,852))
    im.save(OUT+f'scr-{k}.webp','WEBP',quality=84,method=6)
    hs=[dict(id=h[0],r=list(h[1]),c=h[2],a=h[3],l=h[4]) for h in HS[k]]
    for name,(x0,x1) in zip(s.get('navnames',NAMES),s['nav']):
        act='go:'+ROUTE[name] if name in ROUTE else 'soon:'+name
        hs.append(dict(id='nav-'+name.replace(' ','').lower(),r=[x0-10,s['navy'][0],x1+10,s['navy'][1]],c='nav',a=act,l=name))
    DATA[k]=dict(W=W,H=H,img=f'assets/scr-{k}.webp',hs=hs,fx=F,live=live,chest=chest,bg=bgs)
    if k in HDR_SCREENS:
        hx,tx=header_extras(k,OUT+f'scr-{k}.webp');DATA[k]['hs']+=hx;DATA[k]['hdr']=tx
# guild categories: full-size screens from update pack (overwrites concept-board crops)
GS={'guild-members':'02_members','guild-battle':'03_battle','guild-boss':'04_boss','guild-missions':'05_missions','guild-shop':'06_shop','guild-tech':'07_tech','guild-applications':'08_applications','guild-settings':'09_settings'}
for cid,(r,n) in GUILD_CATS.items():
    g=Image.open(UP+'12_Guild/screenshots/'+GS[cid]+'.png').convert('RGB');c=g.crop((222,200,1536,g.height-36))
    c.save(OUT+f'gc-{cid}.webp','WEBP',quality=84,method=6)
    DATA['guild'].setdefault('cats',{})[cid]=dict(n=n,w=c.width,h=c.height)
# fusion animation phases
A=Image.open(U+'fusion_animation_reference.png').convert('RGB')
for i,(x0,x1) in enumerate([(20,352),(356,684),(687,985),(988,1318),(1321,1652)]):A.crop((x0,205,x1,743)).save(OUT+f'fx-p{i+1}.webp','WEBP',quality=84,method=6)
# chest manager art
REF.crop((40,340,420,530)).save(OUT+'cm-art.webp','WEBP',quality=84,method=6);REF.crop((185,274,497,334)).save(OUT+'cm-title.webp','WEBP',quality=84,method=6);REF.crop((432,386,604,462)).save(OUT+'cm-coin.webp','WEBP',quality=84,method=6)
json.dump(DATA,open(os.path.join(SITE,'data.json'),'w'),default=int)
print({k:(len(v['hs']),len(v['fx'])) for k,v in DATA.items()})

# ===== update-pack assets =====
RV=Image.open(UP+'01_Cinematic_Summoning_Reveal/references/summoning_reveal_user_approved_original.png').convert('RGB')
CARDS=[('Ice Shinobi','Jonin','Ice'),('Poison Shinobi','Chunin','Poison'),('Lightning Kunoichi','Legend','Lightning'),('Spirit Shinobi','Elite','Spirit'),('Earth Shinobi','Genin','Earth'),
 ('Fire Shinobi','Elite','Fire'),('Storm Shinobi','Jonin','Storm'),('Shadow Shinobi','Chunin','Shadow'),('Spirit Neko','Legend','Spirit'),('Wind Shinobi','Genin','Wind')]
XS=[(248,392),(407,557),(573,732),(749,900),(915,1059)];YS=[(506,667),(679,843)]
for i,(n,r,e) in enumerate(CARDS):
    x0,x1=XS[i%5];y0,y1=YS[i//5];RV.crop((x0,y0+16,x1,y1)).save(OUT+f'rv-card{i}.webp','WEBP',quality=88,method=6)
RV.crop((148,198,208,292)).save(OUT+'rv-scroll.webp','WEBP',quality=88,method=6)
RV.crop((334,42,578,396)).save(OUT+'rv-open.webp','WEBP',quality=86,method=6)
DATA['reveal']=dict(cards=[dict(n=n,r=r,e=e,img=f'assets/rv-card{i}.webp') for i,(n,r,e) in enumerate(CARDS)])
def gal(src,name,w=1400,q=80):
    g=Image.open(src).convert('RGB')
    if g.width>w:g=g.resize((w,round(g.height*w/g.width)),Image.LANCZOS)
    g.save(OUT+name+'.webp','WEBP',quality=q,method=6);return dict(src='assets/'+name+'.webp',w=g.width,h=g.height)
A4=UP+'04_Adventure_Bomber_Maps/references/'
MAPN=['Shinobi Village — Training Grounds','Fallen Temple Ruins','Bamboo Shadow Forest','Frozen Mountain Pass','Volcanic Shadow Fortress','Thunderstorm Sky Temple','Cursed Spirit Graveyard',"Shadow Emperor's Citadel"]
maps=[]
for i in range(1,9):
    m=gal(A4+f'map_0{i}_user_approved.png',f'map{i}',1280,80);m['n']=MAPN[i-1];maps.append(m)
    full=Image.open(A4+f'map_0{i}_user_approved.png').convert('RGB').crop((70,212,1466,808)).resize((1248,534),Image.LANCZOS)
    full.save(OUT+f'arena{i}.webp','WEBP',quality=80,method=6)
B8=UP+'08_Boss_Models/references/'
BOSS=[('Akuma','Fallen Shinobi','Akuma_Fallen_Shinobi'),('Yuki Onna','Frozen Empress','Yuki_Onna_Frozen_Empress'),('Raijin','Thunder Warlord','Raijin_Thunder_Warlord'),('Daichi Golem','Ancient Guardian','Daichi_Golem_Ancient_Guardian'),('Orochi','Serpent Overlord','Orochi_Serpent_Overlord'),('Shadow Emperor','Final Boss','Shadow_Emperor')]
bosses=[]
for n,t,f in BOSS:
    g=gal(B8+f'six_boss_concept_sheets/{f}_Boss_Concept_Sheet.png','boss-'+n.split()[0].lower(),1400,78);g.update(n=n,t=t);bosses.append(g)
akuma=[gal(B8+f'akuma_animation_concepts/akuma{i}.png',f'akuma{i}',1400,78) for i in (1,2,3)]
H10=UP+'10_Hero_Models_Animations/references/';A11=UP+'11_Hero_Rarity_Auras/references/'
DATA['ref']=dict(maps=maps,bosses=bosses,akuma=akuma,models=gal(H10+'all_12_hero_models_four_directions.png','hero-models',2043,80),
  hayate=gal(H10+'hayate_master_animation_vfx_reference.png','hayate-ref',1400,78),aura=gal(A11+'hero_rarity_aura_system.png','aura-system',1400,80),
  auralayer=gal(A11+'aura_render_layering.png','aura-layer',743,85))
json.dump(DATA,open(os.path.join(SITE,'data.json'),'w'),default=int)
