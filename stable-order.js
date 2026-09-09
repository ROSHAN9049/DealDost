/* DealDost final visual order lock. Market values stay live; DOM order follows V5. */
(function(){
  'use strict';
  const KEY='dealDostStableUniverseV5',MAX=50;
  const $=id=>document.getElementById(id);
  function get(){try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x.slice(0,MAX):[]}catch(e){return[]}}
  function arrange(){
    const body=$('signals'), order=get(); if(!body||!order.length)return;
    const rows=[...body.querySelectorAll('tr')].filter(r=>r.querySelector('td'));
    const by=new Map(rows.map(r=>[(r.querySelector('td:nth-child(2)')?.textContent||'').trim(),r]));
    const sorted=order.map(s=>by.get(s)).filter(Boolean);
    rows.forEach(r=>{if(!sorted.includes(r))sorted.push(r)});
    sorted.forEach(r=>body.appendChild(r));
    const visible=sorted.filter(r=>r.style.display!=='none').length;
    const info=$('scannerInfo'); if(info&&visible)info.textContent=`${visible} stable coins · LIVE price/change/volume`;
  }
  function watch(){const body=$('signals');if(!body)return false;new MutationObserver(()=>requestAnimationFrame(arrange)).observe(body,{childList:true,subtree:true});arrange();return true}
  if(!watch()){const t=setInterval(()=>{if(watch())clearInterval(t)},100)}
  setInterval(arrange,1000);
})();
