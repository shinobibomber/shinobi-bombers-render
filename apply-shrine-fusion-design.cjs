const fs=require('node:fs'),path=require('node:path');
const marker='<!-- exact-shrine-fusion-design -->';
function applyShrineFusionDesign(appDir=path.join(__dirname,'app')){
 const file=path.join(appDir,'public/index.html'),html=fs.readFileSync(file,'utf8');
 const style='<link rel="stylesheet" href="assets/shrine-fusion-design/shrine-fusion-design.css">';
 const script='<script defer src="assets/shrine-fusion-design/shrine-fusion-design.js"></script>';
 const count=html.split(marker).length-1;
 if(count>1||html.split('</head>').length!==2||html.split(style).length-1!==count||html.split(script).length-1!==count)throw Error('Inconsistent Shrine/Fusion design installation.');
 const dest=path.join(appDir,'public/assets/shrine-fusion-design');fs.mkdirSync(dest,{recursive:true});
 for(const name of ['summoning-shrine.png','fusion-menu.png','shrine-fusion-design.js','shrine-fusion-design.css'])fs.copyFileSync(path.join(__dirname,'shrine-fusion-design',name),path.join(dest,name));
 if(!count)fs.writeFileSync(file,html.replace('</head>',marker+'\n'+style+'\n'+script+'\n</head>'));
 console.log('Original Summoning Shrine and Fusion scenes applied with live purchase controls.');
}
module.exports={applyShrineFusionDesign};if(require.main===module)applyShrineFusionDesign();
