const PNL_KEY='paper-engine-state-v1';
const PNL_WS='wss://fstream.binance.com/stream';
let pnlWS=null,pnlRetry=null,pnlTimer=null,lastPrices=new Map(),lastSymbols='';
function pnlConnect(){
  clearTimeout(pnlRetry);
  try{
    const s=JSON.parse(localStorage.getItem(PNL_KEY)||'{}');
    const symbols=Object.keys(s.positions||{}).filter(Boolean);
    const sig=symbols.join(',');
    if(!symbols.length){lastSymbols='';return}
    if(sig===lastSymbols&&pnlWS&&(pnlWS.readyState===WebSocket.OPEN||pnlWS.readyState===WebSocket.CONNECTING))return;
    try{pnlWS?.close()}catch{}
    lastSymbols=sig;
    const streams=symbols.map(x=>`${x.toLowerCase()}@ticker`).join('/');
    pnlWS=new WebSocket(`${PNL_WS}?streams=${streams}`);
    pnlWS.onmessage=e=>{
      try{
        const m=JSON.parse(e.data),d=m.data||m;
        if(d?.s&&d?.c)lastPrices.set(d.s,Number(d.c));
      }catch{}
    };
    pnlWS.onerror=()=>{};
    pnlWS.onclose=()=>{
      if(lastSymbols===sig)pnlRetry=setTimeout(pnlConnect,2000);
    };
  }catch{pnlRetry=setTimeout(pnlConnect,2000)}
}
function pnlTick(){
  try{
    const s=JSON.parse(localStorage.getItem(PNL_KEY)||'{}'),positions=s.positions||{};
    if(!Object.keys(positions).length){pnlConnect();return}
    let changed=false;
    for(const p of Object.values(positions)){
      const price=lastPrices.get(p.symbol);
      if(!Number.isFinite(price))continue;
      const entry=Number(p.entry),qty=Number(p.qty);
      p.current=price;
      p.unrealised=p.side==='BUY'?(price-entry)*qty:(entry-price)*qty;
      p.updated=Date.now();
      changed=true;
    }
    if(changed)localStorage.setItem(PNL_KEY,JSON.stringify(s));
    window.dispatchEvent(new CustomEvent('paper-pnl-update'));
    pnlConnect();
  }catch{}
}
pnlConnect();
pnlTimer=setInterval(pnlTick,500);
