"""Writes website/data.json (produced by build.py) into website/index.html's embedded data block.
Usage: python3 website-src/assemble.py   (then delete website/data.json)"""
import os,re,json
site=os.environ.get('SB_SITE_OUT',os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','website'))
d=open(os.path.join(site,'data.json'),encoding='utf-8').read();json.loads(d)
p=os.path.join(site,'index.html');h=open(p,encoding='utf-8').read()
m=re.search(r'(<script type="application/json" id="sbdata">)(.*?)(</script>)',h,re.S)
open(p,'w',encoding='utf-8').write(h[:m.start(2)]+d+h[m.end(2):]);os.remove(os.path.join(site,'data.json'));print('index.html data updated')
