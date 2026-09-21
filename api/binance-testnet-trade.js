import crypto from 'crypto';
const BASE=process.env.BINANCE_FUTURES_DEMO_BASE_URL||'https://demo-fapi.binance.com';
const KEY=process.env.BINANCE_TESTNET_API_KEY;
const SECRET=process.env.BINANCE_TESTNET_API_SECRET;
const UNLOCKED=String(process.env.TESTNET_UNLOCKED??'true').toLowerCase()==='true';
const MAX_NOTIONAL=Number(process.env.TESTNET_MAX_NOTIONAL_USDT||100);
const STOP=Number(process.env.TESTNET_STOP_PCT||0.006);
const RR=Number(process.env.TESTNET_TP_RR||2);
function dec(v){const n=Number(v);return Number.isFinite(n)?n:0}
function sign(params){const qs=new URLSearchParams(params);qs.set('signature',crypto.createHmac('sha256',SECRET).update(qs.toString()).digest('hex'));return qs.toString()}
async function req(method,path,params={}){
  const q={...params,timestamp:String(Date.now()),recvWindow:'5000'};
  const r=await fetch(BASE+path+(method==='GET'?'?'+sign(q):''),{method,headers:{'X-MBX-APIKEY':KEY,'Content-Type':'application/x-www-form-urlencoded',accept:'application/json'},...(method==='GET'?{}:{body:sign(q)}),cache:'no-store'});
  const text=await r.text();let j;try{j=JSON.parse(text)}catch{j={raw:text}}
  if(!r.ok){const e=Error(j.msg||j.error||'Binance Demo request failed');e.status=r.status;e.code=j.code;e.binanceMessage=j.msg||j.message||j.error;if(r.status===403||r.status===451)e.restricted=true;throw e}
  return j;
}
function stepPrecision(step){if(!step||step<=0)return 8;const s=String(step);if(s.includes('e-'))return Number(s.split('e-')[1]);const i=s.indexOf('.');return i<0?0:s.length-i-1}
function floorStep(v,step){if(!step||step<=0)return v;const p=stepPrecision(step);return Number((Math.floor((v+1e-12)/step)*step).toFixed(p))}
function ceilStep(v,step){if(!step||step<=0)return v;const p=stepPrecision(step);return Number((Math.ceil((v-1e-12)/step)*step).toFixed(p))}
function priceStep(info){return dec((info.filters||[]).find(x=>x.filterType==='PRICE_FILTER')?.tickSize)}
function formatStep(v,step){const p=stepPrecision(step);return Number(v).toFixed(p)}
async function symbolInfo(symbol){
  const r=await fetch(BASE+'/fapi/v1/exchangeInfo',{headers:{accept:'application/json'},cache:'no-store'});
  const text=await r.text();let e;try{e=JSON.parse(text)}catch{e={}}
  if(!r.ok){const err=Error(e.msg||e.error||('Demo exchangeInfo failed ('+r.status+')'));err.status=r.status;err.code=e.code;err.binanceMessage=e.msg||e.message||e.error;err.restricted=r.status===403||r.status===451;throw err}
  const s=(e.symbols||[]).find(x=>x.symbol===symbol);
  if(!s||s.status!=='TRADING'||s.contractType!=='PERPETUAL'||s.quoteAsset!=='USDT'){
    const err=Error('Symbol '+symbol+' is not supported by Binance Futures Demo');err.code=-1121;throw err
  }
  return s
}
async function testOrder(symbol,side,quantity,reduceOnly=false){
  try{
    const params={symbol,side,type:'MARKET',quantity:String(quantity),newOrderRespType:'ACK'};
    if(reduceOnly)params.reduceOnly='true';
    return await req('POST','/fapi/v1/order/test',params);
  }catch(e){
    if(e.code===-1121)e.demoUnsupported=true;
    throw e;
  }
}
async function positionAmount(symbol){
  const rows=await req('GET','/fapi/v2/positionRisk',{symbol});
  const row=Array.isArray(rows)?rows.find(x=>x.symbol===symbol):rows;
  return dec(row?.positionAmt);
}
async function cancelAlgoOrders(symbol){
  let canceled=0;
  try{
    const rows=await req('GET','/fapi/v1/openAlgoOrders',{symbol});
    for(const o of Array.isArray(rows)?rows:[]){
      const id=o.algoId||o.orderId;
      if(id==null)continue;
      try{await req('DELETE','/fapi/v1/algoOrder',{algoId:String(id)});canceled++}catch{}
    }
  }catch(e){
    // Demo may briefly reject the algo query during maintenance; do not hide
    // the primary trade error, but keep the cleanup best-effort.
  }
  return canceled;
}
async function cancelLegacyStopOrders(symbol){
  let canceled=0;
  try{
    const rows=await req('GET','/fapi/v1/openOrders',{symbol});
    for(const o of Array.isArray(rows)?rows:[]){
      if(!['STOP','STOP_MARKET','TAKE_PROFIT','TAKE_PROFIT_MARKET'].includes(String(o.type||'').toUpperCase()))continue;
      try{await req('DELETE','/fapi/v1/order',{symbol,orderId:String(o.orderId)});canceled++}catch{}
    }
  }catch{}
  return canceled;
}
async function cleanupProtection(symbol){
  const a=await cancelAlgoOrders(symbol);
  const l=await cancelLegacyStopOrders(symbol);
  return a+l;
}
async function ensureFlatAndClean(symbol){
  const amt=await positionAmount(symbol);
  if(Math.abs(amt)>0)throw Error('Existing Binance Demo position on '+symbol+'; entry blocked until that position is closed.');
  return cleanupProtection(symbol);
}
export default async function handler(req0,res){
  if(req0.method!=='POST')return res.status(405).json({error:'POST only'});
  if(!UNLOCKED)return res.status(403).json({error:'Binance Futures Demo trading is locked'});
  if(!KEY||!SECRET)return res.status(503).json({error:'Binance Futures Demo credentials are not configured'});
  try{
    const b=req0.body||{},action=String(b.action||'order'),symbol=String(b.symbol||'').toUpperCase();
    if(!['order','preflight','close','cancelAll'].includes(action))return res.status(400).json({error:'Unsupported action'});
    if(!/^[A-Z0-9_]{5,30}$/.test(symbol))return res.status(400).json({error:'Invalid symbol'});
    if(action==='cancelAll')return res.status(200).json(await req('DELETE','/fapi/v1/allOpenOrders',{symbol}));
    const info=await symbolInfo(symbol);
    const lot=(info.filters||[]).find(x=>x.filterType==='LOT_SIZE')||{};
    let quantity=floorStep(Math.abs(dec(b.quantity)),dec(lot.stepSize));
    if(quantity<dec(lot.minQty))return res.status(400).json({error:'Quantity below Binance minimum'});
    if(dec(lot.maxQty)&&quantity>dec(lot.maxQty))quantity=dec(lot.maxQty);
    const mark=await req('GET','/fapi/v1/premiumIndex',{symbol});
    const px=dec(mark.markPrice);
    if(quantity*px>MAX_NOTIONAL)quantity=floorStep(MAX_NOTIONAL/px,dec(lot.stepSize));
    if(quantity<dec(lot.minQty))return res.status(400).json({error:'Testnet safety cap is below minimum order size'});
    const requestedSide=String(b.side||'BUY').toUpperCase();
    if(!['BUY','SELL'].includes(requestedSide))return res.status(400).json({error:'Invalid side'});
    const side=action==='close'?(requestedSide==='BUY'?'SELL':'BUY'):requestedSide;
    // Non-placing exchange preflight used by safe TESTNET rotation.
    if(action==='preflight'){
      await testOrder(symbol,side,quantity,false);
      if(Math.abs(await positionAmount(symbol))>0)throw Error('Existing Binance Demo position on '+symbol+'; replacement entry blocked.');
      return res.status(200).json({preflight:true,symbol,side,quantity,serverPrice:px,notional:quantity*px});
    }
    if(action==='close'){
      await cleanupProtection(symbol);
    }else{
      await ensureFlatAndClean(symbol);
    }
    await testOrder(symbol,side,quantity,action==='close');
    const entryParams={symbol,side,type:'MARKET',quantity:String(quantity),newOrderRespType:'RESULT'};if(action==='close')entryParams.reduceOnly='true';
    const entry=await req('POST','/fapi/v1/order',entryParams);
    if(action==='close')return res.status(200).json(entry);
    const fill=dec(entry.avgPrice)||px;
    const stop=Math.min(Math.max(dec(b.stopPct)||STOP,.003),.012),rawSl=side==='BUY'?fill*(1-stop):fill*(1+stop),rawTp=side==='BUY'?fill*(1+stop*RR):fill*(1-stop*RR),exitSide=side==='BUY'?'SELL':'BUY';
    const tick=priceStep(info);
    const sl=side==='BUY'?floorStep(rawSl,tick):ceilStep(rawSl,tick);
    const tp=side==='BUY'?ceilStep(rawTp,tick):floorStep(rawTp,tick);
    if(!tick||sl<=0||tp<=0)return res.status(400).json({error:'Binance price filter is unavailable for '+symbol});
    let protection=null;
    if(process.env.TESTNET_PROTECT_ORDERS!=='false'){
      // Since Binance migrated Futures conditional orders to the Algo Order API,
      // never send STOP/TAKE_PROFIT through /fapi/v1/order. Stale protections for
      // this symbol are cleaned before entry/close so the account does not hit the
      // Demo max-algo-order limit from old protections.
      try{
        // Demo currently reports a max stop/algo-order limit when every
        // position carries both SL and TP. Keep one exchange-side protective
        // STOP_MARKET per position; TP is handled by DealDost's 3s TESTNET
        // monitor and the normal close endpoint. This preserves hard downside
        // protection without consuming two algo slots per position.
        const so=await req('POST','/fapi/v1/algoOrder',{algoType:'CONDITIONAL',symbol,side:exitSide,type:'STOP_MARKET',triggerPrice:formatStep(sl,tick),closePosition:'true',workingType:'MARK_PRICE',newOrderRespType:'RESULT'});
        protection={stopOrderId:so.algoId||so.orderId,stopPrice:sl,takeProfitPrice:tp,route:'algoOrder-stop-only',tpMode:'software'};
      }catch(secondErr){
        try{await req('POST','/fapi/v1/order',{symbol,side:exitSide,type:'MARKET',quantity:String(quantity),reduceOnly:'true',newOrderRespType:'RESULT'})}catch{}
        throw Error('Demo entry protection failed; emergency close attempted. Algo: '+secondErr.message)
      }
    }
    return res.status(200).json({entry,protection,serverPrice:px,quantity,notional:quantity*fill});
  }catch(e){
    if(e.demoUnsupported||e.code===-1121)return res.status(400).json({error:e.binanceMessage||('Binance Futures Demo rejected '+String(req0.body?.symbol||'')+' during safe preflight.'),code:-1121,demoUnsupported:true});
    if(e.restricted)return res.status(403).json({error:e.binanceMessage||'Binance Futures Demo trading is unavailable from this deployment location or account eligibility.',testnetUnavailable:true,restricted:true,upstreamStatus:e.status,code:e.code||null,baseUrl:BASE});
    return res.status(502).json({error:e.message,code:e.code||null});
  }
}
