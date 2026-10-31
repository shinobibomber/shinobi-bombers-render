/* Add a visual compatibility/production-import boundary without replacing the engine. */
const fs=require('node:fs'),path=require('node:path');
const marker='<!-- v3-animation-contract -->';
function applyV3Animation(appDir=path.join(__dirname,'app')){
 const file=path.join(appDir,'public/index.html'),html=fs.readFileSync(file,'utf8'),count=html.split(marker).length-1;
 if(count>1||html.split('</head>').length!==2)throw Error('Cannot apply V3 animation: inconsistent HTML head.');
 const dest=path.join(appDir,'public/assets/v3-animation');fs.mkdirSync(dest,{recursive:true});
 for(const name of ['animation-contract.js','v3-animation.js','v3-animation.css','inventory.json','production-frame-template.json'])fs.copyFileSync(path.join(__dirname,'v3-animation',name),path.join(dest,name));
 if(!count)fs.writeFileSync(file,html.replace('</head>',marker+'\n<link rel="stylesheet" href="assets/v3-animation/v3-animation.css">\n<script defer src="assets/v3-animation/animation-contract.js"></script>\n<script defer src="assets/v3-animation/v3-animation.js"></script>\n</head>'));
 console.log('V3 visual contract, stable model inventory, aura quality adapter and asset studio applied.');
}
module.exports={applyV3Animation};if(require.main===module)applyV3Animation();
