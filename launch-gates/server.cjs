/* Launch gates: independent server-side switches for the game's paying features.
 *
 *   SUMMONING_ENABLED        purchase of Shrine summons
 *   MARKETPLACE_ENABLED      market-post / market-buy / market-offer / market-accept
 *   REWARD_CLAIMS_ENABLED    claim-adventure, creator-player-claim (referral heroes), creator-redeem
 *   SOL_DEPOSITS_ENABLED     deposit (Ryo token deposits) and box-mint (Mythic Box SOL payment)
 *   SOL_WITHDRAWALS_ENABLED  withdraw
 *   BOSS_HUNT_ENABLED        hunt-enter (Boss Hunt entry; closed on live until the owner configures it, 2026-11-09)
 *
 * Defaults: on for a devnet (test server) build, so it behaves exactly as before; OFF for a mainnet (live) build.
 * Turning the game on never turns money features on by itself. Browsing, cancelling, recovery and
 * confirmations of already-sent transactions (box-confirm, ack-*) are never blocked.
 * Copied to app/server/launch-gates.cjs by apply-launch-gates.cjs.
 */
'use strict';
const GATES = Object.freeze({
  summoning: 'SUMMONING_ENABLED', marketplace: 'MARKETPLACE_ENABLED', rewardClaims: 'REWARD_CLAIMS_ENABLED',
  solDeposits: 'SOL_DEPOSITS_ENABLED', solWithdrawals: 'SOL_WITHDRAWALS_ENABLED', bossHunt: 'BOSS_HUNT_ENABLED',
});
const MESSAGES = Object.freeze({
  summoning: 'Hero summoning opens at the official launch.', marketplace: 'The Market opens at the official launch.',
  rewardClaims: 'Reward claims open at the official launch.', solDeposits: 'Deposits are not open yet.',
  solWithdrawals: 'Withdrawals are not open yet.', bossHunt: 'Boss Hunt opens soon.',
});

function defaultOn() {
  try { return require('./network.cjs').built(__dirname).key !== 'mainnet'; } catch { return true; }
}
function isOn(gate, env = process.env) {
  const raw = String(env[GATES[gate]] ?? '').trim();
  if (/^(1|on|true|yes)$/i.test(raw)) return true;
  if (/^(0|off|false|no)$/i.test(raw)) return false;
  return defaultOn();
}
function gateFor(action, body = {}) {
  if (action === 'purchase' && body && body.product === 'summon') return 'summoning';
  if (action === 'purchase' && body && body.product === 'hunt') return 'bossHunt';
  if (['market-post', 'market-buy', 'market-offer', 'market-accept'].includes(action)) return 'marketplace';
  if (['claim-adventure', 'creator-player-claim', 'creator-redeem'].includes(action)) return 'rewardClaims';
  if (['deposit', 'box-mint'].includes(action)) return 'solDeposits';
  if (action === 'withdraw') return 'solWithdrawals';
  if (action === 'hunt-enter') return 'bossHunt';
  return null;
}
/** Throws 403 with code LAUNCH_GATE_CLOSED when the action's gate is off. */
function check(action, body, env = process.env) {
  require('./live-economy.cjs').assertPurchase(action, body);
  const gate = gateFor(action, body);
  if (gate && !isOn(gate, env)) throw Object.assign(Error(MESSAGES[gate]), { status: 403, code: 'LAUNCH_GATE_CLOSED', gate });
  // The Market pays the studio and revenue wallets, which are optional on the live build: refuse it until both exist.
  if (gate === 'marketplace' && !require('./live-economy.cjs').marketConfigured(env)) throw Object.assign(Error('The Market is not configured yet.'), { status: 503, code: 'LAUNCH_GATE_CLOSED', gate });
}
/** Public on/off map, returned in the `config` action so the client can refuse before signing. */
function publicGates(env = process.env) {
  return Object.fromEntries(Object.keys(GATES).map(g => [g, isOn(g, env) && (g !== 'marketplace' || require('./live-economy.cjs').marketConfigured(env))]));
}
/* SR_REVENUE_ROUTING_ENABLED: one of four independent locks on live SR service routing (with the Mainnet build
 * stamp, the committed registry activation approval and the two-person DB configuration). Strictly opt-in on
 * every build: unset means OFF, and it is refused at start-up while PRELAUNCH_MODE is on. */
function srRoutingEnabled(env = process.env) { return /^(1|on|true|yes)$/i.test(String(env.SR_REVENUE_ROUTING_ENABLED ?? '').trim()); }
module.exports = { GATES, gateFor, isOn, check, publicGates, srRoutingEnabled };
