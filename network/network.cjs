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
const on = value => /^(1|on|true|yes)$/i.test(String(value || ''));

/** PRELAUNCH_MODE=on: the site serves only the pre-launch portal; the game API is not mounted. */
const prelaunch = (env = process.env) => on(env.PRELAUNCH_MODE);
// Money settings that must not exist while only the pre-launch portal runs.
const MONEY_SETTINGS = ['RYO_TREASURY_SECRET', 'RYO_TOKEN_MINT', 'RYO_STUDIO_WALLET', 'RYO_REVENUE_WALLET'];
/** The account scope must be fixed before players register, so it survives creating the mint/treasury. */
const scopeOk = (env, net) => new RegExp('^' + net.id + ':[A-Za-z0-9_-]{1,64}$').test(String(env.RYO_SCOPE || ''));
const localOrigin = value => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(String(value || ''));

/** Problems that must stop a server from starting. Empty array = safe to start. */
function startupProblems(env = process.env, dir = __dirname) {
  const problems = [];
  let net; try { net = resolve(env); } catch (e) { return [e.message]; }
  const build = built(dir);
  if (net.key !== build.key) problems.push('This server was built for Solana ' + build.label + ' but SOLANA_NETWORK is "' + net.key + '". Rebuild and deploy (Render: "Clear build cache & deploy").');
  if (prelaunch(env)) {
    if (on(env.STARTER_PACK)) problems.push('STARTER_PACK must be off while PRELAUNCH_MODE is on.');
    const money = MONEY_SETTINGS.filter(k => String(env[k] || '').trim());
    if (money.length) problems.push('PRELAUNCH_MODE=on must not hold money settings (' + money.join(', ') + '). Add them only when the game launches.');
    if (!String(env.DATABASE_URL || '').trim()) problems.push('DATABASE_URL is required to store pre-launch registrations.');
    if (!scopeOk(env, net)) problems.push('RYO_SCOPE must be set and fixed before registrations open, e.g. "' + net.id + ':live".');
    if (!httpsUrl(env.RYO_SITE_ORIGIN) && !(net.key === 'devnet' && localOrigin(env.RYO_SITE_ORIGIN))) problems.push('RYO_SITE_ORIGIN must be this server\'s public https:// origin (wallet sign-in is bound to it).');
    return problems;
  }
  if (net.key === 'mainnet') {
    if (!scopeOk(env, net)) problems.push('RYO_SCOPE must be set on Mainnet (the same value used during pre-launch, e.g. "solana-mainnet:live") so accounts carry over.');
    if (on(env.STARTER_PACK)) problems.push('STARTER_PACK must be off on Mainnet (it grants free Ryo and heroes). Remove it from this service.');
    if (!httpsUrl(env.SOLANA_RPC_URL)) problems.push('SOLANA_RPC_URL (private, server-side Mainnet RPC) must be an https:// URL.');
    if (!httpsUrl(env.SOLANA_PUBLIC_RPC_URL)) problems.push('SOLANA_PUBLIC_RPC_URL (browser Mainnet RPC, domain-restricted key) must be an https:// URL.');
    if (!httpsUrl(env.RYO_SITE_ORIGIN)) problems.push('RYO_SITE_ORIGIN must be set to this server\'s public https:// origin on Mainnet.');
  }
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

module.exports = { NETWORKS, resolve, built, prelaunch, startupProblems, assertStartup, mainnetRules, rewriteText, MAINNET_LEFTOVERS };
