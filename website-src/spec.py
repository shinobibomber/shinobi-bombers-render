import os
# Reference inputs: the screenshots you uploaded (SB_UPLOADS) and the extracted Updates.zip design pack (SB_UPDATE_PACK).
U=os.environ.get('SB_UPLOADS','/mnt/user-data/uploads').rstrip('/\\')+'/'
NAMES=['Home','Heroes','Adventure','Summon','Fusion','Dojo','Market','Boss Hunt','Codex','Guild']
ROUTE={'Home':'home','Summon':'summon','Fusion':'fusion','Market':'market','Boss Hunt':'boss-hunt','Guild':'guild'}
SCREENS={
'home':dict(file='1793481009081_image.png',W=1672,H=941,chest=(1224,61,1421,104),ryo=(1203,10,1385,55),
  nav=[(251,342),(367,412),(451,518),(552,611),(648,691),(735,772),(820,866),(912,980),(1029,1069),(1126,1159)],navy=(4,86)),
'summon':dict(file='1793483225922_image.png',W=1672,H=941,chest=(1260,57,1454,97),ryo=(1245,8,1418,48),
  nav=[(292,332),(378,427),(460,533),(550,650),(675,721),(771,807),(859,908),(954,1027),(1072,1115),(1168,1203)],navy=(2,84)),
'fusion':dict(file='fusion_uploaded_reference.png',W=1536,H=1024,chest=(1093,61,1277,103),ryo=(1078,12,1245,50),
  nav=[(257,292),(329,372),(401,465),(493,546),(563,642),(668,702),(745,787),(818,881),(918,956),(1008,1039)],navy=(4,84)),
'market':dict(file='marketplace_enhanced_reference.png',W=1672,H=941,chest=(1202,64,1405,110),ryo=(1185,14,1372,54),
  nav=[(282,319),(364,409),(445,511),(544,601),(644,685),(735,769),(799,890),(907,973),(1014,1054),(1108,1141)],navy=(2,88)),
'boss-hunt':dict(file='boss_hunt_uploaded_reference.png',W=1536,H=1024,chest=(1096,60,1288,101),ryo=(1078,12,1255,52),
  nav=[(253,289),(329,373),(405,470),(499,554),(588,628),(672,703),(747,790),(811,903),(925,964),(1009,1041)],navy=(2,84)),
'guild':dict(file='Guild_Home_Original_Reference.png',W=1536,H=1024,chest=(1092,59,1273,101),ryo=(1070,10,1236,48),
  nav=[(255,290),(328,370),(401,465),(492,546),(582,622),(666,699),(743,785),(817,880),(916,954),(981,1058)],navy=(2,84)),
}
# hotspots: id, rect, classes, action, label
HS={
'home':[('logo',(25,6,236,108),'','toast:Shinobi Bombers – Forge your ninja way','Shinobi Bombers'),
 ('c-adv',(29,395,438,563),'card sh','soon:Adventure','Adventure'),('c-sum',(451,395,845,563),'card sh','go:summon','Summoning Shrine'),('c-dojo',(858,395,1231,563),'card sh','soon:Dojo','Dojo'),
 ('c-her',(29,573,438,727),'card sh','soon:Heroes','Heroes'),('c-mkt',(451,573,845,727),'card sh','go:market','Market'),('c-fus',(858,573,1231,727),'card sh','go:fusion','Fusion'),
 ('c-boss',(29,735,438,858),'card sh','go:boss-hunt','Boss Hunt'),('c-cdx',(451,735,845,858),'card sh','codex','Codex'),('c-gld',(858,735,1231,858),'card sh','go:guild','Guild'),
 ('prof',(1268,137,1368,232),'glowp','toast:Profile','Profile'),('mng',(1544,262,1637,296),'','toast:Manage strike team','Manage strike team'),
 ('t1',(1268,300,1337,425),'tile sh','toast:Strike team slot 1','Strike team slot 1'),('t2',(1343,300,1412,425),'tile sh','toast:Strike team slot 2','Strike team slot 2'),('t3',(1418,300,1487,425),'tile sh','toast:Strike team slot 3','Strike team slot 3'),('t4',(1493,300,1562,425),'tile sh','toast:Strike team slot 4','Strike team slot 4'),('t5',(1568,300,1637,425),'tile sh','toast:Strike team slot 5','Strike team slot 5'),
 ('ev',(1268,495,1637,627),'sh','toast:Weekend Boost Event – increased drop rates','Weekend Boost Event'),
 ('go1',(1571,694,1634,734),'pu','go:boss-hunt','Go: Defeat 50 monsters'),('go2',(1571,746,1634,786),'pu','chest','Go: Open 5 chests'),('go3',(1571,798,1634,838),'pu','soon:Adventure','Go: Complete 3 adventures'),
 ('season',(17,869,513,933),'sh','toast:Season 1 – Shadow Legacy · 750 / 1,000','Season 1'),('tut',(1260,877,1382,931),'','toast:Tutorial','Tutorial'),('news',(1394,877,1509,931),'','toast:News','News'),('sup',(1521,877,1642,931),'','toast:Support','Support')],
'summon':[('logo',(25,6,250,105),'','go:home','Home'),
 ('sb-shrine',(18,133,282,192),'act','toast:You are at the Summoning Shrine','Summoning Shrine'),('sb-gal',(30,206,272,260),'side','fn:gallery','Hero Gallery'),('sb-rate',(30,268,272,322),'side','fn:flashRates','Rarity Rates'),('sb-hist',(30,330,272,384),'side','fn:history','Summon History'),('sb-col',(30,391,272,445),'side','fn:gallery','Collection'),
 ('legend',(30,462,277,700),'sh',None,None),('lg-view',(50,648,258,688),'pu','fn:legend','View legend details'),
 ('elem',(30,718,277,875),'sh',None,None),('el-exp',(52,818,258,858),'','fn:elements','Explore elemental Shinobi'),
 ('scroll',(690,240,935,500),'breathe','fn:summon:1','Summon from the shrine'),
 ('k1',(325,573,538,752),'card sh','fn:pick:1','Normal Summon ×1'),('k5',(555,573,765,752),'card sh','fn:pick:5','5× Summon'),('k10',(782,573,995,752),'card sh','fn:pick:10','10× Summon'),('k15',(1012,573,1228,752),'card sh','fn:pick:15','15× Summon'),
 ('feat',(318,772,1652,908),'sh',None,None),('ft-view',(1450,816,1628,866),'pu','fn:featured','View featured details'),
 ('q1',(1275,204,1364,248),'','fn:qty:1','Summon ×1'),('q5',(1371,204,1455,248),'','fn:qty:5','Summon ×5'),('q10',(1463,204,1548,248),'','fn:qty:10','Summon ×10'),('q15',(1556,204,1640,248),'','fn:qty:15','Summon ×15'),
 ('go',(1277,295,1637,352),'pu','fn:summon','Summon'),('rates',(1255,380,1658,605),'',None,None),('help',(1447,388,1474,413),'','fn:flashRates','Rarity rates help'),
 ('e1',(1279,658,1327,708),'bob','toast:Fire – burns over time','Fire'),('e2',(1340,658,1388,708),'bob','toast:Ice – slows enemies','Ice'),('e3',(1402,658,1450,708),'bob','toast:Poison – stacks damage','Poison'),('e4',(1464,658,1512,708),'bob','toast:Lightning – chains between foes','Lightning'),('e5',(1526,658,1574,708),'bob','toast:Spirit – drains chakra','Spirit'),('e6',(1588,658,1636,708),'bob','toast:Earth – raises defense','Earth')],
'fusion':[('logo',(25,6,220,104),'','go:home','Home'),('back',(27,125,158,178),'pu','go:home','Back'),
 ('r1',(56,247,205,295),'','fn:rank:0','Genin'),('r2',(218,247,354,295),'','fn:rank:1','Chunin'),('r3',(368,247,505,295),'','fn:rank:2','Jonin'),('r4',(519,247,668,295),'','fn:rank:3','Elite'),
 ('weak',(540,311,700,348),'','fn:weakest','Select weakest'),('clr',(714,311,807,348),'','fn:clear','Clear selection'),
 ('batch',(45,363,812,535),'sh',None,None),('b1',(64,440,192,488),'pu','fn:batch:1','Fuse ×1'),('b5',(204,440,336,488),'','fn:batch:5','Fuse ×5'),('b10',(349,440,481,488),'','fn:batch:10','Fuse ×10'),('bmax',(490,440,645,488),'','fn:batch:61','Fuse Max (61)'),
 ('bh',(655,385,805,530),'breathe',None,None),
 ('all',(58,558,84,584),'','fn:weakest','Select weakest three'),
]+[('row%d'%i,(46,594+60*i,800,652+60*i),'row','fn:row:%d'%i,'Select hero %d'%(i+1)) for i in range(6)]+[
 ('s1',(901,347,1052,433),'slot','fn:slot:0','Hero slot 1'),('s2',(901,440,1052,527),'slot','fn:slot:1','Hero slot 2'),('s3',(901,533,1052,619),'slot','fn:slot:2','Hero slot 3'),
 ('portal',(1180,382,1340,628),'',None,None),('fuse',(1190,884,1484,950),'pu','fn:fuse','Fuse now'),
 ('et1',(1199,237,1270,303),'','fn:etab:0','Genin'),('et2',(1272,237,1341,303),'','fn:etab:1','Chunin'),('et3',(1343,237,1412,303),'','fn:etab:2','Jonin'),('et4',(1414,237,1482,303),'','fn:etab:3','Elite')],
'market':[('logo',(25,6,250,112),'','go:home','Home'),
 ('tb1',(80,256,298,302),'','fn:mtab:0','Heroes'),('tb2',(308,256,548,302),'','fn:mtab:1','Items'),('tb3',(558,256,800,302),'','fn:mtab:2','Resources'),('tb4',(878,256,1124,302),'','fn:mtab:3','My Listings'),
 ('f0',(80,315,148,349),'','fn:rar:All','All'),('f1',(157,315,230,349),'','fn:rar:Genin','Genin'),('f2',(238,315,309,349),'','fn:rar:Chunin','Chunin'),('f3',(316,315,389,349),'','fn:rar:Jonin','Jonin'),('f4',(397,315,470,349),'','fn:rar:Elite','Elite'),('f5',(478,315,568,349),'','fn:rar:Legend','Legend'),
 ('dd1',(582,315,672,349),'','fn:dd:element','Element filter'),('dd2',(683,315,768,349),'','fn:dd:skills','Skills filter'),('dd3',(780,315,863,349),'','fn:dd:price','Price sort'),('srch',(876,315,1040,349),'','fn:search','Search hero name'),('rst',(1052,315,1124,349),'pu','fn:reset','Reset filters'),
]+[('cd%d'%i,r,'card mc sh','fn:card:%d'%i,None) for i,r in enumerate([(76,364,276,603),(290,364,493,603),(507,364,708,603),(722,364,915,603),(929,364,1128,603),(76,617,276,850),(290,617,493,850),(507,617,708,850),(722,617,915,850),(929,617,1128,850)])]+[
 ('pv',(386,867,432,903),'','fn:page:-1','Previous page'),('p1',(452,867,500,903),'','fn:page:1','Page 1'),('p2',(515,867,563,903),'','fn:page:2','Page 2'),('p3',(577,867,625,903),'','fn:page:3','Page 3'),('p4',(640,867,688,903),'','fn:page:4','Page 4'),('p5',(701,867,749,903),'','fn:page:5','Page 5'),('nx',(768,867,816,903),'','fn:page:+1','Next page'),
 ('dprev',(1177,440,1225,490),'top','fn:cyc:-1','Previous hero'),('dnext',(1545,440,1593,490),'top','fn:cyc:1','Next hero'),('dfav',(1556,265,1592,298),'top','fn:fav:-1','Favourite'),
 ('dt1',(1176,586,1284,620),'','fn:dtab:0','Stats'),('dt2',(1288,586,1386,620),'','fn:dtab:1','Skills'),('dt3',(1390,586,1490,620),'','fn:dtab:2','Chakra'),('dt4',(1494,586,1594,620),'','fn:dtab:3','Info'),
 ('vl',(1463,795,1597,832),'','fn:listings','View seller listings'),('buy',(1343,852,1508,905),'pu','fn:buy:-1','Buy now'),('off',(1515,852,1600,905),'','fn:offer','Make offer')],
'boss-hunt':[('logo',(25,6,210,98),'','go:home','Home'),('back',(25,118,148,172),'pu','go:home','Back'),
 ('bl0',(50,355,205,422),'act','toast:Akuma · Fallen Shinobi selected','Akuma'),('bl1',(50,429,205,494),'side','fn:locked:Orochi','Orochi (locked)'),('bl2',(50,501,205,566),'side','fn:locked:Raijin','Raijin (locked)'),('bl3',(50,572,205,637),'side','fn:locked:Tsukuyomi','Tsukuyomi (locked)'),('bl4',(50,644,205,709),'side','fn:locked:Kaguya','Kaguya (locked)'),
 ('lb',(800,212,990,244),'sh','toast:Legendary boss – Recommended Power 50,000','Legendary boss'),('boss',(560,440,800,665),'breathe','fn:challenge','Challenge Akuma'),
]+[('rw%d'%i,(x,765,x+90,858),'bob',f'toast:{n}',n) for i,(x,n) in enumerate([(52,'Ryo'),(163,'Legend Fragment'),(274,'Elite Fragment'),(386,'Jutsu Scroll'),(498,'Upgrade Stone'),(610,'Skill Tome'),(722,'Boss Material'),(835,'Chest Key')])]+[
 ('rk',(885,893,980,927),'','fn:ranking','View all rankings'),
]+[('dh%d'%i,(x,454,x+53,527),'tile',f'toast:Deployed hero {i+1}','Deployed hero %d'%(i+1)) for i,x in enumerate([1032,1090,1149,1208,1267])]+[
 ('ad%d'%i,(x,454,x+53,527),'','fn:team','Add hero') for i,x in enumerate([1330,1386,1442])]+[
 ('mt',(1332,547,1494,589),'','fn:team','Manage team'),('ch',(1032,605,1494,668),'pu sh','fn:challenge','Challenge'),('rec',(1016,884,1510,1000),'sh',None,None)],
'guild':[('logo',(25,6,220,100),'','go:home','Home'),
 ('g-home',(27,130,198,182),'act','gcat:guild','Guild Home'),('g-mem',(35,190,195,240),'side','gcat:guild-members','Members'),('g-bat',(35,248,195,298),'side','gcat:guild-battle','Guild Battle'),('g-boss',(35,306,195,356),'side','gcat:guild-boss','Guild Boss'),('g-mis',(35,364,195,414),'side','gcat:guild-missions','Guild Missions'),('g-shop',(35,422,195,472),'side','gcat:guild-shop','Guild Shop'),('g-tech',(35,480,195,530),'side','gcat:guild-tech','Guild Tech'),('g-app',(35,538,195,588),'side','gcat:guild-applications','Applications'),('g-set',(35,596,195,646),'side','gcat:guild-settings','Settings'),
 ('banner',(232,222,460,452),'sway',None,None),('ginfo',(434,480,458,504),'','toast:Guild Lv. 5 · 12,450 / 20,000 EXP','Guild level info'),('mem',(868,283,962,318),'','gcat:guild-members','Members 48/50'),
 ('st1',(492,437,645,505),'sh','toast:Guild Power 15,280','Guild Power'),('st2',(654,437,800,505),'sh','toast:Guild Rank #12','Guild Rank'),('st3',(810,437,955,505),'sh','toast:6 Weekly Wins','Weekly Wins'),
 ('note',(1452,445,1490,478),'','fn:notice','Edit guild notice'),('lbva',(888,538,962,566),'','fn:benefits','View all benefits'),('anva',(1418,538,1496,566),'','fn:announce','View all announcements'),
]+[('ben%d'%i,(x0,572,x1,694),'tile2 sh',f'toast:{n}',n) for i,(x0,x1,n) in enumerate([(222,334,'+10% Guild Shop Discount'),(342,454,'+5% EXP Gain'),(462,574,'+5% Ryo Gain'),(582,694,'+1 Daily Guild Mission'),(706,826,'Unlock Guild Boss (Hard)'),(834,962,'Exclusive Guild Badge')])]+[
 ('tc%d'%i,(42,y,497,y+44),'row',f'toast:{n}',n) for i,(y,n) in enumerate([(756,'KuroSenpai · 12,450'),(801,'YukiChan · 10,320'),(847,'Raizen · 8,910'),(892,'Mizuki · 7,650'),(937,'ShinobiMaster · 7,120')])]+[
 ('qg0',(943,766,1008,800),'pu','go:boss-hunt','Go: Defeat World Boss'),('qg1',(943,818,1008,852),'','gcat:guild-missions','Go: Complete Guild Missions'),('qg2',(943,872,1008,906),'','fn:donate','Go: Donate Ryo'),('qg3',(943,930,1008,966),'','gcat:guild-battle','Go: Participate in Guild Battle'),
 ('qva',(928,724,1012,752),'','gcat:guild-missions','View all quests'),
 ('gbn',(1058,830,1196,868),'','toast:Normal difficulty selected','Normal'),('gbh',(1206,830,1345,868),'','fn:glock:Hard','Hard (locked)'),('gbm',(1355,830,1492,868),'','fn:glock:Nightmare','Nightmare (locked)'),
 ('gbv',(1433,885,1491,918),'','fn:lastresult','View last result'),('gbp',(1058,937,1490,982),'pu sh','gcat:guild-boss','Prepare for battle'),('gbimg',(1150,722,1330,822),'',None,None)],
}
GUILD_CATS={'guild-members':((598,128,1020,386),'Members'),'guild-battle':((1108,128,1528,386),'Guild Battle'),'guild-boss':((90,448,510,698),'Guild Boss'),
 'guild-missions':((600,448,1020,698),'Guild Missions'),'guild-shop':((1110,448,1528,698),'Guild Shop'),'guild-tech':((90,758,510,938),'Guild Tech'),
 'guild-applications':((600,758,1020,938),'Applications'),'guild-settings':((1110,758,1528,938),'Settings')}

# ===== Update pack screens =====
UP=os.environ.get('SB_UPDATE_PACK','/tmp/upd').rstrip('/\\')+'/'
NAMES11=NAMES+['Chat']
ROUTE.update({'Heroes':'heroes','Adventure':'adventure','Dojo':'dojo','Codex':'codex','Chat':'chat'})
SCREENS.update({
'adventure':dict(src=UP+'04_Adventure_Bomber_Maps/references/adventure_ui_user_approved_original.png',W=1536,H=1024,chest=(1115,64,1288,104),ryo=(1092,14,1256,54),
  nav=[(264,299),(338,381),(400,484),(502,555),(592,632),(676,709),(751,794),(828,891),(928,965),(1017,1047)],navy=(0,84)),
'heroes':dict(src=UP+'17_Supplement_Heroes_Collection/references/neon_shinobi_heroes_roster_dashboard.png',W=1536,H=1024,chest=(1038,57,1222,101),ryo=(1020,10,1185,50),
  nav=[(239,275),(299,376),(399,462),(489,544),(573,614),(651,678),(716,758),(787,851),(883,921),(955,986)],navy=(0,90)),
'codex':dict(src=UP+'16_Codex_Knowledge_Hub/references/codex_tab_reference.png',W=1672,H=941,chest=(1242,53,1431,91),ryo=(1224,6,1400,42),
  nav=[(258,302),(338,390),(415,491),(512,574),(600,654),(685,731),(763,823),(851,921),(945,1017),(1047,1093),(1130,1176)],navy=(0,78)),
'chat':dict(src=UP+'15_Chat_System/references/chat_ui_reference.png',W=1672,H=941,chest=(1274,51,1454,90),ryo=(1262,4,1428,42),
  nav=[(263,301),(350,394),(432,499),(530,587),(626,668),(720,751),(804,849),(888,955),(996,1035),(1091,1124),(1170,1228)],navy=(0,80)),
'dojo':dict(src=UP+'09_Dojo/reference.png',W=1774,H=887,chest=(1228,49,1377,84),ryo=(1206,10,1340,44),
  nav=[(218,258),(292,334),(370,420),(456,502),(544,582),(632,672),(710,754),(786,846),(880,926),(966,1010)],navy=(0,68),
  navnames=['Home','Heroes','Adventure','Summon','Dojo','Fusion','Market','Boss Hunt','Codex','Guild']),
})
SCREENS['codex']['navnames']=NAMES11;SCREENS['chat']['navnames']=NAMES11
HS['home']=[h if h[3] not in ('soon:Adventure','soon:Dojo','soon:Heroes','codex') else (h[0],h[1],h[2],{'soon:Adventure':'go:adventure','soon:Dojo':'go:dojo','soon:Heroes':'go:heroes','codex':'go:codex'}[h[3]],h[4]) for h in HS['home']]
HS['home'].append(('chatbar',(529,877,1214,930),'','go:chat','Open global chat'))
HS['boss-hunt']=[h if h[0] not in ('bl1','bl2','lb') else {'bl1':('bl1',h[1],'side','fn:bossinfo:Orochi','Orochi (locked)'),'bl2':('bl2',h[1],'side','fn:bossinfo:Raijin','Raijin (locked)'),'lb':('lb',h[1],'sh','fn:bossinfo:Akuma','Legendary boss profile')}[h[0]] for h in HS['boss-hunt']]
HS['adventure']=[('logo',(20,8,232,110),'','go:home','Home'),
 ('st0',(22,214,262,316),'act','fn:stage:0','Stage 30 Thunderstorm Sky Temple'),('st1',(22,330,262,430),'side','fn:stage:1','Stage 29 Cursed Spirit Graveyard'),('st2',(22,445,262,545),'side','fn:stage:2','Stage 28 Volcanic Fortress'),('st3',(22,560,262,660),'side','fn:stage:3','Stage 27 Crystal Caverns'),('st4',(22,674,262,774),'side','fn:stage:4','Stage 26 Bamboo Forest'),
 ('banner',(292,152,1066,218),'sh',None,None),('diff',(1206,162,1354,214),'','toast:Difficulty: HARD – stronger enemies, bigger rewards','Difficulty'),('sinfo',(1366,164,1506,212),'','fn:stageinfo','Stage info'),
 ('mh',(740,770,926,812),'','go:heroes','Manage heroes'),('wa',(944,770,1100,812),'pu','fn:work','Work all'),('ra',(1114,770,1282,812),'','fn:rest','Rest all'),
]+[('hc%d'%i,(x0,826,x1,980),'tile2 sh','fn:hero:%d'%i,n) for i,(x0,x1,n) in enumerate([(290,486,'Kai'),(496,692,'Sora'),(702,900,'Aki'),(912,1112,'Ren'),(1122,1320,'Yuki')])]+[
 ('add',(1334,826,1504,980),'','go:heroes','Tap to add Shinobi')]
HS['heroes']=[('logo',(15,5,215,92),'','go:home','Home')]+[('tf%d'%i,r,'','fn:tab:%d'%i,n) for i,(r,n) in enumerate([((28,232,132,276),'All'),((146,232,292,276),'Battle-ready'),((304,232,440,276),'Reserve'),((456,232,572,276),'Genin'),((584,232,692,276),'Chunin'),((704,232,808,276),'Jonin'),((820,232,926,276),'Elite'),((940,232,1048,276),'Legend')])]+[
 ('srch',(1066,232,1298,276),'','fn:search','Search heroes'),('flt',(1310,232,1340,276),'','fn:sort','Filter'),('sort',(1350,232,1502,276),'','fn:sort','Sort'),
 ('pp',(1310,288,1338,312),'','fn:page','Previous page'),('pn',(1474,288,1502,312),'','fn:page','Next page')]+[
 ('cd%d'%i,(x0,y0,x1,y1),'card sh','fn:sel:%d'%i,None) for i,(x0,y0,x1,y1) in enumerate([(x,324,x+196,672) for x in (28,240,452,658,864)]+[(x,686,x+196,1004) for x in (28,240,452,658,864)])]+[
 ('dfav',(1470,334,1500,362),'top','fn:fav','Favourite'),('dt0',(1098,686,1192,720),'','fn:dtab:0','Stats'),('dt1',(1196,686,1292,720),'','fn:dtab:1','Skills'),('dt2',(1296,686,1394,720),'','fn:dtab:2','Chakra'),('dt3',(1398,686,1494,720),'','fn:dtab:3','Info'),
 ('dtrain',(1102,838,1490,892),'pu','fn:train:-1','Train'),('dsell',(1102,908,1294,966),'','fn:sell:-1','Sell'),('ddep',(1312,908,1490,966),'','fn:deploy:-1','Deploy')]
HS['codex']=[('logo',(30,6,230,96),'','go:home','Home'),('back',(30,118,160,172),'pu','go:home','Back')]+[
 ('cs%d'%i,(30,y,280,y+50),'act' if i==1 else 'side','fn:sec:%d'%i,n) for i,(y,n) in enumerate([(272,'Basics'),(331,'Perks & Chakra'),(389,'Elements'),(445,'Hero Ranks'),(500,'Battle Tips'),(554,'Boss Guide'),(608,'Rewards'),(662,'FAQ')])]+[
 ('ew%d'%i,(x,268,x+66,358),'bob','fn:elem:%d'%i,n) for i,(x,n) in enumerate([(1244,'Fire'),(1325,'Water'),(1405,'Wind'),(1485,'Shadow'),(1565,'Lightning')])]+[
 ('rk',(1232,484,1638,652),'',None,None),('perks',(322,412,1188,656),'sh',None,None),
 ('ht0',(320,782,604,898),'sh','fn:sec:0','Deploy'),('ht1',(616,782,900,898),'sh','fn:sec:0','Recovery'),('ht2',(912,782,1194,898),'sh','fn:sec:5','Victory')]
HS['chat']=[('logo',(30,6,215,92),'','go:home','Home')]+[('ch%d'%i,(22,y,270,y+52),'act' if i==0 else 'side','fn:chan:%d'%i,n) for i,(y,n) in enumerate([(250,'Global'),(306,'Guild'),(361,'Team'),(415,'Direct Messages'),(470,'Trade'),(525,'System'),(580,'Event'),(636,'Help')])]+[
 ('b0',(310,252,618,334),'sh','toast:Weekend Boost Event – increased drop rates and rewards','Weekend Boost Event'),('b1',(632,252,924,334),'sh','go:guild','Guild War sign-up'),('b2',(938,252,1224,334),'sh','toast:Server maintenance on Jan 27, 03:00 – 05:00 (UTC)','Maintenance notice'),
 ('csel',(1108,196,1224,234),'','fn:chanpick','Pick channel'),('isel',(312,830,432,876),'','fn:chanpick','Pick channel'),('emo',(444,830,490,876),'','fn:emoji','Emoji'),('stk',(500,830,548,876),'','fn:emoji','Stickers'),('att',(558,830,604,876),'','fn:attach','Attach item'),
 ('send',(1110,830,1224,876),'pu','fn:send','Send'),('va',(1570,198,1650,228),'','fn:online','View all online ninjas')]+[
 ('w%d'%i,(1600,y,1648,y+40),'','fn:whisper:%s'%n,'Message '+n) for i,(y,n) in enumerate([(242,'NinjaMaster'),(298,'ShadowKage'),(354,'RyoSenpai'),(410,'KuroFox'),(466,'EmberLeaf')])]+[
 ('gc',(1498,620,1648,668),'pu','fn:chan:1','Guild chat'),('qa0',(1272,756,1460,806),'','fn:party','Create party'),('qa1',(1474,756,1648,806),'','fn:invite','Invite'),('qa2',(1272,822,1460,872),'','fn:whisper:','Whisper'),('qa3',(1474,822,1648,872),'','fn:report','Report')]
HS['dojo']=[('logo',(22,6,170,76),'','go:home','Home'),('bk0',(42,96,122,128),'pu','go:home','Back'),('bk1',(888,96,970,128),'','fn:focus:svc','Back to Dojo Services'),('bk2',(144,612,224,644),'','fn:focus:svc','Back to Dojo Services'),
 ('dcard',(40,228,432,590),'sh',None,None),('scard',(444,228,836,590),'sh breathe',None,None),('enter',(82,534,392,578),'pu','fn:focus:upg','Enter dojo'),('msen',(484,534,796,578),'pu','fn:focus:sen','Manage sensei'),
]+[('tier%d'%i,(1204,y0,1726,y1),'row','fn:tier:%d'%i,'Dojo tier %d'%i) for i,(y0,y1) in enumerate([(140,182),(186,228),(230,274),(278,322),(326,372),(374,420),(422,470)])]+[
 ('upg',(894,480,1180,522),'pu','fn:upgrade','Upgrade dojo'),
 ('sk0',(208,798,266,858),'','fn:skin:0','Original skin'),('sk1',(284,798,342,858),'','fn:skin:1','Shadow skin'),('sk2',(358,798,416,858),'','fn:skin:2','Frost skin'),('sk3',(434,798,492,858),'','fn:skin:3','Flame skin'),
 ('skp',(154,808,190,848),'','fn:skin:-1','Previous skin'),('skn',(508,808,544,848),'','fn:skin:+1','Next skin'),
]+[('rp%d'%i,(x,716,x+70,744),'','fn:ret:%d'%i,'Return at %d%%'%(50+10*i)) for i,x in enumerate([748,828,908,986,1066])]+[
 ('tog',(1080,808,1130,826),'','fn:hire','Auto rotation toggle'),('toff',(1020,836,1144,870),'pu','fn:hire','Turn sensei off')]+[
 ('pr%d'%i,(x,808,x+70,858),'bob','toast:%s heroes rotate in %s'%(n,o),n) for i,(x,n,o) in enumerate([(1204,'Legend','first'),(1296,'Elite','second'),(1382,'Jonin','third'),(1468,'Chunin','fourth'),(1554,'Genin','last')])]

for k,o in {'adventure':46,'heroes':34,'codex':36,'chat':34,'dojo':36}.items():SCREENS[k]['ryoff']=o
