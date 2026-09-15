(()=>{'use strict';
const KEY='ddTestnetFallback';
function enabled(){return localStorage.getItem('ddMode')==='TESTNET'}
function state(){try{return JSON.parse(localStorage.getItem(KEY)||'{"equity":10000,"real":0,"fees":0,"pos":[],"hist":[]}')}catch{return {equity:10000,real:0,fees:0,pos:[],hist:[]}}}
function save(s){localStorage.setItem(KEY,JSON.stringify(s))}
function fee(notional){return Math.abs(notional)*0.0005}
function tick(){if(!enabled())return;const s=state();const rows=window.__DD_ROWS||[];const now=Date.now();
  for(const p of s.pos){const x=rows.find(r=>r.s===p.symbol);if(!x||!x.p)continue;p.price=x.p;p.pnl=(p.side==='BUY'?(x.p-p.entry):(p.entry-x.p))*p.qty}
  const closed=[];for(const p of s.pos){const hit=p.side==='BUY'?(p.price<=p.sl||p.price>=p.tp):(p.price>=p.sl||p.price<=p.tp);if(hit){const gross=p.pnl, f=fee(p.entry*p.qty)+fee(p.price*p.qty), net=gross-f;s.real+=net;s.equity+=net;s.fees+=f;s.hist.unshift({...p,exit:p.price,gross,fees:f,net,closedAt:now});closed.push(p)}}
  if(closed.length)s.pos=s.pos.filter(p=>!closed.includes(p));save(s);window.__DD_TESTNET_STATE=s;window.dispatchEvent(new CustomEvent('dd-testnet-update',{detail:s}))
}
window.DDTestnet={enabled,state,save,fee,tick};setInterval(tick,3000);tick();
})();
