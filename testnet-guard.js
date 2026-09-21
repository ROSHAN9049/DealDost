/* DealDost Testnet restriction guard
 * Keeps scanner + Paper Trading working when Binance Demo Trading is
 * unavailable from the deployment location. It never bypasses Binance's
 * regional/eligibility controls and prevents repeated order requests.
 *
 * IMPORTANT: This guard must NEVER allow a background market-feed/scanner
 * refresh to navigate the DealDost page to any Binance Demo/Testnet page.
 */
(()=>{
  'use strict';
  const ACCOUNT='/api/binance-testnet-account?path=';
  const TRADE='/api/binance-testnet-trade';
  const KEY='ddTestnetRestrictedAt';
  const TTL=10*60*1000;
  const nativeFetch=window.fetch.bind(window);
  const nativeOpen=window.open.bind(window);

  // HARD NAVIGATION LOCK: DealDost must remain a single-origin terminal.
  const SAME_ORIGIN=window.location.origin;
  const blockExternalDestination=(value,source)=>{
    try{
      const u=new URL(String(value||''),window.location.href);
      if(u.origin!==SAME_ORIGIN){
        console.warn('[DealDost] blocked external navigation:',source||'',u.href);
        return true;
      }
    }catch(e){return true}
    return false;
  };


  const isBlockedBinanceUrl=(value)=>{
    try{
      const u=new URL(String(value||''),window.location.href);
      const host=u.hostname.toLowerCase();
      const path=u.pathname.toLowerCase();
      // Block only external Binance Demo/Testnet destinations. Normal public
      // market API calls made through DealDost's own /api routes are unaffected.
      return (
        host==='demo.binance.com' ||
        host.endsWith('.demo.binance.com') ||
        host==='testnet.binancefuture.com' ||
        host==='testnet.binance.vision' ||
        host==='demo-fapi.binance.com' ||
        host==='demo-api.binance.com' ||
        (host.endsWith('.binance.com') && (host.startsWith('demo-') || host.startsWith('testnet-'))) ||
        (host==='www.binance.com' && /(^|\\/)testnet|(^|\\/)demo/i.test(path))
      );
    }catch(e){return false}
  };

  const blockNavigation=(value,source)=>{
    if(!isBlockedBinanceUrl(value))return false;
    console.warn('[DealDost] blocked automatic Binance Demo/Testnet navigation:',source||'',String(value||''));
    return true;
  };

  // The scanner must stay inside DealDost. Binance Demo is an API/account
  // execution environment, not a page that the terminal should auto-open.
  window.open=function(url,...args){
    // DealDost is a single-page terminal. Background scanner/account refreshes
    // must never create or navigate to another website.
    try{
      const u=new URL(String(url||''),window.location.href);
      if(u.origin!==window.location.origin){
        console.warn('[DealDost] blocked external window navigation:',u.href);
        return null;
      }
    }catch(e){}
    if(blockNavigation(url,'window.open'))return null;
    return nativeOpen(url,...args);
  };

  // HARD POPUP LOCK: no script/background refresh is allowed to open a new tab.
  // DealDost does not need window.open for scanner, market feed, or execution.
  window.open=function(){
    console.warn('[DealDost] blocked popup/new-tab navigation');
    return null;
  };

  const nativeAnchorSetAttribute=HTMLAnchorElement.prototype.setAttribute;
  HTMLAnchorElement.prototype.setAttribute=function(name,value){
    if(String(name).toLowerCase()==='href' && blockExternalDestination(value,'anchor.setAttribute'))return;
    return nativeAnchorSetAttribute.apply(this,arguments);
  };

  // Also intercept direct anchor.href assignments, which bypass setAttribute().
  try{
    const anchorProto=HTMLAnchorElement.prototype;
    const hrefDesc=Object.getOwnPropertyDescriptor(anchorProto,'href');
    if(hrefDesc&&hrefDesc.get&&hrefDesc.set){
      Object.defineProperty(anchorProto,'href',{
        configurable:hrefDesc.configurable,
        enumerable:hrefDesc.enumerable,
        get:hrefDesc.get,
        set:function(value){
          if(blockExternalDestination(value,'anchor.href='))return;
          return hrefDesc.set.call(this,value);
        }
      });
    }
  }catch(e){}

  // Remove/neutralize dynamically-created external links before they can be clicked.
  const scrubExternalLinks=()=>{
    try{
      document.querySelectorAll('a[href]').forEach(link=>{
        if(blockExternalDestination(link.href,'anchor.scan')){
          link.removeAttribute('href');
          link.removeAttribute('target');
        }
      });
    }catch(e){}
  };
  const observer=new MutationObserver(()=>scrubExternalLinks());
  try{observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href','target']});}catch(e){}
  setTimeout(scrubExternalLinks,0);

  const originalAnchorClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    try{if(blockNavigation(this.href,'anchor.click'))return;}catch(e){}
    return originalAnchorClick.apply(this,arguments);
  };

  const originalFormSubmit=HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit=function(){
    try{
      if(blockNavigation(this.action,'form.submit')){
        return;
      }
    }catch(e){}
    return originalFormSubmit.apply(this,arguments);
  };

  // Block any external anchor navigation, not only Binance. This prevents a
  // redirected/constructed Demo URL from escaping the terminal.
  document.addEventListener('click',(event)=>{
    try{
      const link=event.target&&event.target.closest?event.target.closest('a[href]'):null;
      if(link){
        const u=new URL(link.href,window.location.href);
        if(u.origin!==window.location.origin){
          event.preventDefault();
          event.stopImmediatePropagation();
          console.warn('[DealDost] blocked external anchor navigation:',u.href);
        }
      }
    }catch(e){}
  },true);

  document.addEventListener('click',(event)=>{
    try{
      const link=event.target&&event.target.closest?event.target.closest('a[href]'):null;
      if(link&&blockNavigation(link.href,'anchor')){event.preventDefault();event.stopImmediatePropagation();}
    }catch(e){}
  },true);

  // Also catch target=_blank links and synthetic navigation attempts before
  // they leave the terminal. This is deliberately limited to blocked Binance
  // Demo/Testnet URLs so normal site navigation is untouched.
  document.addEventListener('auxclick',(event)=>{
    try{
      const link=event.target&&event.target.closest?event.target.closest('a[href]'):null;
      if(link&&blockNavigation(link.href,'auxclick')){event.preventDefault();event.stopImmediatePropagation();}
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

  const MSG='Binance Futures Demo trading is unavailable from this deployment location or account eligibility.';

  // IMPORTANT: never programmatically click the Auto button.
  // The previous guard used b.click() here; if the terminal's Auto handler
  // opens the Binance Demo/Testnet UI, that synthetic click creates the exact
  // unwanted new-tab behavior during background scanner/account updates.
  // Testnet restriction is enforced at the API boundary instead.
  function disableTestnetAuto(){}

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