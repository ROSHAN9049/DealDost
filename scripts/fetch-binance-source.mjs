import { writeFile } from 'node:fs/promises';

const SOURCE='https://raw.githubusercontent.com/ROSHAN9049/deltascanner/main/src/both.jsx';
const r=await fetch(SOURCE,{cache:'no-store'});
if(!r.ok) throw new Error(`Could not fetch deltascanner source: HTTP ${r.status}`);
let s=await r.text();

s=s.replace("const API='https://api.india.delta.exchange/v2/tickers?contract_types=perpetual_futures',CANDLE='https://api.india.delta.exchange/v2/history/candles',START=10000;", "const API='https://fapi.binance.com/fapi/v1/ticker/24hr',CANDLE='https://fapi.binance.com/fapi/v1/klines',START=10000;");
s=s.replace("const priceOf=r=>[r?.ltp,r?.last_price,r?.mark_price,r?.close,r?.last5,r?.last1].map(num).find(v=>v>0)||0;", "const priceOf=r=>[r?.lastPrice,r?.last_price,r?.ltp,r?.markPrice,r?.mark_price,r?.close,r?.last5,r?.last1].map(num).find(v=>v>0)||0;");
s=s.replace(/async function candles\\(symbol,res,count\\)\\{[\\s\\S]*?\\n\\}/, "async function candles(symbol,res,count){const r=await fetch(`${CANDLE}?symbol=${encodeURIComponent(symbol)}&interval=${res}&limit=${count}`,{cache:'no-store'});if(!r.ok)throw Error('Binance candle HTTP '+r.status);const j=await r.json();return(Array.isArray(j)?j:[]).map(k=>({time:num(k[0]),open:num(k[1]),high:num(k[2]),low:num(k[3]),close:num(k[4]),volume:num(k[5])})).sort((a,b)=>num(a.time)-num(b.time))}\n");

const old="const j=await r.json(),raw=(Array.isArray(j.result)?j.result:[]).filter(x=>x.symbol&&x.contract_type==='perpetual_futures'),base=raw.map(x=>({...x,change:num(x.ltp_change_24h),volume:num(x.turnover_usd),marketPrice:priceOf(x)}))";
const neu="const j=await r.json(),raw=(Array.isArray(j)?j:[]).filter(x=>x.symbol&&/USDT$/.test(x.symbol)),base=raw.map(x=>({...x,change:num(x.priceChangePercent),volume:num(x.quoteVolume),marketPrice:priceOf(x)}))";
if(!s.includes(old)) throw new Error('Expected ticker mapping was not found in deltascanner source');
s=s.replace(old,neu);
s=s.replaceAll('Delta API HTTP','Binance API HTTP').replaceAll('No perpetual coins returned by Delta Exchange','No Binance USDT perpetual coins returned').replaceAll('Delta Exchange','Binance Futures').replaceAll('Delta Scanner','Binance Scanner').replaceAll('Delta','Binance');
await writeFile('src/both.jsx',s);
console.log('Binance scanner source prepared from deltascanner.');
