import {useEffect,useState} from 'react';
import {Icon,type IconName} from './Icons';

export interface GameHeaderProps {
 page:number;
 mode:number;
 balance:string;
 claimable:string|null;
 wallet:string;
 onNavigate:(page:number,mode?:number)=>void;
 onChest:()=>void;
 onBack:()=>void;
 online:string;muted:boolean;community:{label:string;url:string|null}[];onMute:()=>void;
}

interface HeaderRoute {label:string;icon:IconName;page:number;mode?:number}
const routes:HeaderRoute[]=[
 {label:'Home',icon:'home',page:5},
 {label:'Heroes',icon:'hero',page:1},
 {label:'Adventure',icon:'swords',page:0},
 {label:'Summon',icon:'shrine',page:2},
 {label:'Fusion',icon:'fusion',page:6},
 {label:'Dojo',icon:'dojo',page:4},
 {label:'Market',icon:'market',page:4,mode:1},
 {label:'Boss Hunt',icon:'boss',page:8},
 {label:'Codex',icon:'book',page:3}
];

export function GameHeader({page,mode,balance,claimable,wallet,onNavigate,onChest,onBack,online,muted,community,onMute}:GameHeaderProps){
 const [expanded,setExpanded]=useState(false);
 useEffect(()=>setExpanded(false),[page,mode]);
 const navigate=(route:HeaderRoute)=>{setExpanded(false);onNavigate(route.page,route.mode)};
 return <header className="gc-header" aria-label="Shinobi Bombers game header">
  <button className="gc-brand" aria-label="Shinobi Bombers Home" onClick={()=>onNavigate(5)}><span className="gc-brand-art" aria-hidden="true"/><span className="gc-sr-only">Shinobi Bombers</span></button>
  <button className="gc-mobile-menu" aria-expanded={expanded} aria-controls="gc-main-navigation" onClick={()=>setExpanded(value=>!value)}><span className="gc-menu-lines" aria-hidden="true">☰</span><span>{expanded?'Close menu':'Game menu'}</span></button>
  <nav className={'gc-header-nav'+(expanded?' gc-nav-expanded':'')} id="gc-main-navigation" aria-label="Game menus">
   {page!==5&&<button className="gc-nav-item" onClick={onBack} aria-label="Back"><Icon name="arrow"/><span>Back</span></button>}
   {routes.map(route=><button key={route.label} className="gc-nav-item" aria-current={page===route.page&&mode===(route.mode??0)?'page':undefined} onClick={()=>navigate(route)}><Icon name={route.icon}/><span>{route.label}</span></button>)}
   <button className="gc-nav-item gc-nav-unavailable" disabled title="Guild — coming soon. The shared service is not available." aria-label="Guild — coming soon"><Icon name="guild"/><span>Guild</span><span className="gc-sr-only">Coming soon</span></button>
   <button className="gc-nav-item gc-nav-unavailable" disabled title="Chat — coming soon. The shared service is not available." aria-label="Chat — coming soon"><Icon name="chat"/><span>Chat</span><span className="gc-sr-only">Coming soon</span></button>
  </nav>
  <div className="gc-header-account">
   <div className="gc-header-ryo" aria-label={'Spendable balance '+balance+' Ryo'}><Icon name="coin"/><strong data-gc-balance>{balance}</strong><span>Ryo</span></div>
   <button className="gc-global-chest" data-gc-chest onClick={onChest} aria-label={'Open Chest. '+(claimable===null?'Checking Adventure Ryo':claimable+' Adventure Ryo')}><Icon name="chest"/><span>Chest <b aria-hidden="true">·</b> <strong data-gc-pending>{claimable??'—'}</strong></span></button>
   <details className="gc-tools" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus()}}}><summary aria-label="Game information and sound"><Icon name="settings"/><span>Tools</span></summary><div><strong>{online}</strong><button onClick={onMute} aria-label={muted?'Unmute sound':'Mute sound'}>{muted?'🔇 Sound off · Unmute':'🔊 Sound on · Mute'}</button><button type="button" className="gc-display" onClick={()=>{(window as unknown as {DisplaySettings?:{open:()=>void}}).DisplaySettings?.open()}}>Display &amp; Accessibility</button><nav aria-label="Community links"><a href="/whitepaper">Whitepaper</a>{community.map(link=>link.url?<a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>:<button key={link.label} disabled title={link.label+' link coming soon'}>{link.label} · Coming soon</button>)}</nav></div></details>
   <div className="gc-header-wallet" title={'Connected wallet: '+wallet}><Icon name="wallet"/><span>{wallet.length>15?wallet.slice(0,5)+'…'+wallet.slice(-5):wallet}</span></div>
  </div>
 </header>
}
