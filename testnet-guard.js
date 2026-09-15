/* DealDost Testnet restriction guard
 * Keeps scanner + Paper Trading working when Binance Demo Trading is
 * unavailable from the deployment location. It never bypasses Binance's
 * regional/eligibility controls and prevents repeated order requests.
 */
(()=>{
  'use strict';
  const ACCOUNT='/api/binance-testnet-account?path=';
  const TRADE='/api/binance-testnet-trade';
  const KEY='ddTestnetRestrictedAt';
  const TTL=10*60*1000;
  const nativeFetch=window.fetch.bind(window);

  const restrictedNow=()=>{
    const t=Number(localStorage.getItem(KEY)||0);
    if(!t)return false;
    if(Date.now()-t>TTL){localStorage.removeItem(KEY);return false}
    return true;
  };
  const markRestricted=()=>localStorage.setItem(KEY,String(Date.now()));
  const clearRestricted=()=>localStorage.removeItem(KEY);

  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';

    if(url.includes(TRADE)&&restrictedNow()){
      return new Response(JSON.stringify({
        error:'Binance Futures Demo trading is unavailable from this deployment location or account eligibility.',
        testnetUnavailable:true,
        restricted:true,
        localGuard:true
      }),{status:403,headers:{'Content-Type':'application/json'}});
    }

    const res=await nativeFetch(input,init);

    if(url.includes(ACCOUNT)){
      try{
        const copy=res.clone();
        const data=await copy.json();
        if(data&&data.testnetUnavailable&&data.restricted)markRestricted();
        else if(data&&!data.error&&!data.testnetUnavailable)clearRestricted();
      }catch(e){}
    }
    return res;
  };
})();
