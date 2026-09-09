/* DealDost STABLE TOP-50 controller — coin identity/order locked; market values stay live. */
(function(){
'use strict';
const KEY='dealDostStableUniverseV6',MAX=50;
let stable=[];
try{const saved=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(saved))stable=saved.filter(s=>typeof s==='string'&&s).slice(0,MAX)}catch(e){}
const nativeSort=Array.prototype.sort,nativeFetch=window.fetch.bind(window);
let exchangeSymbols=new Set();
function save(){try{localStorage.setItem(KEY,JSON.stringify(stable.slice(0,MAX)))}catch(e){}}
function validTicker(x){return x&&typeof x.symbol==='string'&&/^[A-Z0-9]+$/.test(x.symbol)}
function choose(data){
 const list=(Array.isArray(data)?data:[]).filter(x=>exchangeSymbols.size?exchangeSymbols.has(x.symbol):validTicker(x));
 const valid=new Set(list.map(x=>x.symbol));
 stable=stable.filter(s=>valid.has(s));
 const fresh=list.filter(x=>!stable.includes(x.symbol));
 nativeSort.call(fresh,(a,b)=>Math.abs(Number(b.priceChangePercent)||0)-Math.abs(Number(a.priceChangePercent)||0));
 for(const x of fresh){if(stable.length>=MAX)break;stable.push(x.symbol)}
 stable=stable.slice(0,MAX);save();window.__dealDostStableSymbols=stable.slice();return stable.slice();
}
function ordered(data){
 const map=new Map((data||[]).map(x=>[x.symbol,x])),out=[];
 for(const s of stable){const x=map.get(s);if(x)out.push(x)}
 if(out.length<MAX)for(const x of data||[]){if(out.length>=MAX)break;if(!out.some(y=>y.symbol===x.symbol))out.push(x)}
 return out.slice(0,MAX);
}
window.__dealDostStableUniverse={max:MAX,get:()=>stable.slice(),reset:()=>{stable=[];try{localStorage.removeItem(KEY)}catch(e){}}};
window.__dealDostStableSymbols=stable.slice();
if(window.__dealDostStablePreload)return;
window.__dealDostStablePreload=true;
function jsonResponse(data,r){return new Response(JSON.stringify(data),{status:r.status,statusText:r.statusText,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
window.fetch=async function(input,init){
 const url=typeof input==='string'?(input||''):(input&&input.url)||'';
 if(/\/fapi\/v1\/exchangeInfo(?:\?|$)/.test(url)){
  const r=await nativeFetch(input,init);
  try{
   const info=await r.clone().json();
   exchangeSymbols=new Set((info.symbols||[]).filter(s=>s&&s.status==='TRADING'&&s.contractType==='PERPETUAL'&&(s.quoteAsset==='USDT'||s.quoteAsset==='USDC')).map(s=>s.symbol));
   stable=stable.filter(s=>exchangeSymbols.has(s));
   save();window.__dealDostStableSymbols=stable.slice();
   return r;
  }catch(e){return r}
 }
 if(/\/fapi\/v1\/ticker\/24hr(?:\?|$)/.test(url)){
  const r=await nativeFetch(input,init);
  try{
   const data=await r.clone().json();if(!Array.isArray(data))return r;
   const chosen=choose(data);const out=ordered(data);
   /* If the real Binance exchangeInfo contains fewer than 50 eligible contracts,
      return the available universe rather than inventing symbols. */
   return jsonResponse(out,r);
  }catch(e){return r}
 }
 return nativeFetch(input,init);
};
Array.prototype.sort=function(compareFn){
 const arr=this;
 try{if(arr.length&&arr[0]&&typeof arr[0]==='object'&&typeof arr[0].symbol==='string'&&Object.prototype.hasOwnProperty.call(arr[0],'priceChangePercent')){const order=window.__dealDostStableSymbols||[];if(order.length){const rank=new Map(order.map((s,i)=>[s,i]));return nativeSort.call(arr,(a,b)=>(rank.has(a.symbol)?rank.get(a.symbol):999999)-(rank.has(b.symbol)?rank.get(b.symbol):999999))}}}catch(e){}
 return nativeSort.call(arr,compareFn);
};
})();
