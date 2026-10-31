const fs=require('node:fs'),path=require('node:path'),marker='<!-- v3-marketplace-presentation -->';
function applyV3Market(appDir=path.join(__dirname,'app')){
 const file=path.join(appDir,'public/index.html');let html=fs.readFileSync(file,'utf8');const count=html.split(marker).length-1;if(count>1||html.split('</head>').length!==2)throw Error('Invalid V3 marketplace installation marker.');
 const dest=path.join(appDir,'public/assets/v3-market');fs.mkdirSync(dest,{recursive:true});for(const name of ['v3-market.js','v3-market.css'])fs.copyFileSync(path.join(__dirname,'v3-market',name),path.join(dest,name));
 if(!count){html=html.replace('</head>',marker+'\n<link rel="stylesheet" href="assets/v3-market/v3-market.css">\n<script defer src="assets/v3-market/v3-market.js"></script>\n</head>');fs.writeFileSync(file,html)}
 console.log('V3 marketplace presentation applied; existing listing/security logic retained.');
}
module.exports={applyV3Market};if(require.main===module)applyV3Market();
