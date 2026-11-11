import{useEffect,useRef}from'react';
import{money}from'./bridge';
/* Deposit / withdrawal result popup (owner request 2026-11-11): a clear on-screen answer after every transfer. Display only:
 * the outcome comes from the payment client and server (credited deposit receipt, withdrawal status), never from the click. */
export type TransferKind='deposit'|'withdrawal';
export type TransferOutcome='success'|'failed'|'processing';
export interface TransferResult {kind:TransferKind;outcome:TransferOutcome;amount:number;detail?:string}
const TITLE:Record<TransferKind,Record<TransferOutcome,string>>={
 deposit:{success:'Deposit successful',failed:'Deposit failed',processing:'Deposit processing'},
 withdrawal:{success:'Withdrawal successful',failed:'Withdrawal failed',processing:'Withdrawal processing'}};
export function resultText(r:TransferResult){
 if(r.kind==='deposit')return r.outcome==='success'?money(r.amount)+' Ryo was added to your Game Balance.'
  :r.outcome==='failed'?'Your deposit of '+money(r.amount)+' Ryo was not credited.'
  :'Your deposit of '+money(r.amount)+' Ryo is being confirmed on-chain. It is credited automatically; nothing is lost.';
 return r.outcome==='success'?'Your withdrawal of '+money(r.amount)+' Ryo was sent to your connected wallet.'
  :r.outcome==='failed'?'Your withdrawal of '+money(r.amount)+' Ryo did not go through.'
  :'Your withdrawal of '+money(r.amount)+' Ryo is reserved and settling. You will see the result when it finalizes.';
}
export function ResultPopup({result,onClose}:{result:TransferResult;onClose:()=>void}){
 const ok=useRef<HTMLButtonElement>(null);
 useEffect(()=>{ok.current?.focus()},[result.outcome,result.kind]);
 const icon=result.outcome==='success'?'✓':result.outcome==='failed'?'✕':'⏳';
 return <div className="gc-result-layer" tabIndex={-1} data-gc-result={result.kind+'-'+result.outcome} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose()}}}>
  <section className={'gc-result gc-result-'+result.outcome} role="alertdialog" aria-modal="true" aria-labelledby="gc-result-title" aria-describedby="gc-result-text">
   <div className="gc-result-icon" aria-hidden="true">{icon}</div>
   <h2 id="gc-result-title">{TITLE[result.kind][result.outcome]}</h2>
   <p id="gc-result-text">{resultText(result)}</p>
   {result.detail&&<p className="gc-result-detail">{result.detail}</p>}
   <button ref={ok} type="button" className="gc-gold gc-result-ok" onClick={onClose}>OK</button>
  </section>
 </div>;
}
