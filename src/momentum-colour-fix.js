const STYLE_ID='momentum-direction-colours-v1';
function ensureStyle(){
  if(document.getElementById(STYLE_ID))return;
  const s=document.createElement('style');s.id=STYLE_ID;s.textContent=`
    .momentum-bullish{color:#00ff9d!important;background:rgba(0,255,157,.14)!important;border:1px solid rgba(0,255,157,.45);font-weight:900!important;text-shadow:0 0 8px rgba(0,255,157,.55)}
    .momentum-bearish{color:#ff5b78!important;background:rgba(255,23,79,.14)!important;border:1px solid rgba(255,23,79,.45);font-weight:900!important;text-shadow:0 0 8px rgba(255,23,79,.45)}
    .momentum-wait{color:#c9d1dc!important;background:rgba(255,255,255,.06)!important;font-weight:700!important}
    .momentum-signal-buy{color:#001b10!important;background:linear-gradient(135deg,#00d984,#00ffae)!important;font-weight:900!important;border-radius:8px;padding:4px 9px;box-shadow:0 0 18px rgba(0,255,174,.55)}
    .momentum-signal-sell{color:#fff!important;background:linear-gradient(135deg,#ff174f,#ff003c)!important;font-weight:900!important;border-radius:8px;padding:4px 9px;box-shadow:0 0 18px rgba(255,23,79,.55)}
    .momentum-signal-watch{color:#fff!important;font-weight:800!important}
  `;document.head.appendChild(s)
}
function paint(){
  ensureStyle();
  document.querySelectorAll('.scanner-panel tbody tr').forEach(row=>{
    const cells=row.querySelectorAll('td');
    [cells[5],cells[6]].forEach(cell=>{
      if(!cell)return;
      const text=(cell.textContent||'').trim().toUpperCase();
      cell.classList.remove('momentum-bullish','momentum-bearish','momentum-wait');
      if(text.includes('BULLISH'))cell.classList.add('momentum-bullish');
      else if(text.includes('BEARISH'))cell.classList.add('momentum-bearish');
      else cell.classList.add('momentum-wait');
    });
    const signal=cells[9];
    if(signal){
      const text=(signal.textContent||'').toUpperCase();
      signal.classList.remove('momentum-signal-buy','momentum-signal-sell','momentum-signal-watch');
      if(text.includes('BUY'))signal.classList.add('momentum-signal-buy');
      else if(text.includes('SELL'))signal.classList.add('momentum-signal-sell');
      else signal.classList.add('momentum-signal-watch');
    }
  });
}
paint();setInterval(paint,1000);
