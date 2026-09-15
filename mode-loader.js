(()=>{'use strict';
const KEY='ddMode';
const mode=localStorage.getItem(KEY)||'PAPER';
function patch(src){
  const testnet="localStorage.getItem('ddMode')==='TESTNET'";
  src=src.replace("const PUB='/api/binance-market?path=',AC='/api/binance-account?path=',TR='/api/binance-trade'","const PUB='/api/binance-market?path=',AC=("+testnet+"?'/api/binance-testnet-account?path=':'/api/binance-account?path='),TR=("+testnet+"?'/api/binance-testnet-trade':'/api/binance-trade')");
  src=src.replace("mode:'PAPER'","mode:(localStorage.getItem('ddMode')||'PAPER')");
  src=src.replace("liveAuto:false","liveAuto:(localStorage.getItem('ddMode')==='TESTNET')");
  src=src.replace("function paperOpen(x,e){if(S.mode!=='PAPER'", "function paperOpen(x,e){if(!['PAPER','TESTNET'].includes(S.mode)");
  src=src.replace("if(S.mode==='PAPER'){if(x.m>=65", "if(S.mode==='PAPER'||S.mode==='TESTNET'){if(x.m>=65");
  src=src.replace("function managePaper(){for(const p of [...S.pos]){if(p.mode!=='PAPER')continue;", "function managePaper(){for(const p of [...S.pos]){if(!['PAPER','TESTNET'].includes(p.mode))continue;");
  src=src.replace("if(S.mode==='LIVE'){S.pos=", "if(S.mode==='LIVE'){S.pos=");
  src=src.replace("async function syncAccount(){if(Date.now()-S.lastAccount<2500)return;", "async function syncAccount(){if(S.mode==='TESTNET'){S.account=null;S.err='';return;}if(Date.now()-S.lastAccount<2500)return;");
  src=src.replace("S.err=(S.mode==='PAPER'?'':('Account sync: '+e.message))", "S.err=(S.mode==='PAPER'||S.mode==='TESTNET'?'':('Account sync: '+e.message))");
  src=src.replace("if(!['LIVE','TESTNET'].includes(S.mode)||!S.liveAuto)","if(S.mode!=='LIVE'||!S.liveAuto)");
  src=src.replace("else if((S.mode==='LIVE'||S.mode==='TESTNET')&&S.liveAuto)","else if(S.mode==='LIVE'&&S.liveAuto)");
  src=src.replace("if(S.mode==='LIVE'||S.mode==='TESTNET')", "if(S.mode==='LIVE')");
  src=src.replace("e:S.mode,side:N(p.positionAmt)>0?'BUY':'SELL'", "e:'LIVE',side:N(p.positionAmt)>0?'BUY':'SELL'");
  src=src.replace("mode:S.mode}))", "mode:'LIVE'}))");
  src=src.replace("x.contractType==='PERPETUAL'&&x.quoteAsset==='USDT'&&x.status==='TRADING'","x.contractType==='PERPETUAL'&&x.quoteAsset==='USDT'&&x.status==='TRADING'&&/^[A-Z0-9_]{5,30}$/.test(x.symbol)");
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
  note.textContent=current==='PAPER'?'Local paper simulation':current==='TESTNET'?'TESTNET · local simulation fallback (Binance Demo private API is region-restricted)':'Binance LIVE · real orders locked by server';
  root.appendChild(note);
}
async function boot(){try{controls();const r=await fetch('/app-scanner-v3.js?mode='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('Scanner source failed '+r.status);let src=await r.text();src=patch(src);(0,eval)(src);controls()}catch(e){const a=document.getElementById('app');if(a)a.innerHTML='<div style="padding:30px"><b>Scanner startup error</b><div style="color:#ff6178;margin-top:8px">'+String(e.message||e)+'</div></div>'}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();