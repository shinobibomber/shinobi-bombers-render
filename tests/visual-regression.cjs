#!/usr/bin/env node
/* Visual regression for the website: renders every screen (desktop 1672×941 + phone 390×844) from a git ref and from
 * the working tree, in preview mode with seeded randomness and frozen animations, and compares pixels.
 * Usage: node tests/visual-regression.cjs [ref=HEAD] [maxPercent=0]   e.g. compare uncommitted edits with HEAD,
 *        or a branch/commit with the design you approved.
 * Output: tests/out/visual/<ref|current>/*.png and tools/out/visual/diff-*.png for any changed screen. */
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright'), path = require('node:path'), fs = require('node:fs'), os = require('node:os'), { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..'), ref = process.argv[2] || 'HEAD', max = Number(process.argv[3] || 0);
const OUT = path.join(ROOT, 'tests', 'out', 'visual');
const ROUTES = ['home', 'summon', 'fusion', 'market', 'boss-hunt', 'guild', 'guild-shop', 'adventure', 'heroes', 'codex', 'chat', 'dojo'];
const SEED = `(()=>{const T0=1793500000000;Date.now=()=>T0;let a=1234567;Math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}})()`;
const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important}.petals,.fx,.afx{display:none!important}';

async function capture(browser, siteDir, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const [vp, w, h] of [['desktop', 1672, 941], ['mobile', 390, 844]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); await p.addInitScript(SEED);
    // always preview mode, so the comparison is about design, not about whether a game URL is configured
    await p.route(/site-config\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: 'window.SB_SITE_CONFIG={gameUrl:""};' }));
    for (const r of ROUTES) {
      // A hash-only navigation retains the previous screen's pending demo timers.
      // Start a fresh document so Adventure rewards cannot alter the next capture.
      await p.goto('about:blank');
      await p.goto(pathToFileURL(path.join(siteDir, 'index.html')).href + '#' + r);
      await p.evaluate(() => { try { window.SB.store.set({ adventure: 379840, spendable: 884250 }); } catch {} });
      await p.addStyleTag({ content: FREEZE }); await p.waitForTimeout(600);
      await p.screenshot({ path: path.join(dest, `${vp}-${r}.png`) });
    }
    await p.close();
  }
}

(async () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-vr-'));  // separate git worktree of the reference commit
  execFileSync('git', ['worktree', 'add', '--detach', '-f', wt, ref], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch(); let bad = 0;
  try {
    const A = path.join(OUT, ref.replace(/[^\w.-]/g, '_')), B = path.join(OUT, 'current');
    await capture(browser, path.join(wt, 'website'), A); await capture(browser, path.join(ROOT, 'website'), B);
    const p = await browser.newPage();
    for (const f of fs.readdirSync(A).filter(x => x.endsWith('.png'))) {
      const a = fs.readFileSync(path.join(A, f)).toString('base64'), b = fs.readFileSync(path.join(B, f)).toString('base64');
      const r = await p.evaluate(async ([a, b]) => {
        const load = s => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
        const [x, y] = await Promise.all([load(a), load(b)]); if (x.width !== y.width || x.height !== y.height) return { size: true };
        const c = document.createElement('canvas'); c.width = x.width; c.height = x.height; const g = c.getContext('2d');
        g.drawImage(x, 0, 0); const dx = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(y, 0, 0); const img = g.getImageData(0, 0, c.width, c.height), dy = img.data;
        let n = 0; for (let i = 0; i < dx.length; i += 4) { const d = Math.max(Math.abs(dx[i] - dy[i]), Math.abs(dx[i + 1] - dy[i + 1]), Math.abs(dx[i + 2] - dy[i + 2])); if (d > 24) { n++; dy[i] = 255; dy[i + 1] = 0; dy[i + 2] = 255; } }
        g.putImageData(img, 0, 0); return { pct: 100 * n / (c.width * c.height), diff: n ? c.toDataURL('image/png').split(',')[1] : null };
      }, [a, b]);
      const changed = r.size || r.pct > max; bad += changed;
      if (r.diff && changed) fs.writeFileSync(path.join(OUT, 'diff-' + f), Buffer.from(r.diff, 'base64'));
      console.log(`${f.padEnd(26)} ${r.size ? 'SIZE CHANGED' : r.pct.toFixed(4) + '% pixels differ'}  ${changed ? 'CHANGED' : 'OK'}`);
    }
  } finally { await browser.close(); execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'ignore' }); }
  console.log(`\n${bad} screen(s) changed vs ${ref} (threshold ${max}%).`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
