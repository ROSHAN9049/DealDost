/* Binance scanner UI: stable Delta-style order without rolling/loading lock. */
(function(){
  const order=new Map(); let seq=0, lastHtml='';
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  function decorate(){
    const body=document.getElementById('signals'); if(!body)return;
    const rows=[...body.querySelectorAll('tr')].filter(tr=>tr.querySelector('td'));
    if(!rows.length)return;
    rows.forEach(tr=>{const cell=tr.querySelector('td'); const s=(cell?.textContent||'').trim(); if(s&&!order.has(s)&&/^[A-Z0-9_]+USDT$/.test(s))order.set(s,seq++);});
    const sortable=rows.filter(tr=>{const s=(tr.querySelector('td')?.textContent||'').trim();return order.has(s)});
    sortable.sort((a,b)=>order.get((a.querySelector('td')?.textContent||'').trim())-order.get((b.querySelector('td')?.textContent||'').trim()));
    sortable.forEach(tr=>body.appendChild(tr));
    const search=(document.getElementById('search')?.value||'').trim().toUpperCase().replace('/','');
    if(search)sortable.forEach(tr=>{tr.style.display=(tr.querySelector('td')?.textContent||'').toUpperCase().includes(search)?'':'none'});
    else sortable.forEach(tr=>tr.style.display='');
    const visible=sortable.filter(tr=>tr.style.display!=='none');
    const info=document.getElementById('scannerInfo');
    if(info)info.textContent=`${visible.length} coins · stable Delta-style order`;
    const signalCount=[...body.querySelectorAll('td')].filter(td=>/^(LONG|SHORT)$/.test(td.textContent.trim())).length;
    const sc=document.getElementById('signalCount');
    if(sc)sc.textContent=`${signalCount} qualifying signals`;
    let box=document.getElementById('topSignals');
    if(!box){box=document.createElement('div');box.id='topSignals';box.className='notice';const panel=body.closest('.panel');const wrap=panel?.querySelector('.tableWrap');if(wrap)panel.insertBefore(box,wrap);}
    const candidates=sortable.map(tr=>{const td=tr.querySelectorAll('td');return{symbol:td[0]?.textContent.trim(),score:Math.max(Number(td[5]?.textContent)||0,Number(td[8]?.textContent)||0),reason:td[10]?.textContent.trim(),signal:[td[6]?.textContent.trim(),td[9]?.textContent.trim()].find(x=>x==='LONG'||x==='SHORT')||''}}).filter(x=>x.signal).sort((a,b)=>b.score-a.score).slice(0,6);
    box.innerHTML=candidates.length?`<b>🔥 TOP LIVE SIGNALS</b><span>${candidates.map((x,i)=>`${i+1}. ${esc(x.symbol)} · ${esc(x.signal)} · Score ${x.score}`).join(' &nbsp; | &nbsp; ')}</span><small>Rows stay in first-seen order; live values update in place.</small>`:'<b>🔥 TOP LIVE SIGNALS</b><span>No qualifying signal at the current scan.</span><small>Rows stay in first-seen order; live values update in place.</small>';
  }
  function observe(){
    const body=document.getElementById('signals'); if(!body)return false;
    const observer=new MutationObserver(()=>{if(body.innerHTML!==lastHtml){lastHtml=body.innerHTML;setTimeout(decorate,0)}});
    observer.observe(body,{childList:true,subtree:true});
    decorate(); return true;
  }
  if(!observe()){const timer=setInterval(()=>{if(observe())clearInterval(timer)},100)}
  document.getElementById('search')?.addEventListener('input',()=>setTimeout(decorate,0));
  document.getElementById('refreshBtn')?.addEventListener('click',()=>setTimeout(decorate,500));
})();