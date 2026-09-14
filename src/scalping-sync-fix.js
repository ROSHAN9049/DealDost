/* Scalping dashboard sync fix: display only fresh engine analysis, align trend labels, and keep live P&L styling untouched. */
(()=>{
  const AK='scalping-analysis-v1', MAX_AGE=90_000;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]));
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
  const pct=v=>{const x=n(v);return `${x>=0?'+':''}${x.toFixed(2)}%`};
  const money=v=>{const x=n(v);if(!x)return '—';if(x>=1e9)return '$'+(x/1e9).toFixed(2)+'B';if(x>=1e6)return '$'+(x/1e6).toFixed(2)+'M';if(x>=1e3)return '$'+(x/1e3).toFixed(2)+'K';return '$'+x.toFixed(0)};
  const trend=(signal)=>signal==='BUY'?'BUY':signal==='SELL'?'SELL':'WAIT';
  function read(){
    let o={};try{o=JSON.parse(localStorage.getItem(AK)||'{}')||{}}catch{return[]}
    const a=Object.values(o).filter(x=>x&&x.symbol&&Number.isFinite(Number(x.analyzedAt)));
    if(!a.length)return[];
    const newest=Math.max(...a.map(x=>Number(x.analyzedAt)||0));
    return a.filter(x=>newest-(Number(x.analyzedAt)||0)<=MAX_AGE)
      .sort((a,b)=>(n(b.score)-n(a.score))||(Math.abs(n(b.priceChangePercent))-Math.abs(n(a.priceChangePercent))));
  }
  function cls(t){return t==='BUY'?'bull':t==='SELL'?'bear':'neutral'}
  function render(){
    const root=document.getElementById('scalping-analysis-dashboard');
    if(!root)return;
    const all=read();
    if(!all.length)return;
    const ready=all.filter(x=>x.signal==='BUY'||x.signal==='SELL');
    const buys=ready.filter(x=>x.signal==='BUY'), sells=ready.filter(x=>x.signal==='SELL');
    const top=ready[0]||all[0];
    const kpis=root.querySelectorAll('.scalp-kpis>div');
    if(kpis.length>=5){kpis[0].querySelector('b').textContent=buys.length;kpis[1].querySelector('b').textContent=sells.length;kpis[2].querySelector('b').textContent=top?.score??'—';kpis[3].querySelector('b').textContent=ready.length;kpis[4].querySelector('b').textContent=Object.keys(JSON.parse(localStorage.getItem('scanner-universe-v1')||'[]')).length||'';}
    const focus=root.querySelector('.scalp-focus');
    if(focus&&top){
      const strong=focus.querySelector('strong'); if(strong)strong.textContent=top.symbol;
      const span=focus.querySelector('span'); if(span){span.className=cls(top.signal);span.textContent=top.signal==='BUY'?'🟢 BUY':top.signal==='SELL'?'🔴 SELL':'⚪ WATCH'}
      const bs=focus.querySelectorAll('b'); if(bs[0])bs[0].textContent=n(top.price).toLocaleString('en-IN',{maximumFractionDigits:8});if(bs[1]){bs[1].className=cls(n(top.priceChangePercent)>=0?'BUY':'SELL');bs[1].textContent=pct(top.priceChangePercent)}if(bs[2])bs[2].textContent=top.spike==null?'—':n(top.spike).toFixed(2)+'x';if(bs[3])bs[3].textContent=top.reason||'Waiting for analysis';
    }
    const tbody=root.querySelector('.scalp-table tbody');
    if(!tbody)return;
    tbody.innerHTML=all.slice(0,20).map((r,i)=>{
      const s=r.signal==='BUY'||r.signal==='SELL'?r.signal:'WAIT';
      const t1=trend(s),t5=trend(s),t15=trend(s);
      return `<tr class="${s==='BUY'?'row-buy':s==='SELL'?'row-sell':'row-watch'}"><td>${i+1}</td><td><strong>${esc(r.symbol)}</strong></td><td>${n(r.price).toLocaleString('en-IN',{maximumFractionDigits:8})}</td><td class="${n(r.priceChangePercent)>=0?'bull':'bear'}">${pct(r.priceChangePercent)}</td><td>${money(r.quoteVolume)}</td><td class="${cls(t1)}">${t1}</td><td class="${cls(t5)}">${t5}</td><td class="${cls(t15)}">${t15}</td><td class="${n(r.spike)>=1.25?'hot':''}">${r.spike==null?'—':n(r.spike).toFixed(2)+'x'}</td><td class="${n(r.score)>=75?'score':''}">${r.score??'—'}</td><td><span class="sig ${s==='BUY'?'sig-buy':s==='SELL'?'sig-sell':'sig-watch'}">${s==='BUY'?'🟢 BUY':s==='SELL'?'🔴 SELL':'⚪ WATCH'}</span></td><td class="reason">${esc(r.reason||'Waiting for analysis')}</td></tr>`;
    }).join('');
    const live=root.querySelector('.scalp-live');if(live)live.innerHTML='<i></i> LIVE ENGINE SYNC';
    root.querySelector('.scalp-foot')?.querySelector('span')?.replaceChildren(document.createTextNode(`🧠 Fresh engine analysis · ${all.length} current records · stable universe`));
  }
  render();setInterval(render,1000);
})();
