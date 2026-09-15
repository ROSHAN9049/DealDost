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
  src=src.replace("e:'LIVE',side:N(p.positionAmt)>0?'BUY':'SELL'","e:S.mode,side:N(p.positionAmt)>0?'BUY':'SELL'");
  src=src.replace("mode:'LIVE'}))","mode:S.mode}))");
  src=src.replace("x.contractType==='PERPETUAL'&&x.quoteAsset==='USDT'&&x.status==='TRADING'","x.contractType==='PERPETUAL'&&x.quoteAsset==='USDT'&&x.status==='TRADING'&&/^[A-Z0-9_]{5,30}$/.test(x.symbol)");
  src=src.replace("S.err='Account sync: '+e.message","S.err=(S.mode==='PAPER'?'':('Account sync: '+e.message))");
  return src;
}
function controls(){
  const root=document.getElementById('dd-mode-root');
  if(!root)return;
  root.innerHTML='';
  const current=localStorage.getItem(KEY)||'PAPER';
  ['PAPER','TESTNET','LIVE'].forEach(m=>{
    const b=document.createElement('button');b.type='button';b.textContent=m+(m===current?' ✓':'');b.dataset.mode=m;
    b.style.cssText='background:'+(m===current?'#15304b':'#0d1a2a')+';color:#e9f1fb;border:1px solid '+(m===current?'#4da3ff':'#2a415b')+';border-radius:10px;padding:9px 13px;cursor:pointer;font-weight:800';
    b.onclick=()=>{if(m===current)return;if(m==='LIVE'&&!confirm('LIVE mode selected. Real Binance orders remain server-locked until LIVE_UNLOCKED=true. Continue?'))return;localStorage.setItem(KEY,m);location.reload()};
    root.appendChild(b);
  });
  const note=document.createElement('span');note.style.cssText='font-size:11px;color:#8295ad;margin-left:4px';
  note.textContent=current==='PAPER'?'Local paper simulation':current==='TESTNET'?'Binance Futures Demo · automatic futures entries + exchange SL/TP · server key required':'Binance LIVE · real orders locked by server';
  root.appendChild(note);
}
async function boot(){try{controls();const r=await fetch('/app-scanner-v3.js?mode='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('Scanner source failed '+r.status);let src=await r.text();src=patch(src);(0,eval)(src);controls()}catch(e){const a=document.getElementById('app');if(a)a.innerHTML='<div style="padding:30px"><b>Scanner startup error</b><div style="color:#ff6178;margin-top:8px">'+String(e.message||e)+'</div></div>'}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();