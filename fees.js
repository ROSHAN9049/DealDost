(function(){'use strict';
var RATE=0.0005, KEY='bd-fee-ledger-v2';
function n(x){x=Number(x);return isFinite(x)?x:0}
function load(){try{return JSON.parse(localStorage.getItem(KEY)||'{"trades":{},"closed":{},"fees":0}') }catch(e){return{trades:{},closed:{},fees:0}}}
function save(x){try{localStorage.setItem(KEY,JSON.stringify(x))}catch(e){}}
function notional(p,price){return Math.abs(n(price)*n(p&&p.qty))}
function intercept(){
 var original=localStorage.setItem.bind(localStorage);
 if(localStorage.__bdFeePatched)return;
 localStorage.__bdFeePatched=true;
 localStorage.setItem=function(k,v){
  if(k!=='bd-v5'){original(k,v);return}
  try{
   var d=JSON.parse(v), l=load(), positions=Array.isArray(d.positions)?d.positions:[], history=Array.isArray(d.history)?d.history:[];
   positions.forEach(function(p){var id=String(p.id);if(!l.trades[id]){var ef=notional(p,p.entry)*RATE;l.trades[id]={id:id,symbol:p.symbol,engine:p.engine,entry:n(p.entry),qty:n(p.qty),entryFee:ef,opened:p.opened||Date.now()};l.fees+=ef;d.equity-=ef;}});
   history.forEach(function(h){var key=String(h.time)+'|'+String(h.symbol)+'|'+String(h.engine)+'|'+String(h.entry)+'|'+String(h.exit);if(l.closed[key])return;var match=null,ObjectKeys=Object.keys(l.trades);for(var i=0;i<ObjectKeys.length;i++){var t=l.trades[ObjectKeys[i]];if(t.symbol===h.symbol&&t.engine===h.engine&&Math.abs(n(t.entry)-n(h.entry))<1e-9){match=t;break}}
    var qty=match?n(match.qty):0, xf=qty?Math.abs(n(h.exit)*qty)*RATE:0, ef=match?n(match.entryFee):0;
    l.fees+=xf;d.equity-=xf;d.realized-=ef+xf;l.closed[key]=1;if(match)delete l.trades[match.id];
   });
   save(l); original(k,JSON.stringify(d));
  }catch(e){original(k,v)}
 };
}
function money(x){return '₹'+n(x).toLocaleString('en-IN',{maximumFractionDigits:2})}
function paint(){try{
 var d=JSON.parse(localStorage.getItem('bd-v5')||'{}'),l=load(),pos=Array.isArray(d.positions)?d.positions:[], openFee=pos.reduce(function(s,p){return s+notional(p,p.current||p.entry)*RATE},0),netOpen=pos.reduce(function(s,p){return s+n(p.pnl)},0)-openFee;
 var m=document.querySelectorAll('.grid .metric');if(m.length>=3){m[0].textContent=money(n(d.equity)+netOpen);m[1].textContent=money(n(d.realized));m[2].textContent=money(netOpen)}
 var old=document.getElementById('bd-fee-badge');if(!old){old=document.createElement('div');old.id='bd-fee-badge';old.style.cssText='margin:8px 0;padding:8px 10px;background:#111d2c;border:1px solid #263b55;border-radius:9px;color:#9fb0c4;font-size:12px';var app=document.getElementById('app');if(app)app.prepend(old)}
 old.innerHTML='<b style="color:#e8eef8">BINANCE FEE SIM</b> · Taker 0.05%/side · Fees charged: <b style="color:#ffcf66">'+money(l.fees)+'</b> · Open estimated exit fees: '+money(openFee);
 }catch(e){}}
intercept();setInterval(paint,700);paint();
})();
