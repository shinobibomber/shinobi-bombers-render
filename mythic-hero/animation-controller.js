/* Presentation-only state machine. No wallet, damage, movement or reward dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MythicAnimation = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const aliases = { idle:'IDLE', walk:'WALK_FRONT', run:'RUN', melee:'ATTACK', ranged:'ATTACK', bomb:'BOMB_PLACE', hurt:'HURT', die:'DEFEAT', victory:'VICTORY', skill:'ULTIMATE_DRAGON_ASCENSION' };
  const facing = value => ['front','left','right','back'].includes(value) ? value : value === 'side' ? 'right' : 'front';
  function create(manifest, notify = () => {}) {
    const actors = new Map(), clips = manifest.states;
    let serial = 0;
    function key(hero) { return hero?.tokenId ?? hero?.id ?? null; }
    function record(hero, now) {
      const id = key(hero); if (id == null) return null;
      let r = actors.get(id);
      if (!r) {
        if (actors.size >= 128) actors.delete(actors.keys().next().value);
        r = { id, state:'IDLE', started:now, seen:now, direction:'front', event:null, emitted:-1, generation:0, frame:0, cycles:0, phase:null, last:now, moving:false, gaitPhase:null, gaitCycles:0, moveFrame:0 };
        actors.set(id, r);
      }
      r.seen = now; return r;
    }
    function emit(r, name, frame) {
      try { notify(Object.freeze({ actor:r.id, state:r.state, name, frame, generation:r.generation, cosmetic:true })); } catch { /* Observers cannot interrupt combat. */ }
    }
    function enter(r, state, now, event) {
      r.state=state; r.started=now; r.event=event; r.emitted=-1; r.frame=0; r.generation=++serial;
      r.cycles=0; r.phase=null; r.last=now;
    }
    function play(hero, value, options = {}) {
      const state=aliases[value] || String(value).toUpperCase(), clip=clips[state], now=options.now ?? performance.now();
      if (!clip || !Number.isFinite(now)) return false;
      const r=record(hero,now); if (!r) return false;
      if (options.eventId != null && r.event === options.eventId) return false;
      const old=clips[r.state];
      if(options.coalesce && r.state===state && !old.loop && now-r.started<old.durationMs)return false;
      if (!options.force && !old.loop && now-r.started < old.durationMs && old.priority>clip.priority) return false;
      r.direction=facing(options.direction || r.direction);
      enter(r,state,now,options.eventId ?? serial+1); emit(r,'start',0); return true;
    }
    function sample(hero, now, context = {}) {
      const r=record(hero,now); if (!r) return null;
      const dir=facing(context.direction || r.direction); r.direction=dir;
      if (context.sleeping) { if (r.state!=='IDLE') {emit(r,'cancel',r.frame);enter(r,'IDLE',now,null);} r.moving=false; r.frame=0; return r; }
      r.moving=!!context.moving;
      // Gait is independent of attacks and direction changes. Native shots cannot freeze feet.
      if(Number.isFinite(context.phase)){
        if(r.moving && r.gaitPhase!=null)r.gaitCycles+=Math.max(0,Math.min(4,context.phase-r.gaitPhase))/4;
        r.gaitPhase=context.phase;
        r.moveFrame=Math.floor(r.gaitCycles*8)%8;
      }else r.moveFrame=Math.floor(now/(context.running?75:100))%8;
      let clip=clips[r.state], age=Math.max(0,now-r.started);
      if (!clip.loop) {
        const current=Math.min(clip.frames-1,Math.floor(age/clip.durationMs*clip.frames));
        for (const [name,frame] of Object.entries(clip.events || {})) if (frame>r.emitted && frame<=current) emit(r,name,frame);
        r.emitted=Math.max(r.emitted,current); r.frame=context.reducedMotion?(clip.reducedFrame??0):current;
        if (age<clip.durationMs) return r;
        emit(r,'complete',clip.frames-1);
        enter(r,'IDLE',now,null);
      }
      const next=context.moving ? (context.running ? 'RUN' : 'WALK_'+dir.toUpperCase()) : 'IDLE';
      if (r.state!==next) enter(r,next,now,null);
      clip=clips[r.state]; r.moving=!!context.moving;
      if (r.moving && Number.isFinite(context.phase)) {
        // The renderer's distance phase advances with actual tile motion, not wall time.
        r.frame=r.moveFrame;
      } else r.frame=Math.floor(Math.max(0,now-r.started)/clip.durationMs*clip.frames)%clip.frames;
      if (context.reducedMotion) r.frame=0;
      r.last=now; return r;
    }
    function clear(hero) { if (hero) actors.delete(key(hero)); else actors.clear(); }
    function sweep(liveIds, now) {
      for(const [id,r] of actors) if(now-r.seen>30000 || liveIds && !liveIds.has(id)) actors.delete(id);
    }
    return { play, sample, clear, sweep, get size(){return actors.size}, has:hero=>actors.has(key(hero)), get:hero=>actors.get(key(hero)), states:clips };
  }
  return { create, facing };
});
