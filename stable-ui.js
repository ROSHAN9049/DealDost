/* Delta-style visual stabilizer for Binance scanner. Keeps the analysed coin list compact and colours live values. */
(function(){
  let lastHtml='';
  const $=id=>document.getElementById(id);
  const num=v=>Number(String(v??'').replace(/[^0-9.+-]/g,''))||0;
  function decorate(){
    const body=$('signals');if(!body)return;
    const rows=[...body.querySelectorAll('tr')].filter(tr=>tr.querySelector('td'));
    const search=($('search')?.value||'').trim().toUpperCase().replace('/','');
    rows.forEach(tr=>{
      const td=tr.querySelectorAll('td'),symbol=(td[0]?.textContent||'').trim();
      tr.style.display=search&&symbol.toUpperCase().indexOf(search)<0?'none':'';
      tr.classList.add('scannerRow');
      if(td[0]){const ch=num(td[2]?.textContent);td[0].classList.remove('coinUp','coinDown');td[0].classList.add(ch>=0?'coinUp':'coinDown')}
      if(td[2])td[2].classList.add(num(td[2].textContent)>=0?'up':'down');
      if(td[6]?.textContent.trim()==='LONG'||td[9]?.textContent.trim()==='LONG')tr.classList.add('rowLong');
      if(td[6]?.textContent.trim()==='SHORT'||td[9]?.textContent.trim()==='SHORT')tr.classList.add('rowShort');
    });
    const visible=rows.filter(tr=>tr.style.display!=='none');
    const info=$('scannerInfo');if(info)info.textContent=`${visible.length} coins · live Delta-style order`;
    const sc=$('signalCount');if(sc){const q=rows.filter(tr=>tr.querySelector('td:nth-child(7)')?.textContent.trim()==='LONG'||tr.querySelector('td:nth-child(7)')?.textContent.trim()==='SHORT'||tr.querySelector('td:nth-child(10)')?.textContent.trim()==='LONG'||tr.querySelector('td:nth-child(10)')?.textContent.trim()==='SHORT').length;sc.textContent=`${q} qualifying signals`}
    const table=body.closest('table');table?.classList.add('deltaCompact');
    ['SYMBOL','PRICE','24H CHANGE','VOLUME','MOMENTUM','SCORE','SIGNAL','SCALPING','SCORE','SIGNAL','SIGNAL REASON','ACTION'].forEach((x,i)=>{const h=table?.querySelectorAll('thead th')?.[i];if(h)h.textContent=x});
    colorPnl();
  }
  function colorPnl(){
    document.querySelectorAll('#momentumPositions td,#scalpPositions td,#trades td,#netPnl,#avgPnl').forEach(el=>{
      if(!/₹/.test(el.textContent))return;const v=num(el.textContent);el.classList.remove('pnlPositive','pnlNegative','pnlZero');el.classList.add(v>0?'pnlPositive':v<0?'pnlNegative':'pnlZero');
    });
    document.querySelectorAll('#momentumPositions tr,#scalpPositions tr').forEach(tr=>{
      const side=tr.querySelector('td:nth-child(2)')?.textContent.trim(),coin=tr.querySelector('td:first-child');
      if(coin)coin.classList.add(side==='LONG'?'coinLong':side==='SHORT'?'coinShort':'');
    });
  }
  function observe(){const body=$('signals');if(!body)return false;new MutationObserver(()=>{if(body.innerHTML!==lastHtml){lastHtml=body.innerHTML;requestAnimationFrame(decorate)}else{colorPnl()}}).observe(body,{childList:true,subtree:true});decorate();return true}
  if(!observe()){const t=setInterval(()=>{if(observe())clearInterval(t)},100)}
  $('search')?.addEventListener('input',()=>requestAnimationFrame(decorate));
})();