/* DealDost V2 Command Center
 * Presentation + signal-quality layer only.
 * Does not place, cancel, size, or modify real orders.
 */
(()=>{'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number.isFinite(+v)?+v:0;
  const rows=()=>Array.isArray(window.__DD_SCANNER_ROWS)?window.__DD_SCANNER_ROWS:[];
  const score=x=>Math.max(0,Math.min(100,Math.round(Math.max(n(x.m),n(x.sc))*0.62+Math.min(20,Math.abs(n(x.c))*2.5)+Math.min(18,Math.max(0,(n(x.vs)-1)*9)))));
  const dir=x=>x.momentum==='BUY'&&x.scalp==='BUY'?'BUY':x.momentum==='SELL'&&x.scalp==='SELL'?'SELL':n(x.m)>=n(x.sc)&&x.momentum!=='WAIT'?x.momentum:x.scalp||'WAIT';
  const regime=a=>{if(!a.length)return['WAIT','Scanner data loading'];const avg=a.slice(0,10).reduce((s,x)=>s+(n(x.c)>0?1:-1),0)/Math.min(10,a.length);if(avg>.35)return['BULL','Momentum breadth positive'];if(avg<-.35)return['BEAR','Momentum breadth negative'];return['RANGE','Mixed market breadth']};
  function injectStyle(){if(document.getElementById('dd-v2-css'))return;const s=document.createElement('style');s.id='dd-v2-css';s.textContent=`
#dd-v2{margin-bottom:8px;border:1px solid #243b55;border-radius:12px;background:linear-gradient(135deg,#08111d,#0b1726 55%,#08111d);box-shadow:0 8px 28px rgba(0,0,0,.22);overflow:hidden}
#dd-v2 .v2-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid #1c3045}
#dd-v2 .v2-brand{font-weight:950;letter-spacing:.08em;font-size:14px;color:#d9e8f7}.v2-brand span{color:#4da3ff}.v2-muted{font-size:10px;color:#71869b;margin-top:3px}
#dd-v2 .v2-regime{padding:6px 10px;border:1px solid #28435e;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.06em;white-space:nowrap}
#dd-v2 .v2-grid{display:grid;grid-template-columns:1.05fr 1.95fr;gap:10px;padding:10px}.v2-card{border:1px solid #1d334a;border-radius:10px;background:#0b1623;padding:11px}.v2-title{font-size:10px;font-weight:900;color:#8299ae;letter-spacing:.08em;margin-bottom:8px}
#dd-v2 .v2-main{display:flex;align-items:center;gap:12px}.v2-gauge{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;border:5px solid #28435e;font-size:18px;font-weight:950}.v2-gauge small{font-size:8px;display:block;text-align:center;color:#71869b}
.v2-pick{display:grid;grid-template-columns:90px 58px 1fr 62px;gap:8px;align-items:center;padding:8px 0;border-top:1px solid #172a3d;font-size:11px}.v2-pick:first-of-type{border-top:0}.v2-pick b{font-size:11px}.v2-score{text-align:right;font-weight:950}.buy{color:#54d69a}.sell{color:#ff7082}.wait{color:#91a4b6}
.v2-bar{height:5px;border-radius:5px;background:#16293b;overflow:hidden}.v2-bar i{display:block;height:100%;background:#4da3ff}.v2-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.v2-tag{font-size:9px;padding:4px 6px;border-radius:6px;background:#122337;color:#9db2c7;border:1px solid #203a53}.v2-foot{padding:0 12px 10px;font-size:9px;color:#627a90}
@media(max-width:700px){#dd-v2 .v2-grid{grid-template-columns:1fr}.v2-pick{grid-template-columns:78px 52px 1fr 52px}}
`;document.head.appendChild(s)}
  function panel(){const a=rows().filter(x=>x&&x.s);if(!a.length)return '<section id="dd-v2"><div class="v2-head"><div><div class="v2-brand">⚡ DEALDOST <span>V2</span> COMMAND CENTER</div><div class="v2-muted">Signal quality layer · waiting for live scanner data</div></div><div class="v2-regime">LOADING</div></div></section>';
    const ranked=a.map(x=>({...x,q:score(x),d:dir(x)})).sort((x,y)=>y.q-x.q);const top=ranked.slice(0,5);const [reg,why]=regime(a);const avg=Math.round(top.reduce((s,x)=>s+x.q,0)/top.length);const cls=reg==='BULL'?'buy':reg==='BEAR'?'sell':'wait';
    const picks=top.map(x=>{const d=x.d;const q=x.q;return '<div class="v2-pick"><b>'+esc(x.s)+'</b><span class="'+(d==='BUY'?'buy':d==='SELL'?'sell':'wait')+'">'+esc(d)+'</span><div><div class="v2-bar"><i style="width:'+q+'%"></i></div><div class="v2-tags"><span class="v2-tag">M '+n(x.m)+'</span><span class="v2-tag">S '+n(x.sc)+'</span><span class="v2-tag">24H '+(n(x.c)>=0?'+':'')+n(x.c).toFixed(2)+'%</span></div></div><span class="v2-score">'+q+'/100</span></div>'}).join('');
    return '<section id="dd-v2"><div class="v2-head"><div><div class="v2-brand">⚡ DEALDOST <span>V2</span> COMMAND CENTER</div><div class="v2-muted">Momentum + Scalping · multi-timeframe confirmation · quality ranking</div></div><div class="v2-regime '+cls+'">'+reg+' · '+avg+'/100</div></div><div class="v2-grid"><div class="v2-card"><div class="v2-title">MARKET REGIME</div><div class="v2-main"><div class="v2-gauge"><div>'+avg+'<small>QUALITY</small></div></div><div><b>'+esc(reg)+'</b><div class="v2-muted">'+esc(why)+'</div><div class="v2-tags"><span class="v2-tag">Universe '+a.length+'</span><span class="v2-tag">Radar LIVE</span><span class="v2-tag">Orders OFF</span></div></div></div></div><div class="v2-card"><div class="v2-title">TOP CONFIRMED CANDIDATES</div>'+picks+'</div></div><div class="v2-foot">Quality score is a scanner-ranking metric, not a profit guarantee. Validate signals in PAPER/TESTNET before enabling live execution.</div></section>';
  }
  function mount(){const app=document.getElementById('app');if(!app||!window.DD||DD.tab!=='dashboard')return;const scanner=[...app.querySelectorAll('.panel')].find(p=>/Live Scanner|TOP LIVE MARKET/i.test(p.textContent||''));if(!scanner)return;injectStyle();let p=document.getElementById('dd-v2');if(!p){scanner.insertAdjacentHTML('beforebegin',panel());}else p.outerHTML=panel()}
  let last='';setInterval(()=>{try{const r=rows();const sig=r.length+'|'+r.slice(0,8).map(x=>x.s+':'+x.m+':'+x.sc+':'+x.c).join('|');if(sig!==last){last=sig;mount()}}catch(e){}},900);setTimeout(mount,1200);
})();
