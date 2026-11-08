/* Tsukiyomi v5: reference-paced directional stride using the approved four views.
 * Mesh construction happens only on a body-cache miss, never in the warm draw pass.
 * No body substitution, cut-out seams, movement changes or gameplay dependencies. */
(() => {
  'use strict';
  const clamp=x=>Math.max(0,Math.min(1,x)),smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
  const landmarks={
    front:{hips:[54,75],hipY:99,shoulders:[47,81],shoulderY:73},
    back:{hips:[54,75],hipY:99,shoulders:[45,83],shoulderY:73},
    left:{hips:[60,70],hipY:100,shoulders:[52,67],shoulderY:75},
    right:{hips:[58,68],hipY:100,shoulders:[61,76],shoulderY:75}
  };
  // Authored pose curves, in source pixels/radians. They never read or alter gameplay.
  function gesture(state,frame,frames) {
    const t=clamp(frame/Math.max(1,frames-1)),pulse=Math.sin(t*Math.PI),p=frame/frames*Math.PI*2;
    const g={arms:[0,0],crouch:0,lean:0,nod:0,lift:0,breath:0,blink:0};
    if(state==='IDLE'){g.breath=Math.sin(p)*.8;g.blink=frame===6?.85:frame===5?.2:0;}
    if(state==='ATTACK'||state.startsWith('SKILL_')){
      const swing=[0,-.26,-.62,.95,.38,0][Math.min(5,Math.round(t*5))];
      g.arms=[swing*.35,-swing];g.lean=swing*2.8;g.crouch=Math.sin(t*Math.PI)*1.5;
    }
    if(state==='BOMB_PLACE'){g.crouch=pulse*9;g.lean=pulse*2;g.nod=pulse*.08;g.arms=[pulse*-.55,pulse*.55];}
    if(state==='HURT'){const recoil=[1,.65,.18,0][Math.min(3,frame)];g.lean=-4*recoil;g.crouch=2*recoil;g.nod=-.08*recoil;g.arms=[-.35*recoil,.4*recoil];}
    if(state==='DEFEAT'){const sink=smooth(0,.85,t);g.crouch=20*sink;g.lean=-4*sink;g.nod=.16*sink;g.arms=[.2*sink,-.25*sink];g.blink=sink;}
    if(state==='VICTORY'){const cheer=Math.sin(Math.PI*t)**2;g.arms=[-.9*cheer,.9*cheer];g.nod=-.06*cheer;g.lift=2*cheer;}
    if(state==='EMOTE_ALERT'){g.arms=[-.3*pulse,.3*pulse];g.lift=pulse*1.5;g.nod=-.07*pulse;}
    if(state==='EMOTE_QUESTION'){g.arms=[-.8*pulse,0];g.nod=.13*pulse;g.lean=pulse;}
    if(state==='EMOTE_LIKE'){g.arms=[0,1.05*pulse];g.nod=-.04*pulse;}
    if(state==='EMOTE_CELEBRATE'){g.arms=[-1.05*pulse,1.05*pulse];g.lift=3*pulse;g.nod=-.05*pulse;}
    return g;
  }
  function point(x,y,state,frame,direction,frames=8,g=gesture(state,frame,frames)) {
    const rig=landmarks[direction]||landmarks.front,side=direction==='left'||direction==='right',face=direction==='left'?-1:1;
    const p=frame/frames*Math.PI*2,walk=state.startsWith('WALK')||state==='RUN',run=state==='RUN';
    const stride=walk?Math.sin(p):0,opposite=-stride;
    let dx=0,dy=0;
    // Two opposing hip/knee/ankle chains. The planted foot stays at y=124.
    const leg=smooth(rig.hipY-3,rig.hipY+9,y),right=side?0:smooth(61,68,x);
    const legPhase=stride*(1-right)+opposite*right;
    dx+=leg*legPhase*(side?(run?8.5:6):(run?4.8:3.5));
    dy-=leg*(Math.max(0,stride)*(1-right)+Math.max(0,opposite)*right)*(run?8.5:6);
    // Shoulder -> elbow -> wrist, counter-swinging to the opposite leg.
    for(let i=0;i<2;i++){
      const sx=rig.shoulders[i],sy=rig.shoulderY,armSide=i?1:-1;
      const region=smooth(sy-2,sy+8,y)*(1-smooth(94,102,y))*(1-smooth(side?6:8,side?13:17,Math.abs(x-(sx+armSide*4))));
      let angle=(i?stride:opposite)*(run?.6:.42);
      angle+=g.arms[i]*(side?face:1);
      const ax=x-sx,ay=y-sy;
      dx+=region*(Math.cos(angle)*ax-Math.sin(angle)*ay-ax);
      dy+=region*(Math.sin(angle)*ax+Math.cos(angle)*ay-ay);
    }
    // Hair/cape secondary motion stays below the face and never shifts the floor pivot.
    dx+=Math.sin(p+.8)*(walk?1.5:.3)*smooth(74,90,x)*(1-smooth(89,102,y));
    dx+=Math.sin(p+.4)*(walk?1.4:.25)*smooth(82,95,y)*(1-smooth(102,111,y))*(1-smooth(12,27,Math.abs(x-64)));
    if(walk){dy-=Math.abs(Math.sin(p))*1.1*(1-leg);dx+=face*(run?2:0)*smooth(104,55,y)}
    // Bend through hips/knees while the soles stay planted; head/costume remain coherent.
    const upper=1-smooth(96,124,y),head=1-smooth(62,76,y);
    dx+=g.lean*face*upper;
    dy+=(g.crouch-g.lift-g.breath)*upper;
    const hx=x-64,hy=y-67,angle=g.nod*face;
    dx+=head*(Math.cos(angle)*hx-Math.sin(angle)*hy-hx);
    dy+=head*(Math.sin(angle)*hx+Math.cos(angle)*hy-hy);
    // Close only the existing eye band. No painted replacement face or borrowed eyes.
    if(direction!=='back'&&g.blink){
      const eyeX=direction==='front'?64:direction==='left'?52:72,eyeY=direction==='front'?54:53;
      const eye=(1-smooth(3,9,Math.abs(y-eyeY)))*(1-smooth(direction==='front'?10:4,direction==='front'?18:10,Math.abs(x-eyeX)));
      dy-=(y-eyeY)*g.blink*eye;
    }
    return [x+dx,y+dy];
  }
  function triangle(c,img,u,v,w,a,b,d){
    const det=(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
    const A=((b[0]-a[0])*(w[1]-u[1])-(d[0]-a[0])*(v[1]-u[1]))/det;
    const B=((b[1]-a[1])*(w[1]-u[1])-(d[1]-a[1])*(v[1]-u[1]))/det;
    const C=((d[0]-a[0])*(v[0]-u[0])-(b[0]-a[0])*(w[0]-u[0]))/det;
    const D=((d[1]-a[1])*(v[0]-u[0])-(b[1]-a[1])*(w[0]-u[0]))/det;
    c.save();c.beginPath();
    // A subpixel overlap removes canvas antialias cracks between adjacent triangles.
    const cx=(a[0]+b[0]+d[0])/3,cy=(a[1]+b[1]+d[1])/3;
    for(const [i,q]of [a,b,d].entries()){const r=Math.hypot(q[0]-cx,q[1]-cy)||1,x=q[0]+(q[0]-cx)*.16/r,y=q[1]+(q[1]-cy)*.16/r;if(i)c.lineTo(x,y);else c.moveTo(x,y)}
    c.closePath();c.clip();c.transform(A,B,C,D,a[0]-A*u[0]-C*u[1],a[1]-B*u[0]-D*u[1]);c.drawImage(img,0,0,128,128);c.restore();
  }
  function paint(c,img,state,frame,direction,frames){
    const gesturePose=gesture(state,frame,frames);
    c.save();c.translate(-160,-310);c.scale(2.5,2.5);
    // Side references hide one leg. Reuse this hero's own boot behind the body, keeping
    // the visible boot rigid instead of splitting/stretching it into opposing halves.
    if((direction==='left'||direction==='right')&&(state==='RUN'||state.startsWith('WALK'))){
      const stride=Math.sin(frame/frames*Math.PI*2),x=direction==='left'?54:55,hip=direction==='left'?65:63;
      c.save();c.translate(hip-stride*(state==='RUN'?8:5.5),101-Math.max(0,-stride)*6);c.rotate(stride*.2);
      c.globalAlpha=.88;c.drawImage(img,x,102,20,23,x-hip,1,20,23);c.restore();
    }
    // Sparse top rows preserve the face; finer rows resolve arms, knees and boots.
    const xs=[0,16,24,32,40,44,48,52,56,60,64,68,72,76,80,84,88,96,104,112,128];
    const ys=['IDLE','DEFEAT'].includes(state)?[0,8,24,40,46,50,52,54,56,58,62,64,70,74,78,82,86,90,94,98,102,106,110,114,118,124,128]:[0,8,24,40,56,64,70,74,78,82,86,90,94,98,102,106,110,114,118,124,128];
    for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
      const u=[xs[i],ys[j]],v=[xs[i+1],ys[j]],w=[xs[i],ys[j+1]],z=[xs[i+1],ys[j+1]];
      const a=point(...u,state,frame,direction,frames,gesturePose),b=point(...v,state,frame,direction,frames,gesturePose),d=point(...w,state,frame,direction,frames,gesturePose),e=point(...z,state,frame,direction,frames,gesturePose);
      triangle(c,img,u,v,w,a,b,d);triangle(c,img,v,z,w,b,e,d);
    }c.restore();
  }
  // Vector expressions are separate from character art and independent of system fonts.
  function expression(c,state,frame,frames){
    if(!state.startsWith('EMOTE_'))return;
    const p=frame/Math.max(1,frames-1)*Math.PI;
    c.save();c.translate(263,67-Math.sin(p)*6);c.scale(1+Math.sin(p)*.08,1+Math.sin(p)*.08);
    c.fillStyle='#160c30';c.strokeStyle='#cba1ff';c.lineWidth=2;c.beginPath();c.arc(0,0,21,0,Math.PI*2);c.fill();c.stroke();
    c.strokeStyle='#f3e3ff';c.fillStyle='#f3e3ff';c.lineWidth=3.5;c.lineCap='round';c.lineJoin='round';c.beginPath();
    if(state==='EMOTE_ALERT'){c.moveTo(0,-11);c.lineTo(0,3);c.stroke();c.beginPath();c.arc(0,10,2,0,Math.PI*2);c.fill();}
    if(state==='EMOTE_QUESTION'){c.moveTo(-7,-7);c.bezierCurveTo(-7,-16,10,-16,8,-6);c.bezierCurveTo(7,-1,0,-2,0,4);c.stroke();c.beginPath();c.arc(0,11,2,0,Math.PI*2);c.fill();}
    if(state==='EMOTE_LIKE'){c.moveTo(0,12);c.bezierCurveTo(-25,-3,-8,-19,0,-8);c.bezierCurveTo(8,-19,25,-3,0,12);c.fillStyle='#e8a0ee';c.fill();}
    if(state==='EMOTE_CELEBRATE'){for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/2,r=i%2?4:14;const x=Math.cos(a)*r,y=Math.sin(a)*r;i?c.lineTo(x,y):c.moveTo(x,y)}c.closePath();c.fillStyle='#ffe59f';c.fill();}
    c.restore();
  }
  window.TsukiyomiRig={paint,point,gesture,expression,version:5};
})();
