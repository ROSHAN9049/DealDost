/* DealDost Unified Rotation Engine V6
 * PAPER-first. Handles both profit rotation and worst-loss rotation.
 * Profit: profitable PAPER futures may rotate into confirmed Top-Movers.
 * Loss: the single worst losing PAPER position across Momentum, Scalping and
 * Options may be cut when a different confirmed Top-Mover signal is ready.
 * LIVE execution is untouched.
 */
(()=>{'use strict';
 if(window.__DD_PROFIT_ROTATION_V6)return; window.__DD_PROFIT_ROTATION_V6=true;
 const CFG={enabled:true,minProfit:0.01,minLoss:0.01,minScore:80,cooldown:15000,scanMs:5000};
 const N=x=>Number.isFinite(+x)?+x:0,now=()=>Date.now();
 let rotating=false,lastKey='';const recent={};
 const candidates=()=>Array.isArray(window.DD_TOP_MOVERS?.candidates)?window.DD_TOP_MOVERS.candidates:[];
 const score=x=>Math.max(N(x?.momentumScore),N(x?.scalpingScore),N(x?.score));
 const side=x=>String(x?.direction||'').toUpperCase();
 const strong=()=>candidates().filter(x=>x&&x.confirmed&&score(x)>=CFG.minScore&&(side(x)==='BUY'||side(x)==='SELL')).sort((a,b)=>score(b)-score(a));
 function futuresState(){try{return JSON.parse(localStorage.getItem('ddv5_PAPER')||'{}')}catch{return {}}}
 function futuresPositions(){const q=futuresState(),ps=Array.isArray(q.pos)?q.pos:[];return ps.filter(p=>p&&p.s&&N(p.entry)>0&&N(p.current)>0).map(p=>{const gross=String(p.side).toUpperCase()==='SELL'?(N(p.entry)-N(p.current))*N(p.q):(N(p.current)-N(p.entry))*N(p.q),pnl=N(p.pnl)>0?N(p.pnl):gross-N(p.entryFee);return{...p,_pnl:pnl,_kind:'FUTURES'}})}
 function profitableFutures(){return futuresPositions().filter(p=>p._pnl>=CFG.minProfit)}
 function optionPositions(){try{const a=window.DDOptions?.getState?.()?.positions;return(Array.isArray(a)?a:[]).filter(p=>p&&p.id).map(p=>({...p,_pnl:N(p.pnl),_kind:'OPTIONS'}))}catch{return[]}}
 function worstLoss(){return[...futuresPositions(),...optionPositions()].filter(p=>p._pnl<=-CFG.minLoss).sort((a,b)=>a._pnl-b._pnl)[0]||null}
 function activeSymbols(){const a=[...futuresPositions(),...optionPositions()];return new Set(a.map(p=>String(p.s||p.u||'').toUpperCase()).filter(Boolean))}
 function candidateForReplacement(){const active=activeSymbols();return strong().find(c=>!active.has(String(c.symbol).toUpperCase()))||null}
 async function closePosition(p,reason){if(p._kind==='OPTIONS'&&typeof window.DDOptions?.closePosition==='function')return await Promise.resolve(window.DDOptions.closePosition(p.id,reason));if(p._kind==='FUTURES'&&typeof window.DD?.close==='function')return await Promise.resolve(window.DD.close(p.s));return false}
 function openFutures(c){if(typeof window.DD?.manualEntry!=='function')return false;const m=N(c.momentumScore),s=N(c.scalpingScore);const preferred=m>=s?'MOMENTUM':'SCALPING',other=preferred==='MOMENTUM'?'SCALPING':'MOMENTUM';let ok=window.DD.manualEntry(c.symbol,side(c));if(ok!==false)return{section:preferred};ok=window.DD.manualEntry(c.symbol,side(c));if(ok!==false)return{section:other};return false}
 function openReplacement(c){if(!c)return false;const m=N(c.momentumScore),s=N(c.scalpingScore);if(Math.max(m,s)>=80){const f=openFutures(c);if(f)return f}if(typeof window.DDOptions?.openCandidate==='function'){const o=window.DDOptions.openCandidate(c.symbol,side(c));if(o)return{section:'OPTIONS',strategy:o.s}}return false}
 async function profitRotate(){const best=strong();if(!best.length)return false;const profitable=profitableFutures();if(!profitable.length)return false;for(const p of profitable){if(now()-N(recent[p.s])<CFG.cooldown)continue;const c=best.find(x=>String(x.symbol).toUpperCase()!==String(p.s).toUpperCase()&&!activeSymbols().has(String(x.symbol).toUpperCase()));if(!c)continue;const ok=await closePosition(p,'PROFIT_ROTATION');if(ok===false)continue;recent[p.s]=now();await new Promise(r=>setTimeout(r,250));const opened=openReplacement(c);if(opened)recent[c.symbol]=now();return{type:'PROFIT',from:p.s,to:c.symbol,section:opened?.section||'NONE'}}return false}
 async function lossRotate(){const c=candidateForReplacement();if(!c)return false;const p=worstLoss();if(!p)return false;const key=String(p.s||p.u||p.id);if(now()-N(recent[key])<CFG.cooldown)return false;const ok=await closePosition(p,'LOSS_ROTATION');if(ok===false)return false;recent[key]=now();await new Promise(r=>setTimeout(r,250));const opened=openReplacement(c);if(opened)recent[c.symbol]=now();return{type:'LOSS',from:p.s||p.u,to:c.symbol,section:opened?.section||'NONE',loss:p._pnl}}
 async function rotate(){if(rotating||!CFG.enabled||String(localStorage.getItem('ddMode')||'PAPER')!=='PAPER')return;rotating=true;try{const p=await profitRotate();if(p)return;await lossRotate()}catch(e){console.warn('Unified rotation skipped:',e)}finally{rotating=false}}
 function mount(){let el=document.getElementById('dd-profit-rotation');if(el)return el;el=document.createElement('div');el.id='dd-profit-rotation';el.style.cssText='display:block!important;width:100%;box-sizing:border-box;margin:0;padding:8px 10px;background:#04080f;position:relative;z-index:999;';document.body.insertBefore(el,document.body.firstChild);return el}
 function panel(){const el=mount(),st=strong()[0],p=profitableFutures(),w=worstLoss(),key=(st?[st.symbol,side(st),score(st)].join('|'):'WAIT')+'|P'+p.length+'|L'+(w?String(w.s||w.u||w.id):'NONE');if(key===lastKey&&el.dataset.ready==='1')return;lastKey=key;el.innerHTML='<div class="panel" style="margin:0"><div class="panel-header"><div class="panel-title">UNIFIED ROTATION V6</div><div class="panel-sub">Profit rotation + worst-loss rotation · confirmed Top-Mover ≥ 80 · PAPER only</div></div><div style="padding:9px;font-size:11px;color:#8ea3b8">'+(st?'Next strong signal: <b>'+String(st.symbol)+'</b> · '+side(st)+' · score '+score(st):'Waiting for confirmed Top-Mover signal ≥ 80…')+' · Profitable: <b>'+p.length+'</b> · Worst loss: <b>'+(w?(String(w.s||w.u||w.id)+' ₹'+w._pnl.toFixed(2)):'None')+'</b></div><div style="padding:0 9px 9px;font-size:10px;color:#71859b">When a new confirmed signal is available, the engine first rotates a profitable PAPER trade; otherwise it can cut only the single worst losing PAPER trade and route the replacement to Momentum, Scalping or Options.</div></div>';el.dataset.ready='1'}
 async function tick(){try{panel();await rotate()}catch(e){console.warn('Unified rotation tick skipped:',e)}}
 window.DDProfitRotation={config:CFG,refresh:tick,mount};setTimeout(tick,1200);setInterval(tick,CFG.scanMs);
})();
