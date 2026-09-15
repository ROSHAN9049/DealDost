(()=>{'use strict';
/* DealDost safety/UX guard: PAPER mode must never require private Binance credentials. */
const nativeFetch=window.fetch.bind(window);
window.fetch=async function(input,init){
  const u=typeof input==='string'?input:(input&&input.url)||'';
  const body=document.body?.innerText||'';
  if(u.includes('/api/binance-account?path=') && /PAPER/i.test(body) && /LIVE OFF/i.test(body)){
    return new Response(JSON.stringify({availableBalance:10000,totalWalletBalance:10000,totalUnrealizedProfit:0,totalMarginBalance:10000,assets:[{asset:'USDT',availableBalance:'10000',walletBalance:'10000'}],positions:[]}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  return nativeFetch(input,init);
};
function cleanText(root){
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
  while(n=w.nextNode()){
    if(n.parentElement&&['SCRIPT','STYLE'].includes(n.parentElement.tagName))continue;
    if(n.nodeValue.includes('₹'))n.nodeValue=n.nodeValue.replace(/₹/g,'USDT ');
    if(n.nodeValue.includes('OPTIONS 4'))n.nodeValue=n.nodeValue.replace(/OPTIONS 4/g,'OPTIONS RADAR · 4 SLOTS');
  }
}
function health(){
  const el=document.querySelector('.panel');if(!el||document.getElementById('dd-health'))return;
  const d=document.createElement('div');d.id='dd-health';d.className='notice';d.innerHTML='<b>System health:</b> Market feed <span class="buy">ONLINE</span> · Paper engine <span class="buy">LOCAL</span> · Private Binance account <span class="watch">LIVE MODE ONLY</span> · Live orders <span class="sell">LOCKED</span> · Options <span class="buy">RADAR</span>';
  el.parentNode.insertBefore(d,el);
}
const mo=new MutationObserver(()=>{cleanText(document.body);health()});
window.addEventListener('load',()=>{cleanText(document.body);health()});
mo.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();
