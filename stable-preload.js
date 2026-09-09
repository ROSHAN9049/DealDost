/* DealDost FINAL stable coin controller — live prices, locked coin identities/order. */
(function(){
'use strict';
const KEY='dealDostStableUniverseV5',MAX_COINS=50;
let symbols=[];
try{
 const s=JSON.parse(localStorage.getItem(KEY)||'[]');
 if(Array.isArray(s))symbols=s.filter(x=>typeof x==='string'&&x).slice(0,MAX_COINS);
}catch(e){}
const nativeSort=Array.prototype.sort;
function save(){try{localStorage.setItem(KEY,JSON.stringify(symbols.slice(0,MAX_COINS)))}catch(e){}}
function build(data){
 const list=Array.isArray(data)?data:[];
 const valid=new Set(list.filter(x=>x&&x.symbol).map(x=>x.symbol));
 const old=symbols.slice();
 symbols=symbols.filter(s=>valid.has(s));
 const candidates=list.filter(x=>x&&x.symbol&&!symbols.includes(x.symbol));
 nativeSort.call(candidates,(a,b)=>Math.abs(Number(b.priceChangePercent)||0)-Math.abs(Number(a.priceChangePercent)||0));
 for(const x of candidates){if(symbols.length>=MAX_COINS)break;symbols.push(x.symbol)}
 symbols=symbols.slice(0,MAX_COINS);
 if(symbols.length!==old.length||symbols.some((s,i)=>s!==old[i]))save();
 window.__dealDostStableSymbols=symbols.slice();
 return symbols;
}
window.__dealDostStableUniverse={max:MAX_COINS,get:()=>symbols.slice(),update:build,reset:()=>{symbols=[];save()}};
window.__dealDostStableSymbols=symbols.slice();
const originalFetch=window.fetch.bind(window);
if(window.__dealDostStablePreload)return;
window.__dealDostStablePreload=true;
window.fetch=function(input,init){
 return originalFetch(input,init).then(async response=>{
  try{
   const url=typeof input==='string'?input:(input&&input.url)||'';
   if(/\/fapi\/v1\/ticker\/24hr(?:\?|$)/.test(url)){
    const data=await response.clone().json();
    if(Array.isArray(data))build(data);
   }
  }catch(e){}
  return response;
 });
};
/* app.js sorts the ticker array by live 24H change.
   Override ONLY that ticker sort so the app receives the same 50 coins in the same order.
   Prices/change/volume themselves remain untouched and fully live. */
Array.prototype.sort=function(compareFn){
 const arr=this;
 try{
  if(arr.length&&arr[0]&&typeof arr[0]==='object'&&arr[0].symbol&&Object.prototype.hasOwnProperty.call(arr[0],'priceChangePercent')){
   const order=window.__dealDostStableSymbols||[];
   if(order.length){
    const rank=new Map(order.map((s,i)=>[s,i]));
    return nativeSort.call(arr,(a,b)=>{
     const ra=rank.has(a.symbol)?rank.get(a.symbol):999999;
     const rb=rank.has(b.symbol)?rank.get(b.symbol):999999;
     return ra-rb;
    });
   }
  }
 }catch(e){}
 return nativeSort.call(arr,compareFn);
};
})();
