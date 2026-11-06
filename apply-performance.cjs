/* Phone-friendly delivery (last build step).
 * 1. The large PNG artworks become WebP. Sprite sheets the game crops pixel by pixel are lossless
 *    (identical pixels); menu and reference screenshots are high quality (q88). Every static and
 *    runtime-built reference is rewritten, and the build fails if a converted PNG is still referenced.
 * 2. The game's file server answers repeat visits with 304 Not Modified (content-hash ETag), so a
 *    returning phone downloads only what changed, even across deploys. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const LOSSLESS = ['design-v3/players-core', 'design-v3/players-extra', 'design-v3/enemies', 'design-v3/bosses', 'design-v3/terrain',
  'design-v3/ref-players', 'design-v3/ref-enemies', 'design-v3/ref-maps', 'adventure-design/map', 'combat-models/BossModel', 'combat-models/EnemyModel',
  'player-models/playermodel', 'character-animations/animationset1', 'character-animations/animationset2', 'character-animations/animationset3',
  'character-animations/animationset4', 'reveal-design/reveal-design'];
const QUALITY = ['design-v3/village', 'design-v3/academy', ...['login', 'home', 'heroes', 'summon', 'fusion', 'dojo', 'upgrades', 'sensei', 'adventure'].map(n => 'design-v3/ref-' + n),
  'login-exact/login-reference', 'dojo-design/dojo-menu', 'dojo-design/sensei-tab', 'dojo-design/dojo-list-upgrades', 'heroes-design/heroes-menu',
  'shrine-fusion-design/summoning-shrine', 'shrine-fusion-design/fusion-menu', 'adventure-design/adventure-mode', 'chest-ui/reference'];
// URLs the game builds at runtime from a name; every name they can produce is converted above.
const DYNAMIC = [["'assets/design-v3/'+v+'.png'", "'assets/design-v3/'+v+'.webp'"], ["'assets/design-v3/ref-'+n+'.png'", "'assets/design-v3/ref-'+n+'.webp'"],
  ["new URL(name+'.png',root)", "new URL(name+'.webp',root)"], ["file = 'animationset' + index + '.png'", "file = 'animationset' + index + '.webp'"]];
// Any other runtime-built ".png" URL would 404 once its PNG is deleted, so the build stops on it.
const BUILT_PNG = /\+\s*['"`]\.png|\$\{[^}]+\}[^'"`\s]{0,20}\.png/;
const CACHE = path.join(__dirname, 'node_modules/.cache/shinobi-webp');

function textFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...textFiles(full)); else if (/\.(html|js|css|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const reference = name => new RegExp('(^|[/\'"(`])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.png', 'g');

async function convert(source, target, lossless) {
  const options = lossless ? { lossless: true, effort: 4 } : { quality: 88, effort: 4, smartSubsample: true };
  const bytes = fs.readFileSync(source), key = crypto.createHash('sha256').update(bytes).update(JSON.stringify(options)).digest('hex');
  const cached = path.join(CACHE, key + '.webp');
  if (!fs.existsSync(cached)) { fs.mkdirSync(CACHE, { recursive: true }); await require('sharp')(bytes).webp(options).toFile(cached + '.tmp'); fs.renameSync(cached + '.tmp', cached); }
  fs.copyFileSync(cached, target);
}

async function applyPerformance(appDir = path.join(__dirname, 'app')) {
  const assets = path.join(appDir, 'public/assets'), files = textFiles(path.join(appDir, 'public'));
  const jobs = [...LOSSLESS.map(name => [name, true]), ...QUALITY.map(name => [name, false])];
  let before = 0, after = 0, converted = 0;
  for (const [name, lossless] of jobs) {
    const png = path.join(assets, name + '.png'), webp = path.join(assets, name + '.webp');
    if (!fs.existsSync(png)) { if (fs.existsSync(webp)) continue; throw Error('Asset optimizer: missing ' + name + '.png'); }
    before += fs.statSync(png).size; await convert(png, webp, lossless); after += fs.statSync(webp).size; converted++;
  }
  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8'); const original = text;
    for (const [from, to] of DYNAMIC) text = text.split(from).join(to);
    for (const [name] of jobs) text = text.replace(reference(path.basename(name)), (_, lead) => lead + path.basename(name) + '.webp');
    if (text !== original) fs.writeFileSync(file, text);
  }
  // Nothing may still ask for a converted PNG, and each runtime builder must have been rewritten.
  const html = fs.readFileSync(path.join(appDir, 'public/index.html'), 'utf8') + files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  for (const [name] of jobs) if (reference(path.basename(name)).test(html)) throw Error('Asset optimizer: ' + name + '.png is still referenced');
  for (const [from, to] of DYNAMIC) if (html.includes(from) || !html.includes(to)) throw Error('Asset optimizer: runtime image URL not rewritten: ' + from);
  for (const file of files) { const found = fs.readFileSync(file, 'utf8').match(BUILT_PNG); if (found) throw Error('Asset optimizer: runtime-built PNG URL in ' + path.relative(appDir, file) + ': ' + found[0]); }
  for (const [name] of jobs) fs.rmSync(path.join(assets, name + '.png'), { force: true });
  patchFileServer(appDir);
  if (converted) console.log(`Phone-friendly assets: ${converted} images ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB WebP; repeat visits use 304 Not Modified.`);
}

// Content-hash ETag + Last-Modified, and 304 when the browser already has the file. Cache-Control
// stays no-cache, so every visit still checks and a deploy is picked up immediately.
const serveBefore = "res.writeHead(200,{'Content-Type':type+(/^(text\\/|application\\/json)/.test(type)?'; charset=utf-8':''),'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});";
const serveAfter = "const tag=await require('./file-etag.cjs')(target),fresh=req.headers['if-none-match']===tag.etag||(!req.headers['if-none-match']&&req.headers['if-modified-since']===tag.modified);" +
  "if(fresh){res.writeHead(304,{ETag:tag.etag,'Last-Modified':tag.modified,'Cache-Control':'no-cache'});return res.end()}" +
  "res.writeHead(200,{'Content-Type':type+(/^(text\\/|application\\/json)/.test(type)?'; charset=utf-8':''),'Cache-Control':'no-cache',ETag:tag.etag,'Last-Modified':tag.modified,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});";
const ETAG_MODULE = `/* Content-hash ETags for static files, memoized per file version (size + mtime). */
const fs=require('node:fs'),crypto=require('node:crypto'),known=new Map();
module.exports=async function fileTag(file){
 const info=await fs.promises.stat(file),key=file+':'+info.size+':'+info.mtimeMs,hit=known.get(file);
 if(hit&&hit.key===key)return hit;
 const hash=crypto.createHash('sha256');await new Promise((resolve,reject)=>fs.createReadStream(file).on('data',d=>hash.update(d)).on('end',resolve).on('error',reject));
 const tag={key,etag:'"'+hash.digest('base64url').slice(0,27)+'"',modified:new Date(Math.floor(info.mtimeMs/1000)*1000).toUTCString()};known.set(file,tag);return tag;
};
`;
function patchFileServer(appDir) {
  const file = path.join(appDir, 'server/render-server.cjs'); let text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(path.join(appDir, 'server/file-etag.cjs'), ETAG_MODULE);
  if (text.includes(serveAfter)) return;
  if (text.split(serveBefore).length !== 2) throw Error('Asset optimizer: game file server changed');
  fs.writeFileSync(file, text.replace(serveBefore, () => serveAfter));
}
// Undo the reference rewrites in a text (tests/preservation.cjs compares the original inline modules).
function restoreReferences(text) {
  for (const [from, to] of DYNAMIC) text = text.split(to).join(from);
  for (const name of [...LOSSLESS, ...QUALITY]) { const base = path.basename(name); text = text.replace(new RegExp('(^|[/\'"(`])' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.webp', 'g'), (_, lead) => lead + base + '.png'); }
  return text;
}
module.exports = { applyPerformance, restoreReferences, LOSSLESS, QUALITY };
if (require.main === module) applyPerformance().catch(error => { console.error(error); process.exitCode = 1; });
