const KEY='paper-engine-state-v1';
const REFRESH=2000;
function fmt(v){return Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:8})}
function render(){
  let el=document.getElementById('position-dashboard');
  if(!el){
    el=document.createElement('section');
    el.id='position-dashboard';
    el.style='margin:12px auto;max-width:1400px;padding:14px 16px;border:1px solid rgba(0,255,180,.25);border-radius:16px;background:linear-gradient(135deg,#071a18,#111827);color:#fff;font-family:Arial,sans-serif;box-sizing:border-box';
    document.body.insertBefore(el,document.getElementById('root'));
  }
  let s;
  try{s=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{s={}}
  const positions=Object.values(s.positions||{});
  el.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><b>📌 POSITION DASHBOARD</b><div style="font-size:12px;opacity:.75;margin-top:3px">Browser PAPER engine positions · updates every 2 seconds</div></div><div style="font-weight:800">${positions.length}/${3} OPEN</div></div>${positions.length?`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;margin-top:12px">${positions.map(p=>`<div style="padding:12px;border-radius:12px;background:${p.side==='BUY'?'rgba(0,180,100,.12)':'rgba(255,70,90,.12)'};border:1px solid ${p.side==='BUY'?'rgba(0,255,180,.3)':'rgba(255,80,100,.3)'}"><div style="display:flex;justify-content:space-between"><b>🪙 ${p.symbol}</b><b>${p.side==='BUY'?'🟢 BUY':'🔴 SELL'}</b></div><div style="font-size:12px;line-height:1.8;margin-top:6px">Entry: <b>${fmt(p.entry)}</b><br>Qty: <b>${fmt(p.qty)}</b><br>Stop Loss: <b>${fmt(p.sl)}</b><br>Take Profit: <b>${fmt(p.tp)}</b><br>Opened: <b>${p.opened?new Date(p.opened).toLocaleTimeString():'—'}</b></div></div>`).join('')}</div>`:`<div style="margin-top:12px;padding:16px;border-radius:12px;background:rgba(255,255,255,.06);text-align:center;opacity:.85">⏳ No open paper position yet. Engine is scanning for fully qualified BUY/SELL signals with score ≥ 75.</div>`}`;
}
render();
setInterval(render,REFRESH);
