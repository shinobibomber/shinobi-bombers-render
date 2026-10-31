const fs=require('node:fs'),path=require('node:path');
const marker='<!-- exact-startup-design -->';
const before="await ShinobiSprites.ready;set(2,'Shinobi and arenas ready')";
const after="await ShinobiSprites.ready;await window.LoadingDesign?.ready;set(2,'Shinobi and arenas ready')";
const count=(text,part)=>text.split(part).length-1;
function applyLoadingDesign(appDir=path.join(__dirname,'app')){
 const file=path.join(appDir,'public/index.html');let html=fs.readFileSync(file,'utf8');const done=count(html,marker)===1;
 if(count(html,marker)>1||count(html,'</head>')!==1||count(html,done?after:before)!==1)throw Error('Startup gate changed or partially patched');
 const dest=path.join(appDir,'public/assets/loading-design');fs.mkdirSync(dest,{recursive:true});for(const name of ['loading-design.js','loading-design.css'])fs.copyFileSync(path.join(__dirname,'loading-design',name),path.join(dest,name));
 if(!done){html=html.replace(before,after).replace('</head>',marker+'\n<link rel="stylesheet" href="assets/loading-design/loading-design.css">\n<script defer src="assets/loading-design/loading-design.js"></script>\n</head>');fs.writeFileSync(file,html)}
 console.log('Original login artwork applied to startup; complete deferred model pipeline awaited.');
}
module.exports={applyLoadingDesign};if(require.main===module)applyLoadingDesign();
