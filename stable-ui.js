/* Delta-style visual stabilizer + paper risk guard. Keeps scanner coins fixed while live values update, and prevents rapid revenge re-entry. */
(function(){
  let lastHtml='', arranging=false;
  const order=new Map(); let nextOrder=0;
  const $=id=>document.getElementById(id);
  const num=v=>Number(String(v??'').replace(/[^0-9.+-]/g,''))||0;

  /* Paper re-entry protection:
     - 5 minute cooldown after any position closes
     - after 2 losing closes for the same symbol+engine, 30 minute lock
     - does not affect scanner signals or real Binance orders (which remain OFF)
  */
  const GUARD_KEY='binancePaperRiskGuardV1',COOLDOWN=5*60*1000,LOSS_WINDOW=30*60*1000,LOSS_LIMIT=2,LOSS_LOCK=30*60*1000;
  let guard={};
  try{guard=JSON.parse(localStorage.getItem(GUARD_KEY)||'{}')||{}}catch(e){guard={}};
  const saveGuard=()=>{try{localStorage.setItem(GUARD_KEY,JSON.stringify(guard))}catch(e){}};
  const cleanGuard=()=>{const now=Date.now();Object.keys(guard).forEach(k=>{const g=guard[k];if(!g||((g.lastClose||0)+LOSS_WINDOW<now&&!(g.blockedUntil>now)))delete guard[k];else if(Array.isArray(g.losses))g.losses=g.losses.filter(t=>t+LOSS_WINDOW>=now)});saveGuard()};
  function installRiskGuard(){
    if(typeof window.paperOpen!=='function'||window.__dealDostRiskGuard)return false;
    const original=window.paperOpen;window.__dealDostRiskGuard=true;
    window.paperOpen=function(s,auto=false){
      cleanGuard();
      const symbol=s?.symbol,engine=s?.engine;if(!symbol||!engine)return original(s,auto);
      const key=symbol+'|'+engine,now=Date.now(),g=guard[key]||{};
      if(g.blockedUntil>now)return false;
      if(g.lastClose&&now-g.lastClose<COOLDOWN)return false;
      return original(s,auto);
    };
    return true;
  }
  let previousPositions=new Map();
  function monitorClosedPositions(){
    if(typeof state==='undefined'||!Array.isArray(state.positions))return;
    cleanGuard();
    const current=new Map(state.positions.map(p=>[(p.symbol||'')+'|'+(p.engine||'')+'|'+(p.openedAt||0),p]));
    for(const [id,p] of previousPositions){
      if(current.has(id))continue;
      const key=(p.symbol||'')+'|'+(p.engine||'');if(!p.symbol||!p.engine)continue;
      const now=Date.now(),g=guard[key]||{};g.lastClose=now;
      const recent=Array.isArray(state.trades)?state.trades.slice().reverse().find(t=>t&&t.symbol===p.symbol&&t.engine===p.engine):null;
      const pnl=recent&&Number.isFinite(Number(recent.pnl))?Number(recent.pnl):Number(p.unreal||0);
      if(pnl<0){g.losses=Array.isArray(g.losses)?g.losses.filter(t=>t+LOSS_WINDOW>=now):[];g.losses.push(now);if(g.losses.length>=LOSS_LIMIT)g.blockedUntil=now+LOSS_LOCK;}
      guard[key]=g;
    }
    previousPositions=current;saveGuard();
  }

  function arrange(){
    const body=$('signals');if(!body||arranging)return;
    const rows=[...body.querySelectorAll('tr')].filter(tr=>tr.querySelector('td'));
    rows.forEach(tr=>{const s=(tr.querySelector('td')?.textContent||'').trim();if(s&&!order.has(s))order.set(s,nextOrder++);});
    const sorted=rows.slice().sort((a,b)=>(order.get((a.querySelector('td')?.textContent||'').trim())??999999)-(order.get((b.querySelector('td')?.textContent||'').trim())??999999));
    if(rows.some((r,i)=>r!==sorted[i])){arranging=true;sorted.forEach(r=>body.appendChild(r));arranging=false;}
  }
  function decorate(){
    const body=$('signals');if(!body)return;
    arrange();
    const rows=[...body.querySelectorAll('tr')].filter(tr=>tr.querySelector('td'));
    const search=($('search')?.value||'').trim().toUpperCase().replace('/','');
    rows.forEach(tr=>{
      const td=tr.querySelectorAll('td'),symbol=(td[0]?.textContent||'').trim();
      tr.style.display=search&&symbol.toUpperCase().indexOf(search)<0?'none':'';
      tr.classList.add('scannerRow');
      if(td[0]){const ch=num(td[2]?.textContent);td[0].classList.remove('coinUp','coinDown');td[0].classList.add(ch>=0?'coinUp':'coinDown')}
      if(td[2])td[2].classList.add(num(td[2].textContent)>=0?'up':'down');
      if(td[6]?.textContent.trim()==='LONG'||td[9]?.textContent.trim()==='LONG')tr.classList.add('rowLong');
      if(td[6]?.textContent.trim()==='SHORT'||td[9]?.textContent.trim()==='SHORT')tr.classList.add('rowShort');
    });
    const visible=rows.filter(tr=>tr.style.display!=='none');
    const info=$('scannerInfo');if(info)info.textContent=`${visible.length} coins · fixed live order`;
    const sc=$('signalCount');if(sc){const q=rows.filter(tr=>['LONG','SHORT'].includes(tr.querySelector('td:nth-child(7)')?.textContent.trim())||['LONG','SHORT'].includes(tr.querySelector('td:nth-child(10)')?.textContent.trim())).length;sc.textContent=`${q} qualifying signals`}
    const table=body.closest('table');table?.classList.add('deltaCompact');
    ['SYMBOL','PRICE','24H CHANGE','VOLUME','MOMENTUM','SCORE','SIGNAL','SCALPING','SCORE','SIGNAL','SIGNAL REASON','ACTION'].forEach((x,i)=>{const h=table?.querySelectorAll('thead th')?.[i];if(h)h.textContent=x});
    colorPnl();
  }
  function colorPnl(){
    document.querySelectorAll('#momentumPositions td,#scalpPositions td,#trades td,#netPnl,#avgPnl').forEach(el=>{if(!/₹/.test(el.textContent))return;const v=num(el.textContent);el.classList.remove('pnlPositive','pnlNegative','pnlZero');el.classList.add(v>0?'pnlPositive':v<0?'pnlNegative':'pnlZero');});
    document.querySelectorAll('#momentumPositions tr,#scalpPositions tr').forEach(tr=>{const side=tr.querySelector('td:nth-child(2)')?.textContent.trim(),coin=tr.querySelector('td:first-child');if(coin)coin.classList.add(side==='LONG'?'coinLong':side==='SHORT'?'coinShort':'');});
  }
  function observe(){const body=$('signals');if(!body)return false;new MutationObserver(()=>{if(arranging)return;if(body.innerHTML!==lastHtml){lastHtml=body.innerHTML;requestAnimationFrame(decorate)}else{requestAnimationFrame(arrange);colorPnl()}}).observe(body,{childList:true,subtree:true});decorate();return true}
  if(!observe()){const t=setInterval(()=>{if(observe())clearInterval(t)},100)}
  $('search')?.addEventListener('input',()=>requestAnimationFrame(decorate));
  installRiskGuard();setInterval(()=>{installRiskGuard();monitorClosedPositions()},1000);
})();