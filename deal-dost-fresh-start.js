/* DealDost Fresh Start — one-time paper reset
 * Clears old local trading history/state and starts PAPER mode at ₹1,000.
 * Does not touch Binance credentials or live/testnet account data.
 */
(()=>{'use strict';
 const VERSION='20260917-1000-v1',DONE='dd_fresh_start_version';
 try{
  if(localStorage.getItem(DONE)===VERSION)return;
  ['ddv5_PAPER','dd_v2_signal_history_v1','dd_options_v2','ddTestnetRestrictedAt'].forEach(k=>localStorage.removeItem(k));
  const settings=JSON.parse(localStorage.getItem('ddSettings')||'{}');
  settings.paperCapital=1000;
  localStorage.setItem('ddSettings',JSON.stringify(settings));
  localStorage.setItem('ddMode','PAPER');
  localStorage.setItem(DONE,VERSION);
 }catch(e){console.warn('DealDost fresh start reset skipped:',e)}
})();
