import { useState } from 'react';
import type { FeatureProps } from './feature-contract';
import { FeatureIcon } from './FeatureIcon';
import '../feature-content.css';

const guildSections = [
  ['home', 'Guild Home', 'guild', 'Your guild headquarters', 'Guild profiles, notices and activity will appear here when the membership service is available. No guild membership is assumed for your wallet.'],
  ['members', 'Members', 'people', 'A place for your whole clan', 'Member directories, role management and presence need an authenticated guild roster service. The current game does not publish these records.'],
  ['battle', 'Guild Battle', 'blades', 'Prepare for a future rivalry', 'Guild matchmaking, seasons, team eligibility and authoritative results are not configured. No battle can be entered or rewards claimed from this preview.'],
  ['boss', 'Guild Boss', 'boss', 'Cooperative encounters', 'Shared boss HP, damage contributions and guild payouts require a raid service. The existing solo Boss Hunt remains available as its own mode.'],
  ['missions', 'Guild Missions', 'book', 'Shared objectives', 'No guild mission catalog, reset schedule or reward-claim service is configured. This screen does not invent objectives or rewards.'],
  ['shop', 'Guild Shop', 'shop', 'A future clan armory', 'The current economy has no guild-points currency or guild shop catalog. Purchases remain disabled; no new currency or exchange rate is introduced.'],
  ['tech', 'Guild Tech', 'tech', 'Research your next chapter', 'Guild research costs, prerequisites and bonuses have not been configured. No stat or Ryo bonus is added by this screen.'],
  ['applications', 'Applications', 'mail', 'Recruitment, when ready', 'Applying, accepting and rejecting require a server membership service with role checks and capacity validation. There are no fabricated applications to review.'],
  ['settings', 'Settings', 'tech', 'Guild identity and permissions', 'Guild identity, recruitment and role settings require persisted guild records. No changes can be saved until that capability exists.'],
] as const;
const channels = [
  ['global', 'Global', 'chakra', 'Shared world messages need an authenticated messaging service.'],
  ['guild', 'Guild', 'guild', 'Private guild messages require a guild membership service and authorized conversations.'],
  ['team', 'Team', 'people', 'Party chat requires persistent party membership and invitation services.'],
  ['dm', 'Direct Messages', 'mail', 'Private messages require participant authorization, privacy controls and blocking.'],
  ['trade', 'Trade', 'shop', 'Trade discussion will never transfer a hero or Ryo. Actual trading belongs to the Marketplace service.'],
  ['system', 'System', 'tech', 'Only server-authored official messages may appear here. No announcements are configured.'],
  ['event', 'Event', 'star', 'Published event records and their real schedules will appear here when supported.'],
  ['help', 'Help', 'help', 'Live support chat is unavailable. The current Codex provides game guidance.'],
] as const;

export function CommunityHub({ snapshot, navigate, mode = 'guild' }: FeatureProps & { mode?: 'guild' | 'chat' }) {
  const [guildSection, setGuildSection] = useState('home');
  const [channel, setChannel] = useState('global');
  const selection = mode === 'guild' ? guildSections.find(item => item[0] === guildSection)! : channels.find(item => item[0] === channel)!;
  return <section className="v3-community" aria-labelledby="v3-community-heading">
    <div className="v3-feature-banner"><div><span className="v3-feature-eyebrow">STRONGER SHINOBI. TOGETHER.</span><h1 id="v3-community-heading">{mode === 'guild' ? 'Guild' : 'Chat'}<FeatureIcon name={mode} /></h1><p>{mode === 'guild' ? 'Your future clan headquarters, connected to real game services.' : 'A place to coordinate and connect when messaging becomes available.'}</p></div><span className="v3-capability-status"><FeatureIcon name="lock" />Service unavailable</span></div>
    <div className="v3-community-layout">
      <nav className="v3-feature-sidebar" aria-label={mode === 'guild' ? 'Guild sections' : 'Chat channels'}><h2><FeatureIcon name={mode} />{mode === 'guild' ? 'Guild Sections' : 'Chat Channels'}</h2>{mode === 'guild' ? guildSections.map(([id, name, icon]) => <button key={id} className={guildSection === id ? 'is-active' : ''} aria-current={guildSection === id ? 'page' : undefined} onClick={() => setGuildSection(id)}><FeatureIcon name={icon} /><span>{name}</span><FeatureIcon name="lock" /></button>) : channels.map(([id, name, icon]) => <button key={id} className={channel === id ? 'is-active' : ''} aria-current={channel === id ? 'page' : undefined} onClick={() => setChannel(id)}><FeatureIcon name={icon} /><span>{name}</span><FeatureIcon name="lock" /></button>)}</nav>
      <div className="v3-community-content">
        <header className="v3-feature-panel-title"><FeatureIcon name={selection[2]} /><h2>{selection[1]}</h2></header>
        <div className="v3-community-unavailable"><div className="v3-community-sigil"><FeatureIcon name={selection[2]} /></div><span className="v3-feature-eyebrow">BACKEND CAPABILITY REQUIRED</span><h3>{mode === 'guild' ? selection[3] : `${selection[1]} chat is not connected`}</h3><p>{mode === 'guild' ? (selection as typeof guildSections[number])[4] : selection[3]}</p><div className="v3-community-status-line"><span />{snapshot.authenticated ? 'Your existing wallet session is preserved.' : 'Sign in through the existing wallet flow.'}</div>
          {mode === 'guild' && guildSection === 'boss' ? <button className="v3-feature-link" onClick={() => navigate(8)}>Open solo Boss Hunt<FeatureIcon name="arrow" /></button> : <button className="v3-feature-link" onClick={() => navigate(3)}>Explore the Codex<FeatureIcon name="book" /></button>}
        </div>
        {mode === 'chat' ? <form className="v3-chat-composer" onSubmit={event => event.preventDefault()}><label htmlFor="v3-chat-unavailable-input">Message composer</label><div><input id="v3-chat-unavailable-input" disabled placeholder="Messaging service unavailable" aria-describedby="v3-chat-service-note" /><button disabled type="submit">Send</button></div><small id="v3-chat-service-note">No messages are sent or stored. This interface never asks for a wallet signature to send chat.</small></form> : <div className="v3-community-actions"><button disabled>{guildSection === 'home' ? 'Create Guild' : guildSection === 'applications' ? 'Review Applications' : guildSection === 'settings' ? 'Save Settings' : `Open ${selection[1]}`}</button><p>Unavailable until the corresponding server capability is implemented and verified.</p></div>}
      </div>
      <aside className="v3-community-aside"><section className="v3-knowledge-card"><h2><FeatureIcon name="lock" />Account integrity</h2><p>Only real guild, member, conversation and presence records will appear here.</p><p>No example names, guild points, rewards or unread badges are loaded from the artwork.</p></section><section className="v3-knowledge-card"><h2><FeatureIcon name="arrow" />Keep playing</h2><button className="v3-feature-link" onClick={() => navigate(0)}>Adventure<FeatureIcon name="blades" /></button><button className="v3-feature-link" onClick={() => navigate(1)}>Your heroes<FeatureIcon name="people" /></button><button className="v3-feature-link" onClick={() => navigate(mode === 'guild' ? 11 : 10)}>{mode === 'guild' ? 'Chat channels' : 'Guild headquarters'}<FeatureIcon name={mode === 'guild' ? 'chat' : 'guild'} /></button></section></aside>
    </div>
  </section>;
}
