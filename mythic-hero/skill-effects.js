/* Mythic-only VFX v5. Brighter celestial cores; cached art, no gameplay effects. */
(() => {
  'use strict';
  const TAU=Math.PI*2,clamp=x=>Math.max(0,Math.min(1,x));
  function stroke(c,path,color,width,glow=0){c.strokeStyle=color;c.lineWidth=width;c.shadowColor='#a02bff';c.shadowBlur=glow;c.stroke(path);c.shadowBlur=0}
  function ring(c,x,y,rx,ry,phase,color,width=2){const p=new Path2D();p.ellipse(x,y,rx,ry,0,phase,phase+TAU*.86);stroke(c,p,color,width,4)}
  function sparks(c,t,count,radius){
    c.fillStyle='#e6bdff';
    for(let i=0;i<count;i++){const a=i*2.399963+t*.8,r=radius*(.35+.65*((i*7%13)/13)),x=Math.cos(a)*r,y=Math.sin(a)*r*.7-20*t;
      c.save();c.translate(x,y);c.rotate(a);const s=1.2+((i*3)%4)*.45;c.fillRect(-s,-s,s*2,s*2);c.restore()}
  }
  function crescent(c,t){
    c.rotate(-.55+t*.7);const r=24+58*Math.sin(t*Math.PI*.85),p=new Path2D();
    p.moveTo(-r*.38,-r);p.bezierCurveTo(r*1.2,-r*.58,r*1.2,r*.6,-r*.38,r);p.bezierCurveTo(r*.5,r*.36,r*.5,-r*.36,-r*.38,-r);p.closePath();
    const g=c.createLinearGradient(-r,0,r,0);g.addColorStop(0,'#8425d7');g.addColorStop(.6,'#d57aff');g.addColorStop(1,'#fff5ff');
    c.fillStyle=g;c.shadowColor='#c45bff';c.shadowBlur=12;c.fill(p);c.shadowBlur=0;stroke(c,p,'#fff1ff',2.6);
    for(let i=0;i<3;i++){const q=new Path2D();q.arc(-8-i*8,0,r*(.8-i*.13),-.95,1.03);stroke(c,q,i?'#993cff99':'#f5e2ff',i?1.5:2.5)}
    sparks(c,t,8,r*.85);
  }
  function shuriken(c,t,step){
    if(step>=6){const p=(step-5)/3;ring(c,0,0,22+p*52,22+p*52,t,'#d890ff',3);sparks(c,p,12,85*p);return}
    const size=32+Math.sin(t*Math.PI)*30;c.rotate(t*TAU*1.75);
    for(let trail=2;trail>=0;trail--){c.save();c.rotate(-trail*.22);c.globalAlpha*=trail?.15:1;
      const p=new Path2D();for(let j=0;j<8;j++){const a=j*Math.PI/4,r=j%2?size*.25:size,x=Math.cos(a)*r,y=Math.sin(a)*r;if(j)p.lineTo(x,y);else p.moveTo(x,y)}p.closePath();
      c.fillStyle='#a048e5';c.fill(p);stroke(c,p,'#fff1ff',3.3,9);c.restore()}
    ring(c,0,0,size+9,size+9,t,'#b65aff',1.5);c.beginPath();c.arc(0,0,4.5,0,TAU);c.fillStyle='#ead6ff';c.fill();
  }
  function field(c,t,step,layer){
    const strength=Math.sin(t*Math.PI),r=24+strength*57;
    if(layer!=='front'){
      const glow=c.createRadialGradient(0,0,4,0,0,r);glow.addColorStop(0,'#d394ff66');glow.addColorStop(1,'#8c37ff00');c.save();c.scale(1,.3);c.fillStyle=glow;c.beginPath();c.arc(0,0,r,0,TAU);c.fill();c.restore();
      ring(c,0,0,r,r*.3,t,'#e5b1ff',3);ring(c,0,0,r*.76,r*.23,-t,'#fff4ff',2);
      for(let i=0;i<6;i++){const a=i*TAU/6+t*.5;c.save();c.translate(Math.cos(a)*r,Math.sin(a)*r*.3);c.rotate(a);c.strokeStyle='#bb72ed';c.strokeRect(-3,-3,6,6);c.restore()}
    }
    if(layer==='ground'||step<2||step>8)return;
    for(let pillar=0;pillar<3;pillar++){
      const x=(pillar-1)*r*.66,baseY=pillar===1?0:-7,h=(42+strength*72)*(pillar===1?1:.78),p=new Path2D();p.moveTo(x,baseY);
      const glow=c.createLinearGradient(0,baseY,0,baseY-h);glow.addColorStop(0,'#a643ff66');glow.addColorStop(.6,'#9b35ff22');glow.addColorStop(1,'#9b35ff00');c.fillStyle=glow;c.beginPath();c.moveTo(x-12,baseY);c.quadraticCurveTo(x-2,baseY-h*.55,x,baseY-h);c.quadraticCurveTo(x+2,baseY-h*.55,x+12,baseY);c.closePath();c.fill();
      for(let j=1;j<=7;j++){const jitter=Math.sin(j*13.7+step*4.2+pillar*8)*8*(j===7?.3:1);p.lineTo(x+jitter,baseY-h*j/7)}
      stroke(c,p,'#a14cdd99',10,13);stroke(c,p,'#e0a3ff',4.5);stroke(c,p,'#fff1ff',2);
      ring(c,x,baseY,13,4,t,'#d7a2ff',1.5);
    }
  }
  function dragon(c,t,step,img,layer){
    const grow=clamp((t-.1)/.55),fade=1-clamp((t-.78)/.22);
    if(layer!=='front'){ring(c,0,0,25+70*grow,7+19*grow,t,'#bd6fff',2.5);ring(c,0,0,17+52*grow,5+15*grow,-t,'#e8c4ff',1.5)}
    if(layer==='ground')return;
    c.save();c.translate(0,-15-grow*25);c.globalAlpha*=Math.min(1,grow*2)*fade;
    if(img&&grow>0){const size=70+grow*115;c.rotate(-.18+t*.25);c.filter='brightness(1.3) saturate(1.08)';c.drawImage(img,-size*.5,-size*.58,size,size);c.filter='none'}
    else {ring(c,0,0,20+grow*45,12+grow*25,t,'#bb5aff',3)}
    sparks(c,t,18,30+grow*90);c.restore();
    if(step>=8){c.save();c.globalAlpha*=fade;ring(c,0,0,60+(step-8)*11,18+(step-8)*3,t,'#ddabff',3);c.restore()}
  }
  function paint(c,name,step,count,layer,dragonImage){
    const t=(step+.35)/count;c.save();c.translate(c.canvas.width/2,c.canvas.height/2);c.lineCap='round';c.lineJoin='round';
    c.globalAlpha*=Math.min(1,(step+1)/2,(count-step)/2);
    if(name==='dragon_slash')crescent(c,t);
    else if(name==='void_shuriken')shuriken(c,t,step);
    else if(name==='raijin_field')field(c,t,step,layer);
    else dragon(c,t,step,dragonImage,layer);
    c.restore();
  }
  window.TsukiyomiEffects={paint,version:5};
})();
