(()=>{'use strict';
const KEY='ddMode';
function showError(e){const s=document.getElementById('boot-status');if(s)s.innerHTML='<b style="color:#ff6178">Scanner error:</b> '+String(e&&e.message||e||'Unknown startup error')+' <button onclick="location.reload()" style="margin-left:8px;padding:7px 10px;border-radius:7px;border:1px solid #34506d;background:#142238;color:#fff">RELOAD</button>';console.error('DealDost boot failed',e)}
function patch(src){
 const testnet="localStorage.getItem('ddMode')==='TESTNET'";
 src=src.replace("const PUB='/api/binance-market?path=',AC='/api/binance-account?path=',TR='/api/binance-trade'","const PUB='/api/binance-market?path=',AC='/api/binance-account?path=',TR='/api/binance-trade'");
 src=src.replace("const S={mode:'PAPER',auto:true,liveAuto:false","const S={mode:(localStorage.getItem('ddMode')||'PAPER'),auto:true,liveAuto:false");
 src=src.replace("if(S.mode!=='PAPER'||!canOpen(x,e))return false","if(!['PAPER','TESTNET'].includes(S.mode)||!canOpen(x,e))return false");
 src=src.replace("mode:'PAPER',reason:x.reasons","mode:S.mode,reason:x.reasons");
 src=src.replace("if(S.mode==='PAPER'){","if(S.mode==='PAPER'||S.mode==='TESTNET'){");
 src=src.replace("if(p.mode!=='PAPER')continue","if(!['PAPER','TESTNET'].includes(p.mode))continue");
 src=src.replace("async function syncAccount(){if(Date.now()-S.lastAccount<2500)return;","async function syncAccount(){if(S.mode==='PAPER'||S.mode==='TESTNET'){return;}if(Date.now()-S.lastAccount<2500)return;");
 src=src.replace("localStorage.ddv5=JSON.stringify","localStorage['ddv5_'+(S.mode||'PAPER')]=JSON.stringify");
 src=src.replace("JSON.parse(localStorage.ddv5||'{}')","JSON.parse(localStorage['ddv5_'+(localStorage.getItem('ddMode')||'PAPER')]||'{}')");
 src=src.replace("S.mode==='LIVE'?'LIVE MODE · Binance account sync active.':'PAPER MODE · Real orders are OFF.'","S.mode==='LIVE'?'LIVE MODE · Binance account sync active.':S.mode==='TESTNET'?'TESTNET · Local simulation · Real orders are OFF.':'PAPER MODE · Local simulation · Real orders are OFF.'");
 return src;
}
function controls(){const root=document.getElementById('dd-mode-root');if(!root)return;root.innerHTML='';const current=localStorage.getItem(KEY)||'PAPER';['PAPER','TESTNET','LIVE'].forEach(m=>{const b=document.createElement('button');b.type='button';b.textContent=(m==='PAPER'?'PAPER TRADING':m)+(m===current?' ✓':'');b.dataset.mode=m;b.style.cssText='background:'+(m===current?'#15304b':'#0d1a2a')+';color:#e9f1fb;border:1px solid '+(m===current?'#4da3ff':'#2a415b')+';border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:900';b.onclick=()=>{if(m===current)return;if(m==='LIVE'&&!confirm('LIVE mode selected. Real Binance orders remain server-locked until LIVE_UNLOCKED=true. Continue?'))return;localStorage.setItem(KEY,m);location.reload()};root.appendChild(b)});const note=document.createElement('span');note.id='dd-mode-note';note.style.cssText='font-size:11px;color:#8295ad;margin-left:4px';note.textContent=current==='PAPER'?'PAPER TRADING · Local simulation':current==='TESTNET'?'TESTNET · Local simulation · Real orders OFF':'LIVE · Real orders locked';root.appendChild(note)}
async function boot(){if(window.__DD_BOOT_STARTED)return;window.__DD_BOOT_STARTED=true;try{controls();const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),12000);const r=await fetch('/app-scanner-v3.js?mode='+Date.now(),{cache:'no-store',signal:ctl.signal});clearTimeout(timer);if(!r.ok)throw Error('Scanner source failed '+r.status);let src=await r.text();if(!src||src.length<500)throw Error('Scanner source is empty or incomplete');src=patch(src);(0,eval)(src);window.__DD_BOOT_OK=true;controls();}catch(e){showError(e)}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();