/* DealDost Profit Rotation Engine V5
 * PAPER-first. Profitable positions may rotate into confirmed Top-Mover signals.
 * Losing positions are never force-closed by this engine. LIVE execution is untouched.
 * Stable panel outside #app; guarded against duplicate script evaluation.
 */
(()=>{'use strict';
 if(window.__DD_PROFIT_ROTATION_V5)return; window.__DD_PROFIT_ROTATION_V5=true;
 const CFG={enabled:true,minProfit:0.01,minScore:80,cooldown:15000,scanMs:5000};
 const N=x=>Number.isFinite(+x)?+x:0,now=()=>Date.now();
 let rotating=false,lastKey='';const recent={};
 const candidates=()=>Array.isArray(window.DD_TOP_MOVERS?.candidates)?window.DD_TOP_MOVERS.candidates:[];
 const score=x=>Math.max(N(x?.momentumScore),N(x?.scalpingScore),N(x?.score));
 const side=x=>String(x?.direction||'').toUpperCase();
 const strong=()=>candidates().filter(x=>x&&x.confirmed&&score(x)>=CFG.minScore&&(side(x)==='BUY'||side(x)==='SELL')).sort((a,b)=>score(b)-score(a));
 function futuresState(){try{return JSON.parse(localStorage.getItem('ddv5_PAPER')||'{}')}catch{return {}}}
 function profitableFutures(){const q=futuresState(),ps=Array.isArray(q.pos)?q.pos:[];return ps.filter(p=>p&&p.s&&N(p.entry)>0&&N(p.current)>0).map(p=>{const gross=String(p.side).toUpperCase()==='SELL'?(N(p.entry)-N(p.current))*N(p.q):(N(p.current)-N(p.entry))*N(p.q);const pnl=N(p.pnl)>0?N(p.pnl):gross-N(p.entryFee);return{...p,_pnl:pnl}}).filter(p=>p._pnl>=CFG.minProfit)}
 async function rotate(){if(rotating||!CFG.enabled||String(localStorage.getItem('ddMode')||'PAPER')!=='PAPER')return;const best=strong();if(!best.length)return;const profitable=profitableFutures();if(!profitable.length)return;rotating=true;try{for(const p of profitable){if(now()-N(recent[p.s])<CFG.cooldown)continue;const c=best.find(x=>String(x.symbol).toUpperCase()!==String(p.s).toUpperCase());if(!c||typeof window.DD?.close!=='function')continue;const ok=await Promise.resolve(window.DD.close(p.s));if(ok===false)continue;recent[p.s]=now();await new Promise(r=>setTimeout(r,250));if(typeof window.DD?.manualEntry==='function'){const opened=window.DD.manualEntry(c.symbol,side(c));if(opened!==false)recent[c.symbol]=now()}}}catch(e){console.warn('Profit rotation skipped:',e)}finally{rotating=false}}
 function mount(){let el=document.getElementById('dd-profit-rotation');if(el)return el;el=document.createElement('div');el.id='dd-profit-rotation';el.style.cssText='display:block!important;width:100%;box-sizing:border-box;margin:0;padding:8px 10px;background:#04080f;position:relative;z-index:999;';document.body.insertBefore(el,document.body.firstChild);return el}
 function panel(){const el=mount(),st=strong()[0],p=profitableFutures(),key=(st?[st.symbol,side(st),score(st)].join('|'):'WAIT')+'|P'+p.length;if(key===lastKey&&el.dataset.ready==='1')return;lastKey=key;el.innerHTML='<div class="panel" style="margin:0"><div class="panel-header"><div class="panel-title">PROFIT ROTATION V5</div><div class="panel-sub">Profit position → confirmed Top-Mover ≥ 80 → rotate · losing trades keep SL</div></div><div style="padding:9px;font-size:11px;color:#8ea3b8">'+(st?'Next strong signal: <b>'+String(st.symbol)+'</b> · '+side(st)+' · score '+score(st):'Waiting for confirmed Top-Mover signal ≥ 80…')+' · Profitable positions: <b>'+p.length+'</b></div></div>';el.dataset.ready='1'}
 async function tick(){try{panel();await rotate()}catch(e){console.warn('Profit rotation tick skipped:',e)}}
 window.DDProfitRotation={config:CFG,refresh:tick,mount};setTimeout(tick,1200);setInterval(tick,CFG.scanMs);
})();
