/* DealDost stable coin universe — MUST load before app.js.
   Keeps coin identities/order stable while price, 24H change and volume remain LIVE. */
(function(){
  'use strict';
  const KEY='dealDostStableUniverseV3';
  const MAX_COINS=50;
  let symbols=[];
  try{
    const saved=JSON.parse(localStorage.getItem(KEY)||'[]');
    if(Array.isArray(saved)) symbols=saved.filter(s=>typeof s==='string'&&s);
  }catch(e){symbols=[]}

  function save(){try{localStorage.setItem(KEY,JSON.stringify(symbols.slice(0,MAX_COINS)))}catch(e){}}
  function build(payload){
    const valid=new Set((payload||[]).filter(t=>t&&t.symbol).map(t=>t.symbol));
    // Keep existing symbols and their order. Never reorder because price/change moves.
    symbols=symbols.filter(s=>valid.has(s));
    const candidates=(payload||[])
      .filter(t=>t&&t.symbol&&valid.has(t.symbol)&&!symbols.includes(t.symbol))
      .sort((a,b)=>Math.abs(Number(b.priceChangePercent)||0)-Math.abs(Number(a.priceChangePercent)||0));
    for(const t of candidates){
      if(symbols.length>=MAX_COINS) break;
      symbols.push(t.symbol);
    }
    symbols=symbols.slice(0,MAX_COINS);
    save();
    return symbols;
  }

  const nativeFetch=window.fetch.bind(window);
  if(window.__dealDostStablePreload) return;
  window.__dealDostStablePreload=true;
  window.fetch=function(input,init){
    return nativeFetch(input,init).then(async response=>{
      try{
        const url=typeof input==='string'?input:(input&&input.url)||'';
        if(!/\/fapi\/v1\/ticker\/24hr(?:\?|$)/.test(url)) return response;
        const data=await response.clone().json();
        if(!Array.isArray(data)) return response;
        const stable=build(data);
        const bySymbol=new Map(data.map(t=>[t.symbol,t]));
        const filtered=stable.map(s=>bySymbol.get(s)).filter(Boolean);
        return new Response(JSON.stringify(filtered),{
          status:response.status,
          statusText:response.statusText,
          headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
        });
      }catch(e){ return response; }
    });
  };
})();
