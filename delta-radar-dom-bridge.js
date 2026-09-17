/* DealDost radar DOM bridge
 * Reads the already-rendered scanner table into the Delta-style dashboard layer.
 * UI/read-only bridge only; trading/order logic is untouched.
 */
(()=>{'use strict';
  const num=v=>{const n=parseFloat(String(v??'').replace(/,/g,'').replace('%','').replace(/x$/i,''));return Number.isFinite(n)?n:0};
  const side=v=>{const s=String(v||'').toUpperCase();return s.includes('SELL')?'SELL':s.includes('BUY')?'BUY':'WAIT'};
  function read(){
    const app=document.getElementById('app');if(!app)return[];
    const panel=[...app.querySelectorAll('.panel')].find(p=>/Live Scanner/i.test(p.textContent||''));if(!panel)return[];
    const table=panel.querySelector('table');if(!table)return[];
    const hs=[...table.querySelectorAll('thead th')].map(x=>x.textContent.trim().toLowerCase());
    const ix={};hs.forEach((h,i)=>{ix[h.replace(/\s+/g,' ')]=i});
    const cell=(cells,name)=>{const i=ix[name];return i==null?'':cells[i]?.textContent?.trim()||''};
    return [...table.querySelectorAll('tbody tr')].map(tr=>{
      const cells=[...tr.querySelectorAll('td')];
      const s=cell(cells,'coin').replace(/\s+/g,'');
      if(!/USDT$/i.test(s))return null;
      const sig=cell(cells,'signal'),act=cell(cells,'action');
      const mtxt=cell(cells,'mom score'),stxt=cell(cells,'scalp score');
      const mside=side(sig.match(/BUY|SELL/i)?.[0]||'')||'WAIT';
      const scalp=side(act.match(/BUY|SELL/i)?.[0]||'')||'WAIT';
      return {s,p:num(cell(cells,'price')),c:num(cell(cells,'24h')),v:num(cell(cells,'24h vol')),
        vs:num(cell(cells,'vol spike')),m:num(mtxt),sc:num(stxt),momentum:mside,scalp,
        trend:side(sig)==='BUY'?'BULLISH':side(sig)==='SELL'?'BEARISH':'NEUTRAL',
        signal:sig,action:act};
    }).filter(Boolean);
  }
  let last='';
  function sync(){
    try{
      const rows=read();if(!rows.length)return;
      const key=JSON.stringify(rows);
      window.__DD_SCANNER_ROWS=rows;
      window.__DD_GET_VOL_SPIKE=s=>{const r=rows.find(x=>x.s===s);return r&&r.vs>0?r.vs:1};
      if(key!==last){last=key;if(window.DD&&typeof window.DD.render==='function')window.DD.render()}
    }catch(e){}
  }
  setInterval(sync,700);sync();
})();
