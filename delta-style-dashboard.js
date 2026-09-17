/* DealDost Delta-Exchange-style dashboard layer
 * Safe UI-only enhancement. No MutationObserver, no app.innerHTML replacement.
 * Keeps the existing Binance scanner/trading engine untouched.
 * Adds a stable 50-coin universe: the first scanner membership is remembered,
 * then subsequent exchangeInfo scans are restricted to that same membership.
 */
(()=>{'use strict';
  const UNIVERSE_KEY='dd_stable_universe_v1';
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))}
  function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
  function money(v){return '₹'+num(v).toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2})}
  function price(v){const n=num(v);if(!n)return '—';if(n>=1000)return n.toLocaleString('en-IN',{maximumFractionDigits:2});if(n>=1)return n.toFixed(4);return n.toFixed(8)}
  function mode(){return localStorage.getItem('ddMode')||'PAPER'}
  function state(){try{return JSON.parse(localStorage.getItem('ddv5_'+mode())||'{}')}catch{return {}}}

  /* ===== Stable scanner universe ===== */
  function getStableUniverse(){try{const a=JSON.parse(localStorage.getItem(UNIVERSE_KEY)||'[]');return Array.isArray(a)?a.filter(x=>typeof x==='string'&&x):[]}catch{return []}}
  function setStableUniverse(a){try{localStorage.setItem(UNIVERSE_KEY,JSON.stringify([...new Set(a)].slice(0,50)))}catch(e){}}
  function rememberUniverseFromScanner(scanner){
    if(getStableUniverse().length)return;
    const coins=[...scanner.querySelectorAll('tbody tr')].map(tr=>tr.querySelectorAll('td')[1]?.textContent?.trim()).filter(x=>/USDT$/i.test(x));
    if(coins.length)setStableUniverse(coins);
  }
  function installStableFetch(){
    if(window.__DD_STABLE_FETCH_INSTALLED)return;
    const originalFetch=window.fetch;
    window.fetch=function(input,init){
      const reqUrl=typeof input==='string'?input:(input&&input.url)||'';
      let isExchangeInfo=false;
      try{const u=new URL(reqUrl,location.href);isExchangeInfo=u.pathname.endsWith('/api/binance-market')&&u.searchParams.get('path')==='/fapi/v1/exchangeInfo'}catch(e){}
      if(!isExchangeInfo)return originalFetch.apply(this,arguments);
      const stable=getStableUniverse();
      if(!stable.length)return originalFetch.apply(this,arguments);
      return originalFetch.apply(this,arguments).then(async response=>{
        try{
          const data=await response.clone().json();
          if(!Array.isArray(data.symbols))return response;
          const rank=new Map(stable.map((s,i)=>[s,i]));
          data.symbols=data.symbols.filter(x=>rank.has(x.symbol)).sort((a,b)=>rank.get(a.symbol)-rank.get(b.symbol));
          const headers=new Headers(response.headers);headers.set('content-type','application/json');
          return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
        }catch(e){return response}
      });
    };
    window.__DD_STABLE_FETCH_INSTALLED=true;
  }

  function activeTrades(){
    const q=state(),out=[];
    (Array.isArray(q.pos)?q.pos:[]).forEach(p=>out.push({engine:p.e||'TRADE',symbol:p.s||'',side:p.side||'',entry:num(p.entry),current:num(p.current),qty:num(p.q),sl:num(p.sl),tp:num(p.tp),pnl:num(p.pnl),time:p.opened||0}));
    (Array.isArray(q.optSets)?q.optSets:[]).forEach(p=>{if(p.status==='OPEN')out.push({engine:'OPTIONS SET '+p.id,symbol:p.symbol||'',side:p.side||'',entry:num(p.entry),current:num(p.current),qty:num(p.qty),sl:0,tp:0,pnl:num(p.pnl),time:p.opened||0})});
    return out;
  }
  function positionPanel(){
    const ps=activeTrades();
    const rows=ps.map(p=>'<tr><td><b>'+esc(p.symbol)+'</b></td><td>'+esc(p.engine)+'</td><td class="'+(p.side==='BUY'?'buy':'sell')+'">'+esc(p.side)+'</td><td>'+price(p.entry)+'</td><td>'+price(p.current)+'</td><td>'+price(p.qty)+'</td><td>'+price(p.sl)+'</td><td>'+price(p.tp)+'</td><td class="'+(p.pnl>=0?'buy':'sell')+'">'+money(p.pnl)+'</td></tr>').join('');
    return '<section id="dd-delta-position-panel" class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">📌 POSITION DASHBOARD</div><div class="panel-sub">'+ps.length+' ACTIVE · '+esc(mode())+' MODE</div></div><div class="table-scroll"><table class="term"><thead><tr><th>Coin</th><th>Engine</th><th>Side</th><th>Entry</th><th>Current</th><th>Qty</th><th>SL</th><th>TP</th><th>P&amp;L</th></tr></thead><tbody>'+(rows||'<tr><td colspan="9" class="empty">No open positions</td></tr>')+'</tbody></table></div></section>';
  }
  function rulesPanel(){
    return '<section id="dd-delta-rules" class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">⚙️ AUTO ENGINE — ACTIVE RULES &amp; SAFETY</div><div class="panel-sub">Real orders remain controlled by the selected mode</div></div><div class="note info">🌐 Live Binance market feed · 📊 Momentum + Scalping confirmation · 📈 Volume/volatility filters · 🎯 ATR-based SL/TP · 🛡️ Max 3 Momentum + 3 Scalping slots · 🧪 PAPER is simulation only · 🔴 LIVE AUTO requires separate confirmation</div></section>';
  }
  function enhance(){
    if(!window.DD)return;
    if(DD.tab!=='dashboard')return;
    const app=document.getElementById('app');if(!app)return;
    if(app.querySelector('#dd-delta-position-panel'))return;
    const panels=[...app.querySelectorAll('.panel')];
    const scanner=panels.find(p=>/Live Scanner/i.test(p.textContent||''));
    if(!scanner)return;
    rememberUniverseFromScanner(scanner);
    const stable=getStableUniverse();
    const frag=document.createRange().createContextualFragment(rulesPanel()+positionPanel());
    const rules=frag.firstElementChild,pos=frag.lastElementChild;
    scanner.parentNode.insertBefore(rules,scanner);
    scanner.parentNode.insertBefore(pos,scanner);
    const title=scanner.querySelector('.panel-title');
    if(title)title.innerHTML='🌈 TOP LIVE MARKET · STABLE '+(stable.length||50);
    const sub=scanner.querySelector('.panel-sub');
    if(sub)sub.innerHTML='Fixed coin universe · Live prices · 24H change · volume · Momentum · Scalping · signal';
  }
  function install(){
    installStableFetch();
    if(!window.DD||window.__DD_DELTA_STYLE_INSTALLED)return false;
    window.__DD_DELTA_STYLE_INSTALLED=true;
    const original=DD.render;
    DD.render=function(){const r=original.apply(this,arguments);try{enhance()}catch(e){}return r};
    setTimeout(enhance,50);
    return true;
  }
  const timer=setInterval(()=>{if(install())clearInterval(timer)},100);
})();
