/* DealDost Top Movers Unified Engine V2
 * Selector/UI layer only. It does NOT submit orders and does not modify
 * PAPER/TESTNET/LIVE execution functions.
 * Flow: stable scanner rows -> 24H Jump/Dump -> volume -> 1m/5m/15m
 * confirmation proxy -> 0-100 score -> WATCH/SETUP/CONFIRMED -> anti-chase.
 */
(()=>{'use strict';
 const KEY='dd_top_movers_v2',N=x=>Number.isFinite(+x)?+x:0;
 const rows=()=>Array.isArray(window.__DD_SCANNER_ROWS)?window.__DD_SCANNER_ROWS:[];
 const dir=x=>x?.momentum==='BUY'&&x?.scalp==='BUY'?'BUY':x?.momentum==='SELL'&&x?.scalp==='SELL'?'SELL':x?.momentum!=='WAIT'?x?.momentum:x?.scalp!=='WAIT'?x?.scalp:'NEUTRAL';
 const vol=x=>N(x?.vs)||1;
 const pct=x=>N(x?.c);
 const score=x=>{
  const d=dir(x), ch=Math.abs(pct(x)), m=Math.max(0,Math.min(100,N(x?.m))), s=Math.max(0,Math.min(100,N(x?.sc)));
  const momentum=Math.min(20,ch/2*20);
  const volume=Math.min(20,Math.max(0,(vol(x)-1)/1.5*20));
  const oneM=Math.min(15,s*.15);
  const fiveM=Math.min(20,s*.20);
  const fifteenM=Math.min(15,m*.15);
  const breakout=(d!=='NEUTRAL'&&Math.max(m,s)>=70)?10:0;
  return Math.round(Math.max(0,Math.min(100,momentum+volume+oneM+fiveM+fifteenM+breakout)));
 };
 const stage=x=>{
  const q=score(x),d=dir(x),v=vol(x),ch=pct(x);
  if(d==='NEUTRAL'||q<55)return'WATCH';
  if(Math.abs(ch)>=4.5&&v<1.8)return'EXTENDED';
  if(q>=80&&v>=1.15&&((d==='BUY'&&ch>0)||(d==='SELL'&&ch<0)))return'CONFIRMED';
  if(q>=65&&v>=1.0)return'SETUP';
  return'WATCH';
 };
 const make=(x,side)=>{
  const d=dir(x),q=score(x),st=stage(x),ch=pct(x),v=vol(x);
  return{symbol:x.s,price:N(x.p),change:ch,volume:N(x.v),volumeSpike:v,momentum:x.momentum,scalping:x.scalp,momentumScore:N(x.m),scalpingScore:N(x.sc),direction:d,side,score:q,stage:st,confirmed:st==='CONFIRMED',antiChase:st==='EXTENDED',trend:x.trend||'NEUTRAL',reasons:x.reasons||''};
 };
 function build(){
  const a=rows().filter(x=>x&&x.s&&N(x.p)>0),jump=a.filter(x=>pct(x)>0).sort((x,y)=>pct(y)-pct(x)).slice(0,8),dump=a.filter(x=>pct(x)<0).sort((x,y)=>pct(x)-pct(y)).slice(0,8);
  const jm=jump.map(x=>make(x,'JUMP')),dm=dump.map(x=>make(x,'DUMP'));
  const candidates=[...jm,...dm].filter(x=>x.stage==='CONFIRMED'&&((x.side==='JUMP'&&x.direction==='BUY')||(x.side==='DUMP'&&x.direction==='SELL'))).sort((a,b)=>b.score-a.score).slice(0,6);
  const state={version:2,updated:Date.now(),jump:jm,dump:dm,candidates};
  window.DD_TOP_MOVERS=state;try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}return state;
 }
 function optionEligible(symbol){
  try{const s=window.DDOptions?.getState?.(),c=s?.contracts||[];return c.some(x=>String(x.u||'').toUpperCase()===String(symbol).toUpperCase()&&N(x.ex)>Date.now()&&String(x.status||'TRADING')==='TRADING')}catch{return false}
 }
 function panel(){
  const app=document.querySelector('#app');if(!app||!window.DD_TOP_MOVERS)return;
  let el=document.querySelector('#dd-top-movers-engine');
  if(!el){el=document.createElement('div');el.id='dd-top-movers-engine';const target=app.querySelector('.scanner-panel,.panel');if(target?.parentNode)target.parentNode.insertBefore(el,target);else app.prepend(el)}
  const st=window.DD_TOP_MOVERS,all=[...st.jump,...st.dump],fmt=x=>(x>=0?'+':'')+x.toFixed(2)+'%';
  el.innerHTML='<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">TOP MOVERS → UNIFIED ENGINE V2</div><div class="panel-sub">24H → Volume → 1m/5m/15m confirmation → Score → Risk gate</div></div><div style="padding:10px;display:grid;gap:7px">'+(all.length?all.map(x=>'<div style="display:grid;grid-template-columns:1.1fr .65fr .75fr .65fr .8fr .85fr;gap:6px;align-items:center;font-size:11px"><b>'+x.symbol+'</b><span>'+x.side+'</span><span>'+fmt(x.change)+'</span><span>Vol '+x.volumeSpike.toFixed(2)+'x</span><span>Score '+x.score+'</span><span>'+x.stage+(x.antiChase?' · PULLBACK':x.stage==='CONFIRMED'?' · '+(optionEligible(x.symbol)?'OPT':'NO OPT'):'')+'</span></div>').join(''):'<div class="empty">Waiting for stable-universe market data…</div>')+'</div><div style="padding:0 10px 10px;font-size:10px;color:#71859b">CONFIRMED candidates only are trade candidates. EXTENDED means wait for pullback; WAIT/SETUP never auto-trade.</div></div>';
 }
 function tick(){try{build();panel()}catch(e){}}
 setInterval(tick,1200);setTimeout(tick,1800);
 window.DDTopMovers={refresh:build,get:()=>window.DD_TOP_MOVERS||build,optionEligible,score,stage};
})();
