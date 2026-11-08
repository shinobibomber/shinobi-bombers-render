'use strict';
// Called under the existing ordered wallet locks when an NFT changes owner.
async function detach(store,c,wallet,hero){
 const C=require('./combat-chakra.cjs'),now=store.now(),reservation=hero.chakra?.hunt;
 if(reservation){
  const row=(await c.query('SELECT combat FROM ryo_hunt_entries WHERE scope=$1 AND id=$2 AND wallet=$3 FOR UPDATE',[store.scope,reservation.entryId,wallet])).rows[0];
  if(row?.combat){const unit=row.combat.team.find(u=>u.id===hero.tokenId);if(unit)unit.ends=Math.min(unit.ends??row.combat.ends,now);await c.query('UPDATE ryo_hunt_entries SET combat=$3 WHERE scope=$1 AND id=$2',[store.scope,reservation.entryId,JSON.stringify(row.combat)]);}
  reservation.ends=Math.min(reservation.ends,now);
 }
 C.setResting(hero,true,now);return hero;
}
module.exports={detach};
