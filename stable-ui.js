/* Binance scanner UI: stable Delta-style order + full coin coverage + P&L colors. */
(function(){
  const order=new Map(); let seq=0,lastHtml='',universe=[],lastUniverseAt=0,universeBusy=false;
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Number(String(v??'').replace(/[^0-9.+-]/g,''))||0;
  const $=id=>document.getElementById(id);
  async function fetchUniverse(force=false){
    if(universeBusy)return;
    if(!force&&Date.now()-lastUniverseAt<15000)return;
    universeBusy=true;
    try{
      const [info,ticker]=await Promise.all([
        fetch('https://fapi.binance.com/fapi/v1/exchangeInfo').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/ticker/24hr').then(r=>r.json())
      ]);
      const eligible=new Set((info.symbols||[]).filter(s=>s.status==='TRADING'&&s.contractType==='PERPETUAL'&&(s.quoteAsset==='USDT'||s.quoteAsset==='USDC')).map(s=>s.symbol));
      const minVol=Number($('minVolume')?.value)||100000;
      universe=(ticker||[]).filter(t=>eligible.has(t.symbol)&&Number(t.quoteVolume||0)>=minVol).sort((a,b)=>Number(b.quoteVolume||0)-Number(a.quoteVolume||0));
      lastUniverseAt=Date.now();
      decorate();
    }catch(e){}finally{universeBusy=false}
  }
  function ensureRadar(){
    const signals=$('signals'); if(!signals)return;
    const panel=signals.closest('.panel'); if(!panel)return;
    let radarBox=$('deltaRadar');
    if(!radarBox){radarBox=document.createElement('div');radarBox.id='deltaRadar';radarBox.className='deltaRadar';const head=panel.querySelector('.panelHead');if(head)head.insertAdjacentElement('afterend',radarBox);else panel.insertBefore(radarBox,panel.firstChild);}
    return radarBox;
  }
  function radar(rows){
    const box=ensureRadar();if(!box)return;
    const data=rows.map(tr=>{const td=tr.querySelectorAll('td');const change=num(td[2]?.textContent),vol=td[3]?.textContent.trim()||'—',mom=num(td[5]?.textContent),scalp=num(td[8]?.textContent),reason=td[10]?.textContent.trim()||'',spike=reason.match(/volume\s+(?:spike\s+)?([0-9.]+)x/i),signal=[td[6]?.textContent.trim(),td[9]?.textContent.trim()].find(x=>x==='LONG'||x==='SHORT')||'';return{symbol:td[0]?.textContent.trim()||'',change,vol,mom,scalp,score:Math.max(mom,scalp),reason,spike:spike?Number(spike[1]):0,signal}}).filter(x=>x.symbol&&x.symbol!=='Loading Binance Futures contracts…');
    const pump=[...data].sort((a,b)=>b.change-a.change)[0],dump=[...data].sort((a,b)=>a.change-b.change)[0],vs=[...data].filter(x=>x.spike>0).sort((a,b)=>b.spike-a.spike)[0],best=[...data].filter(x=>x.signal).sort((a,b)=>b.score-a.score)[0];
    const card=(title,icon,item,detail)=>`<div class="radarCard"><small>${icon} ${title}</small>${item?`<b>${esc(item.symbol)}</b><strong class="${item.change>=0?'up':'down'}">${detail}</strong><span>${item.vol}${item.score?` · Score ${item.score}`:''}</span>`:'<b>—</b><span>No qualifying data</span>'}</div>`;
    box.innerHTML=`${card('TOP PUMP','🚀',pump,pump?`+${pump.change.toFixed(2)}%`:'—')}${card('TOP DUMP','🔻',dump,dump?`${dump.change.toFixed(2)}%`:'—')}${card('VOLUME SPIKE','📊',vs,vs?`${vs.spike.toFixed(2)}x`:'No spike')}${card('TOP SIGNAL','⚡',best,best?`${best.signal} · ${best.score}`:'No signal')}`;
  }
  function injectUniverseRows(body){
    if(!universe.length)return;
    const existing=new Set([...body.querySelectorAll('tr td:first-child')].map(td=>td.textContent.trim()));
    const frag=document.createDocumentFragment();
    for(const t of universe){
      if(existing.has(t.symbol))continue;
      const change=Number(t.priceChangePercent)||0,price=Number(t.lastPrice)||0,vol=Number(t.quoteVolume)||0;
      const tr=document.createElement('tr');
      tr.innerHTML=`<td><b>${esc(t.symbol)}</b></td><td>${price.toLocaleString()}</td><td class="${change>=0?'long':'short'}">${change.toFixed(2)}%</td><td>$${(vol/1e6).toFixed(2)}M</td><td>WAIT</td><td>0</td><td class="watch">WATCH</td><td>WAIT</td><td>0</td><td class="watch">WATCH</td><td>Awaiting candle analysis</td><td>—</td>`;
      frag.appendChild(tr);
    }
    if(frag.childNodes.length)body.appendChild(frag);
  }
  function colorPnl(){
    ['netPnl','avgPnl'].forEach(id=>{const e=$(id);if(!e)return;const v=num(e.textContent);e.classList.remove('pnlPositive','pnlNegative','pnlZero');e.classList.add(v>0?'pnlPositive':v<0?'pnlNegative':'pnlZero');});
    document.querySelectorAll('#momentumPositions td,#scalpPositions td,#trades td').forEach(td=>{
      const text=td.textContent.trim();if(!/₹/.test(text))return;
      const v=num(text);td.classList.remove('pnlPositive','pnlNegative','pnlZero');td.classList.add(v>0?'pnlPositive':v<0?'pnlNegative':'pnlZero');
    });
    document.querySelectorAll('#momentumPositions tr,#scalpPositions tr').forEach(tr=>{
      const side=tr.querySelector('td:nth-child(2)')?.textContent.trim();const coin=tr.querySelector('td:first-child');
      if(coin){coin.classList.remove('coinLong','coinShort');coin.classList.add(side==='LONG'?'coinLong':side==='SHORT'?'coinShort':'');}
    });
  }
  function decorate(){
    const body=$('signals');if(!body)return;
    injectUniverseRows(body);
    const rows=[...body.querySelectorAll('tr')].filter(tr=>tr.querySelector('td'));
    if(!rows.length)return;
    rows.forEach(tr=>{const s=(tr.querySelector('td')?.textContent||'').trim();if(s&&!order.has(s)&&/^[A-Z0-9_]+(?:USDT|USDC)$/.test(s))order.set(s,seq++);});
    const sortable=rows.filter(tr=>order.has((tr.querySelector('td')?.textContent||'').trim()));
    sortable.sort((a,b)=>order.get((a.querySelector('td')?.textContent||'').trim())-order.get((b.querySelector('td')?.textContent||'').trim()));
    sortable.forEach(tr=>body.appendChild(tr));
    const search=($('search')?.value||'').trim().toUpperCase().replace('/','');
    sortable.forEach(tr=>tr.style.display=search?((tr.querySelector('td')?.textContent||'').toUpperCase().includes(search)?'':'none'):'' );
    const visible=sortable.filter(tr=>tr.style.display!=='none');
    const info=$('scannerInfo');if(info)info.textContent=`${visible.length} coins · live Delta-style order`;
    const signalCount=[...body.querySelectorAll('td')].filter(td=>/^(LONG|SHORT)$/.test(td.textContent.trim())).length;const sc=$('signalCount');if(sc)sc.textContent=`${signalCount} qualifying signals`;
    const headers=body.closest('table')?.querySelectorAll('thead th');['SYMBOL','PRICE','24H %','VOLUME','MOM 5m/15m','SCORE','SIGNAL','SCALP 1m/5m','SCORE','SIGNAL','REASON','ACTION'].forEach((x,i)=>{if(headers?.[i])headers[i].textContent=x;});
    body.closest('table')?.classList.add('deltaCompact');
    sortable.forEach(tr=>{tr.classList.add('scannerRow');const td=tr.querySelectorAll('td');if(td[0]){const ch=num(td[2]?.textContent);td[0].classList.remove('coinUp','coinDown');td[0].classList.add(ch>=0?'coinUp':'coinDown');}if(td[2])td[2].classList.add(num(td[2].textContent)>=0?'up':'down');if(td[6]?.textContent.trim()==='LONG'||td[9]?.textContent.trim()==='LONG')tr.classList.add('rowLong');if(td[6]?.textContent.trim()==='SHORT'||td[9]?.textContent.trim()==='SHORT')tr.classList.add('rowShort');});
    radar(visible);
    let box=$('topSignals');if(!box){box=document.createElement('div');box.id='topSignals';box.className='notice';const panel=body.closest('.panel');const wrap=panel?.querySelector('.tableWrap');if(wrap)panel.insertBefore(box,wrap);}
    const candidates=sortable.map(tr=>{const td=tr.querySelectorAll('td');return{symbol:td[0]?.textContent.trim(),score:Math.max(num(td[5]?.textContent),num(td[8]?.textContent)),signal:[td[6]?.textContent.trim(),td[9]?.textContent.trim()].find(x=>x==='LONG'||x==='SHORT')||''}}).filter(x=>x.signal).sort((a,b)=>b.score-a.score).slice(0,6);
    box.innerHTML=candidates.length?`<b>🔥 TOP LIVE SIGNALS</b><span>${candidates.map((x,i)=>`${i+1}. ${esc(x.symbol)} · ${esc(x.signal)} · ${x.score}`).join(' &nbsp; | &nbsp; ')}</span><small>Rows stay in first-seen order; live values update in place.</small>`:'<b>🔥 TOP LIVE SIGNALS</b><span>No qualifying signal at the current scan.</span><small>Rows stay in first-seen order; live values update in place.</small>';
    colorPnl();
  }
  function observe(){const body=$('signals');if(!body)return false;const observer=new MutationObserver(()=>{if(body.innerHTML!==lastHtml){lastHtml=body.innerHTML;setTimeout(decorate,0)}});observer.observe(body,{childList:true,subtree:true});decorate();return true}
  if(!observe()){const timer=setInterval(()=>{if(observe())clearInterval(timer)},100)}
  fetchUniverse(true);setInterval(()=>fetchUniverse(false),15000);
  $('search')?.addEventListener('input',()=>setTimeout(decorate,0));
  $('minVolume')?.addEventListener('change',()=>fetchUniverse(true));
  $('refreshBtn')?.addEventListener('click',()=>{fetchUniverse(true);setTimeout(decorate,500)});
})();