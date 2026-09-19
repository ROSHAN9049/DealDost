const BASE=process.env.BINANCE_FUTURES_DEMO_BASE_URL||'https://demo-fapi.binance.com';
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  try{
    const r=await fetch(BASE+'/fapi/v1/exchangeInfo',{headers:{accept:'application/json'},cache:'no-store'});
    const text=await r.text();let j;try{j=JSON.parse(text)}catch{j={raw:text}};
    if(!r.ok)return res.status(r.status).json({error:j.msg||j.error||'Demo exchangeInfo failed',testnetUnavailable:r.status===403||r.status===451,restricted:r.status===403||r.status===451});
    const symbols=(j.symbols||[]).filter(x=>x.contractType==='PERPETUAL'&&x.quoteAsset==='USDT'&&x.status==='TRADING').map(x=>x.symbol);
    res.setHeader('Cache-Control','public, max-age=30, s-maxage=30');
    return res.status(200).json({symbols});
  }catch(e){return res.status(502).json({error:e.message})}
}