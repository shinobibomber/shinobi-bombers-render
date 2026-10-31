const fs = require('node:fs');
const path = require('node:path');
const marker = '<!-- character-animation-sets -->';
const script = '<script defer src="assets/character-animations/character-animations.js"></script>';
const patches = [
 [
  'function drawSkillProjectile(c,shot,x,y,now){',
  "function drawSkillProjectile(c,shot,x,y,now){if(window.CharacterAnimations?.loaded){const unit=state()?.team.find(unit=>unit.slot===shot.slot),origin=position(shot.slot);if(CharacterAnimations.drawHuntProjectile(c,shot,x,y,now,unit?.id||0,Math.atan2(target.y-origin.y,target.x-origin.x)))return;}"
 ],
 [
  'function drawSkillImpact(c,hit){',
  "function drawSkillImpact(c,hit){if(window.CharacterAnimations?.loaded){const unit=state()?.team.find(unit=>unit.slot===hit.slot);if(CharacterAnimations.drawHuntImpact(c,hit,target,unit?.id||0))return;}"
 ],
 [
  "const pose=sleeping?'s0':atkPose||(a.moving?SS.walkName(a.phase):SS.idleName(now,seed)),img=SS.heroFrame",
  "const pose=window.CharacterAnimations?.loaded?CharacterAnimations.poseFor(h,now,{moving:a.moving,direction:a.direction,phase:a.phase,sleeping,attackAge:since}):(sleeping?'s0':atkPose||(a.moving?SS.walkName(a.phase):SS.idleName(now,seed))),img=SS.heroFrame"
 ],
 [
  "g.save();g.translate(sx,sy);\r\n  if(kind==='rasengan')",
  "if(window.CharacterAnimations?.drawProjectile(g,b,now,{x:sx,y:sy,scale:s,angle:ang}))return;\r\n  g.save();g.translate(sx,sy);\r\n  if(kind==='rasengan')"
 ],
 [
  "SS.blit(g,img,sx,sy+hop,s,flip);",
  "SS.blit(g,img,sx,sy+hop,s,flip);if(window.CharacterAnimations?.loaded)CharacterAnimations.drawActorEffects(g,h,now,{x:sx,y:sy+hop,scale:s,flip});"
 ],
 [
  "drawParticles(dt);\r\n  for(const f of fl)",
  "drawParticles(dt);if(window.CharacterAnimations?.loaded)CharacterAnimations.drawImpacts(g,now,{proj,Sg});\r\n  for(const f of fl)"
 ]
];
function count(text, value) { return text.split(value).length - 1; }
function patchHtml(html) {
 if(count(html,'</head>')!==1)throw Error('Animation setup requires one HTML head.');
 const applied=count(html,marker)===1;
 if(count(html,marker)>1||count(html,script)!==(applied?1:0))throw Error('Inconsistent animation script marker.');
 for(const [from,to]of patches){
  // Some replacements contain the original as a suffix; check complete replacement first.
  if(applied){if(count(html,to)!==1)throw Error('Animation render hook was changed or partially applied.');}
  else {if(count(html,from)!==1||html.includes(to))throw Error('Animation render hook does not match the expected game source.');}
 }
 if(applied)return html;
 for(const [from,to]of patches)html=html.replace(from,to);
 return html.replace('</head>',marker+'\n'+script+'\n</head>');
}
function applyCharacterAnimations(appDir=path.join(__dirname,'app')){
 const index=path.join(appDir,'public','index.html');
 const html=fs.readFileSync(index,'utf8'),patched=patchHtml(html);
 const files=['character-animations.js','manifest.json','animationset1.png','animationset2.png','animationset3.png','animationset4.png'];
 for(const file of files)if(!fs.statSync(path.join(__dirname,'character-animations',file)).isFile())throw Error('Missing original animation asset '+file);
 const dest=path.join(appDir,'public','assets','character-animations');fs.mkdirSync(dest,{recursive:true});
 for(const file of files)fs.copyFileSync(path.join(__dirname,'character-animations',file),path.join(dest,file));
 if(html!==patched)fs.writeFileSync(index,patched);
 console.log('Character-specific animation sets and effects applied.');
}
module.exports={applyCharacterAnimations,patchHtml};
if(require.main===module)applyCharacterAnimations();
