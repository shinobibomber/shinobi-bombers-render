/* Tsukiyomi v3: continuous texture skinning of the approved four views.
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
  function point(x,y,state,frame,direction,frames=8) {
    const rig=landmarks[direction]||landmarks.front,side=direction==='left'||direction==='right',face=direction==='left'?-1:1;
    const p=frame/frames*Math.PI*2,walk=state.startsWith('WALK')||state==='RUN',run=state==='RUN';
    const stride=walk?Math.sin(p):0,opposite=-stride,attack=state==='ATTACK'||state.startsWith('SKILL_');
    let dx=0,dy=0;
    // Two opposing hip/knee/ankle chains. The planted foot stays at y=124.
    const leg=smooth(rig.hipY-3,rig.hipY+9,y),right=side?0:smooth(61,68,x);
    const legPhase=stride*(1-right)+opposite*right;
    dx+=leg*legPhase*(side?(run?7:5):(run?3.8:2.8));
    dy-=leg*(Math.max(0,stride)*(1-right)+Math.max(0,opposite)*right)*(run?7:5);
    // Shoulder -> elbow -> wrist, counter-swinging to the opposite leg.
    for(let i=0;i<2;i++){
      const sx=rig.shoulders[i],sy=rig.shoulderY,armSide=i?1:-1;
      const region=smooth(sy-2,sy+8,y)*(1-smooth(94,102,y))*(1-smooth(side?6:8,side?13:17,Math.abs(x-(sx+armSide*4))));
      let angle=(i?stride:opposite)*(run?.46:.32);
      if(attack)angle+=face*Math.sin(frame/Math.max(1,frames-1)*Math.PI)*(i?-.7:.25);
      if(state==='BOMB_PLACE')angle+=Math.sin(frame/(frames-1)*Math.PI)*armSide*.3;
      if(state==='VICTORY'||state==='EMOTE_CELEBRATE')angle+=Math.sin(frame/(frames-1)*Math.PI)*armSide*-.55;
      const ax=x-sx,ay=y-sy;
      dx+=region*(Math.cos(angle)*ax-Math.sin(angle)*ay-ax);
      dy+=region*(Math.sin(angle)*ax+Math.cos(angle)*ay-ay);
    }
    // Hair/cape secondary motion stays below the face and never shifts the floor pivot.
    dx+=Math.sin(p+.8)*(walk?1.5:.3)*smooth(74,90,x)*(1-smooth(89,102,y));
    dx+=Math.sin(p+.4)*(walk?1.4:.25)*smooth(82,95,y)*(1-smooth(102,111,y))*(1-smooth(12,27,Math.abs(x-64)));
    if(walk){dy-=Math.abs(Math.sin(p))*1.1*(1-leg);dx+=face*(run?2:0)*smooth(104,55,y)}
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
    c.save();c.translate(-160,-310);c.scale(2.5,2.5);
    // Side references hide one leg. Reuse this hero's own boot behind the body, keeping
    // the visible boot rigid instead of splitting/stretching it into opposing halves.
    if((direction==='left'||direction==='right')&&(state==='RUN'||state.startsWith('WALK'))){
      const stride=Math.sin(frame/frames*Math.PI*2),x=direction==='left'?54:55,hip=direction==='left'?65:63;
      c.save();c.translate(hip-stride*(state==='RUN'?6:4),101-Math.max(0,-stride)*5);c.rotate(stride*.15);
      c.globalAlpha=.88;c.drawImage(img,x,102,20,23,x-hip,1,20,23);c.restore();
    }
    // Sparse top rows preserve the face; finer rows resolve arms, knees and boots.
    const xs=[0,16,24,32,40,44,48,52,56,60,64,68,72,76,80,84,88,96,104,112,128];
    const ys=[0,8,24,40,56,64,70,74,78,82,86,90,94,98,102,106,110,114,118,124,128];
    for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
      const u=[xs[i],ys[j]],v=[xs[i+1],ys[j]],w=[xs[i],ys[j+1]],z=[xs[i+1],ys[j+1]];
      const a=point(...u,state,frame,direction,frames),b=point(...v,state,frame,direction,frames),d=point(...w,state,frame,direction,frames),e=point(...z,state,frame,direction,frames);
      triangle(c,img,u,v,w,a,b,d);triangle(c,img,v,z,w,b,e,d);
    }c.restore();
  }
  window.TsukiyomiRig={paint,point,version:3};
})();
