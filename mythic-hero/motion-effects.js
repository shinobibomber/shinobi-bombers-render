/* Code-native interpretation of reference/skill-motion-v10.png. Bake-time only.
 * The poster, labels and placeholder character are never runtime sprite textures. */
(()=>{
 'use strict';
 const TAU=Math.PI*2;
 function line(c,path,color,width,glow=0){c.strokeStyle=color;c.lineWidth=width;c.shadowColor='#b636ff';c.shadowBlur=glow;c.stroke(path);c.shadowBlur=0}
 function ellipse(c,x,y,rx,ry,angle,color,width=2){const p=new Path2D();p.ellipse(x,y,rx,ry,angle,0,TAU);line(c,p,color,width,4)}
 function motes(c,t,count,radius){for(let i=0;i<count;i++){const a=i*2.39996+t*.65,r=radius*(.48+.48*((i*7%17)/17)),x=Math.cos(a)*r,y=Math.sin(a)*r*.85;c.globalAlpha=.35+.5*((i*3%7)/7);c.fillStyle=i%4?'#d48bff':'#ffcf71';c.beginPath();c.arc(x,y,1+(i%3)*.4,0,TAU);c.fill()}c.globalAlpha=1}
 function slash(c,t){
  const growth=.58+.42*Math.sin(t*Math.PI*.8);
  for(let i=0;i<3;i++){
   c.save();c.translate((i-1)*20+8,10-i*9);c.rotate((i-1)*.2-.12+t*.14);const r=(52+i*28)*growth,p=new Path2D();p.arc(0,0,r,-1.05,1.05);
   line(c,p,'#8620cd55',22,10);line(c,p,'#ac33ee',10);line(c,p,'#df98ff',3);
   const trail=new Path2D();trail.arc(-9,0,r-9,-1.02,1.02);line(c,trail,'#a94bdb99',3);c.restore();
  }
  // Restrained spectral head silhouette between the crescents, as in the motion study.
  c.save();c.translate(30, -25);c.globalAlpha=.45+.5*Math.sin(t*Math.PI);const head=new Path2D();head.moveTo(-24,-9);head.lineTo(3,-31);head.lineTo(21,-19);head.lineTo(39,-25);head.lineTo(28,-4);head.lineTo(13,1);head.moveTo(3,-31);head.lineTo(9,-46);head.moveTo(28,-4);head.lineTo(39,5);line(c,head,'#db83ff',4,8);c.fillStyle='#ffe5a6';c.beginPath();c.arc(22,-17,2,0,TAU);c.fill();c.restore();motes(c,t,18,118);
 }
 function star(c,size){const p=new Path2D();for(let i=0;i<8;i++){const a=i*Math.PI/4,r=i%2?size*.22:size;i?p.lineTo(Math.cos(a)*r,Math.sin(a)*r):p.moveTo(Math.cos(a)*r,Math.sin(a)*r)}p.closePath();c.fillStyle='#7c2795aa';c.fill(p);line(c,p,'#d58aff',1.5,7);c.beginPath();c.arc(0,0,size*.14,0,TAU);c.fillStyle='#190b31';c.fill()}
 function eclipse(c,t){
  const r=36+24*Math.sin(t*Math.PI*.9),rotation=t*TAU*.7;
  const glow=c.createRadialGradient(0,0,5,0,0,r+18);glow.addColorStop(0,'#080214');glow.addColorStop(.65,'#26103a88');glow.addColorStop(.85,'#b147e755');glow.addColorStop(1,'#a342ff00');c.fillStyle=glow;c.beginPath();c.arc(0,0,r+18,0,TAU);c.fill();
  ellipse(c,0,0,r,r*.8,.25+rotation*.2,'#b36ce8',2.5);ellipse(c,0,0,r*.9,r*.62,-.45-rotation*.2,'#e19aff99',1.5);
  for(let i=0;i<6;i++){const a=i*TAU/6+rotation,x=Math.cos(a)*(r+10),y=Math.sin(a)*(r+10)*.8;c.save();c.translate(x,y);c.rotate(a+t*TAU);star(c,13+(i%2)*3);c.restore()}
  if(t>.65){const k=(t-.65)/.35;ellipse(c,0,0,r+20*k,r+20*k,0,'#d78dff99',2)}motes(c,t,16,112);
 }
 function vortex(c,t,step,layer){
  const grow=.65+.35*Math.sin(t*Math.PI),r=70*grow;
  if(layer==='ground'){ellipse(c,0,77,r,r*.25,.05,'#bf60ff',3);ellipse(c,0,77,r*.75,r*.16,-.12,'#ffd27b',1.5);return}
  for(let j=0;j<3;j++){
   const p=new Path2D();for(let i=0;i<=60;i++){const u=i/60,a=u*TAU*2.1+t*TAU+j*TAU/3,x=Math.cos(a)*(18+u*45)*grow,y=80-u*190+Math.sin(a)*13;i?p.lineTo(x,y):p.moveTo(x,y)}line(c,p,j===1?'#d572ff':'#a830f2',j===1?3.5:2.5,6);
  }
  for(let side=-1;side<=1;side+=2){const bolt=new Path2D();bolt.moveTo(side*77,72);for(let j=1;j<12;j++)bolt.lineTo(side*(78+Math.sin(j*4.2+step*2)*10),72-j*15);line(c,bolt,'#b53ffb66',8,9);line(c,bolt,'#edb9ff',2);}
  for(let i=0;i<3;i++)ellipse(c,0,10+i*16,100-i*8,12+i*2,1.0+i*.22+t*.15,i===1?'#edb56a':'#bc66ff',2);
  motes(c,t,14,117);
 }
 function dominion(c,t,layer){
  const swell=.76+.24*Math.sin(t*Math.PI);
  if(layer==='ground'){ellipse(c,0,88,93*swell,23*swell,.04,'#e8b954',2.4);ellipse(c,0,88,75*swell,17*swell,-.1,'#b64bff',2);return}
  c.save();c.translate(0,-8);ellipse(c,0,0,113*swell,119*swell,.25,'#7d24d6',4);ellipse(c,0,0,122*swell,67*swell,.56+t*.12,'#e5ae58',2);
  const wave=new Path2D(),phase=Math.sin(t*TAU)*7;wave.moveTo(-98,-37+phase);wave.bezierCurveTo(-58,-82,-43,94,2,48);wave.bezierCurveTo(43,10,44,-103,86,-61+phase);
  line(c,wave,'#7d13b399',28,15);line(c,wave,'#a939ed',19);line(c,wave,'#d674ff',11);line(c,wave,'#f0b8ff',3);
  c.save();c.translate(86,-61+phase);const head=new Path2D();head.moveTo(-12,-5);head.lineTo(0,-20);head.lineTo(16,-10);head.lineTo(27,-16);head.lineTo(20,4);head.lineTo(8,10);head.lineTo(-5,0);head.moveTo(0,-20);head.lineTo(3,-36);head.lineTo(13,-17);head.moveTo(20,4);head.lineTo(28,13);line(c,head,'#c577e9',4,7);c.fillStyle='#ffdf9c';c.beginPath();c.arc(14,-7,2.2,0,TAU);c.fill();c.restore();motes(c,t,21,112);c.restore();
 }
 function paint(c,id,step,count,layer){
  const t=(step+.5)/count;c.save();c.translate(160,160);c.lineCap='round';c.lineJoin='round';c.globalAlpha*=Math.min(1,(step+1)/2,(count-step)/2);
  if(id==='dragon_slash'&&layer==='front')slash(c,t);else if(id==='void_shuriken'&&layer==='front')eclipse(c,t);else if(id==='raijin_field')vortex(c,t,step,layer);else if(id==='mythic_dragon_ascension')dominion(c,t,layer);c.restore();
 }
 window.TsukiyomiMotionEffects={version:10,paint};
})();
