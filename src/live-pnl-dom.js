const KEY='paper-engine-state-v1';
const WS='wss://fstream.binance.com/stream';
let socket=null,retry=null,prices=new Map(),signature='';
function read(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return{}}}
function getPrice(symbol){try{const m=window.__PAPER_LIVE_TICKERS;if(m?.get){const x=m.get(symbol);const p=Number(x?.lastPrice??x?.price??x?.c);if(Number.isFinite(p)&&p>0)return p}}catch{}try{const m=window.__BINANCE_SCANNER_TICKERS,x=m?.[symbol],p=Number(x?.lastPrice??x?.price??x?.c);if(Number.isFinite(p)&&p>0)return p}catch{}return prices.get(symbol)||null}
function connect(){clearTimeout(retry);const s=read(),symbols=Object.keys(s.positions||{}).filter(Boolean),sig=symbols.join(',');if(!symbols.length){signature='';return}if(sig===signature&&(socket?.readyState===WebSocket.OPEN||socket?.readyState===WebSocket.CONNECTING))return;signature=sig;try{socket?.close();const streams=symbols.map(x=>`${x.toLowerCase()}@ticker`).join('/');socket=new WebSocket(`${WS}?streams=${streams}`);socket.onmessage=e=>{try{const m=JSON.parse(e.data),d=m.data||m;if(d.s&&d.c)prices.set(d.s,Number(d.c))}catch{}};socket.onclose=()=>{if(signature===sig)retry=setTimeout(connect,2000)}}catch{retry=setTimeout(connect,2000)}}
function fmt(v){return Number(v).toLocaleString('en-IN',{maximumFractionDigits:8})}
function money(v){return `₹${Number(v).toFixed(2)}`}
function update(){try{const s=read(),ps=s.positions||{};if(!Object.keys(ps).length){connect();return}let changed=false;for(const p of Object.values(ps)){const price=getPrice(p.symbol);if(!Number.isFinite(price))continue;const pnl=p.side==='BUY'?(price-Number(p.entry))*Number(p.qty):(Number(p.entry)-price)*Number(p.qty);if(p.current!==price||p.unrealised!==pnl){p.current=price;p.unrealised=pnl;p.updated=Date.now();changed=true}}if(changed)localStorage.setItem(KEY,JSON.stringify(s));connect()}catch{}}
connect();setInterval(update,300);window.addEventListener('paper-pnl-update',update);
