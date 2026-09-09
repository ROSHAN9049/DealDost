/* DealDost STABLE TOP-50 controller — coin identities/order locked; market values stay live. */
(function(){
'use strict';
const KEY='dealDostStableUniverseV5',MAX=50;
let symbols=[];
try{const s=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(s))symbols=s.filter(x=>typeof x==='string'&&x).slice(0,MAX)}catch(e){}
const nativeSort=Array.prototype.sort;
const nativeFetch=window.fetch.bind(window);
function save(){try{localStorage.setItem(KEY,JSON.stringify(symbols.slice(0,MAX)))}catch(e){}}
function candidates(data){return(Array.isArray(data)?data:[]).filter(x=>x&&x.symbol&&/^[A-Z0-9]+(?:USDT|USDC)$/.test(x.symbol))}
function build(data){
 const list=candidates(data),valid=new Set(list.map(x=>x.symbol));
 symbols=symbols.filter(s=>valid.has(s));
 const fresh=list.filter(x=>!symbols.includes(x.symbol));
 nativeSort.call(fresh,(a,b)=>Math.abs(Number(b.priceChangePercent)||0)-Math.abs(Number(a.priceChangePercent)||0));
 for(const x of fresh){if(symbols.length>=MAX)break;symbols.push(x.symbol)}
 symbols=symbols.slice(0,MAX);save();window.__dealDostStableSymbols=symbols.slice();return symbols.slice();
}
window.__dealDostStableUniverse={max:MAX,get:()=>symbols.slice(),update:build,reset:()=>{symbols=[];save()}};
window.__dealDostStableSymbols=symbols.slice();
if(window.__dealDostStablePreload)return;
window.__dealDostStablePreload=true;
function jsonResponse(data,r){return new Response(JSON.stringify(data),{status:r.status,statusText:r.statusText,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
window.fetch=async function(input,init){
 const url=typeof input==='string'?(input||''):(input&&input.url)||'';
 /* Ensure the app's contract map has at least the same stable 50 symbols. */
 if(/\/fapi\/v1\/exchangeInfo(?:\?|$)/.test(url)){
  const r=await nativeFetch(input,init);
  try{
   const info=await r.clone().json();
   const base=url.match(/^https?:\/\/[^/]+/);const tr=await nativeFetch((base?base[0]:'https://fapi.binance.com')+'/fapi/v1/ticker/24hr',init);const data=await tr.clone().json();
   const chosen=build(data),list=Array.isArray(info.symbols)?info.symbols.slice():[],have=new Set(list.map(x=>x.symbol));
   for(const s of chosen)if(!have.has(s)){list.push({symbol:s,status:'TRADING',contractType:'PERPETUAL',quoteAsset:s.endsWith('USDC')?'USDC':'USDT',baseAsset:s.replace(/USDC$|USDT$/,'')})}
   info.symbols=list;return jsonResponse(info,r);
  }catch(e){return r}
 }
 /* Return only the locked 50, but never alter price/change/volume fields. */
 if(/\/fapi\/v1\/ticker\/24hr(?:\?|$)/.test(url)){
  const r=await nativeFetch(input,init);
  try{const data=await r.clone().json();if(!Array.isArray(data))return r;const chosen=build(data),map=new Map(data.map(x=>[x.symbol,x]));return jsonResponse(chosen.map(s=>map.get(s)).filter(Boolean),r)}catch(e){return r}
 }
 return nativeFetch(input,init);
};
/* app.js sorts tickers by live 24H change. Override only ticker-array sorting so row order stays locked. */
Array.prototype.sort=function(compareFn){
 const arr=this;
 try{if(arr.length&&arr[0]&&typeof arr[0]==='object'&&arr[0].symbol&&Object.prototype.hasOwnProperty.call(arr[0],'priceChangePercent')){const order=window.__dealDostStableSymbols||[];if(order.length){const rank=new Map(order.map((s,i)=>[s,i]));return nativeSort.call(arr,(a,b)=>(rank.get(a.symbol)??999999)-(rank.get(b.symbol)??999999))}}}catch(e){}
 return nativeSort.call(arr,compareFn);
};
})();
