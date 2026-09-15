import crypto from 'crypto';
const BASE=process.env.BINANCE_TESTNET_BASE_URL||'https://testnet.binancefuture.com';
const KEY=process.env.BINANCE_TESTNET_API_KEY;
const SECRET=process.env.BINANCE_TESTNET_API_SECRET;
const UNLOCKED=String(process.env.BINANCE_TESTNET_UNLOCKED||'false').toLowerCase()==='true';
function sign(params){const qs=new URLSearchParams(params);const signature=crypto.createHmac('sha256',SECRET).update(qs.toString()).digest('hex');qs.set('signature',signature);return qs.toString()}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  if(!UNLOCKED)return res.status(403).json({error:'Binance Futures Testnet trading is locked'});
  if(!KEY||!SECRET)return res.status(503).json({error:'Binance Futures Testnet credentials are not configured'});
  try{
    const b=req.body||{};const action=String(b.action||'order');
    if(!['order','close'].includes(action))return res.status(400).json({error:'Unsupported testnet action'});
    const symbol=String(b.symbol||'').toUpperCase();const quantity=Math.abs(Number(b.quantity||0));
    if(!/^[A-Z0-9_]{5,30}$/.test(symbol)||!Number.isFinite(quantity)||quantity<=0)return res.status(400).json({error:'Invalid symbol or quantity'});
    const p={symbol,side:action==='close'?(String(b.side||'BUY').toUpperCase()==='BUY'?'SELL':'BUY'):String(b.side||'BUY').toUpperCase(),type:'MARKET',quantity:String(quantity),timestamp:String(Date.now()),recvWindow:'5000'};
    if(action==='close')p.reduceOnly='true';
    const r=await fetch(BASE+'/fapi/v1/order',{method:'POST',headers:{'X-MBX-APIKEY':KEY,'Content-Type':'application/x-www-form-urlencoded'},body:sign(p)});
    const text=await r.text();res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');return res.status(r.status).send(text);
  }catch(e){return res.status(502).json({error:e.message})}
}
