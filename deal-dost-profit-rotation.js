/* DealDost Profit Rotation Engine
 * PAPER-first: profitable futures/options positions can rotate into a new
 * confirmed Top-Mover signal. Losing positions are never force-closed here;
 * their existing SL/TP/expiry management remains responsible for exits.
 * LIVE order functions are not modified.
 */
(()=>{'use strict';
 const CFG={enabled:true,minR:.50,minScore:85,cooldown:15000};
 const N=x=>Number.isFinite(+x)?+x:0;
 const now=()=>Date.now();
 const recent={};
 const candidates=()=>Array.isArray(window.DD_TOP_MOVERS?.candidates)?window.DD_TOP_MOVERS.candidates:[];
 const score=x=>Math.max(N(x?.momentumScore),N(x?.scalpingScore),N(x?.score));
 const side=x=>String(x?.direction||x?.side||'').toUpperCase();
 const strong=()=>candidates().filter(x=>x&&x.confirmed&&score(x)>=CFG.minScore&&(side(x)==='BUY'||side(x)==='SELL')).sort((a,b)=>score(b)-score(a));
 function futuresState(){try{return JSON.parse(localStorage.getItem('ddv5_PAPER')||'{}')}catch{return {}}}
 function profitableFutures(){
   const q=futuresState(),ps=Array.isArray(q.pos)?q.pos:[];
   return ps.filter(p=>p&&p.s&&N(p.entry)>0&&N(p.current)>0).map(p=>{
     const risk=Math.abs(N(p.entry)-N(p.sl))*Math.max(N(p.q),0),gross=String(p.side).toUpperCase()==='SELL'?(N(p.entry)-N(p.current))*N(p.q):(N(p.current)-N(p.entry))*N(p.q),pnl=N(p.pnl)>0?N(p.pnl):gross-N(p.entryFee);
     return {...p,_risk:Math.max(risk,0.000001),_gross:gross,_pnl:pnl};
   }).filter(p=>p._pnl>=p._risk*CFG.minR);
 }
 function closeOptionProfits(best){
   try{
     const raw=localStorage.getItem('dd_options_v2');if(!raw)return 0;
     const o=JSON.parse(raw),ps=Array.isArray(o.positions)?o.positions:[],ts=Array.isArray(o.trades)?o.trades:[];
     let closed=0,changed=false;
     for(const p of ps){
       if(!p||N(p.pnl)<=0)continue;
       const age=now()-N(p.time||p.opened);if(age<30000)continue;
       const c=best.find(x=>String(x.symbol||'').toUpperCase()!==String(p.u||'').toUpperCase());
       if(!c)continue;
       const t=ts.find(x=>x.id===p.id);
       if(t){t.status='CLOSED';t.exit=N(p.current)||N(p.entry);t.pnl=N(p.pnl);t.fees=N(p.entryFee);t.closedAt=now();t.reason='PROFIT_ROTATION'}
       o.positions=ps.filter(x=>x.id!==p.id);closed++;changed=true;
     }
     if(changed){o.trades=ts;localStorage.setItem('dd_options_v2',JSON.stringify(o));window.dispatchEvent(new Event('dd:render'));}
     return closed;
   }catch{return 0}
 }
 async function rotate(){
   if(!CFG.enabled||String(localStorage.getItem('ddMode')||'PAPER')!=='PAPER')return;
   const best=strong();if(!best.length)return;
   for(const p of profitableFutures()){
     if(now()-N(recent[p.s])<CFG.cooldown)continue;
     const candidate=best.find(x=>String(x.symbol).toUpperCase()!==String(p.s).toUpperCase());
     if(!candidate||typeof window.DD?.close!=='function')continue;
     try{
       const ok=await Promise.resolve(window.DD.close(p.s));
       if(ok===false)continue;
       recent[p.s]=now();
       await new Promise(r=>setTimeout(r,250));
       if(typeof window.DD?.manualEntry==='function'){
         const opened=window.DD.manualEntry(candidate.symbol,side(candidate));
         if(opened!==false)recent[candidate.symbol]=now();
       }
     }catch(e){console.warn('Profit rotation skipped:',e)}
   }
   closeOptionProfits(best);
   try{if(window.DDOptions?.scan)await window.DDOptions.scan()}catch(e){}
 }
 function panel(){
   const app=document.querySelector('#app');if(!app)return;
   let el=document.querySelector('#dd-profit-rotation');
   if(!el){el=document.createElement('div');el.id='dd-profit-rotation';const host=app.querySelector('.dashboard-panel,.panel');if(host?.parentNode)host.parentNode.insertBefore(el,host);else app.prepend(el)}
   const st=strong()[0];
   el.innerHTML='<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">PROFIT ROTATION</div><div class="panel-sub">Profit ≥ 0.50R → exit · strong confirmed signal ≥ 85 → rotate · losing trades keep SL</div></div><div style="padding:9px;font-size:11px;color:#8ea3b8">'+(st?'Next strong signal: <b>'+String(st.symbol)+'</b> · '+side(st)+' · score '+score(st):'Waiting for strong confirmed signal…')+'</div></div>';
 }
 function tick(){try{panel();rotate()}catch(e){}}
 setInterval(tick,2500);setTimeout(tick,3000);
 window.DDProfitRotation={config:CFG,refresh:tick};
})();
