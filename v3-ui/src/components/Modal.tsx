import {useEffect,useRef,type ReactNode} from 'react';
import {Icon} from './Icons';
export function Modal({title,children,onClose,busy=false,wide=false}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const prior=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>{ref.current?.close();if(prior?.isConnected)prior.focus({preventScroll:true})}},[]);
 return <dialog ref={ref} className={'v3-modal '+(wide?'v3-modal-wide':'')} aria-labelledby="v3-dialog-title" onCancel={event=>{event.preventDefault();if(!busy)close.current()}}>
  <div className="v3-dialog-top"><div><span className="v3-eyebrow">SHINOBI BOMBERS · SOLANA DEVNET</span><h2 id="v3-dialog-title">{title}</h2></div><button className="v3-icon-button" onClick={onClose} disabled={busy} aria-label={'Close '+title}><Icon name="close"/></button></div>
  {children}
 </dialog>
}
