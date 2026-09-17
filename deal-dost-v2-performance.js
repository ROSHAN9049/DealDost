/* DealDost V2 — Paper Signal Performance Engine
 * Records scanner signals only. Never places orders and never changes trading state.
 */
(()=>{'use strict';
 const KEY='dd_v2_signal_history_v1',MAX=3000;
 const n=v=>Number.isFinite(+v)?+v:0;
 const rows=()=>Array.isArray(window.__DD_SCANNER_ROWS)?window.__DD_SCANNER_ROWS:[];
 const dir=x=>{const m=x.momentum, s=x.scalp;if(m==='BUY'&&s==='BUY')return'BUY';if(m==='SELL'&&s==='SELL')return'SELL';return m!=='WAIT'?m:s!=='WAIT'?s:'NEUTRAL'};
 const score=x=>Math.max(n(x.m),n(x.sc));
 const load=()=>{try{const a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[]}catch{return[]}};
 const save=a=>{try{localStorage.setItem(KEY,JSON.stringify(a.slice(-MAX)))}catch{}};
 function snapshot(){
   const now=Date.now(), history=load(), seen=new Set(history.map(x=>x.key));
   rows().forEach(x=>{const d=dir(x),q=score(x);if(d==='NEUTRAL'||q<80)return;const key=x.s+'|'+d+'|'+Math.round(n(x.p)*100000000)+'|'+Math.floor(now/30000);if(seen.has(key))return;history.push({key,s:x.s,d,score:q,entry:n(x.p),c:n(x.c),ts:now,status:'OPEN'});seen.add(key)});save(history);
 }
 function mark(){
   const a=load(), now=Date.now(), by=Object.fromEntries(rows().map(x=>[x.s,x]));let changed=false;
   a.forEach(t=>{if(t.status!=='OPEN')return;const x=by[t.s];if(!x||!n(x.p)||now-t.ts<60000)return;const move=(n(x.p)-t.entry)/Math.max(Math.abs(t.entry),1e-12)*(t.d==='SELL'?-1:1);t.last=n(x.p);t.move=move*100;t.age=Math.round((now-t.ts)/1000);if(move>=.01){t.status='WIN';t.resultR=1;t.exit=n(x.p);t.closedAt=now;changed=true}else if(move<=-.006){t.status='LOSS';t.resultR=-1;t.exit=n(x.p);t.closedAt=now;changed=true}});if(changed)save(a);return a;
 }
 function api(){const a=mark(),closed=a.filter(x=>x.status==='WIN'||x.status==='LOSS'),wins=closed.filter(x=>x.status==='WIN').length;return{all:a,closed,wins,losses:closed.length-wins,winRate:closed.length?wins/closed.length*100:0};}
 window.DD_V2_PERF={snapshot,mark,get:api,clear:()=>localStorage.removeItem(KEY)};
 setInterval(()=>{try{snapshot();mark()}catch{}},30000);setTimeout(()=>{try{snapshot()}catch{}},2500);
})();