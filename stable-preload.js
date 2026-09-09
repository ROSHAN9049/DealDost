/* DealDost stable coin controller — keep Binance ticker response LIVE. */
(function(){
'use strict';
const KEY='dealDostStableUniverseV4',MAX_COINS=50;let symbols=[];
try{const s=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(s))symbols=s.filter(x=>typeof x==='string'&&x).slice(0,MAX_COINS)}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(symbols.slice(0,MAX_COINS)))}catch(e){}}
function update(data){
 const valid=new Set((data||[]).filter(x=>x&&x.symbol).map(x=>x.symbol));
 symbols=symbols.filter(s=>valid.has(s));
 const candidates=(data||[]).filter(x=>x&&x.symbol&&!symbols.includes(x.symbol)).sort((a,b)=>Math.abs(Number(b.priceChangePercent)||0)-Math.abs(Number(a.priceChangePercent)||0));
 for(const x of candidates){if(symbols.length>=MAX_COINS)break;symbols.push(x.symbol)}
 symbols=symbols.slice(0,MAX_COINS);save();window.__dealDostStableSymbols=symbols.slice();return symbols;
}
window.__dealDostStableUniverse={max:MAX_COINS,get:()=>symbols.slice(),update};window.__dealDostStableSymbols=symbols.slice();
const nativeFetch=window.fetch.bind(window);if(window.__dealDostStablePreload)return;window.__dealDostStablePreload=true;
window.fetch=function(input,init){return nativeFetch(input,init).then(async response=>{try{const url=typeof input==='string'?input:(input&&input.url)||'';if(/\/fapi\/v1\/ticker\/24hr(?:\?|$)/.test(url)){const data=await response.clone().json();if(Array.isArray(data))update(data)}}catch(e){}return response})};
})();
