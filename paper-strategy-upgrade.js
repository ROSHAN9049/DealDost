/* DealDost Paper Strategy Upgrade v2
 * PAPER mode only. Selective, risk-controlled Momentum + Scalping + Options.
 * No live/testnet orders are sent from this engine.
 */
(()=>{'use strict';
const PUB='/api/binance-market?path=';
const F=.0005, START=10000, MAX_MOM=3, MAX_SCALP=3, MAX_OPT=4;
const MOM_COOLDOWN=20*60e3, SCALP_COOLDOWN=10*60e3, OPT_COOLDOWN=20*60e3;
const S={equity:START,real:0,fees:0,positions:[],history:[],last:{},rows:[],opt:{contracts:[],marks:{},underlying:{},rows:[]},ready:false,timer:null,optTimer:null};
const N=x=>Number.isFinite(+x)?+x:0;
const P=x=>(N(x)>=0?'+':'')+N(x).toFixed(2)+'%';
const R=x=>N(x).toLocaleString('en-IN',{maximumFractionDigits:2});
const EMA=(a,p)=>{if(!a||a.length<p)return 0;let e=N(a[0][4]),k=2/(p+1);for(let i=1;i<a.length;i++)e=N(a[i][4])*k+e*(1-k);return e};
const RSI=(a,p=14)=>{if(!a||a.length<p+1)return 50;let g=0,l=0;for(let i=a.length-p;i<a.length;i++){let d=N(a[i][4])-N(a[i-1][4]);if(d>0)g+=d;else l-=d}return l?100-100/(1+g/l):g?100:50};
const ATR=(a,p=14)=>{if(!a||a.length<p+1)return 0;let s=0;for(let i=a.length-p;i<a.length;i++){let h=N(a[i][2]),l=N(a[i][3]),pc=N(a[i-1][4]);s+=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc))}return s/p};
const VR=a=>{if(!a||a.length<12)return 1;let b=a.slice(-11,-1).reduce((s,x)=>s+N(x[5]),0)/10;return N(a.at(-1)[5])/Math.max(b,1e-9)};
const closed=a=>Array.isArray(a)&&a.length>2?a.slice(0,-1):a||[];
const now=()=>Date.now();
async function api(path){const r=await fetch(PUB+encodeURIComponent(path),{cache:'no-store'});const t=await r.text();let j;try{j=JSON.parse(t)}catch{throw Error('Invalid market response')};if(!r.ok)throw Error(j.msg||j.error||('API '+r.status));return j}
function save(){try{localStorage.setItem('ddPaperUpgradeV2',JSON.stringify({equity:S.equity,real:S.real,fees:S.fees,positions:S.positions,history:S.history.slice(0,500),last:S.last}))}catch(e){}}
function load(){try{const q=JSON.parse(localStorage.getItem('ddPaperUpgradeV2')||'{}');S.equity=N(q.equity)||START;S.real=N(q.real);S.fees=N(q.fees);S.positions=Array.isArray(q.positions)?q.positions:[];S.history=Array.isArray(q.history)?q.history:[];S.last=q.last||{}}catch(e){}}
function canTrade(key,ms){return now()-N(S.last[key]||0)>=ms}
function exposure(){return S.positions.reduce((a,p)=>a+N(p.notional),0)}
function scoreMom(k,t){
 const m5=closed(k.m5),m15=closed(k.m15);if(m5.length<60||m15.length<60)return{side:'WAIT',score:0,why:'Warm-up'};
 const c5=m5.at(-1),c15=m15.at(-1),e9=EMA(m5,9),e21=EMA(m5,21),e20=EMA(m15,20),e50=EMA(m15,50),r=RSI(m5),v=VR(m5),atr=ATR(m5),d=(N(c5[4])-N(m5.at(-2)[4]))/Math.max(N(m5.at(-2)[4]),1e-9),ch=N(t.c),volOk=v>=1.15;
 const bull=N(c15[4])>e20&&e20>e50&&N(c5[4])>e9&&e9>e21;
 const bear=N(c15[4])<e20&&e20<e50&&N(c5[4])<e9&&e9<e21;
 let bs=0,rs=0;if(bull)bs+=35;if(bear)rs+=35;if(volOk){bs+=15;rs+=15}if(d>=.0005)bs+=15;if(d<=-.0005)rs+=15;if(r>=53&&r<=70)bs+=20;if(r<=47&&r>=30)rs+=20;if(ch>=.6)bs+=15;if(ch<=-.6)rs+=15;
 const side=bs>=80?'BUY':rs>=80?'SELL':'WAIT';return{side,score:Math.max(bs,rs),why:side==='BUY'?'15m trend + 5m EMA + volume + RSI + momentum':'15m downtrend + 5m EMA + volume + RSI + momentum',atr};
}
function scoreScalp(k,t){
 const m1=closed(k.m1),m5=closed(k.m5);if(m1.length<70||m5.length<70)return{side:'WAIT',score:0,why:'Warm-up'};
 const c1=m1.at(-1),p1=m1.at(-2),e8=EMA(m1,8),e21=EMA(m1,21),e5=EMA(m5,9),e52=EMA(m5,21),r=RSI(m1),v=VR(m1),atr=ATR(m1),ch=N(t.c),prev=m1.slice(-13,-1),hi=Math.max(...prev.map(x=>N(x[2]))),lo=Math.min(...prev.map(x=>N(x[3]))),px=N(c1[4]),body=Math.abs(N(c1[4])-N(c1[1]))/Math.max(N(c1[2])-N(c1[3]),1e-9);
 const bull5=N(m5.at(-1)[4])>e5&&e5>e52,bear5=N(m5.at(-1)[4])<e5&&e5<e52,up=px>e8&&e8>e21,down=px<e8&&e8<e21,breakUp=px>hi,breakDn=px<lo,volOk=v>=1.30,quality=body>=.35;
 let bs=0,rs=0;if(bull5)bs+=28;if(bear5)rs+=28;if(up)bs+=22;if(down)rs+=22;if(breakUp)bs+=22;if(breakDn)rs+=22;if(volOk){bs+=16;rs+=16}if(r>=53&&r<=72)bs+=10;if(r<=47&&r>=28)rs+=10;if(ch>=.35)bs+=8;if(ch<=-.35)rs+=8;if(quality){bs+=4;rs+=4}
 const side=bs>=82&&N(c1[4])>N(p1[4])?'BUY':rs>=82&&N(c1[4])<N(p1[4])?'SELL':'WAIT';return{side,score:Math.max(bs,rs),why:side==='BUY'?'5m trend + 1m EMA + closed breakout + volume':'5m trend + 1m EMA + closed breakdown + volume',atr};
}
function openFuture(x,e,side,sc){
 const max=e==='MOMENTUM'?MAX_MOM:MAX_SCALP,cd=e==='MOMENTUM'?MOM_COOLDOWN:SCALP_COOLDOWN,key=e+'_'+x.s;
 if(S.positions.filter(p=>p.engine===e).length>=max||S.positions.some(p=>p.symbol===x.s)||!canTrade(key,cd))return false;
 const stop=e==='SCALPING'?Math.min(Math.max((sc.atr||x.p*.004)/Math.max(x.p,1e-9),.004),.008):Math.min(Math.max((x.atr||x.p*.006)/Math.max(x.p,1e-9),.0055),.012);
 const risk=Math.max(S.equity*.004,5),maxNotional=Math.max(S.equity*.12,100),rawQ=risk/Math.max(x.p*stop,1e-9),q=Math.min(rawQ,maxNotional/Math.max(x.p,1e-9));if(q<=0)return false;
 const entry=x.p,sl=entry*(side==='BUY'?1-stop:1+stop),tp=entry*(side==='BUY'?1+stop*1.8:1-stop*1.8),entryFee=entry*q*F;
 S.positions.push({id:now()+Math.random(),engine:e,symbol:x.s,side,entry,current:entry,q,notional:entry*q,sl,tp,pnl:0,entryFee,fee:entryFee,opened:now(),status:'OPEN',why:sc.why});
 S.last[key]=now();S.history.unshift({time:now(),engine:e,symbol:x.s,side,action:'ENTRY',entry,qty:q,pnl:0,fees:entryFee,status:'OPEN',why:sc.why});return true;
}
function manageFutures(){
 for(const p of [...S.positions]){if(p.engine==='OPTIONS')continue;const x=S.rows.find(r=>r.s===p.symbol);if(!x)continue;p.current=x.p;const gross=p.side==='BUY'?(x.p-p.entry)*p.q:(p.entry-x.p)*p.q,exitFee=x.p*p.q*F;p.pnl=gross-p.entryFee-exitFee;const hit=p.side==='BUY'?(x.p<=p.sl||x.p>=p.tp):(x.p>=p.sl||x.p<=p.tp);if(!hit)continue;
  const net=p.pnl;S.real+=net;S.equity+=net;S.fees+=p.entryFee+exitFee;S.history.unshift({time:now(),engine:p.engine,symbol:p.symbol,side:p.side,action:'EXIT',entry:p.entry,exit:x.p,qty:p.q,pnl:net,fees:p.entryFee+exitFee,status:net>=0?'WIN':'LOSS',why:x.p>=p.tp||x.p<=p.tp?'Target/Stop':'Risk'});S.positions=S.positions.filter(q=>q.id!==p.id);
 }
}
function optionPick(u,kind){
 const all=S.opt.contracts.filter(x=>x.u===u&&x.ex>now()&&x.status==='TRADING');if(!all.length)return null;const m=S.opt.marks;
 let arr=all.filter(x=>m[x.n]&&N(m[x.n].p)>0);if(kind==='BUY_CALL')arr=arr.filter(x=>x.side==='CALL').sort((a,b)=>Math.abs(N(m[a.n].d)-.5)-Math.abs(N(m[b.n].d)-.5));
 if(kind==='BUY_PUT')arr=arr.filter(x=>x.side==='PUT').sort((a,b)=>Math.abs(N(m[a.n].d)+.5)-Math.abs(N(m[b.n].d)+.5));
 if(kind==='SELL_CALL')arr=arr.filter(x=>x.side==='CALL').sort((a,b)=>Math.abs(N(m[a.n].d)-.25)-Math.abs(N(m[b.n].d)-.25));
 if(kind==='SELL_PUT')arr=arr.filter(x=>x.side==='PUT').sort((a,b)=>Math.abs(N(m[a.n].d)+.25)-Math.abs(N(m[b.n].d)+.25));
 if(!arr[0])return null;return{contract:arr[0],mark:m[arr[0].n]};
}
function optionSignal(r){
 const c=N(r.change),v=N(r.volume);if(v<5000000)return'WAIT';
 if(c>=2.0)return'BUY_CALL';if(c>=1.2)return'SELL_PUT';if(c<=-2.0)return'BUY_PUT';if(c<=-1.2)return'SELL_CALL';return'WAIT';
}
function openOption(row,kind){
 const key='OPT_'+kind+'_'+row.u;if(S.positions.filter(p=>p.engine==='OPTIONS').length>=MAX_OPT||!canTrade(key,OPT_COOLDOWN))return false;
 if(S.positions.some(p=>p.engine==='OPTIONS'&&p.optionSet===kind&&p.symbol===row.u))return false;
 const pick=optionPick(row.u,kind);if(!pick)return false;const mk=pick.mark,entry=kind.startsWith('SELL')?(N(mk.bid)||N(mk.p)):(N(mk.ask)||N(mk.p)),unit=N(pick.contract.unit)||1;if(entry<=0||unit<=0)return false;
 const risk=Math.max(S.equity*.0075,5),maxPremium=Math.max(S.equity*.08,50),rawQty=risk/Math.max(entry*unit,.00000001),q=Math.min(rawQty,maxPremium/Math.max(entry*unit,.00000001));if(q<=0)return false;
 const fee=entry*q*unit*F;S.positions.push({id:now()+Math.random(),engine:'OPTIONS',optionSet:kind,symbol:row.u,side:kind,contract:pick.contract.n,entry,current:entry,qty:q,unit,notional:entry*q*unit,entryFee:fee,fee:fee,pnl:0,opened:now(),expiry:pick.contract.ex,status:'OPEN',why:kind+' · 24H '+P(row.change)});
 S.last[key]=now();S.history.unshift({time:now(),engine:'OPTIONS',optionSet:kind,symbol:row.u,side:kind,action:'ENTRY',entry,qty:q,fees:fee,pnl:0,status:'OPEN',contract:pick.contract.n,why:kind+' · 24H '+P(row.change)});return true;
}
function manageOptions(){
 for(const p of [...S.positions]){if(p.engine!=='OPTIONS')continue;const mk=S.opt.marks[p.contract];if(!mk)continue;const exit=p.side.startsWith('SELL')?(N(mk.ask)||N(mk.p)):(N(mk.bid)||N(mk.p));if(exit<=0)continue;p.current=exit;const mult=N(p.qty)*N(p.unit),gross=p.side.startsWith('SELL')?(p.entry-exit)*mult:(exit-p.entry)*mult,exitFee=exit*mult*F;p.pnl=gross-p.entryFee-exitFee;
  const move=p.entry?((exit-p.entry)/p.entry*(p.side.startsWith('SELL')?-1:1)):0,stop=move<=-.22,tp=move>=.40,exp=p.expiry&&now()>=p.expiry;if(!(stop||tp||exp))continue;
  const net=p.pnl;S.real+=net;S.equity+=net;S.fees+=p.entryFee+exitFee;S.history.unshift({time:now(),engine:'OPTIONS',optionSet:p.optionSet,symbol:p.symbol,side:p.side,action:'EXIT',entry:p.entry,exit,qty:p.qty,pnl:net,fees:p.entryFee+exitFee,status:net>=0?'WIN':'LOSS',contract:p.contract,why:exp?'Expiry':stop?'Premium stop':'Premium target'});S.positions=S.positions.filter(q=>q.id!==p.id);
 }
}
async function scan(){
 try{
  const ex=await api('/fapi/v1/exchangeInfo'),tt=await api('/fapi/v1/ticker/24hr');const syms=new Set((ex.symbols||[]).filter(x=>x.contractType==='PERPETUAL'&&x.quoteAsset==='USDT'&&x.status==='TRADING').map(x=>x.symbol));const tick={};(Array.isArray(tt)?tt:[]).forEach(x=>{if(syms.has(x.symbol))tick[x.symbol]={p:N(x.lastPrice),c:N(x.priceChangePercent),v:N(x.quoteVolume)}});
  const top=[...syms].filter(s=>tick[s]?.p>0).sort((a,b)=>(Math.abs(tick[b].c)*Math.log10(1+tick[b].v))-(Math.abs(tick[a].c)*Math.log10(1+tick[a].v))).slice(0,50),rows=[];
  await Promise.all(top.map(async s=>{try{const [m5,m15,m1]=await Promise.all([api('/fapi/v1/klines?symbol='+s+'&interval=5m&limit=100'),api('/fapi/v1/klines?symbol='+s+'&interval=15m&limit=100'),api('/fapi/v1/klines?symbol='+s+'&interval=1m&limit=100')]);const t=tick[s],mo=scoreMom({m5,m15},t),sc=scoreScalp({m1,m5},t);rows.push({s,p:t.p,c:t.c,v:t.v,m:mo.score,sc:sc.score,momentum:mo.side,scalp:sc.side,whyM:mo.why,whyS:sc.why,atr:sc.atr});}catch(e){}}));
  S.rows=rows.sort((a,b)=>Math.max(b.m,b.sc)-Math.max(a.m,a.sc));manageFutures();for(const x of S.rows){if(x.m>=80&&x.momentum!=='WAIT')openFuture(x,'MOMENTUM',x.momentum,{why:x.whyM,atr:ATR((S.k&&S.k[x.s]?.m5)||[])||x.atr});if(x.sc>=82&&x.scalp!=='WAIT')openFuture(x,'SCALPING',x.scalp,{why:x.whyS,atr:x.atr});}save();render();
 }catch(e){console.warn('Paper strategy v2 scan',e)}
}
async function scanOptions(){
 try{
  const e=await api('/eapi/v1/exchangeInfo');S.opt.contracts=(e.optionSymbols||[]).map(o=>{let side=String(o.side||'').toUpperCase();if(side==='C')side='CALL';if(side==='P')side='PUT';const u=String(o.underlying||String(o.symbol||'').split('-')[0]).toUpperCase();return{n:String(o.symbol||''),u:/USDT$/.test(u)?u:u+'USDT',side,k:N(o.strikePrice||o.strike),ex:N(o.expiryDate||o.expiry||o.expirationDate),unit:N(o.unit)||1,status:String(o.status||'').toUpperCase()}}).filter(x=>x.status==='TRADING');
  const m=await api('/eapi/v1/mark');S.opt.marks={};(Array.isArray(m)?m:[]).forEach(x=>S.opt.marks[x.symbol]={p:N(x.markPrice),d:N(x.delta),bid:N(x.bidPrice),ask:N(x.askPrice)});
  const f=await api('/fapi/v1/ticker/24hr');S.opt.underlying={};(Array.isArray(f)?f:[]).forEach(x=>S.opt.underlying[x.symbol]={c:N(x.priceChangePercent),v:N(x.quoteVolume),p:N(x.lastPrice)});
  S.opt.rows=Object.keys(S.opt.underlying).map(u=>{const x=S.opt.underlying[u];return{u,change:x.c,volume:x.v,p:x.p,signal:optionSignal({u,change:x.c,volume:x.v,p:x.p})}}).filter(x=>x.signal!=='WAIT'&&S.opt.contracts.some(c=>c.u===x.u&&c.ex>now())).sort((a,b)=>Math.abs(b.change)-Math.abs(a.change));
  for(const r of S.opt.rows)openOption(r,r.signal);manageOptions();save();render();
 }catch(e){console.warn('Paper option v2 scan',e)}
}
function render(){
 if(!window.DD||DD.tab!=='paper')return;const app=document.getElementById('app');if(!app)return;let host=app.querySelector('.paper-upgrade-panel');if(!host){host=document.createElement('div');host.className='paper-upgrade-panel';app.appendChild(host)}
 const m=S.positions.filter(p=>p.engine==='MOMENTUM'),sc=S.positions.filter(p=>p.engine==='SCALPING'),op=S.positions.filter(p=>p.engine==='OPTIONS');
 const unreal=a=>a.reduce((v,p)=>v+N(p.pnl),0),closedHist=e=>S.history.filter(h=>h.engine===e&&h.action==='EXIT'),wins=e=>closedHist(e).filter(h=>N(h.pnl)>0).length,loss=e=>closedHist(e).filter(h=>N(h.pnl)<0).length;
 const card=(name,arr,e)=>'<div class="acct-card"><h4>'+name+'</h4><div class="acct-row"><span>Open</span><b>'+arr.length+'</b></div><div class="acct-row"><span>Unrealized</span><b>₹'+R(unreal(arr))+'</b></div><div class="acct-row"><span>Closed W/L</span><b>'+wins(e)+' / '+loss(e)+'</b></div></div>';
 const optSets=['BUY_CALL','BUY_PUT','SELL_CALL','SELL_PUT'].map(k=>{const p=op.filter(x=>x.optionSet===k);return'<span class="tag">'+k.replace('_',' ')+' '+p.length+'</span>'}).join(' ');
 host.innerHTML='<div class="panel-header"><div class="panel-title">Paper Strategy v2 · Risk-Controlled</div><div class="panel-sub">Selective entries · closed candles · equity-based sizing</div></div><div class="acct-grid">'+card('Momentum',m,'MOMENTUM')+card('Scalping',sc,'SCALPING')+card('Options',op,'OPTIONS')+'</div><div style="margin-top:10px">'+optSets+'</div><div class="panel-sub" style="margin-top:8px">Realized ₹'+R(S.real)+' · Fees ₹'+R(S.fees)+' · Equity ₹'+R(S.equity)+' · Open trades are OPEN, not losses.</div>';
}
function boot(){load();S.ready=true;scan();scanOptions();clearInterval(S.timer);clearInterval(S.optTimer);S.timer=setInterval(scan,30000);S.optTimer=setInterval(scanOptions,45000);setInterval(()=>{manageFutures();manageOptions();save();render()},5000);render()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();