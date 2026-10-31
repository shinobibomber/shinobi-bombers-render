import { useMemo, useState, type CSSProperties } from 'react';
import type { FeatureProps } from './feature-contract';
import { FeatureIcon } from './FeatureIcon';
import '../feature-content.css';
export type { FeatureSnapshot, FeatureRules } from './feature-contract';

const categories = [
  ['basics', 'Basics', 'book'], ['perks', 'Perks & Chakra', 'chakra'], ['elements', 'Elements', 'flame'], ['ranks', 'Hero Ranks', 'star'],
  ['battle', 'Battle Tips', 'blades'], ['bosses', 'Boss Guide', 'boss'], ['rewards', 'Rewards', 'chest'], ['faq', 'FAQ', 'help'],
] as const;
type Category = typeof categories[number][0];
const elementColors = ['#ff7051', '#cb72ff', '#5bc9ff', '#e6ad78', '#a5e9ff', '#69edab', '#ffdb65', '#e38dff'];
const fmt = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—';

export function KnowledgeHub({ snapshot, navigate, openChest }: FeatureProps) {
  const [category, setCategory] = useState<Category>('perks');
  const [query, setQuery] = useState('');
  const [perkSort, setPerkSort] = useState('default');
  const [element, setElement] = useState(0);
  const [rank, setRank] = useState(0);
  const rules = snapshot.rules;
  const selectedCategory = categories.find(item => item[0] === category)!;
  const search = query.trim().toLocaleLowerCase();
  const matchingPerks = useMemo(() => {
    const perks = (rules?.perks || []).map(([name, effect], index) => ({ name, effect, index })).filter(perk => `${perk.name} ${perk.effect}`.toLocaleLowerCase().includes(search));
    return perkSort === 'name' ? perks.sort((a, b) => a.name.localeCompare(b.name)) : perks;
  }, [rules?.perks, search, perkSort]);
  const faq = [
    ['How do I connect my wallet?', 'Use the existing Phantom or Solflare sign-in flow. A free authentication signature signs you in; purchases and deposits have their own confirmation steps. Never share a seed phrase or private key.'],
    ['What is the difference between Ryo and wallet tokens?', 'Verified Adventure rewards accumulate in the Chest. Claiming moves funded rewards into your spendable balance. Deposit and withdrawal connect that balance to the configured Solana Devnet token.'],
    ['Why does a fusion sometimes produce no hero?', 'Fusion is chance-based. The displayed rate applies to each attempt. All three selected Reserve heroes are consumed and the fee is charged even on failure. Review the payment dialog before confirming.'],
    ['Can I fuse a Legend?', 'Legend is the highest rank. Legends cannot be fused into a higher rarity. Elite-to-Legend attempts require three level 10 Elites.'],
    ['Can I sell a hero to another player?', 'The current game has a local listing prototype. Shared purchases and token-collection trading remain unavailable until a server marketplace provides secure escrow and settlement.'],
    ['Do elements multiply my damage?', 'No elemental matchup multiplier is published by the current combat configuration. Elemental identity and visuals are separate from rarity, base stats and perks.'],
    ['Why is a reward claim temporarily unavailable?', 'Claims require verified pending rewards and a funded reward pool. An unavailable claim leaves rewards in the Chest. Refresh the Chest for the current server state.'],
    ['Are Guild and Chat live?', 'Guild and messaging screens identify their current capabilities. No membership records, conversations, guild rewards or unread counts are invented when their services are unavailable.'],
  ].filter(([title, body]) => `${title} ${body}`.toLocaleLowerCase().includes(search));
  const routeLink = (label: string, page: number, mode?: number) => <button className="v3-feature-link" onClick={() => navigate(page, mode)}>{label}<FeatureIcon name="arrow" /></button>;
  const noRules = <p className="v3-knowledge-note">Current game configuration is still loading. Numeric rules are withheld until the game bridge is ready.</p>;

  return <section className="v3-knowledge" aria-labelledby="v3-codex-heading">
    <div className="v3-feature-banner"><div><span className="v3-feature-eyebrow">THE SHINOBI FIELD GUIDE</span><h1 id="v3-codex-heading">Codex <FeatureIcon name="book" /></h1><p>Learn the systems, perks, elements and battle knowledge of Shinobi Bombers.</p></div><span className="v3-content-version">Current game rules · V3 guide</span></div>
    <div className="v3-knowledge-layout">
      <nav className="v3-feature-sidebar" aria-label="Codex sections"><h2><FeatureIcon name="book" /> Codex Sections</h2>{categories.map(([id, label, icon]) => <button key={id} className={category === id ? 'is-active' : ''} aria-current={category === id ? 'page' : undefined} onClick={() => { setCategory(id); setQuery(''); }}><FeatureIcon name={icon} /><span>{label}</span><span aria-hidden="true">›</span></button>)}</nav>
      <article className="v3-knowledge-article">
        <header className="v3-feature-panel-title"><FeatureIcon name={selectedCategory[2]} /><h2>{selectedCategory[1]}</h2></header>
        <label className="v3-knowledge-search"><FeatureIcon name="search" /><span className="v3-feature-sr">Search this Codex topic</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this topic…" /></label>
        {!rules && noRules}
        {category === 'basics' && <div className="v3-knowledge-stack">
          <p className="v3-knowledge-intro">Build a Shinobi collection, prepare a battle-ready squad and let your heroes work through Adventure. Your owned collection and token balance come from the signed-in account.</p>
          <div className="v3-knowledge-steps">{[
            ['01', 'Prepare your squad', `Move owned heroes between Reserve and Battle-ready. ${rules ? `Keep up to ${rules.battleReadyLimit} battle-ready and deploy ${rules.deployedLimit} at a time.` : 'The current roster limits appear when configuration loads.'}`, 1],
            ['02', 'Enter Adventure', 'Work All deploys eligible heroes; Rest All withdraws the team. Legal movement, collisions and automated attacks follow the existing engine.', 0],
            ['03', 'Recover and improve', 'Rest heroes to recover chakra. The Dojo improves resting recovery, while Sensei manages replacement and supported offline play.', 4],
          ].filter(item => `${item[1]} ${item[2]}`.toLocaleLowerCase().includes(search)).map(([number, title, body, page]) => <article key={number} className="v3-knowledge-card"><span className="v3-step-number">{number}</span><h3>{title}</h3><p>{body}</p>{routeLink('Open '+title, Number(page))}</article>)}</div>
          <p className="v3-knowledge-note">Adventure visuals do not authorize token rewards. The server verifies combat earnings separately; only verified, funded rewards are claimable through the Chest.</p>
        </div>}
        {category === 'perks' && <div className="v3-knowledge-stack">
          <div className="v3-knowledge-headlines"><article><FeatureIcon name="chakra" /><h3>Chakra rule</h3><p>Stamina determines chakra capacity. Resting recovery follows the active Dojo; Fast Charge applies its configured recovery bonus.</p></article><article><FeatureIcon name="star" /><h3>Rank perks</h3><p>{rules ? rules.ranks.map(([name], index) => `${name}: ${index + 1}`).join(' · ') : 'Rank-specific perk counts load with game data.'}</p></article><article><FeatureIcon name="tech" /><h3>Unique skills</h3><p>Perks are selected uniquely. The current pool and effects below come from the game’s own perk definitions.</p></article></div>
          <div className="v3-knowledge-table-heading"><h3>Perk reference</h3><label>Sort <select value={perkSort} onChange={event => setPerkSort(event.target.value)}><option value="default">Game order</option><option value="name">Name</option></select></label></div>
          <div className="v3-knowledge-table-wrap"><table className="v3-knowledge-table"><thead><tr><th>Perk</th><th>Current effect</th><th>Availability</th></tr></thead><tbody>{matchingPerks.map(perk => <tr key={perk.name}><th scope="row"><FeatureIcon name={['chest', 'blades', 'arrow', 'flame', 'chakra', 'star', 'tech'][perk.index]} />{perk.name}</th><td>{perk.effect}</td><td>{perk.name === 'Piercing Shuriken' ? 'Chunin and above' : 'All ranks'}</td></tr>)}</tbody></table></div>
          {!matchingPerks.length && <p className="v3-feature-empty">{rules ? 'No perks match this search.' : 'Waiting for current perk definitions.'}</p>}
          <p className="v3-knowledge-note">The table describes the current client combat perk system. Verified Adventure rewards use the server simulation; these visuals and descriptions do not change reward calculations.</p>
        </div>}
        {category === 'elements' && <div className="v3-knowledge-stack"><p className="v3-knowledge-intro">Your hero’s element is its visual identity. Its rank selects the rarity aura; its stats and perks determine combat behavior.</p><div className="v3-element-grid">{(rules?.elements || []).filter(item => item.label.toLocaleLowerCase().includes(search)).map(item => { const index = rules!.elements.indexOf(item); return <button key={item.key} className={element === index ? 'is-selected' : ''} style={{ '--element-color': elementColors[index % elementColors.length] } as CSSProperties} aria-pressed={element === index} onClick={() => setElement(index)}><FeatureIcon name={index % 3 === 0 ? 'flame' : index % 3 === 1 ? 'chakra' : 'star'} /><span>{item.label.replace(/ Shinobi| Kunoichi/g, '')}</span></button>; })}</div><article className="v3-knowledge-card"><span className="v3-feature-eyebrow">ELEMENTAL IDENTITY</span><h3>{rules?.elements[element]?.label || 'Select a supported element'}</h3><p>Elemental colors and effects are separate from rarity. The current configuration does not define type advantage multipliers, so this guide does not invent a counter wheel.</p></article></div>}
        {category === 'ranks' && <div className="v3-knowledge-stack"><div className="v3-rank-pills">{(rules?.ranks || []).map(([name, color], index) => <button key={name} aria-pressed={rank === index} className={rank === index ? 'is-selected' : ''} style={{ '--rank-color': color } as CSSProperties} onClick={() => setRank(index)}>{name}</button>)}</div>{rules && <><article className="v3-knowledge-card v3-selected-rank" style={{ '--rank-color': rules.ranks[rank]?.[1] } as CSSProperties}><FeatureIcon name="star" /><h3>{rules.ranks[rank]?.[0]}</h3><p>{rank + 1} perk{rank ? 's' : ''} · {rank + 1} projectiles · {rank + 1} range</p><strong>Base stat band: {rules.statBands[rank]?.join('–')}</strong><p>{rank < 4 ? `Fusion to ${rules.ranks[rank + 1]?.[0]}: ${rules.fusionSuccessPercent[rank]}% success per attempt.` : 'Legend is the maximum rarity. No higher-rank fusion exists.'}</p>{rank === 3 && <p>All three Elite inputs must be level 10.</p>}</article><p className="v3-knowledge-note">Every fusion attempt consumes three eligible Reserve heroes and charges the fee, including failures. Keep at least two heroes even if all attempts fail. Review the actual checkout before payment.</p>{routeLink('Open Fusion Forge', 6)}</>}</div>}
        {category === 'battle' && <div className="v3-knowledge-stack">{[
          ['Protect your movement routes', 'Solid cells block navigation. Keep routes between reachable targets and avoid treating decorative scenery as an extra ability or hazard.'],
          ['Watch your chakra', 'A hero without sufficient chakra rests. Work All selects eligible heroes; reserve heroes remain outside the battle rotation until made battle-ready.'],
          ['Prepare before starting a hunt', 'Boss Hunt chooses the team at entry. Rest and deploy the heroes you want first; a hunt uses the existing attack and cooldown calculations.'],
          ['Use rarity and perks together', 'Higher rank changes the available stat band, projectiles, range and perk count. Aura effects are cosmetic and never add a hidden damage multiplier.'],
        ].filter(item => item.join(' ').toLocaleLowerCase().includes(search)).map(([title, body]) => <article className="v3-knowledge-card" key={title}><h3><FeatureIcon name="blades" />{title}</h3><p>{body}</p></article>)}{routeLink('Return to Adventure', 0)}</div>}
        {category === 'bosses' && <div className="v3-knowledge-stack"><p className="v3-knowledge-intro">Guardian Sanctuary is the existing solo Boss Hunt. Guild raids are a separate capability and are not implied by these encounters.</p><div className="v3-boss-guide">{(rules?.bossNames || []).filter(name => name.toLocaleLowerCase().includes(search)).map((name, index) => <article className="v3-knowledge-card" key={name}><span className="v3-feature-eyebrow">GUARDIAN {index + 1}</span><h3><FeatureIcon name="boss" />{name}</h3><p>Uses the current hunt progression, your prepared team and the shared combat renderer.</p></article>)}</div>{rules && <article className="v3-knowledge-card"><h3>Next hunt preview</h3><p>Configured HP: <strong>{fmt(rules.bossHP)}</strong> · Current client first-clear reward: <strong>{fmt(rules.bossReward)} Ryo</strong></p><p>Local hunt rewards and server-verified claimable Adventure Ryo are separate. The Chest only presents verified funded rewards.</p></article>}{routeLink('Open Boss Hunt', 8)}</div>}
        {category === 'rewards' && <div className="v3-knowledge-stack"><div className="v3-reward-overview"><article><span>SPENDABLE RYO</span><strong>{snapshot.authenticated ? fmt(snapshot.balance) : 'Sign in'}</strong><p>Current account balance</p></article><article><span>ADVENTURE CHEST</span><strong>{snapshot.chest ? fmt(snapshot.chest.pending) : 'Open Chest'}</strong><p>Server-verified rewards awaiting claim</p></article></div><article className="v3-knowledge-card"><h3>From Adventure to your wallet</h3><ol><li>Verified earnings accumulate in the Chest.</li><li>Claim funded rewards to your spendable balance.</li><li>Review a deposit or withdrawal amount and its current fee in the Chest.</li></ol>{rules && <p>Withdrawal minimum: {fmt(rules.withdrawalMinimum)} Ryo · cooldown: {fmt(rules.withdrawalCooldownMs / 3_600_000)} hours · studio fee: {fmt(rules.studioFeeBps / 100)}%.</p>}<p>Claiming and withdrawing are distinct actions. This guide never starts a transaction.</p><button className="v3-feature-link" onClick={openChest} disabled={!openChest}>Open shared Chest<FeatureIcon name="chest" /></button></article><p className="v3-knowledge-note">Claims depend on the verified pending amount and current reward-pool funding. Deposits, withdrawals and purchases always use the existing signed-in wallet services.</p></div>}
        {category === 'faq' && <div className="v3-knowledge-stack">{faq.map(([title, body]) => <details className="v3-knowledge-faq" key={title}><summary>{title}</summary><p>{body}</p></details>)}{!faq.length && <p className="v3-feature-empty">No questions match this search.</p>}</div>}
      </article>
      <aside className="v3-knowledge-context"><section className="v3-knowledge-card"><h2><FeatureIcon name="star" />Rank overview</h2>{(rules?.ranks || []).map(([name, color], index) => <button className="v3-context-rank" key={name} style={{ '--rank-color': color } as CSSProperties} onClick={() => { setCategory('ranks'); setRank(index); }}><FeatureIcon name="star" /><b>{name}</b><span>{index + 1} perk{index ? 's' : ''}</span></button>)}</section><section className="v3-knowledge-card"><h2><FeatureIcon name="help" />Quick tips</h2><p>Choose your team before entering a hunt.</p><p>Resting heroes recover chakra.</p><p>Check the current quote before any purchase.</p>{routeLink('Manage heroes', 1)}</section><section className="v3-knowledge-card v3-guide-integrity"><FeatureIcon name="lock" /><h3>Built from game data</h3><p>Screenshot examples never set your balance, rewards or odds. Unavailable community services are identified explicitly.</p></section></aside>
    </div>
  </section>;
}
