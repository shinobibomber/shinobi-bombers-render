/* Presentation metadata only, applied after combat rules. Never changes hit/damage fields. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const patches=[
 ['state.projectiles.push({heroId:h.id,slot:unit.slot,rank:h.r,damage:i===0?damage:0,cosmetic:i!==0,ultimate,index:i,remaining:.45,lifetime:.45});',
  'state.projectiles.push({mythicSkill:window.MythicHero?.attackSkill?.(h,unit.shots,state.entry?.id),heroId:h.id,slot:unit.slot,rank:h.r,damage:i===0?damage:0,cosmetic:i!==0,ultimate,index:i,remaining:.45,lifetime:.45});'],
 ['state.hits.push({damage:applied,life:.8,slot:shot.slot,rank:shot.rank,ultimate:shot.ultimate,heroId:shot.heroId});',
  'state.hits.push({mythicSkill:shot.mythicSkill,damage:applied,life:.8,slot:shot.slot,rank:shot.rank,ultimate:shot.ultimate,heroId:shot.heroId});'],
 ['Every 8 attacks · visual flourish only · 0 additional chakra</span>',
  "${h.r===5?'Cycles four skills, one per attack':'Every 8 attacks'} · visual flourish only · 0 additional chakra</span>"]
];
function patchHtml(html){for(const [before,after]of patches){if(html.split(after).length===2)continue;if(html.split(before).length!==2)throw Error('Mythic rotation presentation anchor changed');html=html.replace(before,after)}return html}
function applyMythicSkillRotation(appDir=path.join(__dirname,'app')){const p=path.join(appDir,'public/index.html');fs.writeFileSync(p,patchHtml(fs.readFileSync(p,'utf8')));console.log('Mythic skill rotation: one cosmetic choice per actual attack, shared by decorative volleys and impact.');}
module.exports={applyMythicSkillRotation,patches,patchHtml};
if(require.main===module)applyMythicSkillRotation();
