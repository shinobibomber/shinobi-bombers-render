const fs=require('node:fs'),path=require('node:path');
const marker='<!-- exact-dojo-services -->';
function patchHtml(html){
 const count=html.split(marker).length-1;
 if(count>1||html.split('</head>').length!==2)throw Error('Cannot apply Dojo design: inconsistent HTML head.');
 if(count===1)return html;
 return html.replace('</head>',marker+'\n<link rel="stylesheet" href="assets/dojo-design/dojo-design.css">\n<script defer src="assets/dojo-design/dojo-design.js"></script>\n</head>');
}
function applyDojoDesign(appDir=path.join(__dirname,'app')){
 const index=path.join(appDir,'public/index.html'),html=fs.readFileSync(index,'utf8'),patched=patchHtml(html);
 const destination=path.join(appDir,'public/assets/dojo-design');fs.mkdirSync(destination,{recursive:true});
 for(const file of ['dojo-menu.png','dojo-list-upgrades.png','sensei-tab.png','dojo-design.js','dojo-design.css'])fs.copyFileSync(path.join(__dirname,'dojo-design',file),path.join(destination,file));
 if(html!==patched)fs.writeFileSync(index,patched);
 console.log('Supplied Dojo, upgrade and Sensei scenes applied with live service controls.');
}
module.exports={applyDojoDesign,patchHtml};if(require.main===module)applyDojoDesign();
