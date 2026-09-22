/* DealDost minimal navigation safety guard
 * Purpose: prevent legacy/synthetic Binance Demo/Testnet popups without
 * interfering with normal terminal startup, same-origin routing, forms,
 * Location APIs, or legitimate user navigation.
 */
(()=>{'use strict';

  if(window.__DD_NAV_GUARD__)return;
  window.__DD_NAV_GUARD__=true;

  const isDemoHost=(value)=>{
    try{
      const u=new URL(String(value||''),window.location.href);
      const host=u.hostname.toLowerCase();
      return (
        host==='demo.binance.com' ||
        host==='demo-api.binance.com' ||
        host==='demo-fapi.binance.com' ||
        host.endsWith('.demo.binance.com') ||
        host.endsWith('.demo-api.binance.com') ||
        host==='testnet.binancefuture.com' ||
        host==='testnet.binance.vision'
      );
    }catch(e){return false}
  };

  // Defense-in-depth for legacy code that may still call window.open().
  // Non-Binance popups remain untouched.
  const nativeOpen=window.open.bind(window);
  window.open=function(url,...args){
    if(isDemoHost(url)){
      console.warn('[DealDost] blocked automatic Binance Demo/Testnet popup:',String(url||''));
      return null;
    }
    return nativeOpen(url,...args);
  };

  // Programmatic anchor.click() has event.isTrusted === false. Block only
  // known Binance Demo/Testnet destinations in that case. Real user clicks
  // remain allowed so the guard cannot break deliberate navigation.
  document.addEventListener('click',(event)=>{
    try{
      if(event.isTrusted!==false)return;
      const link=event.target&&event.target.closest?event.target.closest('a[href]'):null;
      if(link&&isDemoHost(link.href)){
        event.preventDefault();
        event.stopImmediatePropagation();
        console.warn('[DealDost] blocked synthetic Binance Demo/Testnet navigation:',link.href);
      }
    }catch(e){}
  },true);

  document.addEventListener('auxclick',(event)=>{
    try{
      if(event.isTrusted!==false)return;
      const link=event.target&&event.target.closest?event.target.closest('a[href]'):null;
      if(link&&isDemoHost(link.href)){
        event.preventDefault();
        event.stopImmediatePropagation();
        console.warn('[DealDost] blocked synthetic Binance Demo/Testnet aux navigation:',link.href);
      }
    }catch(e){}
  },true);

  // Keep the legacy restriction flag visible for diagnostics, but never
  // disable scanner Auto from this frontend-only guard.
  window.addEventListener('dd:testnet-restricted',()=>{});
})();