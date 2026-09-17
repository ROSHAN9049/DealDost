/* DealDost Dashboard — active positions only. Re-renders after every terminal render so trade cards stay visible. */
(()=>{'use strict';
const esc=x=>String(x??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const num=x=>Number.isFinite(+x)?+x:0;
const money=x=>(num(x)>=0?'+':'')+'₹'+num(x).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const time=x=>x?new Date(x).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
function read(k,f){try{return JSON.parse(localStorage.getItem(k)||f)}catch(e){return JSON.parse(f)}}
function active(mode,engine,limit){const q=read('ddv5_'+mode,'{}');const p=Array.isArray(q.pos)?q.pos:[];return p.filter(x=>x.e===engine).slice(0,limit)}
function options(){
  const q=read('dd_options_v2','{}');
  if(Array.isArray(q.positions))return q.positions.slice(0,4);
  const p=read('ddv5_'+(localStorage.getItem('ddMode')||'PAPER'),'{}');
  return Array.isArray(p.optSets)?p.optSets.filter(x=>x.status==='OPEN').slice(0,4):[];
}
function sideClass(s){return String(s||'').toUpperCase()==='BUY'?'dt-buy':'dt-sell'}
function table(items){if(!items.length)return '<div class="dt-empty">No active trade</div>';return '<div class="dt-table-wrap"><table><thead><tr><th>Time</th><th>Coin</th><th>Side</th><th>Strategy</th><th>Entry</th><th>Current</th><th>Qty</th><th>P&L</th><th>Status</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+time(x.time||x.opened)+'</td><td>'+esc(x.s||x.u||x.symbol||'—')+'</td><td class="'+sideClass(x.side)+'">'+esc(x.side||'—')+'</td><td>'+esc(x.strategy||x.e||'OPTIONS')+'</td><td>'+esc(x.entry??x.price??'—')+'</td><td>'+esc(x.current??x.mark??'—')+'</td><td>'+esc(x.qty??x.q??'—')+'</td><td class="'+(num(x.pnl)>=0?'dt-pos':'dt-neg')+'">'+money(x.pnl)+'</td><td class="dt-open">OPEN</td></tr>').join('')+'</tbody></table></div>'}
function panel(mode){const root=document.querySelector('#dd-dashboard-trades');if(!root)return;root.innerHTML='<div class="dt-head"><div><b>ACTIVE TRADES</b><span>Currently running positions only</span></div><span class="dt-mode">'+esc(mode)+'</span></div><div class="dt-grid"><section><h3>⚡ MOMENTUM <em>3 ACTIVE</em></h3>'+table(active(mode,'MOMENTUM',3))+'</section><section><h3>⚡ SCALPING <em>3 ACTIVE</em></h3>'+table(active(mode,'SCALPING',3))+'</section><section><h3>◈ OPTIONS <em>4 ACTIVE</em></h3>'+table(options())+'</section></div>'}
function style(){if(document.getElementById('dd-dashboard-trades-style'))return;const s=document.createElement('style');s.id='dd-dashboard-trades-style';s.textContent='.dd-dashboard-trades{margin-top:10px;border:1px solid #20384f;border-radius:14px;background:linear-gradient(145deg,#09121c,#050b11);overflow:hidden;contain:layout paint}.dt-head{display:flex;justify-content:space-between;align-items:center;padding:13px 15px;border-bottom:1px solid #172b3d}.dt-head b{color:#eef6ff;font-size:13px;letter-spacing:.08em}.dt-head span{display:block;color:#6f8498;font-size:9px;margin-top:3px}.dt-mode{margin-top:0!important;color:#56a9ff!important;font-weight:900}.dt-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:8px}.dt-grid section{min-width:0;border:1px solid #172b3d;border-radius:10px;background:#071019;overflow:hidden}.dt-grid h3{margin:0;padding:10px 11px;border-bottom:1px solid #162737;color:#dce8f3;font-size:11px}.dt-grid h3 em{font-style:normal;color:#56a9ff;font-size:9px;margin-left:5px}.dt-table-wrap{overflow:auto;max-height:330px}.dt-grid table{width:100%;min-width:700px;border-collapse:collapse}.dt-grid th{position:sticky;top:0;padding:7px 8px;background:#0b1722;color:#60778d;font-size:8px;text-align:left;z-index:2}.dt-grid td{padding:8px;border-bottom:1px solid #10202d;color:#b9c9d8;font-size:9px;white-space:nowrap}.dt-buy,.dt-pos{color:#36e29a!important;font-weight:900}.dt-sell,.dt-neg{color:#ff6079!important;font-weight:900}.dt-open{color:#36e29a!important;font-weight:900}.dt-empty{padding:24px;text-align:center;color:#647b90;font-size:10px}@media(max-width:1050px){.dt-grid{grid-template-columns:1fr}}';document.head.appendChild(s)}
function render(){if(!window.DD||DD.tab!=='dashboard')return;const app=document.querySelector('#app');if(!app)return;style();let root=document.getElementById('dd-dashboard-trades');if(!root){root=document.createElement('div');root.id='dd-dashboard-trades';root.className='dd-dashboard-trades';app.appendChild(root)}panel(localStorage.getItem('ddMode')||'PAPER')}
style();
let hooked=false;
function hook(){
  if(hooked||!window.DD||typeof DD.render!=='function')return false;
  const original=DD.render;
  DD.render=function(){original();render()};
  hooked=true;
  render();
  return true;
}
if(!hook()){
  let tries=0;const timer=setInterval(()=>{if(hook()||++tries>100)clearInterval(timer)},50);
}
window.DDTradeDashboard={render};
})();
