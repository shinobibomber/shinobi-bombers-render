import{useEffect,useRef,type ReactNode}from'react';
import{Icon}from'./Icons';
export function Modal({title,children,onClose,busy}:{title:string;children:ReactNode;onClose:()=>void;busy:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const caller=document.activeElement as HTMLElement|null;const dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();if(caller?.isConnected)caller.focus({preventScroll:true})}},[]);
 return <dialog ref={ref} className="gc-dialog" aria-labelledby="gc-dialog-title" onKeyDown={event=>{
  if(event.key!=='Tab')return;
  const dialog=ref.current;if(!dialog)return;
  const nodes=[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden');
  if(!nodes.length){event.preventDefault();dialog.focus();return}
  const current=document.activeElement,first=nodes[0],last=nodes[nodes.length-1];
  if(event.shiftKey&&(current===first||!nodes.includes(current as HTMLElement))){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&(current===last||!nodes.includes(current as HTMLElement))){event.preventDefault();first.focus()}
 }} onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
  <header className="gc-dialog-header"><div><span className="gc-eyebrow">MANAGE YOUR ADVENTURE RYO</span><h1 id="gc-dialog-title" tabIndex={-1}><Icon name="chest" size={31}/>{title}</h1></div><button className="gc-close" aria-label="Close Chest" disabled={busy} onClick={onClose}><Icon name="close"/></button></header>{children}
 </dialog>
}
