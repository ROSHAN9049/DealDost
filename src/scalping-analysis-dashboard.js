import './scalping-analysis-dashboard.css';

const rootId='scalping-analysis-dashboard';
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
const finite=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const fmt=(v,d=2)=>{const x=Number(v);return Number.isFinite(x)?x.toFixed(d):'—'};
const pct=v=>{const x=finite(v);return x==null?'—':`${x>=0?'+':''}${x.toFixed(2)}%`};
const money=v=>{const x=Math.abs(num(v));return x>=1e9?`$${(x/1e9).toFixed(2)}B`:x>=1e6?`$${(x/1e6).toFixed(2)}M`:x>=1e3?`$${(x/1e3).toFixed(1)}K`:`$${x.toFixed(0)}`};
const cls=v=>v==='BULLISH'?'bull':v==='BEARISH'?'bear':'neutral';
const esc=v=>String(v??'').replace(/[&<>\\\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\\':'&#39;'}[m]));

function stableUniverse(){
  try{const raw=JSON.parse(localStorage.getItem('scanner-universe-v1')||'[]');return [...new Set(raw.map(x=>String(x||'').trim().toUpperCase()).filter(x=>x.endsWith('USDT')))];}catch{return[]}
}
function parseScannerRows(){
  const out=[];document.querySelectorAll('.scanner-panel tbody tr').forEach(row=>{const cells=[...row.querySelectorAll('td')].map(td=>td.textContent.trim());const si=cells.findIndex(x=>/USDT\s*$/.test(x));if(si<0)return;const symbol=(cells[si].match(/([^\s]+USDT)\s*$/)?.[1]||'').toUpperCase();if(!symbol)return;const price=num((cells[si+1]||'').replace(/[^0-9.eE+-]/g,''));const change=num((cells[si+2]||'').replace(/[^0-9.+-]/g,''));let vol=num((cells[si+3]||'').replace(/[^0-9.eE+-]/g,''));const vc=cells[si+3]||'';if(/B/i.test(vc))vol*=1e9;else if(/M/i.test(vc))vol*=1e6;else if(/K/i.test(vc))vol*=1e3;if(price>0)out.push({symbol,price,priceChangePercent:change,quoteVolume:vol})});return out;
}
function parseEngineCards(){
  const out=[];document.querySelectorAll('#scalping-engine-panel #scalp-list > div').forEach(card=>{const text=card.textContent.trim();const symbol=((text.match(/([A-Z0-9._-]+USDT)/)||[])[1]||'').toUpperCase();if(!symbol)return;const signal=/\b(BUY|SELL|WAIT)\b/.exec(text)?.[1]||'WAIT';const score=/Score\s+([0-9]+)/.exec(text);const spike=/Spike\s+([0-9.]+)x/.exec(text);const change=/24H\s+([+-]?[0-9.]+)%/.exec(text);const reason=text.split(/24H\s+[+-]?[0-9.]+%\s*/)[1]||'';out.push({symbol,signal,score:score?Number(score[1]):null,spike:spike?Number(spike[1]):null,priceChangePercent:change?Number(change[1]):0,reason:reason.trim()})});return out;
}
function getData(){
  const universe=stableUniverse(),allowed=new Set(universe);const direct=Array.isArray(window.__BINANCE_SCALPING_ANALYSIS)?window.__BINANCE_SCALPING_ANALYSIS:[];const legacy=Array.isArray(window.__BINANCE_SCANNER_SIGNALS)?window.__BINANCE_SCANNER_SIGNALS:[];const scanner=parseScannerRows();const engine=direct.length?direct:(legacy.length?legacy:parseEngineCards());const ticks=window.__BINANCE_SCANNER_TICKERS||{};const map=new Map();[...scanner,...engine].forEach(raw=>{const x=raw||{},symbol=String(x.symbol||'').toUpperCase();if(!allowed.has(symbol))return;const prev=map.get(symbol)||{};map.set(symbol,{...prev,...x,symbol})});const signals=[...map.values()].map(x=>{const tick=ticks?.[x.symbol]||ticks?.[x.symbol.toLowerCase()]||{};const price=num(x.price)||num(tick.price);const quoteVolume=num(x.quoteVolume)||num(tick.quoteVolume);const change=finite(x.priceChangePercent)??finite(tick.priceChangePercent)??0;const invalidTicker=price<=0||quoteVolume<=0;return {...x,price,quoteVolume,priceChangePercent:change,signal:invalidTicker?'WAIT':(x.signal||'WATCH'),invalidTicker}});return{universe,signals,ticks,engineActive:engine.length>0};
}
function scoreRows(signals){return signals.filter(x=>!x.invalidTicker||x.signal==='WATCH').sort((a,b)=>(b.score??-1)-(a.score??-1)||Math.abs(num(b.priceChangePercent))-Math.abs(num(a.priceChangePercent))).slice(0,20)}
function render(){
  let el=document.getElementById(rootId);if(!el){el=document.createElement('section');el.id=rootId;const root=document.getElementById('root');(root?.parentElement||document.body).appendChild(el)}const{universe,signals,engineActive}=getData();const rows=scoreRows(signals),buys=signals.filter(x=>!x.invalidTicker&&x.signal==='BUY'),sells=signals.filter(x=>!x.invalidTicker&&x.signal==='SELL');const top=buys[0]||sells[0]||rows[0],ready=buys.length+sells.length;el.innerHTML=`<div class="scalp-head"><div><div class="scalp-kicker">⚡ BINANCE SCALPING MODE</div><h2>📊 LIVE ANALYSIS DASHBOARD</h2><p>1M momentum + 5M trend · 24H direction · volume spike · score engine · paper only</p></div><div class="scalp-live"><i></i> ${engineActive?'LIVE ANALYSIS':'WAITING FOR ENGINE'}</div></div><div class="scalp-kpis"><div><small>🟢 BUY READY</small><b class="bull">${buys.length}</b></div><div><small>🔴 SELL READY</small><b class="bear">${sells.length}</b></div><div><small>🎯 BEST SCORE</small><b class="score">${top?.score??'—'}</b></div><div><small>📡 READY SIGNALS</small><b>${ready}</b></div><div><small>🌐 MARKET COINS</small><b>${universe.length}</b></div></div>${top?`<div class="scalp-focus"><div><small>🔥 TOP SCALP CANDIDATE</small><strong>${esc(top.symbol)}</strong><span class="${top.signal==='BUY'?'bull':top.signal==='SELL'?'bear':'neutral'}">${top.signal==='BUY'?'🟢 BUY':top.signal==='SELL'?'🔴 SELL':'⚪ WATCH'}</span></div><div><small>PRICE</small><b>${num(top.price).toLocaleString('en-IN',{maximumFractionDigits:8})}</b></div><div><small>24H</small><b class="${num(top.priceChangePercent)>=0?'bull':'bear'}">${pct(top.priceChangePercent)}</b></div><div><small>VOLUME SPIKE</small><b>${top.spike==null?'—':`${fmt(top.spike)}x`}</b></div><div><small>REASON</small><b>${esc(top.reason||'—')}</b></div></div>`:''}<div class="scalp-table-wrap"><table class="scalp-table"><thead><tr><th>#</th><th>COIN</th><th>PRICE</th><th>24H</th><th>VOL</th><th>1M</th><th>5M</th><th>15M</th><th>SPIKE</th><th>SCORE</th><th>SIGNAL</th><th>ANALYSIS</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${r.signal==='BUY'?'row-buy':r.signal==='SELL'?'row-sell':'row-watch'}"><td>${i+1}</td><td><strong>${esc(r.symbol)}</strong></td><td>${num(r.price).toLocaleString('en-IN',{maximumFractionDigits:8})}</td><td class="${num(r.priceChangePercent)>=0?'bull':'bear'}">${pct(r.priceChangePercent)}</td><td>${money(r.quoteVolume)}</td><td class="${cls(r.trend1)}">${esc(r.trend1||'WAIT')}</td><td class="${cls(r.trend5)}">${esc(r.trend5||'WAIT')}</td><td class="neutral">${esc(r.trend15||'N/A')}</td><td class="${num(r.spike)>=1.5?'hot':''}">${r.spike==null?'—':`${fmt(r.spike)}x`}</td><td class="${num(r.score)>=75?'score':''}">${r.score??'—'}</td><td><span class="sig ${r.signal==='BUY'?'sig-buy':r.signal==='SELL'?'sig-sell':'sig-watch'}">${r.signal==='BUY'?'🟢 BUY':r.signal==='SELL'?'🔴 SELL':'⚪ WATCH'}</span></td><td class="reason">${esc(r.invalidTicker?'Waiting for valid live ticker':(r.reason||'Waiting for analysis'))}</td></tr>`).join('')}</tbody></table></div><div class="scalp-foot"><span>🧠 Standard stable universe · ${universe.length} active USDT perpetuals</span><span>🛡️ Dashboard only · real orders remain OFF</span></div>`;
}
function colorScalpHistoryPnl(){
  const table=document.querySelector('#scalping-engine-panel #scalp-history table');
  if(!table)return;
  table.querySelectorAll('tbody tr').forEach(row=>{
    const cell=row.children[5];
    if(!cell)return;
    const value=Number((cell.textContent||'').replace(/[^0-9.-]/g,''));
    cell.style.fontWeight='900';
    cell.style.color=value>0?'#48df91':value<0?'#ff697a':'#c1c8d2';
  });
}
render();setInterval(()=>{render();colorScalpHistoryPnl()},1500);