const fs=require('node:fs'),path=require('node:path');
const marker='<!-- v3-semantic-summoning -->';
function applyV3Summoning(appDir=path.join(__dirname,'app')){
 const file=path.join(appDir,'public/index.html');let html=fs.readFileSync(file,'utf8');
 if(html.split('</head>').length!==2||html.split(marker).length>2)throw Error('V3 Summoning HTML markers changed.');
 const destination=path.join(appDir,'public/assets/v3-summoning');fs.mkdirSync(destination,{recursive:true});
 for(const name of ['v3-summoning.js','v3-summoning.css'])fs.copyFileSync(path.join(__dirname,'v3-summoning',name),path.join(destination,name));
 if(!html.includes(marker)){html=html.replace('</head>',marker+'\n<link rel="stylesheet" href="assets/v3-summoning/v3-summoning.css">\n<script defer src="assets/v3-summoning/v3-summoning.js"></script>\n</head>');fs.writeFileSync(file,html);}
 console.log('V3 semantic Summoning Shrine and persisted scroll reveal enhancements applied.');
}
module.exports={applyV3Summoning};if(require.main===module)applyV3Summoning();
