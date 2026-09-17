/* DealDost unified Futures + Options accounting bridge
 * Keeps the existing futures engine untouched while making the main terminal
 * show one combined accounting view. Options are sourced from DDOptions V2.
 */
(()=>{'use strict';
const KEY='dd_options_v2';
const N=x=>Number.isFinite(+x)?+x:0;
const money=x=>'₹'+N(x).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=x=>String(x??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
function opt(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return {}}}
function stats(){const o=opt(),ts=Array.isArray(o.trades)?o.trades:[],ps=Array.isArray(o.positions)?o.positions:[],closed=ts.filter(t=>t.status==='CLOSED');const realized=closed.reduce((s,t)=>s+N(t.pnl),0),unreal=ps.reduce((s,p)=>s+N(p.pnl),0),fees=ts.reduce((s,t)=>s+N(t.fees),0);return{realized,unreal,net:realized+unreal,fees,open:ps.length,closed:closed.length,wins:closed.filter(t=>N(t.pnl)>0).length,losses:closed.filter(t=>N(t.pnl)<0).length}}
function panel(){const s=stats();return '<div class="panel dd-opt-core-merge" style="margin-top:8px"><div class="panel-header"><div class="panel-title">UNIFIED ACCOUNTING · FUTURES + OPTIONS</div><div class="panel-sub">ONE PAPER LEDGER VIEW · OPTIONS INCLUDED</div></div><div class="kpi-grid">'+k('Options Realized',money(s.realized),s.realized)+k('Options Unrealized',money(s.unreal),s.unreal)+k('Options Fees',money(s.fees))+k('Options Open',s.open)+k('Options Closed',s.closed)+'</div><div class="acct-card"><div class="acct-row"><span>Options net contribution</span><b class="'+(s.net>=0?'pos':'neg')+'">'+money(s.net)+'</b></div><div class="acct-row"><span>Closed wins / losses</span><b>'+s.wins+' / '+s.losses+'</b></div><div class="acct-row"><span>Accounting rule</span><b>Net P&L already includes option entry + exit fees</b></div></div></div>'}
function k(a,b,c){return '<div class="kpi-card '+(N(c)>0?'pos':N(c)<0?'neg':'')+'"><div class="kpi-label">'+esc(a)+'</div><div class="kpi-value">'+b+'</div></div>'}
function render(){const app=document.querySelector('#app');if(!app||!window.DD)return;document.querySelectorAll('.dd-opt-core-merge').forEach(x=>x.remove());if(DD.tab==='dashboard'||DD.tab==='pnl')app.insertAdjacentHTML('beforeend',panel())}
function hook(){if(!window.DD||window.DD.__optCoreMerge)return;if(typeof DD.render==='function'){const old=DD.render;DD.render=function(){const r=old.apply(this,arguments);setTimeout(render,0);return r};DD.__optCoreMerge=true}}
window.DDCombinedOptions={stats,render};
load();
function load(){}
hook();setInterval(()=>{hook();render()},1500);
})();
