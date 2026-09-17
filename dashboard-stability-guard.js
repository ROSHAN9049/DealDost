/* DealDost dashboard stability guard
 * Prevent the terminal's 3-second management timer from rebuilding the entire UI.
 * Market scans and trading management continue; only the high-frequency full render is blocked.
 */
(()=>{
  'use strict';
  const nativeSetInterval=window.setInterval.bind(window);
  const nativeClearInterval=window.clearInterval.bind(window);
  const blocked=new Set();
  window.setInterval=function(fn,delay,...args){
    if(Number(delay)===3000){
      const id=nativeSetInterval(()=>{},2147483647);
      blocked.add(id);
      return id;
    }
    return nativeSetInterval(fn,delay,...args);
  };
  window.clearInterval=function(id){
    blocked.delete(id);
    return nativeClearInterval(id);
  };
})();
