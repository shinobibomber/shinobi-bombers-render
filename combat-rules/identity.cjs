'use strict';
const crypto=require('node:crypto'),rules=require('./combat-rules.cjs');
function assign(h){
 let step=0;const rand=n=>crypto.createHash('sha256').update(String(h.tokenId)+':combat-v1:'+step++).digest().readUInt32BE(0)%n;
 h.perks=rules.normalizePerks(h.rank,h.perks,rand);
 if(!Number.isInteger(h.look)||h.look<0||h.look>7)h.look=rand(8);
 if(h.rank===5&&h.combatVersion!==rules.VERSION){
  h.baseStats={...h.baseStats};for(const k of ['pw','sp','st'])if(!Number.isInteger(h.baseStats[k])||h.baseStats[k]<17||h.baseStats[k]>20)h.baseStats[k]=17+rand(4);
 }
 h.identityVersion=2;h.combatVersion=rules.VERSION;return h;
}
module.exports={assign};
