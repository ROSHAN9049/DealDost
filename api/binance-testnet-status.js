export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  const key=String(process.env.BINANCE_TESTNET_API_KEY||'').trim();
  const secret=String(process.env.BINANCE_TESTNET_API_SECRET||'').trim();
  const base=String(process.env.BINANCE_FUTURES_DEMO_BASE_URL||'https://demo-fapi.binance.com').trim();
  return res.status(200).json({
    apiKeyConfigured:Boolean(key),
    apiSecretConfigured:Boolean(secret),
    baseUrl:base,
    testnetUnlocked:String(process.env.TESTNET_UNLOCKED||'false').toLowerCase()==='true'
  });
}
