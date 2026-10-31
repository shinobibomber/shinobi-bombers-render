const fs=require('node:fs'),path=require('node:path');
const marker='<!-- original-map-designs -->';
const patches=[
 ['const CW=W*T,CHT=560,CX=CW/2;cv.height=CHT;','const CW=W*T,CHT=465,CX=CW/2;cv.height=CHT;'],
 ['const proj=(gx,gy,z)=>{const s=Sg(gy);','const proj=(gx,gy,z)=>{if(window.MapDesign?.loaded)return MapDesign.project(gx,gy,z||0);const s=Sg(gy);'],
 ['  weatherPass(now,dt);','  if(window.MapDesign?.loaded)MapDesign.drawAtmosphere(g,now);else weatherPass(now,dt);'],
 ["  const L=look();if(L.tint){g.globalCompositeOperation='soft-light';","  const L=look();if(!window.MapDesign?.loaded&&L.tint){g.globalCompositeOperation='soft-light';"],
 ['  vignette();bannerPass();g.restore();','  if(!window.MapDesign?.loaded)vignette();bannerPass();g.restore();']
];
function applyMapDesign(appDir=path.join(__dirname,'app')){
 const file=path.join(appDir,'public/index.html');let html=fs.readFileSync(file,'utf8');const count=(s,v)=>s.split(v).length-1,applied=count(html,marker)===1;
 if(count(html,marker)>1||count(html,'</head>')!==1)throw Error('Map design HTML marker changed.');
 for(const [before,after]of patches){if(applied){if(count(html,after)!==1)throw Error('Map design patch is incomplete.');}else{if(count(html,before)!==1)throw Error('Map source changed: '+before);html=html.replace(before,after);}}
 if(!applied)html=html.replace('</head>',marker+'\n<link rel="stylesheet" href="assets/map-design/map-design.css">\n<script defer src="assets/map-design/map-design.js"></script>\n</head>');
 const dest=path.join(appDir,'public/assets/map-design');fs.mkdirSync(dest,{recursive:true});for(const name of ['map-design.js','map-design.css','maps.json',...Array.from({length:8},(_,i)=>'map'+(i+1)+'.webp')])fs.copyFileSync(path.join(__dirname,'map-design',name),path.join(dest,name));
 fs.writeFileSync(file,html);console.log('Eight original map designs and aligned live collision layouts applied.');
}
module.exports={applyMapDesign};if(require.main===module)applyMapDesign();
