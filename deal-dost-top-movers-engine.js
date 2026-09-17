/* DealDost Top Movers Unified Engine V4
 * Selector/UI layer only. It does NOT submit orders and does not modify
 * PAPER/TESTNET/LIVE execution functions.
 * Stable 50 -> 24H movers -> volume -> multi-timeframe score -> confirmed.
 * Uses the same quality-score basis as DealDost V2 so Top Movers and the
 * Command Center no longer disagree on signal strength.
 * Strong confirmed signals are eligible for Profit Rotation.
 */
(()=>{'use strict';
 const KEY='dd_top_movers_v4',N=x=>Number.isFinite(+x)?+x:0;
 const rows=()=>Array.isArray(window.__DD_SCANNER_ROWS)?window.__DD_SCANNER_ROWS:[];
 const dir=x=>x?.momentum==='BUY'&&x?.scalp==='BUY'?'BUY':x?.momentum==='SELL'&&x?.scalp==='SELL'?'SELL':N(x?.m)>=N(x?.sc)&&x?.momentum!=='WAIT'?x?.momentum:x?.scalp!=='WAIT'?x?.scalp:'NEUTRAL';
 const vol=x=>N(x?.vs)||1;
 const pct=x=>N(x?.c);
 const score=x=>Math.max(0,Math.min(100,Math.round(Math.max(N(x?.m),N(x?.sc))*0.62+Math.min(20,Math.abs(pct(x))*2.5)+Math.min(18,Math.max(0,(vol(x)-1)*9)))));
 const stage=x=>{const q=score(x),d=dir(x),v=vol(x),ch=pct(x),m=N(x?.m),s=N(x?.sc);if(d==='NEUTRAL'||q<55)return'WATCH';if(Math.abs(ch)>=4.5&&v<1.8)return'EXTENDED';if(q>=82&&v>=1.0&&((d==='BUY'&&ch>0)||(d==='SELL'&&ch<0))&&Math.max(m,s)>=80)return'CONFIRMED';if(q>=65&&v>=1.0)return'SETUP';return'WATCH'};
 const make=(x,side)=>{const d=dir(x),q=score(x),st=stage(x),ch=pct(x),v=vol(x);return{symbol:x.s,price:N(x.p),change:ch,volume:N(x.v),volumeSpike:v,momentum:x.momentum,scalping:x.scalp,momentumScore:N(x.m),scalpingScore:N(x.sc),direction:d,side,score:q,stage:st,confirmed:st==='CONFIRMED',antiChase:st==='EXTENDED',trend:x.trend||'NEUTRAL',reasons:x.reasons||''}};
 function build(){const a=rows().filter(x=>x&&x.s&&N(x.p)>0),jump=a.filter(x=>pct(x)>0).sort((x,y)=>pct(y)-pct(x)).slice(0,15),dump=a.filter(x=>pct(x)<0).sort((x,y)=>pct(x)-pct(y)).slice(0,15),jm=jump.map(x=>make(x,'JUMP')),dm=dump.map(x=>make(x,'DUMP')),candidates=[...jm,...dm].filter(x=>x.confirmed&&((x.side==='JUMP'&&x.direction==='BUY')||(x.side==='DUMP'&&x.direction==='SELL'))).sort((a,b)=>b.score-a.score).slice(0,6);const state={version:4,updated:Date.now(),jump:jm,dump:dm,candidates};window.DD_TOP_MOVERS=state;try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}return state}
 function optionEligible(symbol){try{const s=window.DDOptions?.getState?.(),c=s?.contracts||[];return c.some(x=>String(x.u||'').toUpperCase()===String(symbol).toUpperCase()&&N(x.ex)>Date.now()&&String(x.status||'TRADING')==='TRADING')}catch{return false}}
 function panel(){const app=document.querySelector('#app');if(!app||!window.DD_TOP_MOVERS)return;let el=document.querySelector('#dd-top-movers-engine');if(!el){el=document.createElement('div');el.id='dd-top-movers-engine';const target=app.querySelector('.scanner-panel,.panel');if(target?.parentNode)target.parentNode.insertBefore(el,target);else app.prepend(el)}const st=window.DD_TOP_MOVERS,all=[...st.jump,...st.dump],fmt=x=>(x>=0?'+':'')+x.toFixed(2)+'%';const html='<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">TOP MOVERS → UNIFIED ENGINE V4</div><div class="panel-sub">24H → Volume → 1m/5m/15m confirmation → V2-aligned Score → Profit Rotation gate</div></div><div style="padding:10px;display:grid;gap:7px">'+(all.length?all.map(x=>'<div style="display:grid;grid-template-columns:1.1fr .65fr .75fr .65fr .8fr .85fr;gap:6px;align-items:center;font-size:11px"><b>'+x.symbol+'</b><span>'+x.side+'</span><span>'+fmt(x.change)+'</span><span>Vol '+x.volumeSpike.toFixed(2)+'x</span><span>Score '+x.score+'</span><span>'+x.stage+(x.antiChase?' · PULLBACK':x.stage==='CONFIRMED'?' · '+(optionEligible(x.symbol)?'OPT':'NO OPT'):'')+'</span></div>').join(''):'<div class="empty">Waiting for stable-universe market data…</div>')+'</div><div style="padding:0 10px 10px;font-size:10px;color:#71859b">CONFIRMED candidates only are trade candidates. EXTENDED means wait for pullback; WATCH/SETUP never auto-trade.</div></div>';if(el.dataset.html!==html){el.innerHTML=html;el.dataset.html=html}}
 function tick(){try{build();panel()}catch(e){}}
 setInterval(tick,1200);setTimeout(tick,1800);window.DDTopMovers={refresh:build,get:()=>window.DD_TOP_MOVERS||build(),optionEligible,score,stage};
})();
