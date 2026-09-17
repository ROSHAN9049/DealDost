/* DealDost Scanner Trade Action Guard
 * Only confirmed Top-Mover candidates get an actionable BUY/SELL button.
 * WATCH / SETUP / EXTENDED / NEUTRAL are visibly blocked and cannot manual-enter.
 */
(()=>{'use strict';
 const candidates=()=>{
   const a=Array.isArray(window.DD_TOP_MOVERS?.candidates)?window.DD_TOP_MOVERS.candidates:[],m=new Map();
   a.forEach(x=>{const s=String(x.symbol||'').toUpperCase(),d=String(x.direction||'').toUpperCase();if(s&&(d==='BUY'||d==='SELL'))m.set(s,d)});
   return m;
 };
 const patchManual=()=>{
   if(!window.DD||window.DD.__confirmedTradeGuard)return;
   const old=DD.manualEntry;
   if(typeof old!=='function')return;
   DD.manualEntry=function(sym,side){
     const d=candidates().get(String(sym||'').toUpperCase());
     if(!d||d!==String(side||'').toUpperCase()){alert('WAIT — this coin is not a confirmed Top-Mover candidate.');return false}
     return old.apply(this,arguments);
   };
   DD.__confirmedTradeGuard=true;
 };
 const patchButtons=()=>{
   const app=document.querySelector('#app');if(!app)return;
   const map=candidates();
   app.querySelectorAll('table.term tbody tr').forEach(tr=>{
     const cells=tr.children;if(cells.length<15)return;
     const sym=(cells[1]?.textContent||'').trim().toUpperCase();
     const btn=cells[cells.length-1]?.querySelector('button');if(!btn||!sym)return;
     const d=map.get(sym),label=d||'WAIT';
     btn.textContent=label;
     btn.disabled=!d;
     btn.style.opacity=d?'1':'.55';
     btn.title=d?'Confirmed Top-Mover candidate':'Blocked: waiting for confirmed Top-Mover candidate';
   });
 };
 const tick=()=>{try{patchManual();patchButtons()}catch(e){}};
 setInterval(tick,800);setTimeout(tick,1200);
 window.DDTradeActionGuard={refresh:tick};
})();
