export default async function handler(req,res){
  try{
    const raw=typeof req.query?.path==='string'?req.query.path:'/fapi/v1/ticker/24hr';
    const path=raw.startsWith('/')?raw:`/${raw}`;
    if(!path.startsWith('/fapi/v1/')) return res.status(400).json({error:'Invalid Binance market path'});
    const url=`https://fapi.binance.com${path}`;
    const r=await fetch(url,{headers:{accept:'application/json'},cache:'no-store'});
    const text=await r.text();
    res.status(r.status).setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type',r.headers.get('content-type')||'application/json');
    return res.send(text);
  }catch(e){return res.status(502).json({error:e?.message||'Binance market proxy error'})}
}
