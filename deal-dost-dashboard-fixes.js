/* DealDost dashboard consistency fixes
 * Presentation/accounting labels only. No order/trading logic changes.
 */
(()=>{'use strict';
  const n=v=>Number.isFinite(+v)?+v:0;
  const money=v=>'₹'+n(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const mode=()=>localStorage.getItem('ddMode')||'PAPER';
  const state=()=>{try{return JSON.parse(localStorage.getItem('ddv5_'+mode())||'{}')}catch{return{}}};
  const today=new Date().toDateString();
  function fixKpis(){
    const app=document.getElementById('app');if(!app||!window.DD||DD.tab!=='dashboard')return;
    const q=state(),hist=Array.isArray(q.hist)?q.hist:[],ex=hist.filter(h=>h.action==='EXIT');
    const td=ex.filter(h=>new Date(n(h.time)).toDateString()===today);
    const wins=td.filter(h=>n(h.pnl)>0).length,losses=td.filter(h=>n(h.pnl)<0).length;
    const rate=td.length?wins/td.length*100:0;
    [...app.querySelectorAll('.kpi-card')].forEach(card=>{
      const label=card.querySelector('.kpi-label'),value=card.querySelector('.kpi-value');if(!label||!value)return;
      const l=label.textContent.trim();
      if(l==='Winning Trades')value.textContent=String(wins);
      else if(l==='Losing Trades')value.textContent=String(losses);
      else if(l==='Win Rate')value.textContent=rate.toFixed(1)+'%';
      else if(l==='Open Positions')label.textContent='Futures Positions';
    });
  }
  function fixRadar(){
    const root=document.getElementById('dd-market-radar');if(!root)return;
    const cards=[...root.querySelectorAll('.acct-card')];
    const card=cards.find(x=>/VOLUME SPIKE/i.test(x.querySelector('h4')?.textContent||''));if(!card)return;
    const rows=Array.isArray(window.__DD_SCANNER_ROWS)?window.__DD_SCANNER_ROWS:[];
    const vol=rows.map(x=>{let v=1;try{v=n(window.__DD_GET_VOL_SPIKE?.(x.s))}catch{}return{x,v}}).filter(x=>x.v>=1).sort((a,b)=>b.v-a.v).slice(0,3);
    card.innerHTML='<h4>📊 VOLUME SPIKE ≥1x</h4>'+(vol.length?vol.map(x=>'<div class="acct-row"><span>'+String(x.x.s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</span><b>'+x.v.toFixed(2)+'x</b></div>').join(''):'<div class="empty">No volume spike ≥1x</div>');
  }
  function fixV2(){
    const root=document.getElementById('dd-v2');if(!root)return;
    const rows=Array.isArray(window.__DD_SCANNER_ROWS)?window.__DD_SCANNER_ROWS:[];
    const by=Object.fromEntries(rows.map(x=>[x.s,x]));
    const title=[...root.querySelectorAll('.v2-title')].find(x=>/TOP CONFIRMED CANDIDATES/i.test(x.textContent||''));if(title)title.textContent='TOP SIGNAL CANDIDATES';
    [...root.querySelectorAll('.v2-pick')].forEach(p=>{
      const coin=p.querySelector('b')?.textContent?.trim();const x=by[coin];if(!x)return;
      const d=x.signal==='BUY'||x.signal==='SELL'?x.signal:(x.momentum==='BUY'&&x.scalp==='BUY'?'BUY':x.momentum==='SELL'&&x.scalp==='SELL'?'SELL':(x.momentum!=='WAIT'?x.momentum:(x.scalp!=='WAIT'?x.scalp:'WAIT')));
      const spans=p.querySelectorAll('span');if(spans[0]){spans[0].textContent=d;spans[0].className=d==='BUY'?'buy':d==='SELL'?'sell':'wait'}
    });
  }
  function run(){try{fixKpis();fixRadar();fixV2()}catch(e){}}
  setInterval(run,900);setTimeout(run,1500);
})();
