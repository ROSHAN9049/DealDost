(()=>{
  const NativeWebSocket=window.WebSocket;
  if(!NativeWebSocket||window.__DEALDOST_LIVE_WATCHDOG__)return;
  window.__DEALDOST_LIVE_WATCHDOG__=true;
  const tracked=new Set();
  const TICKER_STALE=30000;
  const CANDLE_STALE=90000;
  const isBinance=url=>typeof url==='string'&&url.includes('fstream.binance.com');
  const isCandle=url=>typeof url==='string'&&url.includes('streams=');
  const WatchdogWebSocket=function(url,protocols){
    const ws=protocols===undefined?new NativeWebSocket(url):new NativeWebSocket(url,protocols);
    if(!isBinance(url))return ws;
    const item={ws,url:String(url),last:Date.now()};
    tracked.add(item);
    ws.addEventListener('message',()=>{item.last=Date.now()});
    const cleanup=()=>tracked.delete(item);
    ws.addEventListener('close',cleanup,{once:true});
    return ws;
  };
  WatchdogWebSocket.prototype=NativeWebSocket.prototype;
  ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(k=>{try{WatchdogWebSocket[k]=NativeWebSocket[k]}catch{}});
  window.WebSocket=WatchdogWebSocket;
  setInterval(()=>{
    const now=Date.now();
    for(const item of [...tracked]){
      const ws=item.ws;
      if(ws.readyState!==NativeWebSocket.OPEN)continue;
      const limit=isCandle(item.url)?CANDLE_STALE:TICKER_STALE;
      if(now-item.last>limit){
        try{ws.close(4000,'live-feed-stale')}catch{}
      }
    }
  },10000);
})();
