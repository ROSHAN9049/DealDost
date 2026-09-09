import crypto from 'node:crypto';

const BASE='https://fapi.binance.com';

function sign(query){
  return crypto.createHmac('sha256',process.env.BINANCE_API_SECRET).update(query).digest('hex');
}

async function binance(path,params={},method='GET'){
  if(!process.env.BINANCE_API_KEY||!process.env.BINANCE_API_SECRET) throw new Error('Binance API credentials are not configured');
  const p=new URLSearchParams({...params,timestamp:Date.now(),recvWindow:5000});
  p.set('signature',sign(p.toString()));
  const url=`${BASE}${path}?${p.toString()}`;
  const r=await fetch(url,{method,headers:{'X-MBX-APIKEY':process.env.BINANCE_API_KEY}});
  const text=await r.text();
  let data;try{data=JSON.parse(text)}catch{data={msg:text}}
  if(!r.ok) throw new Error(data.msg||`Binance HTTP ${r.status}`);
  return data;
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'POST only'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const {action='order',symbol,side,quantity,type='MARKET',reduceOnly=false}=body;
    if(action==='account') return res.status(200).json({ok:true,data:await binance('/fapi/v2/account')});
    if(action==='positions') return res.status(200).json({ok:true,data:await binance('/fapi/v2/positionRisk')});
    if(action!=='order') return res.status(400).json({ok:false,error:'Unknown action'});
    if(!/^\w+USDT$/.test(String(symbol||''))) return res.status(400).json({ok:false,error:'Invalid USDT futures symbol'});
    if(!['BUY','SELL'].includes(side)) return res.status(400).json({ok:false,error:'Invalid side'});
    const qty=Number(quantity);
    if(!Number.isFinite(qty)||qty<=0) return res.status(400).json({ok:false,error:'Invalid quantity'});
    const data=await binance('/fapi/v1/order',{symbol:String(symbol).toUpperCase(),side,type,quantity:qty.toString(),...(reduceOnly?{reduceOnly:'true'}:{})},'POST');
    return res.status(200).json({ok:true,data});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'Binance trading error'});}
}
