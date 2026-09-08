/* Binance scanner UI: mirror the Delta Scanner layout/order — top liquid contracts first. */
(function(){
  function esc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}
  function deltaStyleRenderSignals(rows){
    const body=document.getElementById('signals'); if(!body)return;
    const search=(document.getElementById('search')?.value||'').trim().toUpperCase().replace('/','');
    // Delta-style: rows arrive already sorted by 24H turnover/volume. Show only the top 33 liquid contracts.
    const ordered=[...(rows||[])].slice(0,33);
    const visible=search?ordered.filter(r=>String(r.t.symbol||'').includes(search)):ordered;
    const cls=x=>x?.signal==='LONG'?'long':x?.signal==='SHORT'?'short':'watch';
    body.innerHTML=visible.map(r=>{
      const a=r.mom,z=r.scalp;
      const best=a?.signal==='LONG'||a?.signal==='SHORT'?a:(z?.signal==='LONG'||z?.signal==='SHORT'?z:null);
      return `<tr><td><b>${esc(r.t.symbol)}</b></td><td>${Number(r.t.lastPrice||0).toLocaleString()}</td><td class="${Number(r.t.priceChangePercent)>=0?'long':'short'}">${Number(r.t.priceChangePercent||0).toFixed(2)}%</td><td>$${(Number(r.t.quoteVolume||0)/1e6).toFixed(2)}M</td><td>${esc(a?.trend||'WAIT')}</td><td>${a?.score||0}</td><td class="${cls(a)}">${a?.signal||'WATCH'}</td><td>${esc(z?.trend||'WAIT')}</td><td>${z?.score||0}</td><td class="${cls(z)}">${z?.signal||'WATCH'}</td><td>${esc(best?.reason||a?.reason||z?.reason||'Closed candle unavailable · retry')}</td><td>${best?.sl?`<button class="signalBtn" data-s="${encodeURIComponent(JSON.stringify(best))}">Paper Entry</button>`:'—'}</td></tr>`;
    }).join('')||'<tr><td colspan="12" class="empty">No matching coins.</td></tr>';
    body.querySelectorAll('.signalBtn').forEach(q=>q.onclick=()=>window.paperOpen(JSON.parse(decodeURIComponent(q.dataset.s))));
    const signals=visible.flatMap(r=>[r.mom,r.scalp]).filter(x=>x&&(x.signal==='LONG'||x.signal==='SHORT')).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,8);
    let box=document.getElementById('topSignals');
    if(!box){box=document.createElement('div');box.id='topSignals';box.className='notice';const panel=document.querySelector('#signals')?.closest('.panel');panel?.insertBefore(box,panel.querySelector('.tableWrap'));}
    box.innerHTML=signals.length?`<b>🔥 TOP LIVE SIGNALS · ${signals.length}</b><span>${signals.map((s,i)=>`${i+1}. ${esc(s.symbol)} · ${esc(s.side||s.signal)} · ${esc(s.engine)} · Score ${s.score}`).join(' &nbsp; | &nbsp; ')}</span><small>Delta-style order: highest 24H-volume/liquidity contracts appear first. Live values update on each scan.</small>`:'<b>🔥 TOP LIVE SIGNALS</b><span>No qualifying signal at the current scan.</span><small>Delta-style order: highest 24H-volume/liquidity contracts appear first.</small>';
    const qualifying=(rows||[]).filter(r=>r.mom?.signal==='LONG'||r.mom?.signal==='SHORT'||r.scalp?.signal==='LONG'||r.scalp?.signal==='SHORT').length;
    const set=window.set||((id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v});
    set('scannerInfo',`${visible.length} coins${search?' · filtered':''} · Delta-style liquidity order`);
    set('signalCount',`${qualifying} qualifying signals`);
  }
  window.renderSignals=deltaStyleRenderSignals;
})();
