/* DealDost Profit Rotation Engine V3
 * PAPER-first. Stable UI mount + no DOM polling loop.
 * LIVE order functions are not modified.
 */
(()=>{'use strict';
 const CFG={enabled:true,minR:.50,minScore:85,cooldown:15000,scanMs:5000};
 const N=x=>Number.isFinite(+x)?+x:0,now=()=>Date.now();
 let rotating=false, mounted=false, lastKey='';
 const recent={};
 const candidates=()=>Array.isArray(window.DD_TOP_MOVERS?.candidates)?window.DD_TOP_MOVERS.candidates:[];
 const score=x=>Math.max(N(x?.momentumScore),N(x?.scalpingScore),N(x?.score));
 const side=x=>String(x?.direction||x?.side||'').toUpperCase();
 const strong=()=>candidates().filter(x=>x&&x.confirmed&&score(x)>=CFG.minScore&&(side(x)==='BUY'||side(x)==='SELL')).sort((a,b)=>score(b)-score(a));
 function futuresState(){try{return JSON.parse(localStorage.getItem('ddv5_PAPER')||'{}')}catch{return {}}}
 function profitableFutures(){const q=futuresState(),ps=Array.isArray(q.pos)?q.pos:[];return ps.filter(p=>p&&p.s&&N(p.entry)>0&&N(p.current)>0).map(p=>{const risk=Math.abs(N(p.entry)-N(p.sl))*Math.max(N(p.q),0),gross=String(p.side).toUpperCase()==='SELL'?(N(p.entry)-N(p.current))*N(p.q):(N(p.current)-N(p.entry))*N(p.q),pnl=N(p.pnl)>0?N(p.pnl):gross-N(p.entryFee);return{...p,_risk:Math.max(risk,.000001),_pnl:pnl}}).filter(p=>p._pnl>=p._risk*CFG.minR)}
 async function rotate(){if(rotating||!CFG.enabled||String(localStorage.getItem('ddMode')||'PAPER')!=='PAPER')return;const best=strong();if(!best.length)return;rotating=true;try{for(const p of profitableFutures()){if(now()-N(recent[p.s])<CFG.cooldown)continue;const c=best.find(x=>String(x.symbol).toUpperCase()!==String(p.s).toUpperCase());if(!c||typeof window.DD?.close!=='function')continue;const ok=await Promise.resolve(window.DD.close(p.s));if(ok===false)continue;recent[p.s]=now();await new Promise(r=>setTimeout(r,250));if(typeof window.DD?.manualEntry==='function'){const opened=window.DD.manualEntry(c.symbol,side(c));if(opened!==false)recent[c.symbol]=now()}}}catch(e){console.warn('Profit rotation skipped:',e)}finally{rotating=false}}
 function mount(){const app=document.querySelector('#app');if(!app)return null;let el=document.querySelector('#dd-profit-rotation');if(el)return el;el=document.createElement('div');el.id='dd-profit-rotation';el.style.cssText='display:block!important;width:100%;';
   const hosts=['.dashboard-panel','.scanner-panel','.panel'];let host=null;for(const s of hosts){host=app.querySelector(s);if(host)break}if(host?.parentNode)host.parentNode.insertBefore(el,host);else app.appendChild(el);mounted=true;return el}
 function panel(){const el=mount();if(!el)return;const st=strong()[0],key=st?[String(st.symbol),side(st),score(st)].join('|'):'WAIT';if(key===lastKey&&el.dataset.ddReady==='1')return;lastKey=key;el.innerHTML='<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">PROFIT ROTATION</div><div class="panel-sub">Profit ≥ 0.50R → exit · strong confirmed signal ≥ 85 → rotate · losing trades keep SL</div></div><div style="padding:9px;font-size:11px;color:#8ea3b8">'+(st?'Next strong signal: <b>'+String(st.symbol)+'</b> · '+side(st)+' · score '+score(st):'Waiting for strong confirmed signal…')+'</div></div>';el.dataset.ddReady='1'}
 async function tick(){try{panel();await rotate()}catch(e){console.warn('Profit rotation tick skipped:',e)}}
 setInterval(tick,CFG.scanMs);setTimeout(tick,1200);
 window.DDProfitRotation={config:CFG,refresh:tick,mount};
})();