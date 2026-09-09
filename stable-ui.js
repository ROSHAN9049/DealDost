/* Stable coin-universe controller + visual stabilizer + paper risk guard.
   Keeps the tracked coin set stable while Binance price/change/volume stay LIVE.
   A coin is replaced only when it is no longer available in the eligible market. */
(function(){
  const $=id=>document.getElementById(id);
  const num=v=>Number(String(v??'').replace(/[^0-9.+-]/g,''))||0;

  /* ---------------- Stable scanner universe ---------------- */
  const UNIVERSE_KEY='dealDostStableUniverseV2';
  const MAX_COINS=50;
  let stableSymbols=[];
  let universeReady=false;

  function loadUniverse(){
    try{
      const v=JSON.parse(localStorage.getItem(UNIVERSE_KEY)||'[]');
      stableSymbols=Array.isArray(v)?v.filter(x=>typeof x==='string'&&x):[];
    }catch(e){stableSymbols=[]}
  }
  function saveUniverse(){
    try{localStorage.setItem(UNIVERSE_KEY,JSON.stringify(stableSymbols.slice(0,MAX_COINS)))}catch(e){}
  }
  loadUniverse();

  function buildStableUniverse(all,eligible){
    const map=new Map((all||[]).filter(t=>t&&t.symbol).map(t=>[t.symbol,t]));
    const allowed=new Set((eligible||[]).map(c=>c.symbol));
    const available=new Set(map.keys());
    /* Keep existing coins in their original order. Remove only unavailable ones. */
    stableSymbols=stableSymbols.filter(s=>allowed.has(s)&&available.has(s));

    /* First run: choose the current top 50 once. Later runs only fill missing slots. */
    const candidates=(all||[])
      .filter(t=>t&&allowed.has(t.symbol)&&available.has(t.symbol)&&!stableSymbols.includes(t.symbol))
      .sort((a,b)=>Math.abs(num(b.priceChangePercent))-Math.abs(num(a.priceChangePercent)));

    for(const t of candidates){
      if(stableSymbols.length>=MAX_COINS)break;
      stableSymbols.push(t.symbol);
    }
    stableSymbols=stableSymbols.slice(0,MAX_COINS);
    universeReady=true;
    saveUniverse();
    return stableSymbols;
  }

  /* Intercept the 24h ticker response used by app.js.
     Prices, 24h %, and volume are never frozen: only the symbol universe is sticky. */
  const nativeFetch=window.fetch;
  if(!window.__dealDostStableFetch){
    window.__dealDostStableFetch=true;
    window.fetch=async function(input,init){
      const response=await nativeFetch.call(this,input,init);
      try{
        const url=typeof input==='string'?input:(input?.url||'');
        if(!/\/fapi\/v1\/ticker\/24hr(?:\?|$)/.test(url))return response;
        const payload=await response.clone().json();
        if(!Array.isArray(payload))return response;

        /* app.js loads contracts before this ticker call; read them when available. */
        const eligible=Array.isArray(window.contracts)?window.contracts:[];
        const symbols=buildStableUniverse(payload,eligible.length?eligible:payload.map(t=>({symbol:t.symbol})));
        const bySymbol=new Map(payload.map(t=>[t.symbol,t]));
        const filtered=symbols.map(s=>bySymbol.get(s)).filter(Boolean);
        return new Response(JSON.stringify(filtered),{
          status:response.status,
          statusText:response.statusText,
          headers:{'Content-Type':'application/json'}
        });
      }catch(e){return response}
    };
  }

  /* ---------------- Paper risk guard ---------------- */
  const GUARD_KEY='binancePaperRiskGuardV1',COOLDOWN=5*60*1000,LOSS_WINDOW=30*60*1000,LOSS_LIMIT=2,LOSS_LOCK=30*60*1000;
  let guard={};
  try{guard=JSON.parse(localStorage.getItem(GUARD_KEY)||'{}')||{}}catch(e){guard={}};
  const saveGuard=()=>{try{localStorage.setItem(GUARD_KEY,JSON.stringify(guard))}catch(e){}};
  const cleanGuard=()=>{const now=Date.now();Object.keys(guard).forEach(k=>{const g=guard[k];if(!g||((g.lastClose||0)+LOSS_WINDOW<now&&!(g.blockedUntil>now)))delete guard[k];else if(Array.isArray(g.losses))g.losses=g.losses.filter(t=>t+LOSS_WINDOW>=now)});saveGuard()};
  function installRiskGuard(){
    if(typeof window.paperOpen!=='function'||window.__dealDostRiskGuard)return false;
    const original=window.paperOpen;window.__dealDostRiskGuard=true;
    window.paperOpen=function(s,auto=false){
      cleanGuard();const symbol=s?.symbol,engine=s?.engine;if(!symbol||!engine)return original(s,auto);
      const key=symbol+'|'+engine,now=Date.now(),g=guard[key]||{};
      if(g.blockedUntil>now)return false;if(g.lastClose&&now-g.lastClose<COOLDOWN)return false;
      return original(s,auto);
    };return true;
  }
  let previousPositions=new Map();
  function monitorClosedPositions(){
    if(typeof state==='undefined'||!Array.isArray(state.positions))return;cleanGuard();
    const current=new Map(state.positions.map(p=>[(p.symbol||'')+'|'+(p.engine||'')+'|'+(p.openedAt||0),p]));
    for(const [id,p] of previousPositions){
      if(current.has(id))continue;
      const key=(p.symbol||'')+'|'+(p.engine||'');if(!p.symbol||!p.engine)continue;
      const now=Date.now(),g=guard[key]||{};g.lastClose=now;
      const recent=Array.isArray(state.trades)?state.trades.slice().reverse().find(t=>t&&t.symbol===p.symbol&&t.engine===p.engine):null;
      const pnl=recent&&Number.isFinite(Number(recent.pnl))?Number(recent.pnl):Number(p.unreal||0);
      if(pnl<0){g.losses=Array.isArray(g.losses)?g.losses.filter(t=>t+LOSS_WINDOW>=now):[];g.losses.push(now);if(g.losses.length>=LOSS_LIMIT)g.blockedUntil=now+LOSS_LOCK}
      guard[key]=g;
    }
    previousPositions=current;saveGuard();
  }

  /* Never reorder by live 24h change. DOM order follows the sticky symbol universe. */
  let arranging=false;
  function arrange(){
    const body=$('signals');if(!body||arranging||!stableSymbols.length)return;
    const rows=[...body.querySelectorAll('tr')].filter(tr=>tr.querySelector('td'));
    const bySymbol=new Map(rows.map(tr=>[(tr.querySelector('td:nth-child(2)')?.textContent||'').trim(),tr]));
    const sorted=stableSymbols.map(s=>bySymbol.get(s)).filter(Boolean);
    rows.forEach(tr=>{if(!sorted.includes(tr))sorted.push(tr)});
    if(rows.some((r,i)=>r!==sorted[i])){arranging=true;sorted.forEach(r=>body.appendChild(r));arranging=false;}
  }

  function decorate(){
    const body=$('signals');if(!body)return;arrange();
    const rows=[...body.querySelectorAll('tr')].filter(tr=>tr.querySelector('td'));
    const search=($('search')?.value||'').trim().toUpperCase().replace('/','');
    rows.forEach(tr=>{
      const td=tr.querySelectorAll('td'),symbol=(td[1]?.textContent||'').trim();
      tr.style.display=search&&symbol.toUpperCase().indexOf(search)<0?'none':'';
      tr.classList.add('scannerRow');
      if(td[3]){const ch=num(td[3].textContent);td[3].classList.remove('up','down');td[3].classList.add(ch>=0?'up':'down')}
      if(td[7]?.textContent.trim()==='LONG'||td[9]?.textContent.trim()==='LONG')tr.classList.add('rowLong');
      if(td[7]?.textContent.trim()==='SHORT'||td[9]?.textContent.trim()==='SHORT')tr.classList.add('rowShort');
    });
    const visible=rows.filter(tr=>tr.style.display!=='none'),info=$('scannerInfo');
    if(info)info.textContent=`${visible.length} stable coins · LIVE price/change/volume`;
    const sc=$('signalCount');
    if(sc){const q=rows.filter(tr=>['LONG','SHORT'].includes(tr.querySelector('td:nth-child(8)')?.textContent.trim())||['LONG','SHORT'].includes(tr.querySelector('td:nth-child(10)')?.textContent.trim())).length;sc.textContent=`${q} qualifying signals`}
    const table=body.closest('table');table?.classList.add('deltaCompact');
    colorPnl();
  }

  function colorPnl(){
    document.querySelectorAll('#momentumPositions td,#scalpPositions td,#trades td,#netPnl,#avgPnl').forEach(el=>{
      if(!/₹/.test(el.textContent))return;const v=num(el.textContent);el.classList.remove('pnlPositive','pnlNegative','pnlZero');el.classList.add(v>0?'pnlPositive':v<0?'pnlNegative':'pnlZero')
    });
    document.querySelectorAll('#momentumPositions tr,#scalpPositions tr').forEach(tr=>{const side=tr.querySelector('td:nth-child(2)')?.textContent.trim(),coin=tr.querySelector('td:first-child');if(coin)coin.classList.add(side==='LONG'?'coinLong':side==='SHORT'?'coinShort':'')});
  }

  let lastHtml='';
  function observe(){
    const body=$('signals');if(!body)return false;
    new MutationObserver(()=>{if(arranging)return;if(body.innerHTML!==lastHtml){lastHtml=body.innerHTML;requestAnimationFrame(decorate)}else{requestAnimationFrame(arrange);colorPnl()}}).observe(body,{childList:true,subtree:true});
    decorate();return true;
  }
  if(!observe()){const t=setInterval(()=>{if(observe())clearInterval(t)},100)}
  $('search')?.addEventListener('input',()=>requestAnimationFrame(decorate));
  installRiskGuard();setInterval(()=>{installRiskGuard();monitorClosedPositions();arrange()},1000);
})();