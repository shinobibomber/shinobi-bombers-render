'use client';

import {useState} from 'react';

export interface ShinobiBombersGameProps {
 /** Replace the example domain with your deployed complete game origin. */
 gameUrl?:string;
}

export default function ShinobiBombersGame({gameUrl='https://game.example.com'}:ShinobiBombersGameProps){
 const [preview,setPreview]=useState(false);
 let url:URL|null=null;
 try{const candidate=new URL(gameUrl);if(candidate.protocol==='https:'||(candidate.protocol==='http:'&&['localhost','127.0.0.1'].includes(candidate.hostname)))url=candidate}catch{/* Invalid configuration is displayed below; no navigation is attempted. */}
 if(!url)return <section role="alert">Set a valid HTTPS game URL before enabling Shinobi Bombers.</section>;
 const href=url.href;
 return <section aria-labelledby="shinobi-game-title" style={{padding:'clamp(20px,4vw,44px)',border:'1px solid #8b58bd',borderRadius:16,background:'linear-gradient(135deg,#10162d,#060d1b)',color:'#f8eddb',fontFamily:'system-ui,sans-serif'}}>
  <h2 id="shinobi-game-title" style={{margin:'0 0 12px',color:'#ffd477'}}>Shinobi Bombers</h2>
  <p style={{maxWidth:650,lineHeight:1.6,color:'#c1cbe0'}}>Enter the village and continue your Shinobi journey. Open the full game for wallet sign-in and the complete experience.</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center'}}>
   <a href={href} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',alignItems:'center',justifyContent:'center',minHeight:48,padding:'0 22px',border:'1px solid #ffe3a0',borderRadius:7,background:'linear-gradient(110deg,#ffd465,#f59b18)',color:'#211303',fontWeight:800,textDecoration:'none'}}>Play Shinobi Bombers ↗</a>
   <button type="button" aria-expanded={preview} aria-controls="shinobi-game-preview" onClick={()=>setPreview(value=>!value)} style={{minHeight:48,padding:'0 18px',border:'1px solid #8d73b5',borderRadius:7,background:'#17192f',color:'#ece3fc',font:'inherit',cursor:'pointer'}}>{preview?'Hide embedded preview':'Show embedded preview'}</button>
  </div>
  {preview&&<div id="shinobi-game-preview" style={{marginTop:20}}>
   <p style={{fontSize:14,lineHeight:1.6,color:'#c1cbe0'}}>Wallet support inside this frame has not been verified. <a href={href} target="_blank" rel="noopener noreferrer" style={{color:'#ffda83'}}>Open full game ↗</a></p>
   <iframe title="Shinobi Bombers game preview" src={href} loading="lazy" allow="fullscreen; clipboard-write" allowFullScreen style={{display:'block',width:'100%',height:'min(78vh,900px)',minHeight:420,border:'1px solid #624985',borderRadius:8,background:'#030918'}}/>
  </div>}
 </section>
}
