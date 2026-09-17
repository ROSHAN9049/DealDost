/* DealDost Delta-Exchange-style dashboard layer
 * UI enhancement only. Existing trading engine and order endpoints are untouched.
 * Stable universe + Market Radar + 1m/5m/15m confirmation.
 */
(()=>{'use strict';
  const UNIVERSE_KEY='dd_stable_universe_v1';
  const esc=v=>String(v==null?'':v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Number.isFinite(+v)?+v:0;
  const money=v=>'₹'+num(v).toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2});
  const pct=v=>(num(v)>=0?'+':'')+num(v).toFixed(2)+'%';
  const price=v=>{const n=num(v);if(!n)return'—';if(n>=1000)return n.toLocaleString('en-IN',{maximumFractionDigits:2});if(n>=1)return n.toFixed(4);return n.toFixed(8)};
  const mode=()=>localStorage.getItem('ddMode')||'PAPER';
  const state=()=>{try{return JSON.parse(localStorage.getItem('ddv5_'+mode())||'{}')}catch{return {}}};
  function getStableUniverse(){try{const a=JSON.parse(localStorage.getItem(UNIVERSE_KEY)||'[]');return Array.isArray(a)?a.filter(x=>typeof x==='string'&&x):[]}catch{return[]}}
  function setStableUniverse(a){try{localStorage.setItem(UNIVERSE_KEY,JSON.stringify([...new Set(a)].slice(0,50)))}catch(e){}}
  function rememberUniverse(scanner){if(getStableUniverse().length)return;const coins=[...scanner.querySelectorAll('tbody tr')].map(tr=>tr.querySelectorAll('td')[1]?.textContent?.trim()).filter(x=>/USDT$/i.test(x));if(coins.length)setStableUniverse(coins)}
  function installStableFetch(){
    if(window.__DD_STABLE_FETCH_INSTALLED)return;
    const originalFetch=window.fetch;
    window.fetch=function(input,init){
      const reqUrl=typeof input==='string'?input:(input&&input.url)||'';let isEx=false;
      try{const u=new URL(reqUrl,location.href);isEx=u.pathname.endsWith('/api/binance-market')&&u.searchParams.get('path')==='/fapi/v1/exchangeInfo'}catch(e){}
      if(!isEx)return originalFetch.apply(this,arguments);
      const stable=getStableUniverse();if(!stable.length)return originalFetch.apply(this,arguments);
      return originalFetch.apply(this,arguments).then(async response=>{try{const data=await response.clone().json();if(!Array.isArray(data.symbols))return response;const rank=new Map(stable.map((s,i)=>[s,i]));data.symbols=data.symbols.filter(x=>rank.has(x.symbol)).sort((a,b)=>rank.get(a.symbol)-rank.get(b.symbol));const h=new Headers(response.headers);h.set('content-type','application/json');return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers:h})}catch(e){return response}})
    };
    window.__DD_STABLE_FETCH_INSTALLED=true;
  }
  function activeTrades(){
    const q=state(),out=[];
    (Array.isArray(q.pos)?q.pos:[]).forEach(p=>out.push({engine:p.e||'TRADE',symbol:p.s||'',side:p.side||'',entry:num(p.entry),current:num(p.current),qty:num(p.q),sl:num(p.sl),tp:num(p.tp),pnl:num(p.pnl)}));
    (Array.isArray(q.optSets)?q.optSets:[]).forEach(p=>{if(p.status==='OPEN')out.push({engine:'OPTIONS SET '+p.id,symbol:p.symbol||'',side:p.side||'',entry:num(p.entry),current:num(p.current),qty:num(p.qty),sl:0,tp:0,pnl:num(p.pnl)})});
    return out;
  }
  function positionPanel(){const ps=activeTrades();const rows=ps.map(p=>'<tr><td><b>'+esc(p.symbol)+'</b></td><td>'+esc(p.engine)+'</td><td class="'+(p.side==='BUY'?'buy':'sell')+'">'+esc(p.side)+'</td><td>'+price(p.entry)+'</td><td>'+price(p.current)+'</td><td>'+price(p.qty)+'</td><td>'+price(p.sl)+'</td><td>'+price(p.tp)+'</td><td class="'+(p.pnl>=0?'buy':'sell')+'">'+money(p.pnl)+'</td></tr>').join('');return '<section id="dd-delta-position-panel" class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">📌 POSITION DASHBOARD</div><div class="panel-sub">'+ps.length+' ACTIVE · '+esc(mode())+' MODE</div></div><div class="table-scroll"><table class="term"><thead><tr><th>Coin</th><th>Engine</th><th>Side</th><th>Entry</th><th>Current</th><th>Qty</th><th>SL</th><th>TP</th><th>P&amp;L</th></tr></thead><tbody>'+(rows||'<tr><td colspan="9" class="empty">No open positions</td></tr>')+'</tbody></table></div></section>'}
  function rulesPanel(){return '<section id="dd-delta-rules" class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">⚙️ AUTO ENGINE — ACTIVE RULES &amp; SAFETY</div><div class="panel-sub">Real orders remain controlled by selected mode</div></div><div class="note info">🌐 Live Binance feed · 📊 24H change + volume · 🕐 1m/5m/15m confirmation · 🎯 ATR-based SL/TP · 🛡️ Max 3 Momentum + 3 Scalping slots · 🧪 PAPER simulation only · 🔴 LIVE AUTO separately controlled</div></section>'}
  function direction(x){const m=x.momentum,sc=x.scalp;if(m==='BUY'&&sc==='BUY')return'BUY';if(m==='SELL'&&sc==='SELL')return'SELL';return m!=='WAIT'?m:sc!=='WAIT'?sc:'NEUTRAL'}
  function radarRows(){const rows=(window.DD&&window.DD._rows)||[];return rows}
  function marketRadar(){
    const rows=radarRows();
    if(!rows.length)return '<section id="dd-market-radar" class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">📡 MARKET RADAR</div><div class="panel-sub">Waiting for scanner data…</div></div></section>';
    const sorted=rows.slice().sort((a,b)=>Math.max(num(b.m),num(b.sc),Math.abs(num(b.c))) - Math.max(num(a.m),num(a.sc),Math.abs(num(a.c))));
    const pumps=rows.filter(x=>num(x.c)>0).sort((a,b)=>num(b.c)-num(a.c)).slice(0,3);
    const dumps=rows.filter(x=>num(x.c)<0).sort((a,b)=>num(a.c)-num(b.c)).slice(0,3);
    const vol=rows.map(x=>{const k=window.__DD_GET_VOL_SPIKE?window.__DD_GET_VOL_SPIKE(x.s):1;return{x,v:num(k)}}).sort((a,b)=>b.v-a.v).slice(0,3);
    const signal=sorted.filter(x=>direction(x)!=='NEUTRAL').slice(0,5);
    const chip=(label,a,field,fmt)=>'<div class="acct-card"><h4>'+label+'</h4>'+(a.length?a.map(x=>'<div class="acct-row"><span>'+esc(x.s||x.x?.s)+'</span><b class="'+((field==='c'?num(x.c):num(x.v))>=0?'buy':'sell')+'">'+(fmt?fmt(x):'')+'</b></div>').join(''):'<div class="empty">No qualifying data</div>')+'</div>';
    const pumpHtml=chip('🔥 TOP PUMP',pumps,'c',x=>pct(x.c));
    const dumpHtml=chip('🔻 TOP DUMP',dumps,'c',x=>pct(x.c));
    const volHtml='<div class="acct-card"><h4>📊 VOLUME SPIKE</h4>'+vol.map(x=>'<div class="acct-row"><span>'+esc(x.x.s)+'</span><b>'+x.v.toFixed(2)+'x</b></div>').join('')+'</div>';
    const sigHtml='<div class="acct-card"><h4>🎯 ACTIVE SIGNALS</h4>'+signal.map(x=>'<div class="acct-row"><span>'+esc(x.s)+'</span><b class="'+(direction(x)==='BUY'?'buy':'sell')+'">'+direction(x)+' · '+Math.max(num(x.m),num(x.sc))+'/100</b></div>').join('')+'</div>';
    return '<section id="dd-market-radar" class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">📡 MARKET RADAR</div><div class="panel-sub">Stable universe · 24H momentum · volume spike · 1m/5m/15m confirmation</div></div><div class="acct-grid">'+pumpHtml+dumpHtml+volHtml+sigHtml+'</div></section>';
  }
  function refreshPanels(){
    const app=document.getElementById('app');if(!app||DD.tab!=='dashboard')return;
    const scanner=[...app.querySelectorAll('.panel')].find(p=>/TOP LIVE MARKET|Live Scanner/i.test(p.textContent||''));
    if(!scanner)return;
    rememberUniverse(scanner);
    let radar=app.querySelector('#dd-market-radar');
    if(!radar){scanner.insertAdjacentHTML('beforebegin',marketRadar());radar=app.querySelector('#dd-market-radar')}
    else radar.outerHTML=marketRadar();
    let pos=app.querySelector('#dd-delta-position-panel');if(pos)pos.outerHTML=positionPanel();
    const stable=getStableUniverse();const title=scanner.querySelector('.panel-title');if(title)title.innerHTML='🌈 TOP LIVE MARKET · STABLE '+(stable.length||50);const sub=scanner.querySelector('.panel-sub');if(sub)sub.innerHTML='Fixed coin universe · Live prices · 24H change · volume · Momentum · Scalping · signal';
  }
  function enhance(){if(!window.DD||DD.tab!=='dashboard')return;const app=document.getElementById('app');if(!app)return;const panels=[...app.querySelectorAll('.panel')];const scanner=panels.find(p=>/Live Scanner/i.test(p.textContent||''));if(!scanner)return;rememberUniverse(scanner);if(!app.querySelector('#dd-delta-rules'))scanner.insertAdjacentHTML('beforebegin',rulesPanel());if(!app.querySelector('#dd-delta-position-panel'))scanner.insertAdjacentHTML('beforebegin',positionPanel());refreshPanels()}
  function install(){installStableFetch();if(!window.DD||window.__DD_DELTA_STYLE_INSTALLED)return false;window.__DD_DELTA_STYLE_INSTALLED=true;window.DD._rows=[];const original=DD.render;DD.render=function(){const r=original.apply(this,arguments);try{DD._rows=window.__DD_SCANNER_ROWS||DD._rows;enhance()}catch(e){}return r};setTimeout(enhance,50);return true}
  window.__DD_SCANNER_ROWS=[];
  window.__DD_GET_VOL_SPIKE=s=>{try{const r=(window.DD&&window.DD._rows||[]).find(x=>x.s===s);if(!r)return 1;const a=window.__DD_KLINES?.[s]?.m5;return a&&a.length>11?num(a.at(-1)[5])/Math.max(a.slice(-11,-1).reduce((z,k)=>z+num(k[5]),0)/10,1e-9):1}catch(e){return 1}};
  const bridge=setInterval(()=>{if(window.S&&S.rows){window.__DD_SCANNER_ROWS=S.rows;window.__DD_KLINES=S.k||{};if(window.DD)DD._rows=S.rows}},500);
  const timer=setInterval(()=>{if(install())clearInterval(timer)},100);
})();
