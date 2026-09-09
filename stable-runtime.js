/* DealDost STABLE TOP-50 runtime controller.
   Locks the coin universe once; price, 24H change and volume remain live. */
(function(){
  'use strict';
  const KEY='dealDostStableUniverseV5', MAX=50, API='/fapi/v1/';
  let stable=[];
  try{
    const saved=JSON.parse(localStorage.getItem(KEY)||'[]');
    if(Array.isArray(saved)) stable=saved.filter(x=>typeof x==='string'&&x).slice(0,MAX);
  }catch(e){stable=[]}
  const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(stable.slice(0,MAX)))}catch(e){}};
  const nativeFetch=window.fetch.bind(window);
  if(window.__dealDostStableRuntime)return;
  window.__dealDostStableRuntime=true;

  function responseJson(data, original){
    return new Response(JSON.stringify(data),{
      status:original.status,
      statusText:original.statusText,
      headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
    });
  }
  function tickerCandidates(data){
    return (data||[]).filter(x=>x&&x.symbol&&/^[A-Z0-9]+(?:USDT|USDC)$/.test(x.symbol));
  }
  function choose(data){
    const valid=new Set(tickerCandidates(data).map(x=>x.symbol));
    stable=stable.filter(s=>valid.has(s));
    const candidates=tickerCandidates(data)
      .filter(x=>!stable.includes(x.symbol))
      .sort((a,b)=>Math.abs(Number(b.priceChangePercent)||0)-Math.abs(Number(a.priceChangePercent)||0));
    for(const x of candidates){if(stable.length>=MAX)break;stable.push(x.symbol)}
    stable=stable.slice(0,MAX); save(); window.__dealDostStableSymbols=stable.slice();
    return stable.slice();
  }

  window.fetch=async function(input,init){
    const url=typeof input==='string'?(input||''):(input&&input.url)||'';

    /* ExchangeInfo: augment the response with missing ticker symbols so app.js
       can never reduce the stable universe because of a narrow local filter. */
    if(/\/fapi\/v1\/exchangeInfo(?:\?|$)/.test(url)){
      const original=await nativeFetch(input,init);
      try{
        const info=await original.clone().json();
        const tickResp=await nativeFetch((url.match(/^https?:\/\/[^/]+/)||[''])[0]+'/fapi/v1/ticker/24hr',init);
        const tickers=await tickResp.clone().json();
        const symbols=choose(tickers);
        const list=Array.isArray(info.symbols)?info.symbols.slice():[];
        const existing=new Set(list.map(x=>x.symbol));
        for(const symbol of symbols){
          if(existing.has(symbol))continue;
          list.push({symbol,status:'TRADING',contractType:'PERPETUAL',quoteAsset:symbol.endsWith('USDC')?'USDC':'USDT',baseAsset:symbol.replace(/USDC$|USDT$/,'')});
        }
        info.symbols=list; return responseJson(info,original);
      }catch(e){return original}
    }

    /* Ticker: return exactly the locked 50 symbols, with fresh market fields. */
    if(/\/fapi\/v1\/ticker\/24hr(?:\?|$)/.test(url)){
      const original=await nativeFetch(input,init);
      try{
        const data=await original.clone().json();
        if(!Array.isArray(data))return original;
        const symbols=choose(data), map=new Map(data.map(x=>[x.symbol,x]));
        const out=symbols.map(s=>map.get(s)).filter(Boolean);
        return responseJson(out,original);
      }catch(e){return original}
    }
    return nativeFetch(input,init);
  };
})();
