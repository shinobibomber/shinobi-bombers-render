const fs=require('node:fs'),path=require('node:path');
const marker='<!-- exact-adventure-roster -->';
const style='<link rel="stylesheet" href="assets/roster-design/roster-design.css">';
const script='<script defer src="assets/roster-design/roster-design.js"></script>';
function applyRosterDesign(appDir=path.join(__dirname,'app')){
 const file=path.join(appDir,'public/index.html');let html=fs.readFileSync(file,'utf8');
 const count=html.split(marker).length-1;
 if(count>1||html.split('</head>').length!==2||html.split(style).length-1!==count||html.split(script).length-1!==count)throw Error('Cannot apply roster design: invalid HTML or inconsistent script marker.');
 const files=['source.webp','roster-design.js','roster-design.css'];
 for(const name of files)if(!fs.statSync(path.join(__dirname,'roster-design',name)).isFile())throw Error('Missing roster design asset '+name);
 const dest=path.join(appDir,'public/assets/roster-design');fs.mkdirSync(dest,{recursive:true});
 for(const name of files)fs.copyFileSync(path.join(__dirname,'roster-design',name),path.join(dest,name));
 if(!count){html=html.replace('</head>',marker+'\n'+style+'\n'+script+'\n</head>');fs.writeFileSync(file,html);}
 console.log('Original Adventure hero roster design and shared models applied.');
}
module.exports={applyRosterDesign};if(require.main===module)applyRosterDesign();
