import crypto from 'crypto';
const BASE=process.env.BINANCE_FUTURES_DEMO_BASE_URL||'https://demo-fapi.binance.com';
const ALLOWED=new Set(['/fapi/v2/account','/fapi/v2/positionRisk','/fapi/v2/balance','/fapi/v1/openOrders','/fapi/v1/allOrders','/fapi/v1/userTrades']);
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  if(process.env.BINANCE_TESTNET_API_KEY==null||process.env.BINANCE_TESTNET_API_SECRET==null)return res.status(503).json({error:'Binance Futures Demo credentials are not configured'});
  const path=String(req.query?.path||'');
  if(!ALLOWED.has(path))return res.status(400).json({error:'Account path not allowed'});
  try{
    const q=new URLSearchParams();
    for(const [k,v] of Object.entries(req.query||{})){if(k!=='path'&&v!=null)q.set(k,String(v))}
    q.set('timestamp',String(Date.now()));q.set('recvWindow','5000');
    const sig=crypto.createHmac('sha256',process.env.BINANCE_TESTNET_API_SECRET).update(q.toString()).digest('hex');
    q.set('signature',sig);
    const r=await fetch(BASE+path+'?'+q.toString(),{headers:{'X-MBX-APIKEY':process.env.BINANCE_TESTNET_API_KEY,accept:'application/json'},cache:'no-store'});
    const text=await r.text();
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    // Binance can reject Demo Trading from restricted regions with HTTP 403/451.
    // Do not turn that service-level restriction into a misleading scanner/dashboard error.
    if(r.status===403||r.status===451){
      let detail={};try{detail=JSON.parse(text)}catch{}
      return res.status(200).json({
        testnetUnavailable:true,
        restricted:true,
        upstreamStatus:r.status,
        error:detail.msg||detail.message||'Binance Futures Demo service is unavailable from this location',
        baseUrl:BASE,
        path
      });
    }
    return res.status(r.status).send(text);
  }catch(e){return res.status(502).json({error:e.message})}
}