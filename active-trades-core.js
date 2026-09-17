/* DealDost Active Trades — stable dashboard panel.
 * Deliberately does not observe #app, does not rewrite app.innerHTML, and never calls DD.render().
 */
(()=>{
  'use strict';
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=x=>Number.isFinite(+x)?+x:0;
  const money=x=>(num(x)>=0?'+':'')+'₹'+num(x).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const time=x=>x?new Date(x).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||f)}catch(e){return JSON.parse(f)}};
  const state=mode=>read('ddv5_'+mode,'{}');
  const active=(mode,engine,limit)=>{const p=state(mode).pos;return (Array.isArray(p)?p:[]).filter(x=>x&&x.e===engine).slice(0,limit)};
  function options(mode){
    const out=[],seen=new Set();
    const add=x=>{
      if(!x||x.status&&x.status!=='OPEN')return;
      const id=String(x.id||x.contract||x.symbol||x.u||out.length);
      if(seen.has(id))return;
      seen.add(id);out.push({...x,e:'OPTIONS',strategy:x.strategy||x.side||'OPTIONS'});
    };
    const core=read('dd_options_v2','{}');
    if(Array.isArray(core.positions))core.positions.forEach(add);
    const p=state(mode);
    if(Array.isArray(p.optSets))p.optSets.filter(x=>x&&x.status==='OPEN').forEach(add);
    return out.slice(0,4);
  }
  function table(items){
    if(!items.length)return '<div class="at-empty">No active trade</div>';
    return '<div class="at-scroll"><table><thead><tr><th>Time</th><th>Coin</th><th>Side</th><th>Strategy</th><th>Entry</th><th>Current</th><th>Qty</th><th>P&L</th><th>Status</th></tr></thead><tbody>'+items.map(x=>{
      const buy=String(x.side||'').toUpperCase()==='BUY';
      return '<tr><td>'+time(x.time||x.opened)+'</td><td>'+esc(x.s||x.u||x.symbol||'—')+'</td><td class="'+(buy?'at-buy':'at-sell')+'">'+esc(x.side||'—')+'</td><td>'+esc(x.strategy||x.e||'OPTIONS')+'</td><td>'+esc(x.entry??x.price??'—')+'</td><td>'+esc(x.current??x.mark??'—')+'</td><td>'+esc(x.qty??x.q??'—')+'</td><td class="'+(num(x.pnl)>=0?'at-pos':'at-neg')+'">'+money(x.pnl)+'</td><td class="at-open">OPEN</td></tr>';
    }).join('')+'</tbody></table></div>';
  }
  function css(){
    if(document.getElementById('active-trades-core-style'))return;
    const s=document.createElement('style');s.id='active-trades-core-style';s.textContent='.active-trades-core{margin:10px 0;border:1px solid #20384f;border-radius:14px;background:linear-gradient(145deg,#09121c,#050b11);overflow:hidden}.at-head{display:flex;justify-content:space-between;align-items:center;padding:13px 15px;border-bottom:1px solid #172b3d}.at-head b{color:#eef6ff;font-size:13px;letter-spacing:.08em}.at-sub{display:block;color:#6f8498;font-size:9px;margin-top:3px}.at-mode{color:#56a9ff;font-size:9px;font-weight:900}.at-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:8px}.at-grid section{min-width:0;border:1px solid #172b3d;border-radius:10px;background:#071019;overflow:hidden}.at-grid h3{margin:0;padding:10px 11px;border-bottom:1px solid #162737;color:#dce8f3;font-size:11px}.at-grid h3 em{font-style:normal;color:#56a9ff;font-size:9px;margin-left:5px}.at-scroll{overflow:auto;max-height:330px}.at-grid table{width:100%;min-width:700px;border-collapse:collapse}.at-grid th{position:sticky;top:0;padding:7px 8px;background:#0b1722;color:#60778d;font-size:8px;text-align:left;z-index:2}.at-grid td{padding:8px;border-bottom:1px solid #10202d;color:#b9c9d8;font-size:9px;white-space:nowrap}.at-buy,.at-pos,.at-open{color:#36e29a!important;font-weight:900}.at-sell,.at-neg{color:#ff6079!important;font-weight:900}.at-empty{padding:24px;text-align:center;color:#647b90;font-size:10px}@media(max-width:1050px){.at-grid{grid-template-columns:1fr}}';document.head.appendChild(s);
  }
  function findScanner(){return [...document.querySelectorAll('#app .panel')].find(x=>/Live Scanner\s*[—-]/i.test(x.textContent||''))||null}
  function render(){
    if(!window.DD||DD.tab!=='dashboard')return;
    const app=document.getElementById('app');if(!app)return;
    css();
    let root=document.getElementById('active-trades-core');
    if(!root){root=document.createElement('div');root.id='active-trades-core';root.className='active-trades-core'}
    const scanner=findScanner();
    if(scanner)app.insertBefore(root,scanner);else if(!root.parentNode)app.appendChild(root);
    const mode=localStorage.getItem('ddMode')||'PAPER';
    const m=active(mode,'MOMENTUM',3),s=active(mode,'SCALPING',3),o=options(mode);
    root.innerHTML='<div class="at-head"><div><b>ACTIVE TRADES</b><span class="at-sub">Currently running positions only</span></div><span class="at-mode">'+esc(mode)+'</span></div><div class="at-grid"><section><h3>⚡ MOMENTUM <em>'+m.length+'/3 ACTIVE</em></h3>'+table(m)+'</section><section><h3>⚡ SCALPING <em>'+s.length+'/3 ACTIVE</em></h3>'+table(s)+'</section><section><h3>◈ OPTIONS <em>'+o.length+'/4 ACTIVE</em></h3>'+table(o)+'</section></div>';
  }
  function hook(){
    if(!window.DD||typeof DD.render!=='function'||window.__DD_ACTIVE_CORE_HOOKED)return false;
    const original=DD.render;
    DD.render=function(){const result=original.apply(this,arguments);if(DD.tab==='dashboard')setTimeout(render,0);return result};
    window.__DD_ACTIVE_CORE_HOOKED=true;
    setTimeout(render,0);
    return true;
  }
  let tries=0;
  const timer=setInterval(()=>{if(hook()||++tries>120)clearInterval(timer)},50);
})();
