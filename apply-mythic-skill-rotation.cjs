/* Presentation metadata only, applied after combat rules. Never changes hit/damage fields. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const patches=[
 ['for(const unit of team){const h=S.h.find(h=>h.id===unit.id);if(!h)continue;const p=position(unit.slot);',
  "window.MythicHero?.drawHuntSkills?.(c,now,{target,position},'ground');for(const unit of team){const h=S.h.find(h=>h.id===unit.id);if(!h)continue;const p=position(unit.slot);"],
 ['for(const hit of b?.hits||[]){drawSkillImpact(c,hit);',
  "window.MythicHero?.drawHuntSkills?.(c,now,{target,position},'front');for(const hit of b?.hits||[]){drawSkillImpact(c,hit);"],
 ['state.projectiles.push({heroId:h.id,slot:unit.slot,rank:h.r,damage:i===0?damage:0,cosmetic:i!==0,ultimate,index:i,remaining:.45,lifetime:.45});',
  'state.projectiles.push({mythicSkill:window.MythicHero?.attackSkill?.(h,unit.shots,state.entry?.id,{contract:unit.contract}),heroId:h.id,slot:unit.slot,rank:h.r,damage:i===0?damage:0,cosmetic:i!==0,ultimate,index:i,remaining:.45,lifetime:.45});'],
 ['state.hits.push({damage:applied,life:.8,slot:shot.slot,rank:shot.rank,ultimate:shot.ultimate,heroId:shot.heroId});',
  'state.hits.push({mythicSkill:shot.mythicSkill,damage:applied,life:.8,slot:shot.slot,rank:shot.rank,ultimate:shot.ultimate,heroId:shot.heroId});'],
 ['Every 8 attacks · visual flourish only · 0 additional chakra</span>',
  "${h.r===5?'Automatic skills alternate with basic attacks':'Every 8 attacks'} · visual flourish only · 0 additional chakra</span>"]
];
function patchHtml(html){for(const [before,after]of patches){if(html.split(after).length===2)continue;if(html.split(before).length!==2)throw Error('Mythic rotation presentation anchor changed');html=html.replace(before,after)}return html}
function applyMythicSkillRotation(appDir=path.join(__dirname,'app')){const p=path.join(appDir,'public/index.html');fs.writeFileSync(p,patchHtml(fs.readFileSync(p,'utf8')));for(const file of ['automatic-skills.js','animation-runtime.js','clean-effects.js'])fs.copyFileSync(path.join(__dirname,'mythic-hero',file),path.join(appDir,'public/assets/mythic-hero',file));console.log('Mythic automatic skills v2: one cosmetic choice per actual attack, shared by decorative volleys and impact.');}
module.exports={applyMythicSkillRotation,patches,patchHtml};
if(require.main===module)applyMythicSkillRotation();
