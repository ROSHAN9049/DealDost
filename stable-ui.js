/* Binance scanner UI: stable Delta-style order + radar + compact market scanner. */
(function(){
  const order=new Map(); let seq=0,lastHtml='';
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Number(String(v??'').replace(/[^0-9.+-]/g,''))||0;
  function ensureRadar(){
    const signals=document.getElementById('signals'); if(!signals)return;
    const panel=signals.closest('.panel'); if(!panel)return;
    let radar=document.getElementById('deltaRadar');
    if(!radar){
      radar=document.createElement('div'); radar.id='deltaRadar'; radar.className='deltaRadar';
      const head=panel.querySelector('.panelHead');
      if(head)head.insertAdjacentElement('afterend',radar); else panel.insertBefore(radar,panel.firstChild);
    }
    return radar;
  }
  function radar(rows){
    const box=ensureRadar(); if(!box)return;
    const data=rows.map(tr=>{const td=tr.querySelectorAll('td');const change=num(td[2]?.textContent),vol=td[3]?.textContent.trim()||'—';const mom=num(td[5]?.textContent),scalp=num(td[8]?.textContent),reason=td[10]?.textContent.trim()||'';const spike=reason.match(/volume\s+(?:spike\s+)?([0-9.]+)x/i);const signal=[td[6]?.textContent.trim(),td[9]?.textContent.trim()].find(x=>x==='LONG'||x==='SHORT')||'';return{symbol:td[0]?.textContent.trim()||'',change,vol,mom,scalp,score:Math.max(mom,scalp),reason,spike:spike?Number(spike[1]):0,signal}}).filter(x=>x.symbol&&x.symbol!=='Loading Binance Futures contracts…');
    const pump=[...data].sort((a,b)=>b.change-a.change)[0],dump=[...data].sort((a,b)=>a.change-b.change)[0],vs=[...data].filter(x=>x.spike>0).sort((a,b)=>b.spike-a.spike)[0],best=[...data].filter(x=>x.signal).sort((a,b)=>b.score-a.score)[0];
    const card=(title,icon,item,detail)=>`<div class="radarCard"><small>${icon} ${title}</small>${item?`<b>${esc(item.symbol)}</b><strong class="${item.change>=0?'up':'down'}">${detail}</strong><span>${item.vol}${item.score?` · Score ${item.score}`:''}</span>`:'<b>—</b><span>No qualifying data</span>'}</div>`;
    box.innerHTML=`${card('TOP PUMP','🚀',pump,pump?`+${pump.change.toFixed(2)}%`:'—')}${card('TOP DUMP','🔻',dump,dump?`${dump.change.toFixed(2)}%`:'—')}${card('VOLUME SPIKE','📊',vs,vs?`${vs.spike.toFixed(2)}x`:'No spike')}${card('TOP SIGNAL','⚡',best,best?`${best.signal} · ${best.score}`:'No signal')}`;
  }
  function decorate(){
    const body=document.getElementById('signals'); if(!body)return;
    const rows=[...body.querySelectorAll('tr')].filter(tr=>tr.querySelector('td'));
    if(!rows.length)return;
    rows.forEach(tr=>{const cell=tr.querySelector('td');const s=(cell?.textContent||'').trim();if(s&&!order.has(s)&&/^[A-Z0-9_]+USDT$/.test(s))order.set(s,seq++);});
    const sortable=rows.filter(tr=>order.has((tr.querySelector('td')?.textContent||'').trim()));
    sortable.sort((a,b)=>order.get((a.querySelector('td')?.textContent||'').trim())-order.get((b.querySelector('td')?.textContent||'').trim()));
    sortable.forEach(tr=>body.appendChild(tr));
    const search=(document.getElementById('search')?.value||'').trim().toUpperCase().replace('/','');
    if(search)sortable.forEach(tr=>tr.style.display=(tr.querySelector('td')?.textContent||'').toUpperCase().includes(search)?'':'none'); else sortable.forEach(tr=>tr.style.display='');
    const visible=sortable.filter(tr=>tr.style.display!=='none');
    const info=document.getElementById('scannerInfo'); if(info)info.textContent=`${visible.length} coins · live Delta-style order`;
    const signalCount=[...body.querySelectorAll('td')].filter(td=>/^(LONG|SHORT)$/.test(td.textContent.trim())).length; const sc=document.getElementById('signalCount'); if(sc)sc.textContent=`${signalCount} qualifying signals`;
    const headers=body.closest('table')?.querySelectorAll('thead th');
    ['SYMBOL','PRICE','24H %','VOLUME','MOM 5m/15m','SCORE','SIGNAL','SCALP 1m/5m','SCORE','SIGNAL','REASON','ACTION'].forEach((x,i)=>{if(headers?.[i])headers[i].textContent=x;});
    body.closest('table')?.classList.add('deltaCompact');
    sortable.forEach(tr=>{tr.classList.add('scannerRow');const td=tr.querySelectorAll('td');if(td[2])td[2].classList.add(num(td[2].textContent)>=0?'up':'down');if(td[6]?.textContent.trim()==='LONG'||td[9]?.textContent.trim()==='LONG')tr.classList.add('rowLong');if(td[6]?.textContent.trim()==='SHORT'||td[9]?.textContent.trim()==='SHORT')tr.classList.add('rowShort');});
    radar(sortable.filter(tr=>tr.style.display!=='none'));
    let box=document.getElementById('topSignals');if(!box){box=document.createElement('div');box.id='topSignals';box.className='notice';const panel=body.closest('.panel');const wrap=panel?.querySelector('.tableWrap');if(wrap)panel.insertBefore(box,wrap);}
    const candidates=sortable.map(tr=>{const td=tr.querySelectorAll('td');return{symbol:td[0]?.textContent.trim(),score:Math.max(num(td[5]?.textContent),num(td[8]?.textContent)),signal:[td[6]?.textContent.trim(),td[9]?.textContent.trim()].find(x=>x==='LONG'||x==='SHORT')||''}}).filter(x=>x.signal).sort((a,b)=>b.score-a.score).slice(0,6);
    box.innerHTML=candidates.length?`<b>🔥 TOP LIVE SIGNALS</b><span>${candidates.map((x,i)=>`${i+1}. ${esc(x.symbol)} · ${esc(x.signal)} · ${x.score}`).join(' &nbsp; | &nbsp; ')}</span><small>Rows stay in first-seen order; live values update in place.</small>`:'<b>🔥 TOP LIVE SIGNALS</b><span>No qualifying signal at the current scan.</span><small>Rows stay in first-seen order; live values update in place.</small>';
  }
  function observe(){const body=document.getElementById('signals');if(!body)return false;const observer=new MutationObserver(()=>{if(body.innerHTML!==lastHtml){lastHtml=body.innerHTML;setTimeout(decorate,0)}});observer.observe(body,{childList:true,subtree:true});decorate();return true}
  if(!observe()){const timer=setInterval(()=>{if(observe())clearInterval(timer)},100)}
  document.getElementById('search')?.addEventListener('input',()=>setTimeout(decorate,0));
  document.getElementById('refreshBtn')?.addEventListener('click',()=>setTimeout(decorate,500));
})();