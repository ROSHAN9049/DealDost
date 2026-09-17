/* DealDost Top Movers Unified Engine
 * Routes the existing scanner's Momentum/Scalping/Options candidate universe from
 * the strongest 24H jump/dump coins. This layer is selector/UI only: it does not
 * submit orders and does not alter PAPER/TESTNET/LIVE order functions.
 */
(()=>{'use strict';
 const KEY='dd_top_movers_v1',N=x=>Number.isFinite(+x)?+x:0;
 const rows=()=>Array.isArray(window.__DD_SCANNER_ROWS)?window.__DD_SCANNER_ROWS:[];
 const dir=x=>x.momentum==='BUY'&&x.scalp==='BUY'?'BUY':x.momentum==='SELL'&&x.scalp==='SELL'?'SELL':x.momentum!=='WAIT'?x.momentum:x.scalp!=='WAIT'?x.scalp:'WAIT';
 const confirm=x=>{
  const d=dir(x),c=N(x.c),m=N(x.m),s=N(x.sc);
  if(d==='BUY')return c>0&&Math.max(m,s)>=70;
  if(d==='SELL')return c<0&&Math.max(m,s)>=70;
  return false;
 };
 function build(){
  const a=rows().filter(x=>x&&x.s&&N(x.p)>0),jump=a.filter(x=>N(x.c)>0).sort((x,y)=>N(y.c)-N(x.c)).slice(0,5),dump=a.filter(x=>N(x.c)<0).sort((x,y)=>N(x.c)-N(y.c)).slice(0,5);
  const make=(x,side)=>({symbol:x.s,price:N(x.p),change:N(x.c),volume:N(x.v),momentum:x.momentum,scalping:x.scalp,momentumScore:N(x.m),scalpingScore:N(x.sc),direction:dir(x),side,confirmed:confirm(x),trend:x.trend||'NEUTRAL',reasons:x.reasons||''});
  const candidates=[...jump.map(x=>make(x,'JUMP')),...dump.map(x=>make(x,'DUMP'))].filter(x=>x.confirmed&&((x.side==='JUMP'&&x.direction==='BUY')||(x.side==='DUMP'&&x.direction==='SELL')));
  const state={updated:Date.now(),jump:jump.map(x=>make(x,'JUMP')),dump:dump.map(x=>make(x,'DUMP')),candidates:candidates.slice(0,6)};
  window.DD_TOP_MOVERS=state;try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}return state;
 }
 function optionEligible(symbol){
  try{const s=window.DDOptions?.getState?.(),c=s?.contracts||[];return c.some(x=>String(x.u||'').toUpperCase()===String(symbol).toUpperCase()&&N(x.ex)>Date.now())}catch{return false}}
 function panel(){const app=document.querySelector('#app');if(!app||!window.DD_TOP_MOVERS)return;let el=document.querySelector('#dd-top-movers-engine');if(!el){el=document.createElement('div');el.id='dd-top-movers-engine';const target=app.querySelector('.scanner-panel,.panel');if(target?.parentNode)target.parentNode.insertBefore(el,target);else app.prepend(el)}const st=window.DD_TOP_MOVERS,all=[...st.jump,...st.dump],fmt=x=>(x>=0?'+':'')+x.toFixed(2)+'%';el.innerHTML='<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">TOP MOVERS → UNIFIED ENGINE</div><div class="panel-sub">Jump/Dump → confirmation → Momentum · Scalping · Options</div></div><div style="padding:10px;display:grid;gap:7px">'+(all.length?all.map(x=>'<div style="display:grid;grid-template-columns:1.3fr .8fr .8fr .8fr .8fr;gap:6px;align-items:center;font-size:11px"><b>'+x.symbol+'</b><span>'+x.side+'</span><span>'+fmt(x.change)+'</span><span>M '+x.momentumScore+' · S '+x.scalpingScore+'</span><span>'+(x.confirmed?'CONFIRMED':'WAIT')+' · '+(optionEligible(x.symbol)?'OPT':'—')+'</span></div>').join(''):'<div class="empty">Waiting for top movers…</div>')+'</div></div>'}
 function tick(){try{build();panel()}catch(e){}}
 setInterval(tick,1200);setTimeout(tick,1800);
 window.DDTopMovers={refresh:build,get:()=>window.DD_TOP_MOVERS||build(),optionEligible};
})();
