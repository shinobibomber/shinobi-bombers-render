/* Solana network switch for the test (Devnet) and live (Mainnet) servers.
 *
 * SOLANA_NETWORK = devnet (default) | mainnet. Each Render service runs its own build, so the network is
 * baked into app/ at build time by apply-network.cjs, and checked again at start-up: a server whose runtime
 * SOLANA_NETWORK does not match its build refuses to start (rebuild instead of running a mixed client).
 *
 * Copied to app/server/network.cjs; the build stamp sits next to it in network-build.json.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path');

const NETWORKS = Object.freeze({
  devnet: Object.freeze({ key: 'devnet', id: 'solana-devnet', label: 'Devnet', cluster: 'devnet',
    genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', rpc: 'https://api.devnet.solana.com' }),
  mainnet: Object.freeze({ key: 'mainnet', id: 'solana-mainnet', label: 'Mainnet', cluster: '',
    genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', rpc: 'https://api.mainnet-beta.solana.com' }),
});

/** The network named by SOLANA_NETWORK. Unknown values throw; there is no silent fallback. */
function resolve(env = process.env) {
  const raw = String(env.SOLANA_NETWORK || 'devnet').trim().toLowerCase();
  const net = NETWORKS[raw];
  if (!net) throw Error('SOLANA_NETWORK must be "devnet" or "mainnet" (got "' + raw + '").');
  return net;
}

/** The network this app/ was built for (devnet when no stamp exists, e.g. an older build). */
function built(dir = __dirname) {
  try { return NETWORKS[JSON.parse(fs.readFileSync(path.join(dir, 'network-build.json'), 'utf8')).network] || NETWORKS.devnet; }
  catch { return NETWORKS.devnet; }
}

const httpsUrl = value => { try { return new URL(String(value || '')).protocol === 'https:'; } catch { return false; } };
const on = value => /^(1|on|true|yes)$/i.test(String(value || '').trim());   // same reading as the runtime switches

/** PRELAUNCH_MODE=on: the site serves the pre-launch portal as the only public page. */
const prelaunch = (env = process.env) => on(env.PRELAUNCH_MODE);

/* Release stage (RELEASE_STAGE). Deploying never changes it; only an explicit environment change by the owner does.
 *   PRELAUNCH_MODE=on:  "portal"  (default when unset) – portal only, the game is not loaded at all.
 *                       "private" – the game is loaded but every game path is closed to everyone except the
 *                                   wallets in RYO_PRIVATE_TEST_WALLETS (Stage 1, private live testing).
 *   PRELAUNCH_MODE off: "public" must be set explicitly on Mainnet (Stage 3), so removing PRELAUNCH_MODE by
 *                       mistake refuses to start instead of opening the game.
 * Investor early access (Stage 2) is not implemented; it needs a separate, explicit approval.
 * Any other value is reported by startupProblems() and the server does not start (fail closed). */
const STAGES = Object.freeze(['portal', 'private', 'public']);
function releaseStage(env = process.env) {
  const raw = String(env.RELEASE_STAGE ?? '').trim().toLowerCase();
  if (!raw) return prelaunch(env) ? 'portal' : null;
  return STAGES.includes(raw) ? raw : 'invalid';
}
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Wallets allowed into the game during private live testing (comma, space or newline separated). */
function privateTesters(env = process.env) {
  const list = String(env.RYO_PRIVATE_TEST_WALLETS || '').split(/[\s,]+/).filter(Boolean);
  return list.length && list.every(w => WALLET_RE.test(w)) ? new Set(list) : new Set();
}
/** True only when the portal is public and the game is loaded for allowlisted testers. */
const privateTesting = (env = process.env) => prelaunch(env) && releaseStage(env) === 'private';
// Game money settings normally require the complete private-game configuration.
const MONEY_SETTINGS = ['RYO_TREASURY_SECRET', 'RYO_TOKEN_MINT', 'RYO_STUDIO_WALLET', 'RYO_REVENUE_WALLET'];
/** The account scope must be fixed before players register, so it survives creating the mint/treasury. */
const scopeOk = (env, net) => new RegExp('^' + net.id + ':[A-Za-z0-9_-]{1,64}$').test(String(env.RYO_SCOPE || ''));
const localOrigin = value => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(String(value || ''));

/** The committed Chapter 04 public registry of a built app (null when this build has none). */
function treasuryRegistry(dir) {
  const file = path.join(dir, 'treasury-registry.cjs');
  if (!fs.existsSync(file)) return null;
  return require(file).registry();
}
/** Treasury activation locks for a live server (see treasury/ and sr-revenue/). */
function treasuryProblems(env, dir) {
  const problems = [], routing = on(env.SR_REVENUE_ROUTING_ENABLED);
  let reg; try { reg = treasuryRegistry(dir); } catch (e) { return [e.message]; }
  if (!reg) return routing ? ['SR_REVENUE_ROUTING_ENABLED is set but this build has no treasury registry.'] : [];
  const mint = String(env.RYO_TOKEN_MINT || '').trim();
  if (mint && !reg.srMintAddress) problems.push('RYO_TOKEN_MINT is set but the SR mint is still pending in the reviewed treasury registry (treasury/treasury-registry.json). Register the mint through a reviewed commit first.');
  else if (mint && mint !== reg.srMintAddress) problems.push('RYO_TOKEN_MINT does not match the SR mint in the reviewed treasury registry.');
  if (routing && !reg.activation.approved) problems.push('SR_REVENUE_ROUTING_ENABLED requires the committed registry activation approval (activation.approved).');
  return problems;
}

/* Founder boxes and Sensei SOL pay into FOUNDERS_REVENUE_WALLET only. Required when any of those sales is switched on;
 * must be a valid address and, on Mainnet, never a Chapter 04 / custody / Squads address from the reviewed registry. */
function founderRevenueProblems(env, dir, build) {
  const problems = [], addr = String(env.FOUNDERS_REVENUE_WALLET || '').trim();
  const selling = ['FOUNDERS_PUBLIC_SALE_ENABLED', 'FOUNDERS_PRIVATE_TESTING_ENABLED', 'SENSEI_SOL_ENABLED'].some(k => on(env[k]));
  let reg = null; try { const file = path.join(dir, 'treasury-registry.cjs'); if (fs.existsSync(file)) reg = require(file); } catch {}
  // The runtime requires a canonical 32-byte key (new PublicKey(a).toBase58() === a): check the same here when possible.
  const valid = a => WALLET_RE.test(a) && (!reg?.isPublicKey || reg.isPublicKey(a));
  if (addr && !valid(addr)) problems.push('FOUNDERS_REVENUE_WALLET must be a valid Solana wallet address.');
  else if (!addr && selling) problems.push('Founder box / Sensei SOL sales are switched on but FOUNDERS_REVENUE_WALLET (their SOL receipt wallet) is not set.');
  if (addr) {
    let reserved = []; try { if (reg) { reserved = reg.reservedAddresses(); const custody = reg.registry().gameCustody?.address; if (custody) reserved.push(custody); } } catch {}
    if (build.key === 'mainnet' && reserved.includes(addr)) problems.push('FOUNDERS_REVENUE_WALLET must not be a Chapter 04, game custody or Squads address from the treasury registry.');
    if (addr === String(env.RYO_STUDIO_WALLET || '').trim()) problems.push('FOUNDERS_REVENUE_WALLET must not be RYO_STUDIO_WALLET.');
    // Owner decision 2026-11-09: once the game is public, Founder/Sensei SOL and game revenue use different wallets.
    if (!prelaunch(env) && addr === String(env.RYO_REVENUE_WALLET || '').trim()) problems.push('FOUNDERS_REVENUE_WALLET must differ from the game revenue wallet RYO_REVENUE_WALLET once the game is public.');
  }
  return problems;
}

/** Problems that must stop a server from starting. Empty array = safe to start. */
function startupProblems(env = process.env, dir = __dirname) {
  const problems = [];
  let net; try { net = resolve(env); } catch (e) { return [e.message]; }
  const build = built(dir);
  problems.push(...founderRevenueProblems(env, dir, build));
  if (net.key !== build.key) problems.push('This server was built for Solana ' + build.label + ' but SOLANA_NETWORK is "' + net.key + '". Rebuild and deploy (Render: "Clear build cache & deploy").');
  if (prelaunch(env)) {
    if (on(env.SR_REVENUE_ROUTING_ENABLED)) problems.push('SR_REVENUE_ROUTING_ENABLED must be off while PRELAUNCH_MODE is on.');
    if (build.key === 'mainnet') { try { treasuryRegistry(dir); } catch (e) { problems.push(e.message); } }
    if (on(env.STARTER_PACK)) problems.push('STARTER_PACK must be off while PRELAUNCH_MODE is on.');
    const money = MONEY_SETTINGS.filter(k => String(env[k] || '').trim());
    // Founder SOL sales need only a public payment destination and their separate mint key.
    // Keep that receive-only configuration valid when sales are paused. Adding any custody,
    // studio or token setting still invokes the original complete private-game requirements.
    const founderRevenueOnly = money.length === 1 && money[0] === 'RYO_REVENUE_WALLET'
      && WALLET_RE.test(String(env.RYO_REVENUE_WALLET).trim())
      && !!String(env.FOUNDERS_MINT_AUTHORITY_SECRET || '').trim();
    // Owner-approved (2026-11-09): money settings may exist only in private live testing, where every game/money
    // path is closed by the server to all but RYO_PRIVATE_TEST_WALLETS. They must be complete (all or none).
    // The portal-only stage still refuses game custody settings; Founder receipts are the exception above.
    // Mainnet launch gates stay closed unless set explicitly.
    const testers = privateTesters(env).size > 0;
    if (money.length && !founderRevenueOnly && !(releaseStage(env) === 'private' && testers)) problems.push('PRELAUNCH_MODE=on must not hold money settings (' + money.join(', ') + '). Add them only when the game launches, or for private live testing (RELEASE_STAGE=private with RYO_PRIVATE_TEST_WALLETS).');
    else if (money.length && !founderRevenueOnly && money.length !== MONEY_SETTINGS.length) problems.push('Private live testing needs all money settings or none (missing ' + MONEY_SETTINGS.filter(k => !money.includes(k)).join(', ') + ').');
    // The same reviewed treasury-registry locks as a launched Mainnet server (e.g. RYO_TOKEN_MINT must match the registry).
    if (money.length && build.key === 'mainnet') problems.push(...treasuryProblems(env, dir));
    if (!String(env.DATABASE_URL || '').trim()) problems.push('DATABASE_URL is required to store pre-launch registrations.');
    if (!scopeOk(env, net)) problems.push('RYO_SCOPE must be set and fixed before registrations open, e.g. "' + net.id + ':live".');
    if (!httpsUrl(env.RYO_SITE_ORIGIN) && !(net.key === 'devnet' && localOrigin(env.RYO_SITE_ORIGIN))) problems.push('RYO_SITE_ORIGIN must be this server\'s public https:// origin (wallet sign-in is bound to it).');
    const stage = releaseStage(env);
    if (stage !== 'portal' && stage !== 'private') problems.push('RELEASE_STAGE must be "portal" (default) or "private" while PRELAUNCH_MODE is on (got "' + String(env.RELEASE_STAGE).trim() + '"). Investor and public access need a separate, explicit release.');
    if (stage === 'private') {
      const raw = String(env.RYO_PRIVATE_TEST_WALLETS || '').split(/[\s,]+/).filter(Boolean);
      if (!raw.length) problems.push('RELEASE_STAGE=private needs RYO_PRIVATE_TEST_WALLETS (the wallets allowed to test the game).');
      else if (!raw.every(w => WALLET_RE.test(w))) problems.push('RYO_PRIVATE_TEST_WALLETS must list valid Solana wallet addresses only.');
      if (net.key === 'mainnet') {
        if (!httpsUrl(env.SOLANA_RPC_URL)) problems.push('RELEASE_STAGE=private on Mainnet needs SOLANA_RPC_URL (private, server-side RPC) as an https:// URL.');
        if (!httpsUrl(env.SOLANA_PUBLIC_RPC_URL)) problems.push('RELEASE_STAGE=private on Mainnet needs SOLANA_PUBLIC_RPC_URL (browser RPC) as an https:// URL.');
      }
    }
    return problems;
  }
  const stage = releaseStage(env);
  if (stage === 'invalid' || stage === 'portal' || stage === 'private') problems.push('RELEASE_STAGE="' + String(env.RELEASE_STAGE).trim() + '" needs PRELAUNCH_MODE=on (the portal stays the public page). Use RELEASE_STAGE=public only for the approved public release.');
  if (net.key === 'mainnet' && stage !== 'public') problems.push('The Mainnet game is public when PRELAUNCH_MODE is off: set RELEASE_STAGE=public explicitly for the approved public release, or keep PRELAUNCH_MODE=on.');
  if (net.key === 'mainnet') {
    if (!scopeOk(env, net)) problems.push('RYO_SCOPE must be set on Mainnet (the same value used during pre-launch, e.g. "solana-mainnet:live") so accounts carry over.');
    if (on(env.STARTER_PACK)) problems.push('STARTER_PACK must be off on Mainnet (it grants free Ryo and heroes). Remove it from this service.');
    if (!httpsUrl(env.SOLANA_RPC_URL)) problems.push('SOLANA_RPC_URL (private, server-side Mainnet RPC) must be an https:// URL.');
    if (!httpsUrl(env.SOLANA_PUBLIC_RPC_URL)) problems.push('SOLANA_PUBLIC_RPC_URL (browser Mainnet RPC, domain-restricted key) must be an https:// URL.');
    if (!httpsUrl(env.RYO_SITE_ORIGIN)) problems.push('RYO_SITE_ORIGIN must be set to this server\'s public https:// origin on Mainnet.');
    problems.push(...treasuryProblems(env, dir));
  } else if (on(env.SR_REVENUE_ROUTING_ENABLED)) problems.push('SR_REVENUE_ROUTING_ENABLED applies only to the live Mainnet server.');
  return problems;
}

/** Throws one error listing every problem. Call before accepting requests. */
function assertStartup(env = process.env, dir = __dirname) {
  const problems = startupProblems(env, dir);
  if (problems.length) throw Error('Refusing to start:\n - ' + problems.join('\n - '));
  return built(dir);
}

/* Build-time text rules for a Mainnet build. Order matters: specific code first, wording last.
 * `only` limits a rule to file names matching it (the inlined Solana SDK in index.html keeps its own
 * double-quoted cluster URL table, so the JSON-only rule never touches it). */
function mainnetRules(env = process.env) {
  const symbol = String(env.RYO_TOKEN_SYMBOL || 'RYO').trim();
  if (!/^[A-Za-z0-9]{2,10}$/.test(symbol)) throw Error('RYO_TOKEN_SYMBOL must be 2-10 letters or digits.');
  const m = NETWORKS.mainnet;
  return [
    [NETWORKS.devnet.genesis, m.genesis],
    ['solana-devnet', m.id],
    ["process.env.SOLANA_DEVNET_RPC_URL||'https://api.devnet.solana.com'", 'process.env.SOLANA_RPC_URL'],
    ["rpcUrl:'https://api.devnet.solana.com/'", 'rpcUrl:process.env.SOLANA_PUBLIC_RPC_URL'],
    ["'https://api.devnet.solana.com'", "'" + m.rpc + "'"],
    ['"https://api.devnet.solana.com"', '"' + m.rpc + '"', /\.json$/],
    ["+'?cluster=devnet'", ''],
    ['SOLANA DEVNET \\xB7 TEST TOKENS', 'SOLANA MAINNET'],
    ['SOLANA DEVNET · BETA', 'SOLANA MAINNET'],
    ['Solana Devnet beta · Test tokens only.', 'Solana Mainnet.'],
    ['Solana Devnet beta', 'Solana Mainnet'],
    ['Enable Devnet in your wallet', 'Make sure your wallet is on Mainnet'],
    ['DEVNET SOL', 'SOL'],
    ['Devnet SOL', 'SOL'],
    ['tBRYO', symbol],
    ['Devnet', 'Mainnet'],
    ['DEVNET', 'MAINNET'],
  ];
}

/** Anything left that would still point a Mainnet build at Devnet or test tokens. */
const MAINNET_LEFTOVERS = /Devnet|DEVNET|EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG|solana-devnet|cluster=devnet|'https:\/\/api\.devnet\.solana\.com|tBRYO|TEST TOKENS|Test tokens only/;

function rewriteText(text, file, rules) {
  for (const [before, after, only] of rules) if (!only || only.test(file)) text = text.split(before).join(after);
  return text;
}

module.exports = { NETWORKS, resolve, built, prelaunch, releaseStage, privateTesters, privateTesting, startupProblems, assertStartup, mainnetRules, rewriteText, MAINNET_LEFTOVERS };
