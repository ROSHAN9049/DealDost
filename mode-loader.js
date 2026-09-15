(()=>{'use strict';
const KEY='ddMode';
const mode=localStorage.getItem(KEY)||'PAPER';
function patch(src){
  src=src.replace("const PUB='/api/binance-market?path=',AC='/api/binance-account?path=',TR='/api/binance-trade'","const PUB='/api/binance-market?path=',AC=(localStorage.getItem('ddMode')==='TESTNET'?'/api/binance-testnet-account?path=':'/api/binance-account?path='),TR=(localStorage.getItem('ddMode')==='TESTNET'?'/api/binance-testnet-trade':'/api/binance-trade')");
  src=src.replace("mode:'PAPER'","mode:(localStorage.getItem('ddMode')||'PAPER')");
  src=src.replace("liveAuto:false","liveAuto:(localStorage.getItem('ddMode')==='TESTNET')");
  src=src.replace("if(S.mode!=='LIVE'||!S.liveAuto)","if(!['LIVE','TESTNET'].includes(S.mode)||!S.liveAuto)");
  src=src.replace("else if(S.mode==='LIVE'&&S.liveAuto)","else if((S.mode==='LIVE'||S.mode==='TESTNET')&&S.liveAuto)");
  src=src.replace("if(S.mode==='LIVE'){","if(S.mode==='LIVE'||S.mode==='TESTNET'){");
  src=src.replace("S.err='Account sync: '+e.message","S.err=(S.mode==='PAPER'?'':('Account sync: '+e.message))");
  return src;
}
function controls(){
  if(document.getElementById('dd-modes'))return;
  const top=document.querySelector('.top');if(!top)return;
  const box=document.createElement('div');box.id='dd-modes';box.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';
  ['PAPER','TESTNET','LIVE'].forEach(m=>{const b=document.createElement('button');b.textContent=m+(m===mode?' ✓':'');b.dataset.mode=m;b.className=m===mode?'active':'';b.onclick=()=>{if(m==='LIVE'&&!confirm('LIVE mode selected. Real Binance orders remain server-locked until LIVE_UNLOCKED=true. Continue?'))return;localStorage.setItem(KEY,m);location.reload()};box.appendChild(b)});
  const note=document.createElement('div');note.id='dd-mode-note';note.style.cssText='font-size:11px;color:#8295ad;margin-top:5px';note.textContent=mode==='PAPER'?'Local paper simulation':mode==='TESTNET'?'Binance Futures Demo · simulated funds · server key required':'Binance LIVE · real orders locked by server';
  top.appendChild(box);top.appendChild(note);
}
async function boot(){try{const r=await fetch('/app-scanner-v3.js?mode='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('Scanner source failed '+r.status);let src=await r.text();src=patch(src);(0,eval)(src);setTimeout(controls,1200)}catch(e){const a=document.getElementById('app');if(a)a.innerHTML='<div style="padding:30px"><b>Scanner startup error</b><div style="color:#ff6178;margin-top:8px">'+String(e.message||e)+'</div></div>'}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();