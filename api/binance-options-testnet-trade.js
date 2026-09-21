import crypto from 'crypto';

const MARKET_BASE=process.env.BINANCE_OPTIONS_MARKET_BASE_URL||'https://eapi.binance.com';
const EXEC_BASE=process.env.BINANCE_OPTIONS_TESTNET_BASE_URL||'';
const KEY=process.env.BINANCE_OPTIONS_TESTNET_API_KEY;
const SECRET=process.env.BINANCE_OPTIONS_TESTNET_API_SECRET;
const UNLOCKED=String(process.env.OPTIONS_TESTNET_UNLOCKED??'false').toLowerCase()==='true';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function sign(params){
  if(!SECRET)throw Error('Options execution secret is not configured');
  const q=new URLSearchParams();
  for(const [k,v] of Object.entries(params||{})){if(v!==undefined&&v!==null)q.set(k,String(v))}
  q.set('timestamp',String(Date.now()));q.set('recvWindow','5000');
  const sig=crypto.createHmac('sha256',SECRET).update(q.toString()).digest('hex');
  q.set('signature',sig);return q.toString();
}
async function req(method,path,params={}){
  if(!EXEC_BASE)throw Error('Binance Options TESTNET execution endpoint is not configured');
  const qs=sign(params);
  const r=await fetch(EXEC_BASE+path+(method==='GET'?'?'+qs:''),{
    method,headers:{'X-MBX-APIKEY':KEY,'Content-Type':'application/x-www-form-urlencoded',accept:'application/json'},
    ...(method==='GET'?{}:{body:qs}),cache:'no-store'
  });
  const text=await r.text();let j;try{j=JSON.parse(text)}catch{j={raw:text}};
  if(!r.ok){const e=Error(j.msg||j.error||'Binance Options execution request failed');e.status=r.status;e.code=j.code;e.data=j;throw e}
  return j;
}
function precision(step){
  if(!step||step<=0)return 8;
  const s=String(step);if(/e-/.test(s))return Number(s.split('e-')[1]);
  const i=s.indexOf('.');return i<0?0:s.length-i-1;
}
function floorStep(v,step){if(!step||step<=0)return v;const p=precision(step);return Number((Math.floor((v+1e-12)/step)*step).toFixed(p))}
async function symbolInfo(symbol){
  const e=await req('GET','/eapi/v1/exchangeInfo');
  const s=(e.optionSymbols||[]).find(x=>String(x.symbol)===symbol);
  if(!s||String(s.status).toUpperCase()!=='TRADING')throw Error('Option symbol '+symbol+' is not tradable on configured Options execution endpoint');
  return s;
}
function filters(info){
  const fs=info.filters||[];
  return {
    tick:n(fs.find(x=>x.filterType==='PRICE_FILTER')?.tickSize),
    step:n(fs.find(x=>x.filterType==='LOT_SIZE')?.stepSize)||n(info.stepSize),
    min:n(fs.find(x=>x.filterType==='LOT_SIZE')?.minQty)||n(info.minQty),
    max:n(fs.find(x=>x.filterType==='LOT_SIZE')?.maxQty)||n(info.maxQty)
  };
}
async function place(symbol,side,qty,price){
  const info=await symbolInfo(symbol),f=filters(info);
  let q=floorStep(qty,f.step);if(q<f.min)throw Error(symbol+' quantity below minimum '+f.min);if(f.max&&q>f.max)q=f.max;
  if(!(price>0))throw Error(symbol+' price unavailable');
  const p=f.tick>0?Number(price.toFixed(precision(f.tick))):price;
  return req('POST','/eapi/v1/order',{symbol,side,type:'LIMIT',quantity:q,price:p,timeInForce:'IOC',newOrderRespType:'RESULT'});
}
async function cancelAll(symbol){try{return await req('DELETE','/eapi/v1/allOpenOrders',{symbol})}catch{return null}}
async function account(){return req('GET','/eapi/v1/marginAccount')}

export default async function handler(req0,res){
  const b=req0.body||{}, action=String(req0.query?.action||b.action||'');

  if(req0.method==='GET'&&action==='market'){
    const path=String(req0.query?.path||'');
    const allowed=new Set(['/eapi/v1/ping','/eapi/v1/time','/eapi/v1/exchangeInfo','/eapi/v1/mark','/eapi/v1/ticker']);
    if(!allowed.has(path))return res.status(400).json({error:'Unsupported Options market path'});
    try{
      const r=await fetch(MARKET_BASE+path,{cache:'no-store',headers:{accept:'application/json'}});
      const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={raw:text}};
      if(!r.ok)return res.status(200).json({ok:false,available:false,baseUrl:MARKET_BASE,path,error:data.msg||data.error||'Options market request failed',code:data.code||null,status:r.status});
      const out={ok:true,available:true,baseUrl:MARKET_BASE,path,data};
      if(path==='/eapi/v1/exchangeInfo')out.contractCount=Array.isArray(data.optionSymbols)?data.optionSymbols.filter(x=>String(x.status||'').toUpperCase()==='TRADING').length:0;
      return res.status(200).json(out);
    }catch(e){return res.status(200).json({ok:false,available:false,baseUrl:MARKET_BASE,path,error:e.message})}
  }

  if(req0.method==='GET'&&action==='state'){
    if(!EXEC_BASE)return res.status(200).json({
      available:true,connected:true,locked:true,executionUnlocked:false,
      testnetSupported:false,
      error:'Binance public Options API is available, but Binance does not currently document a live Options Testnet/Demo REST base. Options TESTNET execution remains locked.'
    });
    if(!KEY||!SECRET)return res.status(200).json({available:false,connected:false,locked:true,error:'Options TESTNET credentials are not configured'});
    try{
      const ping=await fetch(EXEC_BASE+'/eapi/v1/ping',{cache:'no-store'});
      if(!ping.ok)return res.status(200).json({available:false,connected:false,locked:!UNLOCKED,error:'Configured Options execution endpoint connectivity failed ('+ping.status+')'});
      if(!UNLOCKED)return res.status(200).json({available:true,connected:true,locked:true,executionUnlocked:false,testnetSupported:true});
      const a=await account();
      return res.status(200).json({available:true,connected:true,locked:false,executionUnlocked:true,testnetSupported:true,account:a});
    }catch(e){return res.status(200).json({available:false,connected:false,locked:true,error:e.message,code:e.code||null})}
  }

  if(req0.method!=='POST')return res.status(405).json({error:'POST only'});
  if(!EXEC_BASE)return res.status(503).json({error:'Options TESTNET execution is unavailable: Binance does not currently document an Options Testnet/Demo REST endpoint. Public Options market data remains available.'});
  if(!UNLOCKED)return res.status(403).json({error:'Options TESTNET execution is locked. Set OPTIONS_TESTNET_UNLOCKED=true only for a verified non-live execution endpoint.'});
  if(!KEY||!SECRET)return res.status(503).json({error:'Options TESTNET credentials are not configured'});

  try{
    if(action==='openSpread'){
      const longSymbol=String(b.longSymbol||'').toUpperCase(),shortSymbol=String(b.shortSymbol||'').toUpperCase(),qty=n(b.quantity);
      if(!longSymbol||!shortSymbol||qty<=0)throw Error('Invalid spread parameters');
      if(longSymbol===shortSymbol)throw Error('Long and short option legs must be different');
      const longInfo=await symbolInfo(longSymbol),shortInfo=await symbolInfo(shortSymbol);
      const lt=String(longInfo.side||'').toUpperCase(),st=String(shortInfo.side||'').toUpperCase();
      if(!['CALL','PUT'].includes(lt)||st!==lt)throw Error('Spread legs must use the same valid option type');
      const long=await place(longSymbol,'BUY',qty,n(b.longPrice)),short=await place(shortSymbol,'SELL',qty,n(b.shortPrice));
      const lf=long.fills?.[0]?.price||long.avgPrice||b.longPrice,sf=short.fills?.[0]?.price||short.avgPrice||b.shortPrice;
      const longQty=n(long.executedQty||qty),shortQty=n(short.executedQty||qty);
      if(Math.abs(longQty-shortQty)>1e-9){
        try{if(longQty>0)await place(longSymbol,'SELL',longQty,n(lf))}catch{}
        try{if(shortQty>0)await place(shortSymbol,'BUY',shortQty,n(sf))}catch{}
        throw Error('Options spread legs did not fill equally; filled leg(s) were flattened on a best-effort basis.');
      }
      const fees=n(long.fee)+n(short.fee);
      return res.status(200).json({ok:true,orders:[long,short],quantity:qty,netDebit:Math.max(0,n(lf)-n(sf)),fees});
    }
    if(action==='closeSpread'){
      const longSymbol=String(b.longSymbol||'').toUpperCase(),shortSymbol=String(b.shortSymbol||'').toUpperCase(),qty=n(b.quantity);
      if(!longSymbol||!shortSymbol||qty<=0)throw Error('Invalid close parameters');
      const long=await place(longSymbol,'SELL',qty,n(b.longPrice)||n(b.longMark)||0);
      const short=await place(shortSymbol,'BUY',qty,n(b.shortPrice)||n(b.shortMark)||0);
      return res.status(200).json({ok:true,orders:[long,short]});
    }
    if(action==='cancelAll'){
      const symbol=String(b.symbol||'').toUpperCase();if(!symbol)throw Error('Symbol required');
      return res.status(200).json(await cancelAll(symbol));
    }
    return res.status(400).json({error:'Unsupported action'});
  }catch(e){
    return res.status(e.status||502).json({error:e.message,code:e.code||null,details:e.data||null});
  }
}
