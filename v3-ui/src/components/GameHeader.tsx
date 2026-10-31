import {useState} from 'react';
import type {Snapshot} from '../bridge';
import {Icon,type IconName} from './Icons';
export const routes:{page:number;mode?:number;label:string;icon:IconName}[]=[{page:5,label:'Home',icon:'home'},{page:1,label:'Heroes',icon:'hero'},{page:0,label:'Adventure',icon:'swords'},{page:2,label:'Summon',icon:'shrine'},{page:6,label:'Fusion',icon:'fusion'},{page:4,label:'Dojo',icon:'dojo'},{page:4,mode:1,label:'Market',icon:'market'},{page:8,label:'Boss Hunt',icon:'boss'},{page:10,label:'Guild',icon:'guild'},{page:11,label:'Chat',icon:'chat'},{page:3,label:'Codex',icon:'book'}];
export const money=(n:number)=>Math.floor(Number(n)||0).toLocaleString('en-US');
export function GameHeader({snapshot:s,page,navigate,openChest,settings}:{snapshot:Snapshot;page:number;navigate:(n:number,m?:number)=>void;openChest:()=>void;settings:()=>void}){
 const [expanded,setExpanded]=useState(false);
 return <header className="v3-header">
  <div className="v3-header-row flex items-center gap-3"><button className="v3-brand" onClick={()=>navigate(5)} aria-label="Shinobi Bombers home"><strong>SHINOBI</strong><em>BOMBERS</em></button>
   <button className="v3-nav-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><Icon name="shrine"/><span>{routes.find(r=>r.page===page&&(r.mode||0)===s.mode)?.label||'Village'}</span></button>
   <div className="v3-currency ml-auto"><Icon name="coin"/><strong data-v3-balance>{money(s.balance)}</strong><span>Ryo</span></div>
   <button className="v3-wallet" onClick={openChest} title={s.account||''}><Icon name="wallet" size={18}/><span>{s.account?s.account.slice(0,4)+'…'+s.account.slice(-4):'Disconnected'}</span></button>
   <button className="v3-global-chest" onClick={openChest} aria-label={'Open Chest · '+money(s.chest?.pending||0)+' Adventure Ryo'}><Icon name="chest" size={25}/><span>Chest <b>{s.chest?money(s.chest.pending):'—'}</b></span></button>
   <div className="v3-community-links"><span className="v3-online">{s.online}</span>{s.community.map(link=>link.url?<a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>:<button key={link.label} disabled title={link.label+' link not configured'}>{link.label}</button>)}</div><button className="v3-icon-button" onClick={settings} aria-label="Graphics settings"><Icon name="settings" size={20}/></button>
  </div>
  <nav className={'v3-navigation '+(expanded?'expanded':'')} aria-label="Game navigation">{routes.map(r=><button key={r.label} aria-current={page===r.page&&(r.mode||0)===s.mode?'page':undefined} onClick={()=>{navigate(r.page,r.mode);setExpanded(false)}}><Icon name={r.icon} size={18}/><span>{r.label}</span></button>)}</nav>
 </header>
}
