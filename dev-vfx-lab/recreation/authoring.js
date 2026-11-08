/* Offline canvas authoring only. Does not load in Adventure or alter game APIs. */
(() => {
 'use strict';
 const TAU=Math.PI*2,clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
 function image(c,img,x,y,w,h=w,angle=0,alpha=1){if(!img||alpha<=0)return;c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha*=clamp(alpha);c.drawImage(img,-w/2,-h/2,w,h);c.restore()}
 function element(c,a,key,x,y,w,angle=0,alpha=1){const r=a.tiles[key]?.rect;if(!r||alpha<=0)return;const [sx,sy,sw,sh]=r;c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha*=clamp(alpha);c.drawImage(a.elements,sx,sy,sw,sh,-w/2,-w*sh/sw/2,w,w*sh/sw);c.restore()}
 function sparks(c,t,count,radius,cy=260){c.save();for(let i=0;i<count;i++){const angle=i*2.399963+t*.65,r=(.35+(i%7)/10)*radius,x=256+Math.cos(angle)*r,y=cy+Math.sin(angle)*r*.7-t*18;c.globalAlpha=(.25+.55*Math.sin(Math.PI*t))*(.55+.45*Math.sin(i*4+t*8)**2);c.fillStyle=i%5?'#df71ff':'#ffe3a3';c.shadowColor='#d52bff';c.shadowBlur=5;c.beginPath();c.moveTo(x,y-3);c.lineTo(x+1.2,y);c.lineTo(x,y+3);c.lineTo(x-1.2,y);c.closePath();c.fill()}c.restore()}
 function bolt(c,x0,y0,x1,y1,seed,alpha=1){c.save();c.globalAlpha*=alpha;c.beginPath();c.moveTo(x0,y0);for(let j=1;j<=8;j++){const p=j/8;c.lineTo(x0+(x1-x0)*p+(j<8?Math.sin(seed*7+j*11)*10:0),y0+(y1-y0)*p)}c.lineJoin='round';c.strokeStyle='#c638ff';c.lineWidth=5;c.shadowColor='#b500ff';c.shadowBlur=10;c.stroke();c.strokeStyle='#fbe4ff';c.lineWidth=1.5;c.stroke();c.restore()}
 function floorElement(c,a,key,w,alpha){c.save();c.translate(256,420);c.scale(1,.42);element(c,a,key,0,0,w,0,alpha);c.restore()}
 function ground(c,a,t,gold=false){const w=80+smooth(t)*290;floorElement(c,a,'sigil',w,.35+.45*Math.sin(t*Math.PI));if(gold)floorElement(c,a,'gold_circle',w*.91,.6*Math.sin(t*Math.PI));}
 function burst(c,a,t,force=1){const b=clamp(t),fade=Math.sin(Math.PI*b)*force;if(fade<=0)return;element(c,a,'impact',256,337,120+b*270,0,fade);element(c,a,'flash',256,330,80+b*230,b*.15,fade*.8);for(let i=0;i<9;i++){const ang=-Math.PI+i*Math.PI/8;bolt(c,256,414,256+Math.cos(ang)*(80+b*115),414+Math.sin(ang)*(75+b*205),i+Math.floor(b*8),fade*.55)}}
 // Strip deformation adds an ascending travelling wave while preserving the same
 // detailed master silhouette. Every frame uses identical registration and source.
 function dragon(c,img,t,alpha){const rise=smooth((t-.23)/.48),size=200+rise*214,cx=256+Math.sin(t*7)*9,cy=360-rise*105;c.save();c.globalAlpha*=alpha;const strips=80;for(let i=0;i<strips;i++){const sy=i*img.height/strips,sh=img.height/strips,dy=cy-size/2+i*size/strips,wave=Math.sin(i*.11-t*9)*(3+rise*5);c.drawImage(img,0,sy,img.width,sh,cx-size/2+wave,dy,size,size/strips+.5)}c.restore()}
 function paint(c,id,t,layer,a){
  t=clamp(t);c.save();c.globalCompositeOperation='source-over';
  if(layer==='ground'){
   if(id==='raijin_field'||id==='mythic_dragon_ascension')ground(c,a,t,id==='mythic_dragon_ascension');
   if(id==='void_shuriken'&&t>.73)floorElement(c,a,'sigil',100+260*smooth((t-.73)/.27),.6);
   c.restore();return;
  }
  if(id==='dragon_slash'){
   const expansion=smooth(t/.82),w=82+expansion*344,x=160+expansion*102,y=296-expansion*45;
   // Original complete crescent is cleanly recoverable; use it for the first stages.
   if(t<.5)element(c,a,'crescent',x,y,w*.9,-.12,(1-smooth((t-.22)/.28))*.95);
   const formed=smooth((t-.12)/.4);
   image(c,a.masters[id],x,y,w,w*.92,-.10+expansion*.13,formed*(1-.3*smooth((t-.87)/.13)));
   sparks(c,t,18,65+expansion*140,y);
   if(t>.79)element(c,a,'flash',370,236,70+90*(t-.79)/.21,.15,.55*Math.sin((t-.79)/.21*Math.PI));
  }else if(id==='void_shuriken'){
   const expand=smooth(t/.7),radius=40+expand*110,formation=smooth((t-.25)/.32),end=smooth((t-.85)/.15);
   // Native isolated shuriken gives the six independent travelling projectiles.
   for(let i=0;i<6;i++){const ang=i*TAU/6+t*3.8,r=radius*(1-.55*smooth((t-.7)/.3));element(c,a,'void_shuriken_3',256+Math.cos(ang)*r,260+Math.sin(ang)*r*.8,25+expand*41,ang+t*2,.85*(1-end*.75))}
   if(t<.5)element(c,a,'void_shuriken_4',256,260,40+expand*135,t*2,1-formation);
   image(c,a.masters[id],256,260,100+expand*228,100+expand*228,t*1.4,formation*(1-end*.7));
   if(t>.74)burst(c,a,(t-.74)/.32,.8);sparks(c,t,20,80+expand*116);
  }else if(id==='raijin_field'){
   const rise=smooth((t-.12)/.55),formed=smooth((t-.25)/.4),w=170+rise*241,h=90+rise*290;
   for(let i=0;i<3;i++){const x=208+i*48;element(c,a,'pillar',x,409-(40+rise*100)/2,55+rise*55,0,(1-formed*.8)*.85);if(t>.1)bolt(c,x,410,x+Math.sin(t*8+i)*16,385-rise*(190+i*14),i+Math.floor(t*10),.75*(1-formed*.65))}
   // Horizontal bands sway independently, suggesting rotation through a fixed funnel.
   const img=a.masters[id];c.save();c.globalAlpha=formed*(1-.45*smooth((t-.88)/.12));for(let i=0;i<64;i++){const sh=img.height/64,dy=420-h+i*h/64,offset=Math.sin(i*.14-t*9)*5*rise;c.drawImage(img,0,i*sh,img.width,sh,256-w/2+offset,dy,w,h/64+.5)}c.restore();
   if(t>.8)burst(c,a,(t-.8)/.3,.45);sparks(c,t,24,155,260);
  }else if(id==='mythic_dragon_ascension'){
   const formation=smooth((t-.2)/.3),impact=smooth((t-.78)/.2);
   if(t<.5){element(c,a,'pillar',256,370,90+170*smooth(t/.5),0,1-smooth((t-.3)/.2));for(let i=0;i<3;i++)bolt(c,226+i*30,420,240+i*16,390-270*smooth(t/.5),i+Math.floor(t*9),.6*(1-formation));}
   dragon(c,a.masters[id],t,formation*(1-impact*.82));
   if(t>.68)element(c,a,'vortex',256,315,180+smooth((t-.68)/.32)*230,0,.6*Math.sin((t-.68)/.4*Math.PI));
   if(t>.76)burst(c,a,Math.min(.85,(t-.76)/.28),1);sparks(c,t,30,190,260);
  }
  c.restore();
 }
 window.MythicRecreationAuthoring={paint};
})();
