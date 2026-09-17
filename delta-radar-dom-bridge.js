/* DealDost radar DOM bridge V2
 * Reads the already-rendered scanner table into the dashboard layer.
 * Price/market values may update live, but dashboard render is triggered only
 * when the scanner structure/signal state changes. This prevents render loops.
 * UI/read-only bridge only; trading/order logic is untouched.
 */
(()=>{'use strict';
  const num=v=>{const n=parseFloat(String(v??'').replace(/,/g,'').replace('%','').replace(/x$/i,''));return Number.isFinite(n)?n:0};
  const side=v=>{const s=String(v||'').toUpperCase();return s.includes('SELL')?'SELL':s.includes('BUY')?'BUY':'WAIT'};
  const norm=v=>String(v??'').replace(/\s+/g,' ').trim();
  function read(){
    const app=document.getElementById('app');if(!app)return[];
    const panel=[...app.querySelectorAll('.panel')].find(p=>/Live Scanner/i.test(p.textContent||''));if(!panel)return[];
    const table=panel.querySelector('table');if(!table)return[];
    const hs=[...table.querySelectorAll('thead th')].map(x=>norm(x.textContent).toLowerCase());
    const ix={};hs.forEach((h,i)=>{ix[h]=i});
    const cell=(cells,name)=>{const i=ix[name];return i==null?'':cells[i]?.textContent?.trim()||''};
    return [...table.querySelectorAll('tbody tr')].map(tr=>{
      const cells=[...tr.querySelectorAll('td')],s=cell(cells,'coin').replace(/\s+/g,'');
      if(!/USDT$/i.test(s))return null;
      const sig=cell(cells,'signal'),act=cell(cells,'action');
      const mside=side(sig.match(/BUY|SELL/i)?.[0]||''),scalp=side(act.match(/BUY|SELL/i)?.[0]||'');
      return {s,p:num(cell(cells,'price')),c:num(cell(cells,'24h')),v:num(cell(cells,'24h vol')),vs:num(cell(cells,'vol spike')),m:num(cell(cells,'mom score')),sc:num(cell(cells,'scalp score')),momentum:mside,scalp,trend:mside==='BUY'?'BULLISH':mside==='SELL'?'BEARISH':'NEUTRAL',signal:sig,action:act};
    }).filter(Boolean);
  }
  let lastStructure='',lastRows=[];
  function structureKey(rows){
    return rows.map(x=>[x.s,x.m,x.sc,x.momentum,x.scalp,x.signal,x.action].join('|')).join('||');
  }
  function sync(){
    try{
      const rows=read();if(!rows.length)return;
      const key=structureKey(rows);
      window.__DD_SCANNER_ROWS=rows;
      window.__DD_GET_VOL_SPIKE=s=>{const r=rows.find(x=>x.s===s);return r&&r.vs>0?r.vs:1};
      /* Live prices/volume are exposed above without forcing DD.render().
         Render only when rows/signals/engine states structurally change. */
      if(key!==lastStructure){lastStructure=key;lastRows=rows;if(window.DD&&typeof window.DD.render==='function')window.DD.render()}
      else lastRows=rows;
    }catch(e){console.warn('DealDost radar bridge skipped:',e)}
  }
  setInterval(sync,1200);sync();
  window.DDRadarBridge={refresh:sync,getRows:()=>lastRows.slice()};
})();
