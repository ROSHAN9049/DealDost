/*
 * DealDost Professional Trading Terminal
 * Preserves all trading logic from app-scanner-v3.js
 * Adds: 16 navigation sections, mode isolation (PAPER/TESTNET/LIVE),
 * per-engine accounts, PNL dashboard, analytics, charts, filters, mobile bottom nav
 */
(()=>{'use strict';

/* ===== Constants (preserved from scanner-v3) ===== */
const PUB='/api/binance-market?path=',AC='/api/binance-account?path=',TR='/api/binance-trade',
  TN_AC='/api/binance-testnet-account?path=',TN_TR='/api/binance-testnet-trade',TN_STATUS='/api/binance-testnet-status',
  F=.0005,MC=3,SC=3,OC=4,COOLDOWN=5*60e3;
const NAV=['dashboard','momentum','momentum-history','scalping','scalping-history','options','options-history','positions','trade-history','pnl','paper','testnet','live','analytics','settings'];
const NAV_LABELS={'dashboard':'Dashboard','momentum':'Momentum','momentum-history':'Mom History','scalping':'Scalping','scalping-history':'Scalp History','options':'Options','options-history':'Opt History','positions':'Positions','trade-history':'Trade History','pnl':'PNL','paper':'Paper Trading','testnet':'Testnet','live':'Live Trading','analytics':'Analytics','settings':'Settings'};
const BOTTOM_NAV=['dashboard','momentum','scalping','options','positions','pnl','analytics','settings'];
const BN_ICONS={'dashboard':'⌂','momentum':'M','scalping':'S','options':'O','positions':'P','pnl':'$','analytics':'A','settings':'⚙'};

/* ===== State ===== */
const S={
  mode:(localStorage.getItem('ddMode')||'PAPER'),
  auto:true,liveAuto:false,
  tab:'dashboard',
  wsStatus:'connecting',ws:null,wsTimer:null,
  t:{},rows:[],k:{},universe:[],
  pos:[],hist:[],eq:10000,real:0,fees:0,
  account:null,testnetAccount:null,testnetStatus:null,
  err:'',lastScan:0,lastAccount:0,lastWsMsg:0,lastTrade:{},busy:false,
  optData:{contracts:[],marks:{},underlying:{},rows:[]},optLoading:false,optView:'',
  scanTimer:null,manageTimer:null,optTimer:null,
  settings:JSON.parse(localStorage.getItem('ddSettings')||'{}'),
  filterCoin:'',filterMode:'',filterStrategy:'',filterResult:'',filterDate:''
};
if(!S.settings.coinCount)S.settings.coinCount=50;
if(!S.settings.scanInterval)S.settings.scanInterval=30;
if(!S.settings.paperCapital)S.settings.paperCapital=10000;
if(!S.settings.slippage)S.settings.slippage=0.0003;

/* ===== Helpers ===== */
const N=x=>Number.isFinite(+x)?+x:0;
const R=x=>N(x).toLocaleString('en-IN',{maximumFractionDigits:2});
const P=x=>(N(x)>=0?'+':'')+N(x).toFixed(2)+'%';
const PNL=x=>{const v=N(x);return(v>=0?'+':'')+v.toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2})};
const cl=x=>N(x)>=0?'buy':'sell';
const E=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmtPrice(x){x=N(x);if(x===0)return'—';if(x>=1000)return x.toLocaleString('en-IN',{maximumFractionDigits:2});if(x>=1)return x.toFixed(4);if(x>=0.01)return x.toFixed(5);return x.toFixed(8)}
function fmtQty(x){x=N(x);if(x===0)return'0';if(x>=1000)return R(x);if(x>=1)return x.toFixed(4);return x.toFixed(6)}

/* ===== Indicators (PRESERVED from scanner-v3) ===== */
function EMA(a,p){if(!a||a.length<p)return 0;let e=N(a[0][4]),k=2/(p+1);for(let i=1;i<a.length;i++)e=N(a[i][4])*k+e*(1-k);return e}
function RSI(a,p=14){if(!a||a.length<p+1)return 50;let g=0,l=0;for(let i=a.length-p;i<a.length;i++){let d=N(a[i][4])-N(a[i-1][4]);if(d>0)g+=d;else l-=d}return l?100-100/(1+g/l):g?100:50}
function ATR(a,p=14){if(!a||a.length<p+1)return 0;let s=0;for(let i=a.length-p;i<a.length;i++){let h=N(a[i][2]),l=N(a[i][3]),pc=N(a[i-1][4]);s+=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc))}return s/p}
function VR(a){if(!a||a.length<12)return 1;let b=a.slice(-11,-1).reduce((s,x)=>s+N(x[5]),0)/10;return N(a.at(-1)[5])/Math.max(b,1e-9)}
function closed(a){return Array.isArray(a)&&a.length>2?a.slice(0,-1):a||[]}

/* ===== API ===== */
async function api(base,path){
  const r=await fetch(base+encodeURIComponent(path),{cache:'no-store'});
  const t=await r.text();
  let j;try{j=JSON.parse(t)}catch{throw Error('Invalid Binance response '+r.status)}
  if(!r.ok)throw Error(j.msg||j.error||'Binance API '+r.status);
  return j;
}

/* ===== Storage with mode isolation ===== */
function storageKey(){return 'ddv5_'+S.mode}
function save(){
  try{
    localStorage[storageKey()]=JSON.stringify({pos:S.pos,hist:S.hist.slice(0,500),eq:S.eq,real:S.real,fees:S.fees,lastTrade:S.lastTrade});
    localStorage.setItem('ddSettings',JSON.stringify(S.settings));
  }catch(e){}
}
function load(){
  try{
    const q=JSON.parse(localStorage[storageKey()]||'{}');
    S.pos=q.pos||[];S.hist=q.hist||[];
    S.eq=N(q.eq)||(S.mode==='PAPER'?N(S.settings.paperCapital)||10000:10000);
    S.real=N(q.real);S.fees=N(q.fees);S.lastTrade=q.lastTrade||{};
  }catch(e){}
}

/* ===== Trading Calculations (PRESERVED from scanner-v3) ===== */
function calc(s){
  const t=S.t[s]||{},k=S.k[s]||{},m5=closed(k.m5),m15=closed(k.m15),m1=closed(k.m1),
    c5=m5.map(x=>N(x[4])),c15=m15.map(x=>N(x[4])),c1=m1.map(x=>N(x[4]));
  let mom='WAIT',scalp='WAIT',ms=0,ss=0,atr=ATR(m5),mr=[],sr=[];
  let support=0,resistance=0;
  if(m5.length>=10){const rc=m5.slice(-20);support=Math.min(...rc.map(x=>N(x[3])));resistance=Math.max(...rc.map(x=>N(x[2])))}
  if(c5.length>=35&&c15.length>=35){
    const e9=EMA(m5,9),e21=EMA(m5,21),e50=EMA(m15,50),r=RSI(m5),v=VR(m5),
      d=(c5.at(-1)-c5.at(-2))/Math.max(c5.at(-2),1e-9),
      bull=c5.at(-1)>e9&&e9>e21&&c15.at(-1)>e50,
      bear=c5.at(-1)<e9&&e9<e21&&c15.at(-1)<e50;
    ms=Math.min(100,Math.round((bull||bear?28:0)+(v>=1.15?22:Math.min(v*14,14))+(Math.abs(d)>=.0005?18:Math.min(Math.abs(d)*18000,12))+(r>=52&&r<=74?17:r<=48&&r>=26?17:8)+(Math.abs(t.c)>=.5?15:Math.min(Math.abs(t.c)*10,10))));
    if(bull&&r>=52&&r<=76&&d>0&&t.c>=0&&v>=1.15){mom='BUY';mr=['15m bullish','5m EMA9>EMA21','RSI '+r.toFixed(0),'vol '+v.toFixed(2)+'x']}
    if(bear&&r<=48&&r>=24&&d<0&&t.c<=0&&v>=1.15){mom='SELL';mr=['15m bearish','5m EMA9<EMA21','RSI '+r.toFixed(0),'vol '+v.toFixed(2)+'x']}
  }
  if(c1.length>=35&&c5.length>=35){
    const e1=EMA(m1,9),e12=EMA(m1,21),e5=EMA(m5,9),e52=EMA(m5,21),r=RSI(m1),v=VR(m1),
      d=(c1.at(-1)-c1.at(-2))/Math.max(c1.at(-2),1e-9),
      bull=c5.at(-1)>e5&&e5>e52,bear=c5.at(-1)<e5&&e5<e52;
    ss=Math.min(100,Math.round((bull||bear?25:0)+(v>=1.1?22:Math.min(v*14,14))+(Math.abs(d)>=.0007?20:Math.min(Math.abs(d)*15000,14))+(r>=51&&r<=82?18:r<=49&&r>=18?18:8)+(Math.abs(t.c)>=.3?15:Math.min(Math.abs(t.c)*12,12))));
    if(bull&&c1.at(-1)>e1&&e1>e12&&d>0&&r>=51&&r<=84&&v>=1.1&&t.c>=0){scalp='BUY';sr=['5m bullish','1m EMA9>EMA21','RSI '+r.toFixed(0),'vol '+v.toFixed(2)+'x']}
    if(bear&&c1.at(-1)<e1&&e1<e12&&d<0&&r<=49&&r>=16&&v>=1.1&&t.c<=0){scalp='SELL';sr=['5m bearish','1m EMA9<EMA21','RSI '+r.toFixed(0),'vol '+v.toFixed(2)+'x']}
  }
  const trend=mom==='BUY'?'BULLISH':mom==='SELL'?'BEARISH':scalp==='BUY'?'BULLISH':scalp==='SELL'?'BEARISH':'NEUTRAL';
  return{s,p:N(t.p),c:N(t.c),v:N(t.v),m:ms,sc:ss,momentum:mom,scalp,atr,funding:N(t.funding),oi:N(t.oi),support,resistance,trend,
    reasons:(mr.length?mr:sr.length?sr:['Waiting for closed-candle confirmation']).join(' · ')};
}
function signal(x,e){return e==='MOMENTUM'?x.momentum:x.scalp}
function riskModel(x,e,equity){
  const raw=(x.atr||x.p*.006)/Math.max(x.p,1e-9),
    stop=Math.min(Math.max(raw*(e==='SCALPING'?.8:1.05),e==='SCALPING'?.003:.0045),e==='SCALPING'?.009:.012),
    risk=Math.max(N(equity)*.005,1),q=risk/Math.max(x.p*stop,1e-9);
  return{stop,risk,q};
}
function canOpen(x,e){
  if(!x||!x.p||signal(x,e)==='WAIT')return false;
  if(S.pos.some(p=>p.s===x.s))return false;
  if(S.pos.filter(p=>p.e===e).length>=(e==='MOMENTUM'?MC:SC))return false;
  return Date.now()-N(S.lastTrade[x.s]||0)>=COOLDOWN;
}

/* ===== Paper/Testnet/Live entry (preserved logic) ===== */
function paperOpen(x,e){
  if(!['PAPER','TESTNET'].includes(S.mode)||!canOpen(x,e))return false;
  const z=signal(x,e),r=riskModel(x,e,S.eq),ef=x.p*r.q*F;
  if(!Number.isFinite(r.q)||r.q<=0)return false;
  const slip=x.p*S.settings.slippage;
  const entryPx=x.p+(z==='BUY'?slip:-slip);
  S.pos.push({id:Date.now()+Math.random(),s:x.s,e,side:z,entry:entryPx,current:x.p,q:r.q,
    sl:z==='BUY'?entryPx*(1-r.stop):entryPx*(1+r.stop),tp:z==='BUY'?entryPx*(1+2*r.stop):entryPx*(1-2*r.stop),
    entryFee:ef,pnl:-ef,feeRate:F,mode:S.mode,reason:x.reasons,opened:Date.now()});
  S.lastTrade[x.s]=Date.now();
  S.hist.unshift({time:Date.now(),s:x.s,e,side:z,action:'ENTRY',price:entryPx,qty:r.q,pnl:0,fees:ef,live:S.mode==='LIVE',mode:S.mode,reason:x.reasons});
  save();return true;
}
async function testnetOpen(x,e){
  if(S.mode!=='TESTNET'||!canOpen(x,e))return false;
  const z=signal(x,e),r=riskModel(x,e,N(S.testnetAccount?.availableBalance)||S.eq);
  if(!Number.isFinite(r.q)||r.q<=0)return false;
  try{
    const resp=await fetch(TN_TR,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'order',symbol:x.s,side:z,quantity:r.q,type:'MARKET',stopPct:r.stop})});
    const j=await resp.json();if(!resp.ok)throw Error(j.error||'Testnet order failed');
    const ent=j.entry||j,fillPx=N(ent.avgPrice)||x.p;
    S.pos.push({id:'tn-'+Date.now(),s:x.s,e,side:z,entry:fillPx,current:fillPx,q:N(j.quantity)||r.q,
      sl:z==='BUY'?fillPx*(1-r.stop):fillPx*(1+r.stop),tp:z==='BUY'?fillPx*(1+2*r.stop):fillPx*(1-2*r.stop),
      entryFee:0,pnl:0,feeRate:F,mode:'TESTNET',orderId:ent.orderId,reason:x.reasons,opened:Date.now()});
    S.lastTrade[x.s]=Date.now();
    S.hist.unshift({time:Date.now(),s:x.s,e,side:z,action:'ENTRY',price:fillPx,qty:N(j.quantity)||r.q,pnl:0,fees:0,live:true,mode:'TESTNET',reason:x.reasons});
    await syncTestnet();save();return true;
  }catch(err){S.err='TESTNET: '+err.message;return false}
}
async function liveOpen(x,e){
  if(S.mode!=='LIVE'||!S.liveAuto||!canOpen(x,e))return false;
  const z=signal(x,e),r=riskModel(x,e,N(S.account?.availableBalance));
  if(!Number.isFinite(r.q)||r.q<=0)return false;
  try{
    const resp=await fetch(TR,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'order',symbol:x.s,side:z==='BUY'?'BUY':'SELL',quantity:r.q,type:'MARKET',price:x.p,stopPct:r.stop})});
    const j=await resp.json();if(!resp.ok)throw Error(j.error||'Live order failed');
    const ent=j.entry||j;
    S.hist.unshift({time:Date.now(),s:x.s,e,side:z,action:'ENTRY',orderId:ent.orderId,price:N(ent.avgPrice)||x.p,qty:r.q,pnl:0,fees:0,live:true,mode:'LIVE',reason:x.reasons});
    S.lastTrade[x.s]=Date.now();await syncAccount();save();return true;
  }catch(err){S.err='LIVE: '+err.message;return false}
}

/* ===== Engine (preserved, extended for mode dispatch) ===== */
function engine(){
  if(!S.auto)return;
  const arr=S.rows.filter(x=>x.m>=65||x.sc>=65).sort((a,b)=>Math.max(b.m,b.sc)-Math.max(a.m,a.sc));
  for(const x of arr){
    if(S.mode==='PAPER'){
      if(x.m>=65&&S.pos.filter(p=>p.e==='MOMENTUM').length<MC)paperOpen(x,'MOMENTUM');
      if(x.sc>=65&&S.pos.filter(p=>p.e==='SCALPING').length<SC)paperOpen(x,'SCALPING');
    }else if(S.mode==='TESTNET'){
      if(x.m>=65&&S.pos.filter(p=>p.e==='MOMENTUM').length<MC)testnetOpen(x,'MOMENTUM');
      if(x.sc>=65&&S.pos.filter(p=>p.e==='SCALPING').length<SC)testnetOpen(x,'SCALPING');
    }else if(S.mode==='LIVE'&&S.liveAuto){
      if(x.m>=78&&S.pos.filter(p=>p.e==='MOMENTUM').length<MC)liveOpen(x,'MOMENTUM');
      if(x.sc>=78&&S.pos.filter(p=>p.e==='SCALPING').length<SC)liveOpen(x,'SCALPING');
    }
  }
}

/* ===== Position management (preserved) ===== */
function managePaper(){
  for(const p of [...S.pos]){
    if(p.mode==='LIVE')continue;
    if(p.mode==='TESTNET'&&p.orderId)continue;
    const x=N(S.t[p.s]?.p);if(!x)continue;
    p.current=x;
    const gross=p.side==='BUY'?(x-p.entry)*p.q:(p.entry-x)*p.q,ef=x*p.q*F;
    p.pnl=gross-p.entryFee-ef;
    const hit=p.side==='BUY'?(x<=p.sl||x>=p.tp):(x>=p.sl||x<=p.tp);
    if(hit){
      S.real+=p.pnl;S.eq+=p.pnl;S.fees+=p.entryFee+ef;
      S.hist.unshift({time:Date.now(),s:p.s,e:p.e,side:p.side,action:'EXIT',entry:p.entry,exit:x,pnl:p.pnl,fees:p.entryFee+ef,live:p.mode==='LIVE',mode:p.mode,reason:p.reason});
      S.lastTrade[p.s]=Date.now();S.pos=S.pos.filter(q=>q.id!==p.id);save();
    }
  }
}

/* ===== Account sync ===== */
async function syncAccount(){
  if(S.mode!=='LIVE')return;
  if(Date.now()-S.lastAccount<2500)return;
  S.lastAccount=Date.now();
  try{
    const a=await api(AC,'/fapi/v2/account');const bal=(a.assets||[]).find(x=>x.asset==='USDT');
    S.account={availableBalance:N(a.availableBalance||bal?.availableBalance),walletBalance:N(a.totalWalletBalance||bal?.walletBalance),unrealized:N(a.totalUnrealizedProfit),margin:N(a.totalMarginBalance)};
    if(S.mode==='LIVE')S.pos=(a.positions||[]).filter(p=>Math.abs(N(p.positionAmt))>0).map(p=>({id:'live-'+p.symbol,s:p.symbol,e:'LIVE',side:N(p.positionAmt)>0?'BUY':'SELL',entry:N(p.entryPrice),current:N(p.markPrice),q:Math.abs(N(p.positionAmt)),pnl:N(p.unRealizedProfit),sl:0,tp:0,mode:'LIVE'}));
  }catch(e){S.err='Account sync: '+e.message}
}
async function syncTestnet(){
  if(S.mode!=='TESTNET')return;
  try{
    const a=await api(TN_AC,'/fapi/v2/account');const bal=(a.assets||[]).find(x=>x.asset==='USDT');
    S.testnetAccount={availableBalance:N(a.availableBalance||bal?.availableBalance),walletBalance:N(a.totalWalletBalance||bal?.walletBalance),unrealized:N(a.totalUnrealizedProfit),margin:N(a.totalMarginBalance)};
  }catch(e){S.err='Testnet sync: '+e.message}
}
async function checkTestnetStatus(){
  try{const r=await fetch(TN_STATUS,{cache:'no-store'});if(r.ok)S.testnetStatus=await r.json()}catch(e){S.testnetStatus=null}
}

/* ===== Scanner (preserved, ranking by absolute 24h change) ===== */
async function scan(){
  if(S.busy)return;S.busy=true;
  try{
    const ex=await api(PUB,'/fapi/v1/exchangeInfo'),tt=await api(PUB,'/fapi/v1/ticker/24hr');
    const syms=new Set((ex.symbols||[]).filter(x=>x.contractType==='PERPETUAL'&&x.quoteAsset==='USDT'&&x.status==='TRADING').map(x=>x.symbol));
    (Array.isArray(tt)?tt:[]).forEach(x=>{if(syms.has(x.symbol))S.t[x.symbol]={p:N(x.lastPrice),c:N(x.priceChangePercent),v:N(x.quoteVolume)}});
    // Sort by absolute 24h change descending
    const top=[...syms].sort((a,b)=>Math.abs(N(S.t[b]?.c))-Math.abs(N(S.t[a]?.c))).slice(0,N(S.settings.coinCount)||50);
    S.universe=top;
    S.rows=top.map(s=>({s,p:N(S.t[s]?.p),c:N(S.t[s]?.c),v:N(S.t[s]?.v),m:0,sc:0,momentum:'WAIT',scalp:'WAIT',atr:0,support:0,resistance:0,trend:'NEUTRAL',funding:0,reasons:'Loading'}));
    await Promise.all(top.map(async s=>{
      try{
        const [m5,m15,m1,fr,oi]=await Promise.all([
          api(PUB,'/fapi/v1/klines?symbol='+s+'&interval=5m&limit=100'),
          api(PUB,'/fapi/v1/klines?symbol='+s+'&interval=15m&limit=100'),
          api(PUB,'/fapi/v1/klines?symbol='+s+'&interval=1m&limit=100'),
          api(PUB,'/fapi/v1/premiumIndex?symbol='+s).catch(()=>({})),
          api(PUB,'/fapi/v1/openInterest?symbol='+s).catch(()=>({}))
        ]);
        S.k[s]={m5,m15,m1};
        if(S.t[s]){S.t[s].funding=N(fr.lastFundingRate)*100;S.t[s].oi=N(oi.openInterest)}
        const r=calc(s),i=S.rows.findIndex(x=>x.s===s);if(i>=0)S.rows[i]=r;
      }catch(e){const i=S.rows.findIndex(x=>x.s===s);if(i>=0)S.rows[i].reasons='Feed unavailable'}
    }));
    S.lastScan=Date.now();S.err='';
    await syncAccount();await syncTestnet();
    managePaper();engine();render();
  }catch(e){S.err='Market scan: '+e.message;render()}
  finally{S.busy=false}
}

/* ===== WebSocket (dedup guard) ===== */
function connectWS(){
  if(S.ws){try{S.ws.close()}catch(e){}}
  try{
    S.ws=new WebSocket('wss://fstream.binance.com/stream');
    S.wsStatus='connecting';
    S.ws.onopen=()=>{S.wsStatus='online';S.lastWsMsg=Date.now();S.ws.send(JSON.stringify({method:'SUBSCRIBE',params:['!ticker@arr'],id:1}));render()};
    S.ws.onmessage=ev=>{
      try{
        S.lastWsMsg=Date.now();S.wsStatus='online';
        const z=JSON.parse(ev.data),a=Array.isArray(z)?z:(z.data||[]);
        a.forEach(x=>{if(x&&x.s&&S.t[x.s])S.t[x.s]={p:N(x.c),c:N(x.P),v:N(x.q)}});
        managePaper();
        if(['dashboard','momentum','scalping','positions'].includes(S.tab))renderThrottled();
      }catch(e){}
    };
    S.ws.onclose=()=>{S.wsStatus='offline';render();if(S.wsTimer)clearTimeout(S.wsTimer);S.wsTimer=setTimeout(connectWS,4000)};
    S.ws.onerror=()=>{try{S.ws.close()}catch(e){}};
  }catch(e){S.wsStatus='offline';if(S.wsTimer)clearTimeout(S.wsTimer);S.wsTimer=setTimeout(connectWS,4000)}
}

/* ===== Options (preserved from options-fix.js, integrated) ===== */
async function scanOptions(){
  if(S.optLoading)return;S.optLoading=true;
  try{
    const e=await api(PUB,'/eapi/v1/exchangeInfo');
    const raw=(e.optionSymbols||[]).map(o=>{
      const n=String(o.symbol||''),u=String(o.underlying||n.split('-')[0]).toUpperCase();
      const uu=/USDT$/.test(u)?u:u+'USDT';
      let side=String(o.side||'').toUpperCase();if(side==='C')side='CALL';if(side==='P')side='PUT';
      return{n,u:uu,side,k:N(o.strikePrice||o.strike),ex:N(o.expiryDate||o.expiry||o.expirationDate),status:String(o.status||'').toUpperCase()};
    });
    S.optData.contracts=raw.filter(x=>x.status==='TRADING');
    const m=await api(PUB,'/eapi/v1/mark');S.optData.marks={};
    (Array.isArray(m)?m:[]).forEach(x=>{S.optData.marks[x.symbol]={p:N(x.markPrice),d:N(x.delta),iv:N(x.markIV),g:N(x.gamma),t:N(x.theta),ve:N(x.vega),bid:N(x.bidPrice),ask:N(x.askPrice),oi:N(x.openInterest)||0,vol:N(x.volume)||0}});
    const f=await api(PUB,'/fapi/v1/ticker/24hr');S.optData.underlying={};
    (Array.isArray(f)?f:[]).forEach(x=>{S.optData.underlying[x.symbol]={c:N(x.priceChangePercent),v:N(x.quoteVolume),p:N(x.lastPrice)}});
    buildOptions();
    if(['options','options-history'].includes(S.tab))render();
  }catch(e){}
  finally{S.optLoading=false}
}
function buildOptions(){
  const g={};
  S.optData.contracts.forEach(x=>{if(x.ex>Date.now()&&S.optData.marks[x.n]&&S.optData.marks[x.n].p>0)g[x.u]=1});
  S.optData.rows=Object.keys(g).map(u=>{
    const all=S.optData.contracts.filter(x=>x.u===u&&x.ex>Date.now());
    const near=all.slice().sort((a,b)=>a.ex-b.ex)[0];
    const u24=S.optData.underlying[u];const ch=N(u24?.c),v=N(u24?.v);
    const sig=ch>=2&&v>1000000?'BUY':ch<=-2&&v>1000000?'SELL':'WATCH';
    return{u,count:all.length,expiry:near?near.ex:0,signal:sig,change:ch,volume:v,contracts:all};
  }).sort((a,b)=>Math.abs(b.change)-Math.abs(a.change));
}
function optChainData(u){
  const all=S.optData.contracts.filter(x=>x.u===u&&x.ex>Date.now());if(!all.length)return null;
  const exs={};all.forEach(x=>{(exs[x.ex]||(exs[x.ex]=[])).push(x)});
  const ex=Object.keys(exs).map(Number).sort((a,b)=>a-b)[0];const a=exs[ex]||[];
  const calls=a.filter(x=>x.side==='CALL').sort((x,y)=>x.k-y.k);
  const puts=a.filter(x=>x.side==='PUT').sort((x,y)=>y.k-x.k);
  const strikes=[...new Set(a.map(x=>x.k))].sort((a,b)=>a-b);
  return{calls,puts,strikes,expiry:ex};
}

/* ===== PNL / Analytics ===== */
function statsFor(histArr){
  const exits=histArr.filter(h=>h.action==='EXIT');
  const wins=exits.filter(h=>N(h.pnl)>0),losses=exits.filter(h=>N(h.pnl)<0);
  const totalPnl=exits.reduce((s,h)=>s+N(h.pnl),0),totalFees=exits.reduce((s,h)=>s+N(h.fees),0);
  const winRate=exits.length?wins.length/exits.length*100:0;
  const avgWin=wins.length?wins.reduce((s,h)=>s+N(h.pnl),0)/wins.length:0;
  const avgLoss=losses.length?losses.reduce((s,h)=>s+N(h.pnl),0)/losses.length:0;
  const profitFactor=avgLoss?Math.abs(avgWin*wins.length/(avgLoss*losses.length)):0;
  let peak=0,dd=0,cum=0;
  exits.forEach(h=>{cum+=N(h.pnl);peak=Math.max(peak,cum);dd=Math.max(dd,peak-cum)});
  return{trades:exits.length,wins:wins.length,losses:losses.length,winRate,totalPnl,totalFees,netPnl:totalPnl-totalFees,avgWin,avgLoss,profitFactor,maxDD:dd};
}
function dailyPnl(histArr){
  const days={};histArr.filter(h=>h.action==='EXIT').forEach(h=>{const d=new Date(N(h.time)).toDateString();days[d]=(days[d]||0)+N(h.pnl)-N(h.fees)});return days;
}
function equityCurve(histArr,startEq){
  const exits=histArr.filter(h=>h.action==='EXIT').reverse();let eq=N(startEq);const pts=[eq];
  exits.forEach(h=>{eq+=N(h.pnl)-N(h.fees);pts.push(eq)});return pts;
}

/* ===== Charts (lightweight canvas) ===== */
function drawLine(canvas,data,color,bg){
  if(!canvas||!data||data.length<2)return;
  const c=canvas.getContext('2d'),dpr=window.devicePixelRatio||1;
  const w=canvas.clientWidth||300,h=canvas.clientHeight||120;
  canvas.width=w*dpr;canvas.height=h*dpr;c.scale(dpr,dpr);c.clearRect(0,0,w,h);
  const min=Math.min(...data),max=Math.max(...data),range=max-min||1,pad=10;
  c.strokeStyle='rgba(40,66,93,.3)';c.lineWidth=1;
  for(let i=0;i<4;i++){const y=pad+(h-2*pad)*i/4;c.beginPath();c.moveTo(pad,y);c.lineTo(w-pad,y);c.stroke()}
  c.strokeStyle=color||'#4da3ff';c.lineWidth=2;c.beginPath();
  data.forEach((v,i)=>{const x=pad+(w-2*pad)*i/Math.max(data.length-1,1);const y=h-pad-(h-2*pad)*(v-min)/range;i===0?c.moveTo(x,y):c.lineTo(x,y)});
  c.stroke();c.lineTo(w-pad,h-pad);c.lineTo(pad,h-pad);c.closePath();c.fillStyle=bg||'rgba(77,163,255,.08)';c.fill();
}
function drawBar(canvas,values,posColor,negColor){
  if(!canvas||!values||!values.length)return;
  const c=canvas.getContext('2d'),dpr=window.devicePixelRatio||1;
  const w=canvas.clientWidth||300,h=canvas.clientHeight||120;
  canvas.width=w*dpr;canvas.height=h*dpr;c.scale(dpr,dpr);c.clearRect(0,0,w,h);
  const max=Math.max(...values.map(Math.abs))||1,pad=10,zero=h/2,barW=Math.max((w-2*pad)/values.length-2,2);
  c.strokeStyle='rgba(40,66,93,.3)';c.lineWidth=1;c.beginPath();c.moveTo(pad,zero);c.lineTo(w-pad,zero);c.stroke();
  values.forEach((v,i)=>{const x=pad+i*((w-2*pad)/values.length);const bh=(h/2-pad)*(Math.abs(v)/max);c.fillStyle=v>=0?(posColor||'#2dd882'):(negColor||'#ff5470');c.fillRect(x,v>=0?zero-bh:zero,barW,bh)});
}
function renderPnlCharts(){
  setTimeout(()=>{
    const ec=equityCurve(S.hist,S.eq);
    const dp=dailyPnl(S.hist);const dpArr=Object.values(dp).slice(-30);
    drawLine(document.getElementById('ec-chart'),ec,'#4da3ff','rgba(77,163,255,.08)');
    drawBar(document.getElementById('dp-chart'),dpArr);
    let cum=0;const cumArr=ec.map(v=>{cum+=v;return cum});
    drawLine(document.getElementById('cp-chart'),cumArr,'#2dd882','rgba(45,216,130,.08)');
  },50);
}

/* ===== Render helpers ===== */
function signalBadge(sig){
  const cls=sig==='BUY'?'buy':sig==='SELL'?'sell':sig==='STRONG BUY'?'strong-buy':sig==='STRONG SELL'?'strong-sell':sig==='WATCH'?'watch':'neutral';
  return '<span class="signal-badge '+cls+'">'+E(sig)+'</span>';
}
function pnlClass(v){return N(v)>0?'pos':N(v)<0?'neg':''}
function kpiCard(l,v,c){return '<div class="kpi-card '+(c||'')+'"><div class="kpi-label">'+l+'</div><div class="kpi-value">'+v+'</div></div>'}
function posField(l,v){return '<div class="pos-field"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>'}

/* ===== Scanner Table ===== */
function scannerTable(mode){
  let a=S.rows.slice().sort((x,y)=>Math.abs(N(y.c))-Math.abs(N(x.c)));
  if(mode==='M')a=a.filter(x=>x.momentum!=='WAIT');
  if(mode==='S')a=a.filter(x=>x.scalp!=='WAIT');
  if(S.filterCoin)a=a.filter(x=>x.s.toLowerCase().includes(S.filterCoin.toLowerCase()));
  const rows=a.slice(0,50).map((x,i)=>{
    const z=mode==='M'?x.momentum:mode==='S'?x.scalp:(x.momentum!=='WAIT'?x.momentum:x.scalp);
    const volSpike=VR(S.k[x.s]?.m5||[]);
    return '<tr><td>'+(i+1)+'</td><td><span class="coin">'+E(x.s)+'</span></td><td>'+fmtPrice(x.p)+'</td>'+
      '<td class="'+cl(x.c)+'">'+P(x.c)+'</td><td>'+R(x.v/1e6)+'M</td><td>'+volSpike.toFixed(2)+'x</td>'+
      '<td class="'+(x.momentum==='BUY'?'buy':x.momentum==='SELL'?'sell':'neutral-text')+'">'+x.momentum+'</td><td>'+x.m+'</td>'+
      '<td class="'+(x.scalp==='BUY'?'buy':x.scalp==='SELL'?'sell':'neutral-text')+'">'+x.scalp+'</td><td>'+x.sc+'</td>'+
      '<td class="'+(x.trend==='BULLISH'?'buy':x.trend==='BEARISH'?'sell':'neutral-text')+'">'+x.trend+'</td>'+
      '<td>'+fmtPrice(x.support)+'</td><td>'+fmtPrice(x.resistance)+'</td>'+
      '<td>'+signalBadge(z==='WAIT'?'NEUTRAL':z)+'</td>'+
      '<td><button class="btn sm blue" onclick="DD.manualEntry(\''+E(x.s)+'\',\''+E(z)+'\')">Trade</button></td></tr>';
  }).join('');
  const fb='<div class="filters"><span class="filter-label">Search:</span><input class="filter-input" id="filter-coin-scan" placeholder="Coin name…" value="'+E(S.filterCoin)+'" oninput="DD.filterCoin=this.value;DD.render()"></div>';
  return fb+'<div class="table-scroll"><table class="term"><thead><tr><th>#</th><th>Coin</th><th>Price</th><th>24H</th><th>24H Vol</th><th>Vol Spike</th><th>Mom</th><th>Mom Score</th><th>Scalp</th><th>Scalp Score</th><th>Trend</th><th>Support</th><th>Resistance</th><th>Signal</th><th>Action</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

/* ===== History Table ===== */
function historyTable(arr){
  if(!arr.length)return '<div class="empty"><div class="icon">📋</div>No trades yet.</div>';
  const fb='<div class="filters">'+
    '<span class="filter-label">Coin:</span><input class="filter-input" id="filter-coin-h" placeholder="Search…" value="'+E(S.filterCoin)+'" oninput="DD.filterCoin=this.value;DD.render()">'+
    '<select class="filter-select" onchange="DD.filterResult=this.value;DD.render()"><option value="">All Results</option><option value="win" '+(S.filterResult==='win'?'selected':'')+'>Winning</option><option value="loss" '+(S.filterResult==='loss'?'selected':'')+'>Losing</option></select>'+
    '<input class="filter-select" type="date" value="'+E(S.filterDate)+'" onchange="DD.filterDate=this.value;DD.render()"></div>';
  const filtered=arr.filter(h=>{
    if(S.filterCoin&&!h.s.toLowerCase().includes(S.filterCoin.toLowerCase()))return false;
    if(S.filterResult==='win'&&N(h.pnl)<=0)return false;
    if(S.filterResult==='loss'&&N(h.pnl)>=0)return false;
    if(S.filterDate&&new Date(N(h.time)).toDateString()!==new Date(S.filterDate).toDateString())return false;
    return true;
  });
  if(!filtered.length)return fb+'<div class="empty">No trades match filters.</div>';
  const rows=filtered.slice(0,100).map(h=>{
    const pnl=N(h.pnl),pnlPct=h.entry&&h.exit?((h.exit-h.entry)/h.entry*100*(h.side==='SELL'?-1:1)):0;
    return '<tr><td>'+new Date(N(h.time)).toLocaleString('en-IN')+'</td><td><span class="coin">'+E(h.s)+'</span></td>'+
      '<td>'+E(h.mode||'PAPER')+'</td><td>'+E(h.e)+'</td><td class="'+(h.side==='BUY'?'buy':'sell')+'">'+h.side+'</td>'+
      '<td>'+fmtPrice(h.entry||h.price)+'</td><td>'+fmtPrice(h.exit||0)+'</td><td>'+fmtQty(h.qty)+'</td>'+
      '<td>₹'+R(h.fees)+'</td><td>₹'+R(N(h.pnl)+N(h.fees))+'</td><td class="'+cl(pnl)+'">₹'+PNL(pnl)+'</td>'+
      '<td class="'+cl(pnl)+'">'+P(pnlPct)+'</td><td>'+(pnl>0?'<span class="buy">WIN</span>':'<span class="sell">LOSS</span>')+'</td></tr>';
  }).join('');
  return fb+'<div class="table-scroll"><table class="term"><thead><tr><th>Time</th><th>Coin</th><th>Mode</th><th>Strategy</th><th>Side</th><th>Entry</th><th>Exit</th><th>Qty</th><th>Fees</th><th>Gross PNL</th><th>Net PNL</th><th>PNL%</th><th>Result</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

/* ===== Full history table with all filters ===== */
function fullHistoryTable(){
  const fb='<div class="filters">'+
    '<span class="filter-label">Coin:</span><input class="filter-input" id="filter-coin-fh" placeholder="Search…" value="'+E(S.filterCoin)+'" oninput="DD.filterCoin=this.value;DD.render()">'+
    '<select class="filter-select" onchange="DD.filterMode=this.value;DD.render()"><option value="">All Modes</option><option value="PAPER" '+(S.filterMode==='PAPER'?'selected':'')+'>Paper</option><option value="TESTNET" '+(S.filterMode==='TESTNET'?'selected':'')+'>Testnet</option><option value="LIVE" '+(S.filterMode==='LIVE'?'selected':'')+'>Live</option></select>'+
    '<select class="filter-select" onchange="DD.filterStrategy=this.value;DD.render()"><option value="">All Strategies</option><option value="MOMENTUM" '+(S.filterStrategy==='MOMENTUM'?'selected':'')+'>Momentum</option><option value="SCALPING" '+(S.filterStrategy==='SCALPING'?'selected':'')+'>Scalping</option><option value="OPTIONS" '+(S.filterStrategy==='OPTIONS'?'selected':'')+'>Options</option></select>'+
    '<select class="filter-select" onchange="DD.filterResult=this.value;DD.render()"><option value="">All Results</option><option value="win" '+(S.filterResult==='win'?'selected':'')+'>Winning</option><option value="loss" '+(S.filterResult==='loss'?'selected':'')+'>Losing</option></select>'+
    '<input class="filter-select" type="date" value="'+E(S.filterDate)+'" onchange="DD.filterDate=this.value;DD.render()"></div>';
  const filtered=S.hist.filter(h=>{
    if(S.filterCoin&&!h.s.toLowerCase().includes(S.filterCoin.toLowerCase()))return false;
    if(S.filterMode&&h.mode!==S.filterMode)return false;
    if(S.filterStrategy&&h.e!==S.filterStrategy)return false;
    if(S.filterResult==='win'&&N(h.pnl)<=0)return false;
    if(S.filterResult==='loss'&&N(h.pnl)>=0)return false;
    if(S.filterDate&&new Date(N(h.time)).toDateString()!==new Date(S.filterDate).toDateString())return false;
    return true;
  });
  if(!filtered.length)return fb+'<div class="empty"><div class="icon">📋</div>No trades match filters.</div>';
  const rows=filtered.slice(0,200).map(h=>{
    const pnl=N(h.pnl),pnlPct=h.entry&&h.exit?((h.exit-h.entry)/h.entry*100*(h.side==='SELL'?-1:1)):0;
    return '<tr><td>'+new Date(N(h.time)).toLocaleString('en-IN')+'</td><td><span class="coin">'+E(h.s)+'</span></td>'+
      '<td>'+E(h.mode||'PAPER')+'</td><td>'+E(h.e)+'</td><td class="'+(h.side==='BUY'?'buy':'sell')+'">'+h.side+'</td>'+
      '<td>'+fmtPrice(h.entry||h.price)+'</td><td>'+fmtPrice(h.exit||0)+'</td><td>'+fmtQty(h.qty)+'</td>'+
      '<td>₹'+R(h.fees)+'</td><td>₹'+R(N(h.pnl)+N(h.fees))+'</td><td class="'+cl(pnl)+'">₹'+PNL(pnl)+'</td>'+
      '<td class="'+cl(pnl)+'">'+P(pnlPct)+'</td><td>'+(pnl>0?'<span class="buy">WIN</span>':'<span class="sell">LOSS</span>')+'</td></tr>';
  }).join('');
  return fb+'<div class="table-scroll"><table class="term"><thead><tr><th>Time</th><th>Coin</th><th>Mode</th><th>Strategy</th><th>Side</th><th>Entry</th><th>Exit</th><th>Qty</th><th>Fees</th><th>Gross PNL</th><th>Net PNL</th><th>PNL%</th><th>Result</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

/* ===== Section Renderers ===== */
function renderDashboard(){
  const unreal=S.pos.reduce((a,p)=>a+N(p.pnl),0);
  const st=statsFor(S.hist);const today=new Date().toDateString();
  const todayTrades=S.hist.filter(h=>h.action==='EXIT'&&new Date(N(h.time)).toDateString()===today);
  const todayPnl=todayTrades.reduce((s,h)=>s+N(h.pnl)-N(h.fees),0);
  const avail=S.mode==='LIVE'?(S.account?.availableBalance||0):S.mode==='TESTNET'?(S.testnetAccount?.availableBalance||S.eq):S.eq;
  const kpis=[
    {l:'Total Equity',v:'₹'+R(S.eq+unreal),c:'acc'},{l:'Available Balance',v:'₹'+R(avail),c:''},
    {l:'Realized PNL',v:'₹'+PNL(S.real),c:pnlClass(S.real)},{l:'Unrealized PNL',v:'₹'+PNL(unreal),c:pnlClass(unreal)},
    {l:'Total PNL',v:'₹'+PNL(S.real+unreal),c:pnlClass(S.real+unreal)},{l:'Total Fees',v:'₹'+R(S.fees),c:''},
    {l:'Open Positions',v:S.pos.length+'',c:''},{l:"Today's Trades",v:todayTrades.length+'',c:''},
    {l:'Winning Trades',v:st.wins+'',c:st.wins>0?'pos':''},{l:'Losing Trades',v:st.losses+'',c:st.losses>0?'neg':''},
    {l:'Win Rate',v:st.winRate.toFixed(1)+'%',c:''},{l:"Today's PNL",v:'₹'+PNL(todayPnl),c:pnlClass(todayPnl)}
  ];
  const cards='<div class="kpi-grid">'+kpis.map(k=>'<div class="kpi-card '+(k.c||'')+'"><div class="kpi-label">'+k.l+'</div><div class="kpi-value">'+k.v+'</div></div>').join('')+'</div>';
  const banner=S.mode==='LIVE'?'<div class="mode-banner live"><b>LIVE TRADING ACTIVE</b> — Real Binance orders. Trade carefully.</div>'
    :S.mode==='TESTNET'?'<div class="mode-banner testnet"><b>TESTNET ACTIVE</b> — Binance Futures Demo (simulated funds)</div>'
    :'<div class="mode-banner paper"><b>PAPER TRADING</b> — Local simulation · Real orders OFF</div>';
  const autoRow='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
    '<div class="auto-toggle '+(S.auto?'on':'')+'" onclick="DD.toggleAuto()"><div class="sw"></div><span class="lbl">AUTO '+(S.auto?'ON':'OFF')+'</span></div>'+
    (S.mode==='LIVE'?'<div class="auto-toggle '+(S.liveAuto?'on':'')+'" onclick="DD.toggleLiveAuto()"><div class="sw"></div><span class="lbl">LIVE AUTO '+(S.liveAuto?'ON':'OFF')+'</span></div>':'')+
    '<button class="btn blue sm" onclick="DD.scan()">Refresh Scanner</button>'+
    '<button class="btn sm" onclick="DD.reconnect()">Reconnect WS</button></div>';
  return banner+autoRow+cards+'<div class="panel"><div class="panel-header"><div class="panel-title">Live Scanner — Top '+S.rows.length+' by 24H Change</div><div class="panel-sub">Last scan: '+(S.lastScan?new Date(S.lastScan).toLocaleTimeString('en-IN'):'—')+'</div></div>'+scannerTable()+'</div>';
}

function renderMomentum(){
  return '<div class="panel"><div class="panel-header"><div class="panel-title">Momentum Engine — 5m + 15m Trend, EMA, RSI, Volume</div><div class="panel-sub">Slots: '+S.pos.filter(p=>p.e==='MOMENTUM').length+'/'+MC+'</div></div>'+scannerTable('M')+'</div>';
}
function renderMomentumHistory(){
  const mh=S.hist.filter(h=>h.e==='MOMENTUM');const st=statsFor(mh);
  return '<div class="kpi-grid">'+kpiCard('Trades',st.trades)+kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+kpiCard('Net PNL','₹'+PNL(st.netPnl),pnlClass(st.netPnl))+kpiCard('Avg Win','₹'+PNL(st.avgWin),st.avgWin>0?'pos':'')+kpiCard('Avg Loss','₹'+PNL(st.avgLoss),st.avgLoss<0?'neg':'')+kpiCard('Profit Factor',st.profitFactor.toFixed(2))+'</div>'+
    '<div class="panel"><div class="panel-header"><div class="panel-title">Momentum Trade History</div></div>'+historyTable(mh)+'</div>';
}
function renderScalping(){
  return '<div class="panel"><div class="panel-header"><div class="panel-title">Scalping Engine — 1m Trigger + 5m Trend</div><div class="panel-sub">Slots: '+S.pos.filter(p=>p.e==='SCALPING').length+'/'+SC+'</div></div>'+scannerTable('S')+'</div>';
}
function renderScalpingHistory(){
  const sh=S.hist.filter(h=>h.e==='SCALPING');const st=statsFor(sh);
  return '<div class="kpi-grid">'+kpiCard('Trades',st.trades)+kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+kpiCard('Net PNL','₹'+PNL(st.netPnl),pnlClass(st.netPnl))+kpiCard('Avg Win','₹'+PNL(st.avgWin),st.avgWin>0?'pos':'')+kpiCard('Avg Loss','₹'+PNL(st.avgLoss),st.avgLoss<0?'neg':'')+kpiCard('Profit Factor',st.profitFactor.toFixed(2))+'</div>'+
    '<div class="panel"><div class="panel-header"><div class="panel-title">Scalping Trade History</div></div>'+historyTable(sh)+'</div>';
}

function renderOptions(){
  const rows=S.optData.rows||[];
  let html='<div class="panel"><div class="panel-header"><div class="panel-title">Binance Options Radar</div><div class="panel-sub">All underlyings · defined-risk spreads · naked selling OFF</div></div>';
  if(S.optLoading&&!rows.length)return html+'<div class="note">Loading options radar…</div></div>';
  if(!rows.length)return html+'<div class="note">No option data. <button class="btn sm" onclick="DD.scanOptions()">Scan Options</button></div></div>';
  const active=rows.filter(x=>x.signal!=='WATCH');
  html+='<div class="note info">'+rows.length+' option-enabled underlyings · '+active.length+' with qualifying signal · max '+OC+' paper spreads</div>';
  const tbl=rows.slice(0,50).map((x,i)=>'<tr><td>'+(i+1)+'</td><td><span class="coin">'+E(x.u)+'</span></td><td>'+x.count+'</td><td class="'+cl(x.change)+'">'+P(x.change)+'</td><td>'+R(x.volume/1e6)+'M</td><td>'+(x.expiry?new Date(x.expiry).toLocaleDateString():'-')+'</td><td>'+(x.signal==='BUY'?'<span class="signal-badge buy">BUY</span>':x.signal==='SELL'?'<span class="signal-badge sell">SELL</span>':'<span class="signal-badge watch">WATCH</span>')+'</td><td><button class="btn sm blue" onclick="DD.optView=\''+E(x.u)+'\';DD.render()">Chain</button></td></tr>').join('');
  html+='<div class="table-scroll"><table class="term"><thead><tr><th>#</th><th>Underlying</th><th>Contracts</th><th>24H</th><th>Volume</th><th>Expiry</th><th>Signal</th><th>Action</th></tr></thead><tbody>'+tbl+'</tbody></table></div></div>';
  // Options chain
  const viewU=S.optView||active[0]?.u||rows[0]?.u;
  if(viewU){
    const cd=optChainData(viewU);
    if(cd&&cd.strikes&&cd.strikes.length){
      const u24=S.optData.underlying[viewU];
      html+='<div class="panel"><div class="panel-header"><div class="panel-title">'+E(viewU)+' Options Chain</div><div class="panel-sub">Spot: '+fmtPrice(u24?.p)+' · Expiry: '+new Date(cd.expiry).toLocaleDateString()+'</div></div>';
      let chain='<div class="table-scroll"><table class="term"><thead><tr><th colspan="5" style="text-align:center">CALLS</th><th style="text-align:center">STRIKE</th><th colspan="5" style="text-align:center">PUTS</th></tr><tr><th>Mark</th><th>IV</th><th>Delta</th><th>Theta</th><th>Bid/Ask</th><th></th><th>Mark</th><th>IV</th><th>Delta</th><th>Theta</th><th>Bid/Ask</th></tr></thead><tbody>';
      cd.strikes.slice(0,30).forEach(k=>{
        const call=cd.calls.find(x=>x.k===k),put=cd.puts.find(x=>x.k===k);
        const cm=call?S.optData.marks[call.n]:null,pm=put?S.optData.marks[put.n]:null;
        chain+='<tr>'+
          '<td class="buy">'+(cm?cm.p.toFixed(4):'—')+'</td><td class="neutral-text">'+(cm?cm.iv.toFixed(1):'—')+'</td><td class="neutral-text">'+(cm?cm.d.toFixed(2):'—')+'</td><td class="neutral-text">'+(cm?cm.t.toFixed(4):'—')+'</td><td class="neutral-text">'+(cm?cm.bid.toFixed(3)+'/'+cm.ask.toFixed(3):'—')+'</td>'+
          '<td class="strike" style="text-align:center">'+k+'</td>'+
          '<td class="sell">'+(pm?pm.p.toFixed(4):'—')+'</td><td class="neutral-text">'+(pm?pm.iv.toFixed(1):'—')+'</td><td class="neutral-text">'+(pm?pm.d.toFixed(2):'—')+'</td><td class="neutral-text">'+(pm?pm.t.toFixed(4):'—')+'</td><td class="neutral-text">'+(pm?pm.bid.toFixed(3)+'/'+pm.ask.toFixed(3):'—')+'</td></tr>';
      });
      chain+='</tbody></table></div>';html+=chain+'</div>';
    }
  }
  return html;
}
function renderOptionsHistory(){
  const oh=S.hist.filter(h=>h.e==='OPTIONS');const st=statsFor(oh);
  return '<div class="kpi-grid">'+kpiCard('Trades',st.trades)+kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+kpiCard('Net PNL','₹'+PNL(st.netPnl),pnlClass(st.netPnl))+kpiCard('Fees','₹'+R(st.totalFees))+'</div>'+
    '<div class="panel"><div class="panel-header"><div class="panel-title">Options Trade History</div></div>'+historyTable(oh)+'</div>';
}

function renderPositions(){
  if(!S.pos.length)return '<div class="panel"><div class="empty"><div class="icon">📊</div>No open positions.</div></div>';
  const cards=S.pos.map(p=>{
    const pnl=N(p.pnl),pnlPct=p.entry&&p.current?((p.current-p.entry)/p.entry*100*(p.side==='SELL'?-1:1)):0;
    return '<div class="pos-card '+(p.side==='SELL'?'sell-side':'')+'"><div class="pos-head"><span class="pos-coin">'+E(p.s)+'</span><span class="pos-tag">'+E(p.e)+'</span><span class="pos-tag">'+E(p.side)+'</span><span class="pos-tag">'+E(p.mode||'PAPER')+'</span>'+(p.sl?'<button class="btn sm red" onclick="DD.close(\''+E(p.s)+'\')">Close</button>':'')+'</div>'+
      '<div class="pos-grid">'+posField('Entry',fmtPrice(p.entry))+posField('Mark',fmtPrice(p.current))+posField('Qty',fmtQty(p.q))+posField('SL',fmtPrice(p.sl))+posField('TP',fmtPrice(p.tp))+posField('Fees','₹'+R(p.entryFee))+posField('Open Time',new Date(N(p.opened)).toLocaleString('en-IN'))+'</div>'+
      '<div class="pos-pnl '+cl(pnl)+'">Net PNL: ₹'+PNL(p.pnl)+' ('+P(pnlPct)+')</div></div>';
  }).join('');
  return '<div class="panel"><div class="panel-header"><div class="panel-title">Open Positions</div><div class="panel-sub">'+S.pos.length+' position(s) · Mode: '+S.mode+'</div></div><div class="pos-list">'+cards+'</div></div>';
}

function renderTradeHistory(){
  const st=statsFor(S.hist);
  return '<div class="kpi-grid">'+kpiCard('Total Trades',st.trades)+kpiCard('Wins',st.wins,st.wins>0?'pos':'')+kpiCard('Losses',st.losses,st.losses>0?'neg':'')+kpiCard('Net PNL','₹'+PNL(st.netPnl),pnlClass(st.netPnl))+kpiCard('Total Fees','₹'+R(st.totalFees))+'</div>'+
    '<div class="panel"><div class="panel-header"><div class="panel-title">Complete Trade History</div></div>'+fullHistoryTable()+'</div>';
}

function renderPnl(){
  const st=statsFor(S.hist);const dp=dailyPnl(S.hist);const dpArr=Object.values(dp).slice(-30);
  const ec=equityCurve(S.hist,S.eq);const unreal=S.pos.reduce((a,p)=>a+N(p.pnl),0);
  const now=new Date(),weekAgo=new Date(now.getTime()-7*864e5),monthAgo=new Date(now.getTime()-30*864e5);
  const weekly=S.hist.filter(h=>h.action==='EXIT'&&new Date(N(h.time))>=weekAgo).reduce((s,h)=>s+N(h.pnl)-N(h.fees),0);
  const monthly=S.hist.filter(h=>h.action==='EXIT'&&new Date(N(h.time))>=monthAgo).reduce((s,h)=>s+N(h.pnl)-N(h.fees),0);
  const todayPnl=dp[new Date().toDateString()]||0;
  const cards='<div class="kpi-grid">'+
    kpiCard('Total PNL','₹'+PNL(st.netPnl),pnlClass(st.netPnl))+kpiCard("Today's PNL",'₹'+PNL(todayPnl),pnlClass(todayPnl))+
    kpiCard('Weekly PNL','₹'+PNL(weekly),pnlClass(weekly))+kpiCard('Monthly PNL','₹'+PNL(monthly),pnlClass(monthly))+
    kpiCard('Realized PNL','₹'+PNL(S.real),pnlClass(S.real))+kpiCard('Unrealized PNL','₹'+PNL(unreal),pnlClass(unreal))+
    kpiCard('Total Fees','₹'+R(S.fees))+kpiCard('Net PNL','₹'+PNL(st.netPnl),pnlClass(st.netPnl))+
    kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+kpiCard('Profit Factor',st.profitFactor.toFixed(2))+
    kpiCard('Avg Win','₹'+PNL(st.avgWin),st.avgWin>0?'pos':'')+kpiCard('Avg Loss','₹'+PNL(st.avgLoss),st.avgLoss<0?'neg':'')+
    kpiCard('Max Drawdown','₹'+R(st.maxDD),'neg')+kpiCard('Total Trades',st.trades)+'</div>';
  const charts='<div class="two-col"><div class="chart-box"><div class="chart-title">Equity Curve</div><canvas id="ec-chart" height="160"></canvas></div><div class="chart-box"><div class="chart-title">Daily PNL (30 days)</div><canvas id="dp-chart" height="160"></canvas></div></div><div class="chart-box" style="margin-top:8px"><div class="chart-title">Cumulative PNL</div><canvas id="cp-chart" height="140"></canvas></div>';
  const wl='<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">Win / Loss Distribution</div></div><div class="kpi-grid">'+kpiCard('Wins',st.wins,st.wins>0?'pos':'')+kpiCard('Losses',st.losses,st.losses>0?'neg':'')+kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+'</div></div>';
  return cards+'<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">PNL Charts</div></div>'+charts+'</div>'+wl;
}

function renderPaper(){
  const st=statsFor(S.hist);const unreal=S.pos.reduce((a,p)=>a+N(p.pnl),0);
  const usedMargin=S.pos.reduce((a,p)=>a+N(p.entry*p.q),0),exposure=S.pos.reduce((a,p)=>a+N(p.current*p.q),0);
  const engines=['MOMENTUM','SCALPING','OPTIONS'];
  const ec=engines.map(e=>{
    const ep=S.pos.filter(p=>p.e===e),eh=S.hist.filter(h=>h.e===e&&h.action==='EXIT'),est=statsFor(eh);
    const ePnl=ep.reduce((a,p)=>a+N(p.pnl),0);
    return '<div class="acct-card"><h4>'+e+'</h4><div class="acct-row"><span>Capital</span><b>₹'+R(S.eq)+'</b></div><div class="acct-row"><span>Open Positions</span><b>'+ep.length+'</b></div><div class="acct-row"><span>Unrealized PNL</span><b class="'+cl(ePnl)+'">₹'+PNL(ePnl)+'</b></div><div class="acct-row"><span>Realized PNL</span><b class="'+cl(est.netPnl)+'">₹'+PNL(est.netPnl)+'</b></div><div class="acct-row"><span>Fees</span><b>₹'+R(est.totalFees)+'</b></div><div class="acct-row"><span>Trades</span><b>'+est.trades+'</b></div><div class="acct-row"><span>Win Rate</span><b>'+est.winRate.toFixed(1)+'%</b></div></div>';
  }).join('');
  return '<div class="mode-banner paper"><b>PAPER TRADING</b> — Local simulation · Real orders OFF</div>'+
    '<div class="kpi-grid">'+kpiCard('Virtual Capital','₹'+R(S.settings.paperCapital),'acc')+kpiCard('Available Balance','₹'+R(S.eq),'acc')+kpiCard('Used Margin','₹'+R(usedMargin))+kpiCard('Current Exposure','₹'+R(exposure))+kpiCard('Realized PNL','₹'+PNL(S.real),pnlClass(S.real))+kpiCard('Unrealized PNL','₹'+PNL(unreal),pnlClass(unreal))+kpiCard('Fees','₹'+R(S.fees))+kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+'</div>'+
    '<div class="panel"><div class="panel-header"><div class="panel-title">Per-Engine Accounts</div></div><div class="acct-grid">'+ec+'</div></div>'+
    '<div class="btn-row" style="margin-top:8px"><button class="btn green sm" onclick="DD.toggleAuto()">Auto Trading: '+(S.auto?'ON':'OFF')+'</button><button class="btn sm" onclick="DD.resetPaper()">Reset Paper</button></div>';
}

function renderTestnet(){
  const ta=S.testnetAccount,st=statsFor(S.hist),unreal=S.pos.reduce((a,p)=>a+N(p.pnl),0);
  return '<div class="mode-banner testnet"><b>TESTNET ACTIVE</b> — Binance Futures Demo · Simulated funds</div>'+
    (S.testnetStatus?'<div class="note info">Testnet API: '+(S.testnetStatus.apiKeyConfigured?'Configured':'Not configured')+' · '+(S.testnetStatus.testnetUnlocked?'Unlocked':'Locked')+' · Base: '+E(S.testnetStatus.baseUrl)+'</div>':'<div class="note">Loading testnet status…</div>')+
    '<div class="kpi-grid">'+kpiCard('Wallet Balance','₹'+R(ta?.walletBalance||0),'acc')+kpiCard('Available Balance','₹'+R(ta?.availableBalance||0),'acc')+kpiCard('Margin','₹'+R(ta?.margin||0))+kpiCard('Unrealized PNL','₹'+PNL(ta?.unrealized||unreal),pnlClass(ta?.unrealized||unreal))+kpiCard('Realized PNL','₹'+PNL(S.real),pnlClass(S.real))+kpiCard('Fees','₹'+R(S.fees))+kpiCard('Open Positions',S.pos.length+'')+kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+'</div>'+
    '<div class="btn-row" style="margin-top:8px"><button class="btn sm '+(S.auto?'green':'')+'" onclick="DD.toggleAuto()">Testnet Auto: '+(S.auto?'ON':'OFF')+'</button><button class="btn sm blue" onclick="DD.scan()">Scan</button></div>';
}

function renderLive(){
  const la=S.account,st=statsFor(S.hist),unreal=S.pos.reduce((a,p)=>a+N(p.pnl),0);
  return '<div class="mode-banner live"><b>LIVE TRADING</b> — Real Binance Futures · Real money at risk</div>'+
    '<div class="note warn">LIVE mode sends real orders to Binance. Auto trading is OFF by default. Enable LIVE AUTO only after explicit confirmation.</div>'+
    '<div class="kpi-grid">'+kpiCard('Wallet Balance','₹'+R(la?.walletBalance||0),'acc')+kpiCard('Available Balance','₹'+R(la?.availableBalance||0),'acc')+kpiCard('Margin','₹'+R(la?.margin||0))+kpiCard('Unrealized PNL','₹'+PNL(la?.unrealized||unreal),pnlClass(la?.unrealized||unreal))+kpiCard('Realized PNL','₹'+PNL(S.real),pnlClass(S.real))+kpiCard('Fees','₹'+R(S.fees))+kpiCard('Open Positions',S.pos.length+'')+kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+'</div>'+
    '<div class="btn-row" style="margin-top:8px"><div class="auto-toggle '+(S.liveAuto?'on':'')+'" onclick="DD.toggleLiveAuto()"><div class="sw"></div><span class="lbl">LIVE AUTO '+(S.liveAuto?'ON':'OFF')+'</span></div><button class="btn sm blue" onclick="DD.syncAcc()">Sync Account</button><button class="btn sm" onclick="DD.scan()">Scan</button></div>';
}

function renderAnalytics(){
  const engines=['MOMENTUM','SCALPING','OPTIONS'];
  const engineStats=engines.map(e=>{
    const eh=S.hist.filter(h=>h.e===e),est=statsFor(eh);
    return '<tr><td><b>'+e+'</b></td><td>'+est.trades+'</td><td class="buy">'+est.wins+'</td><td class="sell">'+est.losses+'</td><td>'+est.winRate.toFixed(1)+'%</td><td class="'+cl(est.netPnl)+'">₹'+PNL(est.netPnl)+'</td><td>₹'+PNL(est.avgWin)+'</td><td>₹'+PNL(est.avgLoss)+'</td><td>'+est.profitFactor.toFixed(2)+'</td><td>₹'+R(est.maxDD)+'</td><td>₹'+R(est.totalFees)+'</td></tr>';
  }).join('');
  const coinPerf={};
  S.hist.filter(h=>h.action==='EXIT').forEach(h=>{if(!coinPerf[h.s])coinPerf[h.s]={trades:0,wins:0,losses:0,pnl:0};coinPerf[h.s].trades++;coinPerf[h.s].pnl+=N(h.pnl);if(N(h.pnl)>0)coinPerf[h.s].wins++;else coinPerf[h.s].losses++});
  const coinArr=Object.entries(coinPerf).map(([s,d])=>({...d,s}));
  const topCoins=coinArr.sort((a,b)=>b.pnl-a.pnl).slice(0,10).map((c,i)=>'<tr><td>'+(i+1)+'</td><td><span class="coin">'+E(c.s)+'</span></td><td>'+c.trades+'</td><td class="buy">'+c.wins+'</td><td class="sell">'+c.losses+'</td><td class="'+cl(c.pnl)+'">₹'+PNL(c.pnl)+'</td></tr>').join('');
  const worstCoins=coinArr.slice().reverse().slice(0,10).map((c,i)=>'<tr><td>'+(i+1)+'</td><td><span class="coin">'+E(c.s)+'</span></td><td>'+c.trades+'</td><td class="buy">'+c.wins+'</td><td class="sell">'+c.losses+'</td><td class="'+cl(c.pnl)+'">₹'+PNL(c.pnl)+'</td></tr>').join('');
  const mostTraded=coinArr.sort((a,b)=>b.trades-a.trades).slice(0,10).map((c,i)=>'<tr><td>'+(i+1)+'</td><td><span class="coin">'+E(c.s)+'</span></td><td>'+c.trades+'</td><td>₹'+PNL(c.pnl)+'</td></tr>').join('');
  return '<div class="panel"><div class="panel-header"><div class="panel-title">Strategy Performance</div></div><div class="table-scroll"><table class="term"><thead><tr><th>Strategy</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Win Rate</th><th>Net PNL</th><th>Avg Win</th><th>Avg Loss</th><th>Profit Factor</th><th>Max DD</th><th>Fees</th></tr></thead><tbody>'+engineStats+'</tbody></table></div></div>'+
    '<div class="two-col" style="margin-top:8px"><div class="panel"><div class="panel-header"><div class="panel-title">Top Profitable Coins</div></div><div class="table-scroll"><table class="term"><thead><tr><th>#</th><th>Coin</th><th>Trades</th><th>Wins</th><th>Losses</th><th>PNL</th></tr></thead><tbody>'+topCoins+'</tbody></table></div></div><div class="panel"><div class="panel-header"><div class="panel-title">Top Losing Coins</div></div><div class="table-scroll"><table class="term"><thead><tr><th>#</th><th>Coin</th><th>Trades</th><th>Wins</th><th>Losses</th><th>PNL</th></tr></thead><tbody>'+worstCoins+'</tbody></table></div></div></div>'+
    '<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">Most Traded Coins</div></div><div class="table-scroll"><table class="term"><thead><tr><th>#</th><th>Coin</th><th>Trades</th><th>PNL</th></tr></thead><tbody>'+mostTraded+'</tbody></table></div></div>';
}

function renderSettings(){
  return '<div class="panel"><div class="panel-header"><div class="panel-title">Settings</div></div><div class="settings-grid">'+
    '<div class="setting-row"><div><div class="set-label">Scanner Refresh</div><div class="set-desc">Interval in seconds</div></div><input type="number" value="'+(S.settings.scanInterval||30)+'" min="10" max="120" onchange="DD.updateSetting(\'scanInterval\',+this.value)"></div>'+
    '<div class="setting-row"><div><div class="set-label">Coin Count</div><div class="set-desc">Number of coins to scan</div></div><input type="number" value="'+(S.settings.coinCount||50)+'" min="10" max="100" onchange="DD.updateSetting(\'coinCount\',+this.value)"></div>'+
    '<div class="setting-row"><div><div class="set-label">Paper Capital</div><div class="set-desc">Virtual starting capital</div></div><input type="number" value="'+(S.settings.paperCapital||10000)+'" min="100" max="1000000" onchange="DD.updateSetting(\'paperCapital\',+this.value)"></div>'+
    '<div class="setting-row"><div><div class="set-label">Slippage</div><div class="set-desc">Simulated slippage (bps)</div></div><input type="number" value="'+((S.settings.slippage||0.0003)*10000).toFixed(1)+'" min="0" max="100" onchange="DD.updateSetting(\'slippage\',+this.value/10000)"></div>'+
    '<div class="setting-row"><div><div class="set-label">Taker Fee</div><div class="set-desc">Per-side fee (0.05%)</div></div><input type="text" value="0.05%" disabled></div>'+
    '<div class="setting-row"><div><div class="set-label">Auto Trading</div><div class="set-desc">Paper/Testnet automatic entries</div></div><div class="auto-toggle '+(S.auto?'on':'')+'" onclick="DD.toggleAuto()"><div class="sw"></div><span class="lbl">'+(S.auto?'ON':'OFF')+'</span></div></div>'+
    '</div></div>'+
    '<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">Trading Mode</div></div><div class="note info">Current mode: <b>'+S.mode+'</b>. Each mode maintains separate positions, history, and PNL.</div><div class="btn-row" style="margin-top:10px"><button class="btn '+(S.mode==='PAPER'?'blue':'')+'" onclick="DD.setMode(\'PAPER\')">Paper</button><button class="btn '+(S.mode==='TESTNET'?'blue':'')+'" onclick="DD.setMode(\'TESTNET\')">Testnet</button><button class="btn red" onclick="DD.setMode(\'LIVE\')">Live</button></div></div>'+
    '<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">Data Management</div></div><div class="btn-row"><button class="btn" onclick="DD.resetPaper()">Reset Paper Data</button><button class="btn" onclick="DD.exportData()">Export Data</button><button class="btn" onclick="DD.scan()">Refresh Scanner</button><button class="btn" onclick="DD.reconnect()">Reconnect WebSocket</button></div></div>';
}

/* ===== Main Render (with focus preservation + throttle) ===== */
let _lastRender=0;
function render(){
  const app=document.getElementById('app');if(!app)return;
  let focusInfo=null;
  const ae=document.activeElement;
  if(ae&&ae!==document.body&&app.contains(ae)){focusInfo={tag:ae.tagName,id:ae.id||'',class:ae.className||'',selStart:ae.selectionStart,selEnd:ae.selectionEnd,value:ae.value||''}}
  const wsClass=S.wsStatus==='online'?'online':S.wsStatus==='connecting'?'connecting':'offline';
  const wsLabel=S.wsStatus==='online'?'LIVE':S.wsStatus==='connecting'?'CONNECTING':'OFFLINE';
  let body='';
  switch(S.tab){
    case'dashboard':body=renderDashboard();break;case'momentum':body=renderMomentum();break;
    case'momentum-history':body=renderMomentumHistory();break;case'scalping':body=renderScalping();break;
    case'scalping-history':body=renderScalpingHistory();break;case'options':body=renderOptions();break;
    case'options-history':body=renderOptionsHistory();break;case'positions':body=renderPositions();break;
    case'trade-history':body=renderTradeHistory();break;case'pnl':body=renderPnl();break;
    case'paper':body=renderPaper();break;case'testnet':body=renderTestnet();break;
    case'live':body=renderLive();break;case'analytics':body=renderAnalytics();break;
    case'settings':body=renderSettings();break;default:body=renderDashboard();
  }
  const topbar='<div class="topbar"><div class="brand"><div class="logo">D</div><div class="brand-info"><strong>DEALDOST</strong><small>BINANCE SCANNER</small></div></div><div class="status-bar">'+
    '<div class="stat-badge '+wsClass+'"><div class="dot"></div><span>'+wsLabel+'</span></div>'+
    '<div class="stat-badge"><span>Mode:</span><span class="v">'+S.mode+'</span></div>'+
    '<div class="stat-badge"><span>Auto:</span><span class="v">'+(S.auto?'ON':'OFF')+'</span></div>'+
    '<div class="stat-badge"><span>Update:</span><span class="v">'+(S.lastScan?new Date(S.lastScan).toLocaleTimeString('en-IN'):'—')+'</span></div></div>'+
    '<div class="mode-switch"><button class="mode-btn '+(S.mode==='PAPER'?'active':'')+'" onclick="DD.setMode(\'PAPER\')">PAPER</button><button class="mode-btn '+(S.mode==='TESTNET'?'active':'')+'" onclick="DD.setMode(\'TESTNET\')">TESTNET</button><button class="mode-btn live '+(S.mode==='LIVE'?'active live':'')+'" onclick="DD.setMode(\'LIVE\')">LIVE</button></div></div>';
  const navbar='<div class="navbar">'+NAV.map(n=>'<button class="nav-btn '+(S.tab===n?'active':'')+'" onclick="DD.tab=\''+n+'\';DD.render()">'+NAV_LABELS[n]+'</button>').join('')+'</div>';
  const bottomNav='<div class="bottom-nav">'+BOTTOM_NAV.map(n=>'<button class="bn-btn '+(S.tab===n?'active':'')+'" onclick="DD.tab=\''+n+'\';DD.render()"><span class="bn-icon">'+(BN_ICONS[n]||'?')+'</span>'+NAV_LABELS[n]+'</button>').join('')+'</div>';
  const err=S.err?'<div class="error-banner"><span>'+E(S.err)+'</span><button class="btn sm" onclick="DD.err=\'\';DD.render();DD.scan()">Retry</button></div>':'';
  app.innerHTML=topbar+navbar+err+body+bottomNav;
  // Restore focus after re-render
  if(focusInfo){
    try{
      let el=null;
      if(focusInfo.id)el=app.querySelector('#'+focusInfo.id);
      if(!el&&focusInfo.name)el=app.querySelector('[name="'+focusInfo.name+'"]');
      if(!el&&focusInfo.class){
        const cls=focusInfo.class.split(' ')[0];
        const inputs=app.querySelectorAll(focusInfo.tag.toLowerCase()+'.'+cls);
        // Match by value if multiple
        for(const e of inputs){if(e.value===focusInfo.value){el=e;break}}
        if(!el&&inputs.length)el=inputs[0];
      }
      if(el){el.focus();if(el.setSelectionRange&&focusInfo.selStart!=null)el.setSelectionRange(focusInfo.selStart,focusInfo.selEnd)}
    }catch(e){}
  }
  if(S.tab==='pnl')renderPnlCharts();
}
// Throttled render for high-frequency updates (WS ticks, manage intervals)
function renderThrottled(){
  const now=Date.now();
  if(now-_lastRender<1000)return;
  _lastRender=now;
  render();
}

/* ===== DD API (window interface) ===== */
window.DD={
  get tab(){return S.tab},set tab(v){S.tab=v},
  get filterCoin(){return S.filterCoin},set filterCoin(v){S.filterCoin=v},
  get filterMode(){return S.filterMode},set filterMode(v){S.filterMode=v},
  get filterStrategy(){return S.filterStrategy},set filterStrategy(v){S.filterStrategy=v},
  get filterResult(){return S.filterResult},set filterResult(v){S.filterResult=v},
  get filterDate(){return S.filterDate},set filterDate(v){S.filterDate=v},
  get optView(){return S.optView},set optView(v){S.optView=v},
  get err(){return S.err},set err(v){S.err=v},
  render,scan,scanOptions,connectWS,
  toggleAuto(){S.auto=!S.auto;render();if(S.auto)engine()},
  toggleLiveAuto(){if(!S.liveAuto){if(!confirm('Enable LIVE AUTO trading? This will place REAL orders on Binance automatically.'))return}S.liveAuto=!S.liveAuto;render()},
  setMode(m){
    if(m===S.mode)return;
    if(m==='LIVE'&&!confirm('Switch to LIVE mode? Real Binance orders will be possible. Live Auto stays OFF until you enable it separately.'))return;
    // Save current mode state
    save();
    S.mode=m;S.liveAuto=false;
    localStorage.setItem('ddMode',m);
    // Load new mode state
    load();render();if(m==='LIVE')syncAccount();if(m==='TESTNET'){syncTestnet();checkTestnetStatus()}
  },
  close(sym){
    const p=S.pos.find(x=>x.s===sym);if(!p)return;
    const x=N(S.t[sym]?.p);if(!x)return;
    const gross=p.side==='BUY'?(x-p.entry)*p.q:(p.entry-x)*p.q,ef=x*p.q*F;
    p.pnl=gross-p.entryFee-ef;S.real+=p.pnl;S.eq+=p.pnl;S.fees+=p.entryFee+ef;
    S.hist.unshift({time:Date.now(),s:p.s,e:p.e,side:p.side,action:'EXIT',entry:p.entry,exit:x,pnl:p.pnl,fees:p.entryFee+ef,live:p.mode==='LIVE',mode:p.mode,reason:'Manual close'});
    S.pos=S.pos.filter(q=>q.id!==p.id);S.lastTrade[sym]=Date.now();save();render();
  },
  manualEntry(sym,side){
    if(side==='WAIT'||!side)return;
    if(!['PAPER','TESTNET'].includes(S.mode)){alert('Manual entry is available in PAPER and TESTNET modes only.');return}
    const x=S.rows.find(r=>r.s===sym);if(!x)return;
    const r=riskModel(x,side==='BUY'?'MOMENTUM':'MOMENTUM',S.eq),ef=x.p*r.q*F;
    const slip=x.p*S.settings.slippage,entryPx=x.p+(side==='BUY'?slip:-slip);
    S.pos.push({id:Date.now()+Math.random(),s:sym,e:'MOMENTUM',side,entry:entryPx,current:x.p,q:r.q,sl:side==='BUY'?entryPx*(1-r.stop):entryPx*(1+r.stop),tp:side==='BUY'?entryPx*(1+2*r.stop):entryPx*(1-2*r.stop),entryFee:ef,pnl:-ef,feeRate:F,mode:S.mode,reason:'Manual entry',opened:Date.now()});
    S.hist.unshift({time:Date.now(),s:sym,e:'MOMENTUM',side,action:'ENTRY',price:entryPx,qty:r.q,pnl:0,fees:ef,live:false,mode:S.mode,reason:'Manual entry'});
    save();render();
  },
  reconnect(){connectWS()},
  syncAcc(){syncAccount().then(render)},
  updateSetting(k,v){S.settings[k]=v;save();render()},
  resetPaper(){if(confirm('Reset '+S.mode+' trading data? This clears positions and history for this mode.')){S.pos=[];S.hist=[];S.eq=N(S.settings.paperCapital)||10000;S.real=0;S.fees=0;S.lastTrade={};save();render()}},
  exportData(){try{const d=localStorage[storageKey()];const blob=new Blob([d],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='dealdost-'+S.mode.toLowerCase()+'-'+Date.now()+'.json';a.click();URL.revokeObjectURL(url)}catch(e){alert('Export failed: '+e.message)}},
  drawLine,drawBar
};

/* ===== Boot ===== */
function clearTimers(){
  if(S.scanTimer)clearInterval(S.scanTimer);
  if(S.manageTimer)clearInterval(S.manageTimer);
  if(S.optTimer)clearInterval(S.optTimer);
}
function boot(){
  load();render();
  // Immediate UI render, then async data load
  checkTestnetStatus().then(render);
  scan().catch(e=>{S.err=e.message;render()});
  connectWS();
  scanOptions();
  // Timers (dedup guarded)
  clearTimers();
  S.scanTimer=setInterval(()=>{scan()},(N(S.settings.scanInterval)||30)*1000);
  S.manageTimer=setInterval(()=>{managePaper();if(['dashboard','positions'].includes(S.tab))renderThrottled()},3000);
  S.optTimer=setInterval(()=>{scanOptions()},30000);
}
// Start only once
if(!window.__DD_BOOTED){window.__DD_BOOTED=true;boot();}
})();
