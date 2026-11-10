'use strict';
/* Support tool: attribute players who signed up through a mistyped referral link to the right referrer (owner request 2026-11-10:
 * players used ".../?referral=RP009D06A47C922627AA2AMythic" instead of ".../?referral=RP009D06A47C922627AA2A").
 *
 * What the system did with that link: the exact code "...AA2AMYTHIC" belongs to nobody, so the sign-up was refused attribution
 * ("That referral link is unavailable") and the code was forgotten. No row anywhere says which wallets used it, so they cannot be
 * found automatically: this tool lists the sign-ups with no referrer (to pick from) and attributes the ones you name to the real code.
 * (New sign-ups through such a link are now fixed by the server itself: a code that is a real code plus trailing characters is
 * resolved to the real code.)
 *
 * It calls the game's own attribute() for every wallet, so every normal rule still applies: new players only (no order, spend or
 * Adventure progress yet), no self-referral, no creator wallets, no circular chains, existing attribution is permanent. Players
 * who are already blocked are reported with the reason and left untouched. Default is a DRY RUN that only reads.
 *     node tools/fix-referral-attribution.cjs --list --code RP009D06A47C922627AA2A     (sign-ups after his link existed; shows who can still be attributed)
 *     node tools/fix-referral-attribution.cjs --list [--since 2026-11-09T00:00:00Z]
 *     node tools/fix-referral-attribution.cjs --code RP009D06A47C922627AA2A --username Alice --wallet <wallet> [--username Bob ...]
 *     node tools/fix-referral-attribution.cjs --code RP009D06A47C922627AA2A --username Alice ... --reason "Mistyped link" --apply
 * Run it where the game's database settings already exist (the Render Shell of the live service). It prints usernames, shortened
 * wallets and statuses only, never settings or secrets. */
const path = require('node:path');
const SERVER = path.join(__dirname, '../app/server');
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, short = w => w.slice(0, 4) + '…' + w.slice(-4);
const ACTOR = 'support-tool', ACTION = 'support.referral-attribution';

/** The real code from what the owner typed: a full link, a code, or a code with a typo suffix. */
function codeOf(input) {
  const raw = String(input || '').trim(), m = /(?:[?&]referral=|^)(RP[0-9A-F]{20})/i.exec(raw);
  return m ? m[1].toUpperCase() : null;
}
const args = argv => { const all = n => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : [])).filter(Boolean), one = n => all(n)[0];
  return { code: one('--code'), usernames: all('--username'), wallets: all('--wallet'), since: one('--since'), reason: one('--reason'), list: argv.includes('--list'), apply: argv.includes('--apply') }; };

/** Read-only: registered players with no referrer of any kind, newest first (the candidates for a mistyped-link sign-up). */
async function unreferred(store, since = 0) {
  return (await store.pool.query(`SELECT p.wallet,p.username,p.created FROM ryo_players p WHERE p.scope=$1 AND p.created>=$2
    AND NOT EXISTS(SELECT 1 FROM ryo_player_referrals r WHERE r.scope=p.scope AND r.wallet=p.wallet)
    AND NOT EXISTS(SELECT 1 FROM ryo_creator_referrals r WHERE r.scope=p.scope AND r.wallet=p.wallet) ORDER BY p.created DESC LIMIT 200`, [store.scope, since])).rows
    .map(r => ({ wallet: r.wallet, username: r.username, created: Number(r.created) }));
}
async function resolve(store, { usernames = [], wallets = [] }) {
  const out = [];
  for (const u of usernames) { const r = (await store.pool.query('SELECT wallet,username FROM ryo_players WHERE scope=$1 AND username_key=$2', [store.scope, String(u).toLowerCase()])).rows[0];
    out.push(r ? { wallet: r.wallet, username: r.username, how: 'username' } : { error: 'No registered player with the username "' + u + '".' }); }
  for (const w of wallets) { if (!WALLET_RE.test(w)) { out.push({ error: 'Not a wallet address: ' + String(w).slice(0, 12) }); continue; }
    const r = (await store.pool.query('SELECT username FROM ryo_players WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows[0]; out.push({ wallet: w, username: r?.username || null, how: 'wallet' }); }
  return out;
}
/** Current state of one wallet: any referrer, and whether the game's "new player" rule still holds. */
async function status(store, wallet, code) {
  const one = async (sql, a = []) => (await store.pool.query(sql, [store.scope, wallet, ...a])).rows[0];
  const player = await one('SELECT referrer FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2'), creator = await one('SELECT creator_id FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2');
  const target = (await store.pool.query('SELECT wallet FROM ryo_player_referrers WHERE scope=$1 AND code=$2', [store.scope, code])).rows[0];
  const used = await one(`SELECT EXISTS(SELECT 1 FROM ryo_purchases WHERE scope=$1 AND wallet=$2) OR EXISTS(SELECT 1 FROM ryo_spends WHERE scope=$1 AND wallet=$2)
    OR EXISTS(SELECT 1 FROM ryo_adventures WHERE scope=$1 AND wallet=$2 AND (COALESCE((data->>'kills')::numeric,0)>0 OR COALESCE((data->>'pending')::numeric,0)>0)) AS used`);
  if (!target) return { state: 'blocked', why: 'The code ' + code + ' belongs to nobody.' };
  if (player) return { state: player.referrer === target.wallet ? 'done' : 'blocked', why: player.referrer === target.wallet ? 'Already attributed to this referrer.' : 'Already attributed to another referrer (permanent).' };
  if (creator) return { state: 'blocked', why: 'Already attributed to a creator (permanent).' };
  if (used.used) return { state: 'blocked', why: 'Already has an order, spend or Adventure progress: the game only attributes new players.' };
  return { state: 'ready', why: 'Can be attributed.' };
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!process.env.DATABASE_URL || !process.env.RYO_SCOPE) { console.error('Run this where the game database settings are configured (DATABASE_URL and RYO_SCOPE).'); process.exitCode = 2; return; }
  const { Pool } = require(require.resolve('pg', { paths: [SERVER] })), { Store } = require(path.join(SERVER, 'store.cjs'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, statement_timeout: 15000 }), store = new Store(pool, process.env.RYO_SCOPE);
  try {
    console.log('Scope ' + store.scope);
    if (a.list) {
      let since = a.since ? Date.parse(a.since) : 0; if (a.since && !Number.isFinite(since)) { console.error('--since needs an ISO time.'); process.exitCode = 2; return; }
      // With --code, only sign-ups made after that referrer's link existed can have used it; each is checked against the game's rules.
      const code = a.code ? codeOf(a.code) : null;
      if (a.code && !code) { console.error('--code needs a referral code or link.'); process.exitCode = 2; return; }
      if (code) { const r = (await store.pool.query('SELECT wallet,created FROM ryo_player_referrers WHERE scope=$1 AND code=$2', [store.scope, code])).rows[0];
        if (!r) { console.error('The code ' + code + ' belongs to nobody.'); process.exitCode = 2; return; } since = Math.max(since || 0, Number(r.created)); console.log('Referrer ' + short(r.wallet) + ' got the code on ' + new Date(Number(r.created)).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'); }
      const list = await unreferred(store, since || 0);
      console.log('Registered players with no referrer' + (since ? ' since ' + new Date(since).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '') + ': ' + list.length + (list.length >= 200 ? ' (newest 200 shown)' : ''));
      console.log('  registered (UTC)  username            wallet      ' + (code ? 'can be attributed?' : ''));
      for (const r of list) console.log('  ' + new Date(r.created).toISOString().slice(0, 16).replace('T', ' ') + '  ' + (r.username || '(no username)').padEnd(18) + short(r.wallet) + (code ? '  ' + (await status(store, r.wallet, code)).state.toUpperCase() : ''));
      if (code) console.log('\nShow these usernames to the referrer; then attribute the ones he recognises:\n  node tools/fix-referral-attribution.cjs --code ' + code + ' --username <name> [--username <name> ...] --reason "Mistyped link" --apply');
      return; }
    const code = codeOf(a.code);
    if (!code) { console.error('Usage: --list [--since <ISO>]   or   --code <code or link> (--username <name> | --wallet <wallet>)... [--reason "<why>" --apply]'); process.exitCode = 2; return; }
    const targets = await resolve(store, a);
    if (!targets.length) { console.error('Name the players to attribute with --username or --wallet (use --list to find them).'); process.exitCode = 2; return; }
    const owner = (await store.pool.query('SELECT wallet FROM ryo_player_referrers WHERE scope=$1 AND code=$2', [store.scope, code])).rows[0];
    console.log('Target code ' + code + (owner ? ' (referrer ' + short(owner.wallet) + ')' : ' — NOT FOUND'));
    const plan = [];
    for (const t of targets) { if (t.error) { console.log('  ! ' + t.error); continue; } const s = await status(store, t.wallet, code); plan.push({ ...t, ...s });
      console.log('  ' + (t.username || '(no username)').padEnd(18) + short(t.wallet) + '  ' + s.state.toUpperCase() + '  ' + s.why); }
    if (!a.apply) { console.log('\nDry run: nothing changed. Add --reason "<why>" --apply to attribute the READY players.'); return; }
    if (typeof a.reason !== 'string' || a.reason.trim().length < 8 || a.reason.length > 300) { console.error('Give a reason of 8-300 characters (--reason).'); process.exitCode = 2; return; }
    const cp = require(path.join(SERVER, 'creators-portal.cjs')), dashboard = require(path.join(SERVER, 'economic-dashboard.cjs'));
    let done = 0;
    for (const t of plan.filter(x => x.state === 'ready')) {
      try {
        await cp.attribute(store, t.wallet, { code });   // the game's own function: every rule applies again inside its transaction
        await store.transaction(async c => { await dashboard.control(store, c, true); await dashboard.audit(store, c, ACTOR, ACTION, { wallet: t.wallet, code, reason: a.reason.trim() }); });
        console.log('  attributed ' + short(t.wallet)); done++;
      } catch (e) { console.log('  NOT attributed ' + short(t.wallet) + ': ' + e.message); }
    }
    console.log('\nAttributed ' + done + ' of ' + plan.filter(x => x.state === 'ready').length + ' ready player(s).');
  } catch (e) { console.error('Failed: ' + e.message); process.exitCode = 1; }
  finally { await pool.end(); }
}
module.exports = { codeOf, unreferred, resolve, status, ACTION };
if (require.main === module) main();
