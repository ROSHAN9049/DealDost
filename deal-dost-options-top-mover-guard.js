/* DealDost Options Top-Mover Gate
 * PAPER options may only evaluate confirmed candidates from DD_TOP_MOVERS.
 * This is a safety selector only; it does not submit real orders.
 */
(()=>{'use strict';
 const nativeFilter=Array.prototype.filter;
 const isOptionRows=a=>Array.isArray(a)&&a.length>0&&a.every(x=>x&&typeof x==='object'&&'u' in x&&'signal' in x&&'change' in x&&'volume' in x);
 const candidateMap=()=>{
   const c=Array.isArray(window.DD_TOP_MOVERS?.candidates)?window.DD_TOP_MOVERS.candidates:[];
   const m=new Map();
   c.forEach(x=>{const u=String(x.symbol||'').toUpperCase(),d=String(x.direction||'').toUpperCase();if(u&&(d==='BUY'||d==='SELL'))m.set(u,d)});
   return m;
 };
 Array.prototype.filter=function(fn,thisArg){
   if(isOptionRows(this)){
     const src=nativeFilter.call(this,fn,thisArg);
     const map=candidateMap();
     return nativeFilter.call(src,x=>map.get(String(x.u||'').toUpperCase())===String(x.signal||'').toUpperCase());
   }
   return nativeFilter.call(this,fn,thisArg);
 };
 window.DDOptionsTopMoverGate={getCandidates:candidateMap};
})();
