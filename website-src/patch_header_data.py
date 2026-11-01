"""Adds the integration header controls to an already-built website/index.html (no image regeneration).
Usage: python3 website-src/patch_header_data.py [website_dir]"""
import json,re,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from header_controls import header_extras
site=sys.argv[1] if len(sys.argv)>1 else os.path.join(os.path.dirname(__file__),'..','website')
p=os.path.join(site,'index.html');h=open(p,encoding='utf-8').read()
m=re.search(r'(<script type="application/json" id="sbdata">)(.*?)(</script>)',h,re.S);D=json.loads(m.group(2))
for k,v in D.items():
    if not isinstance(v,dict) or 'hs' not in v:continue
    hs,txt=header_extras(k,os.path.join(site,v['img']))
    v['hs']=[x for x in v['hs'] if x['id'] not in ('wallet','ryoplus')]+hs;v['hdr']=txt
h=h[:m.start(2)]+json.dumps(D,separators=(',',':'))+h[m.end(2):]
open(p,'w',encoding='utf-8').write(h);print('header controls added to',sum(1 for v in D.values() if isinstance(v,dict) and 'hdr' in v),'screens')
