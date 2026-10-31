const fs=require('node:fs'),path=require('node:path');
const marker='<!-- v3-native-adventure -->';
function applyV3Adventure(appDir=path.join(__dirname,'app')){
 const htmlFile=path.join(appDir,'public/index.html');let html=fs.readFileSync(htmlFile,'utf8');
 if(html.split('</head>').length!==2||html.split(marker).length>2)throw Error('V3 Adventure HTML markers changed.');
 const destination=path.join(appDir,'public/assets/v3-adventure');fs.mkdirSync(destination,{recursive:true});
 for(const name of ['v3-adventure.js','v3-adventure.css','environments.json'])fs.copyFileSync(path.join(__dirname,'v3-adventure',name),path.join(destination,name));
 // Do not install a second simulation. The old picture-driven adapter is
 // conditionally inert before its asynchronous readiness callback can run.
 const legacy=path.join(appDir,'public/assets/map-design/map-design.js');let source=fs.readFileSync(legacy,'utf8');
 const before='if (!api.loaded || !G?.length || aligned.has(G)) return;',after='if (!api.loaded || window.V3Adventure?.preserveNativeGrid || !G?.length || aligned.has(G)) return;';
 if(!source.includes(after)){if(source.split(before).length!==2)throw Error('Legacy map alignment guard changed.');source=source.replace(before,after);fs.writeFileSync(legacy,source);}
 const loaderBefore='await Promise.all(data.maps.map((entry, i) => new Promise((resolve, reject) => {',loaderAfter='if (!window.V3Adventure?.preserveNativeGrid) await Promise.all(data.maps.map((entry, i) => new Promise((resolve, reject) => {';
 if(!source.includes(loaderAfter)){if(source.split(loaderBefore).length!==2)throw Error('Legacy map image loader changed.');source=source.replace(loaderBefore,loaderAfter);}
 const floorBefore='AdventureDesign.drawFloor = drawFloor; AdventureDesign.drawWall = () => {};',floorAfter='if (!window.V3Adventure?.preserveNativeGrid) { AdventureDesign.drawFloor = drawFloor; AdventureDesign.drawWall = () => {}; }';
 if(!source.includes(floorAfter)){if(source.split(floorBefore).length!==2)throw Error('Legacy screenshot renderer bridge changed.');source=source.replace(floorBefore,floorAfter);}
 fs.writeFileSync(legacy,source);
 if(!html.includes(marker))html=html.replace('</head>',marker+'\n<link rel="stylesheet" href="assets/v3-adventure/v3-adventure.css">\n<script defer src="assets/v3-adventure/v3-adventure.js"></script>\n</head>');
 const earlyFlag='<script>window.V3Adventure={preserveNativeGrid:true};</script>';
 if(!html.includes(earlyFlag))html=html.replace(marker,earlyFlag+'\n'+marker);
 fs.writeFileSync(htmlFile,html);
 console.log('V3 Adventure tiles render native G without screenshot topology replacement.');
}
module.exports={applyV3Adventure};if(require.main===module)applyV3Adventure();
