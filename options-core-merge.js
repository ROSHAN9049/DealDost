/* DealDost unified Futures + Options accounting bridge — V2
 * Uses the live Options V2 state first, with localStorage as fallback.
 * Keeps dashboard accounting aligned with the actual four option positions.
 */
(()=>{'use strict';
const KEY='dd_options_v2';
const N=x=>Number.isFinite(+x)?+x:0;
const money=x=>'₹'+N(x).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=x=>String(x??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
function opt(){
  try{
    const live=window.DDOptions?.getState?.();
    if(live&&Array.isArray(live.positions)&&Array.isArray(live.trades))return live;
    return JSON.parse(localStorage.getItem(KEY)||'{}');
  }catch(e){return {positions:[],trades:[]}}
}
function stats(){
  const o=opt(),ts=Array.isArray(o.trades)?o.trades:[],ps=Array.isArray(o.positions)?o.positions:[],closed=ts.filter(t=>t.status==='CLOSED');
  const realized=closed.reduce((s,t)=>s+N(t.pnl),0),unreal=ps.reduce((s,p)=>s+N(p.pnl),0),fees=ts.reduce((s,t)=>s+N(t.fees),0);
  return{realized,unreal,net:realized+unreal,fees,open:ps.length,closed:closed.length,wins:closed.filter(t=>N(t.pnl)>0).length,losses:closed.filter(t=>N(t.pnl)<0).length}
}
function panel(){
  const s=stats();
  return '<div class="panel dd-opt-core-merge" style="margin-top:8px"><div class="panel-header"><div class="panel-title">UNIFIED ACCOUNTING · FUTURES + OPTIONS</div><div class="panel-sub">ONE PAPER LEDGER VIEW · LIVE OPTIONS STATE</div></div><div class="dd-opt-core-content"><div class="kpi-grid">'+k('Options Realized',money(s.realized),s.realized)+k('Options Unrealized',money(s.unreal),s.unreal)+k('Options Fees',money(s.fees))+k('Options Open',s.open)+k('Options Closed',s.closed)+'</div><div class="acct-card"><div class="acct-row"><span>Options net contribution</span><b class="'+(s.net>=0?'pos':'neg')+'">'+money(s.net)+'</b></div><div class="acct-row"><span>Closed wins / losses</span><b>'+s.wins+' / '+s.losses+'</b></div><div class="acct-row"><span>Accounting rule</span><b>Open P&L + closed P&L; fees shown separately</b></div></div></div></div>'
}
function k(a,b,c){return '<div class="kpi-card '+(N(c)>0?'pos':N(c)<0?'neg':'')+'"><div class="kpi-label">'+esc(a)+'</div><div class="kpi-value">'+b+'</div></div>'}
function render(force){
  const app=document.querySelector('#app');if(!app||!window.DD)return;if(DD.tab!=='dashboard'&&DD.tab!=='pnl')return;
  let p=app.querySelector('.dd-opt-core-merge');
  if(!p){app.insertAdjacentHTML('beforeend',panel());return}
  if(force){const c=p.querySelector('.dd-opt-core-content');if(c){const fresh=document.createRange().createContextualFragment(panel());const nc=fresh.querySelector('.dd-opt-core-content');if(nc)c.replaceWith(nc)}}
}
function hook(){
  if(!window.DD||window.DD.__optCoreMergeV2)return;
  if(typeof DD.render==='function'){const old=DD.render;DD.render=function(){const r=old.apply(this,arguments);render(false);return r};DD.__optCoreMergeV2=true;render(false)}
}
window.DDCombinedOptions={stats,render};
setInterval(()=>{try{render(true)}catch(e){}},5000);
setTimeout(hook,500);
})();
