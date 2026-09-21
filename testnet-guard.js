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
  const MSG='Binance Futures Demo trading is unavailable from this deployment location or account eligibility.';
  const TTL=10*60*1000;
  const nativeFetch=window.fetch.bind(window);
  const nativeOpen=window.open.bind(window);
  const isBinanceDemoUrl=(value)=>{
    try{
      const u=new URL(String(value||''),window.location.href);
      const host=u.hostname.toLowerCase();
      return host==='demo.binance.com'||host.endsWith('.demo.binance.com')||host==='testnet.binancefuture.com';
    }catch(e){return false}
  };
  const blockBinanceNavigation=(value)=>isBinanceDemoUrl(value);

  // The scanner must stay inside DealDost. Binance Demo is an API/account
  // execution environment, not a page that the terminal should auto-open.
  window.open=function(url,...args){
    if(isBinanceDemoUrl(url)){
      console.warn('[DealDost] blocked automatic Binance Demo navigation:',url);
      return null;
    }
    return nativeOpen(url,...args);
  };

  const originalAnchorClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    try{if(blockBinanceNavigation(this.href)){console.warn('[DealDost] blocked programmatic Binance Demo link:',this.href);return;}}catch(e){}
    return originalAnchorClick.apply(this,arguments);
  };

  document.addEventListener('click',(event)=>{
    try{
      const link=event.target&&event.target.closest?event.target.closest('a[href]'):null;
      if(link&&isBinanceDemoUrl(link.href)){
        event.preventDefault();
        event.stopImmediatePropagation();
        console.warn('[DealDost] blocked Binance Demo link navigation:',link.href);
      }
    }catch(e){}
  },true);

  const restrictedNow=()=>{
    const t=Number(localStorage.getItem(KEY)||0);
    if(!t)return false;
    if(Date.now()-t>TTL){localStorage.removeItem(KEY);return false}
    return true;
  };
  const markRestricted=()=>{
    localStorage.setItem(KEY,String(Date.now()));
    window.dispatchEvent(new CustomEvent('dd:testnet-restricted',{detail:{message:MSG}}));
    disableTestnetAuto();
  };
  const clearRestricted=()=>localStorage.removeItem(KEY);

  function disableTestnetAuto(){
    try{
      /* The terminal keeps its trading state private, so use the existing UI
       * control instead of touching Momentum/Scalping calculations. Only act
       * while the visible terminal is in TESTNET mode and Auto is ON. */
      const text=(document.body?.innerText||'');
      if(!/Mode:\s*TESTNET/i.test(text))return;
      const els=[...document.querySelectorAll('button,[role="button"]')];
      const b=els.find(x=>/Auto\s*[: ]\s*ON/i.test((x.textContent||'').trim()));
      if(b)b.click();
    }catch(e){}
  }

  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';

    if(url.includes(TRADE)&&restrictedNow()){
      return new Response(JSON.stringify({
        error:MSG,
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
        else if(data&&!data.error&&!data.testnetUnavailable){clearRestricted();}
      }catch(e){}
    }
    return res;
  };

  window.addEventListener('dd:testnet-restricted',disableTestnetAuto);
  setTimeout(disableTestnetAuto,800);
  setInterval(()=>{if(restrictedNow())disableTestnetAuto()},1500);
})();
