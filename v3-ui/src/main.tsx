import {Component,useEffect,useState,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {bridge,initialize,snapshot,subscribe,type Snapshot} from './bridge';
import {GameHeader} from './components/GameHeader';
import {Modal} from './components/Modal';
import {HomeDashboard} from './features/HomeDashboard';
import {ChestManager} from './features/ChestManager';
import {KnowledgeHub} from './features/KnowledgeHub';
import {CommunityHub} from './features/CommunityHub';
declare global {interface Window {V3Chest?:{open:()=>void;openHistory:()=>void;close:()=>void};V3UI?:{ready:boolean;refresh:()=>void};V3Animation?:{setQuality:(q:string)=>void;openStudio:()=>void};Arena3D?:{setFx:(n:number)=>void}}}
class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true}}componentDidCatch(error:Error){console.error('V3 interface failed:',error)}render(){return this.state.failed?<div className="v3-fatal" role="alert">The interface could not load. Your account and game progress are unchanged. <button onClick={()=>location.reload()}>Reload interface</button></div>:this.props.children}}
function App(){
 const [state,setState]=useState<Snapshot>(snapshot),[extra,setExtra]=useState<number|null>(null),[chest,setChest]=useState(false),[chestInitial,setChestInitial]=useState<'dashboard'|'history'>('dashboard'),[settings,setSettings]=useState(false),[quality,setQuality]=useState(()=>localStorage.getItem('shinobi-v3-quality')||(matchMedia('(prefers-reduced-motion:reduce)').matches?'low':'high'));
 const active=state.authenticated&&!state.loading&&!state.login;
 useEffect(()=>{const refresh=()=>setState(snapshot()),unsub=subscribe(refresh),stop=initialize(refresh);document.getElementById('loginScreen')?.classList.add('v3-login-refreshed');window.V3UI={ready:true,refresh};window.V3Chest={open:()=>{if(snapshot().authenticated){setChestInitial('dashboard');setChest(true)}},openHistory:()=>{if(snapshot().authenticated){setChestInitial('history');setChest(true)}},close:()=>setChest(false)};refresh();return()=>{unsub();stop();delete window.V3Chest;delete window.V3UI}},[]);
 useEffect(()=>{document.body.classList.toggle('v3-ui-active',active);if(!active){setChest(false);setExtra(null)}return()=>document.body.classList.remove('v3-ui-active')},[active]);
 useEffect(()=>{const selected=matchMedia('(prefers-reduced-motion:reduce)').matches&&quality!=='off'?'low':quality;document.body.dataset.v3Quality=selected;localStorage.setItem('shinobi-v3-quality',quality);dispatchEvent(new CustomEvent('shinobi-graphics-quality',{detail:{quality:selected}}));window.V3Animation?.setQuality(selected);window.Arena3D?.setFx(selected==='high'?2:selected==='medium'?1:0)},[quality]);
 useEffect(()=>{if(extra!==null&&state.page!==3)setExtra(null)},[extra,state.page]);
 useEffect(()=>{if(!active)return;const fit=()=>{const height=document.querySelector('.v3-header')?.getBoundingClientRect().height||112;document.body.style.setProperty('--v3-header-height',height+'px');for(const scene of document.querySelectorAll<HTMLElement>('#exactHomeScene,#exactAdventureScene,#exactDojoScene,#exactFusionScene')){const width=scene.offsetWidth,h=scene.offsetHeight;if(width&&h)scene.style.setProperty('--v3-frame-scale',String(Math.min(innerWidth/width,Math.max(200,innerHeight-height)/h)))}};fit();const observer=new ResizeObserver(fit),header=document.querySelector('.v3-header');if(header)observer.observe(header);addEventListener('resize',fit);return()=>{observer.disconnect();removeEventListener('resize',fit)}},[active,state]);
 function navigate(page:number,mode=0){setExtra(page>=10?page:null);bridge.navigate(page>=10?3:page,mode);setState(snapshot())}
 if(!active)return null;
 const page=extra??state.page;
 return <><GameHeader snapshot={state} page={page} navigate={navigate} openChest={()=>setChest(true)} settings={()=>setSettings(true)}/>
  {state.page===5&&<main className="v3-feature-page"><HomeDashboard snapshot={state} navigate={navigate} openChest={()=>setChest(true)}/></main>}
  {state.page===3&&<main className="v3-feature-page">{extra===10||extra===11?<CommunityHub snapshot={state} navigate={navigate} openChest={()=>setChest(true)} mode={extra===10?'guild':'chat'}/>:<KnowledgeHub snapshot={state} navigate={navigate} openChest={()=>setChest(true)}/>}</main>}
  {chest&&<ChestManager snapshot={state} initialPage={chestInitial} onClose={()=>{setChest(false);setChestInitial('dashboard')}}/>}
  {settings&&<Modal title="Graphics settings" onClose={()=>setSettings(false)}><p className="v3-muted">Visual effects only. Combat timing, damage and rewards stay unchanged.</p><label className="v3-field-label" htmlFor="v3-quality">Effects quality</label><select className="v3-select" id="v3-quality" value={quality} onChange={event=>setQuality(event.target.value)}>{['high','medium','low','off'].map(q=><option key={q} value={q}>{q[0].toUpperCase()+q.slice(1)}</option>)}</select><p className="v3-muted">Your device’s reduced-motion preference always takes priority. Invisible effects pause automatically.</p><button className="v3-secondary" onClick={()=>{setSettings(false);window.V3Animation?.openStudio()}}>Inspect animation assets</button></Modal>}
 </>
}
const mount=document.createElement('div');mount.id='shinobi-v3-root';document.body.append(mount);createRoot(mount).render(<ErrorBoundary><App/></ErrorBoundary>);
