/*
 * DealDost Professional Trading Terminal
 * Preserves all trading logic from app-scanner-v3.js
 * Adds: 16 navigation sections, mode isolation (PAPER/TESTNET/LIVE),
 * per-engine accounts, PNL dashboard, analytics, charts, filters, mobile bottom nav
 */
(()=>{'use strict';

/* ===== Constants (preserved from scanner-v3) ===== */
const PUB='/api/binance-market?path=',AC='/api/binance-account?path=',TR='/api/binance-trade',
  TN_AC='/api/binance-testnet-account?path=',TN_TR='/api/binance-testnet-trade',TN_STATUS='/api/binance-testnet-status',TN_SYMS='/api/binance-testnet-symbols',
  F=.0005,MC=3,SC=3,OC=4,MOM_COOLDOWN=20*60e3,SCALP_COOLDOWN=10*60e3,COOLDOWN=10*60e3,OPT_SETS=4,OPT_COOLDOWN=3*60e3,OPT_STOP=0.25,OPT_TP=0.50,OPT_RISK=0.01,DAILY_RISK_LIMIT=0.06;
  const CONF_MOM=80,CONF_SCALP=82,VOL_FILTER=1.15,QUALITY_MIN=70;
const NAV=['dashboard','momentum','momentum-history','scalping','scalping-history','options','options-history','positions','trade-history','pnl','paper','testnet','live','analytics','settings'];
const NAV_LABELS={'dashboard':'Dashboard','momentum':'Momentum','momentum-history':'Mom History','scalping':'Scalping','scalping-history':'Scalp History','options':'Options','options-history':'Opt History','positions':'Positions','trade-history':'Trade History','pnl':'PNL','paper':'Paper Trading','testnet':'Testnet','live':'Live Trading','analytics':'Analytics','settings':'Settings'};
const BOTTOM_NAV=['dashboard','momentum','scalping','options','positions','pnl','analytics','settings'];
const BN_ICONS={'dashboard':'⌂','momentum':'M','scalping':'S','options':'O','positions':'P','pnl':'$','analytics':'A','settings':'⚙'};

/* ===== State ===== */
const S={
  mode:(localStorage.getItem('ddMode')||'PAPER'),
  auto:true,liveAuto:false,liveTrading:false,
  emergencyStop:false,
  rotation:{enabled:true,lastRotation:0,events:0,rotationDate:'',lastEngine:'',lastClosed:'',lastOpened:'',lastReason:'',lastResult:'',lastAttemptKey:''},
  tab:'dashboard',
  wsStatus:'connecting',ws:null,wsTimer:null,
  t:{},rows:[],k:{},universe:[],stableUniverse:[],
  pos:[],hist:[],eq:10000,real:0,fees:0,optReal:0,optFees:0,
  dailyRiskUsed:0,dailyRiskDate:'',rotationId:0,
  account:null,testnetAccount:null,testnetStatus:null,testnetSymbols:new Set(),testnetSymbolsReady:false,testnetRestricted:false,testnetRejectedSymbols:new Set(),
  err:'',lastScan:0,lastAccount:0,lastWsMsg:0,lastTrade:{},busy:false,
  optData:{contracts:[],marks:{},underlying:{},rows:[]},optLoading:false,optView:'',
  optSets:Array.from({length:OPT_SETS},(_,i)=>({id:i+1,status:'WAITING',symbol:'',side:'',entry:0,current:0,qty:0,contract:'',longContract:'',shortContract:'',expiry:0,strike:0,shortStrike:0,pnl:0,entryFee:0,opened:0,closed:0,reason:''})),
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
    localStorage[storageKey()]=JSON.stringify({pos:S.pos,hist:S.hist.slice(0,500),eq:S.eq,real:S.real,fees:S.fees,lastTrade:S.lastTrade,optSets:S.optSets,dailyRiskUsed:S.dailyRiskUsed,dailyRiskDate:S.dailyRiskDate,rotationEvents:S.rotation.events,rotationEnabled:S.rotation.enabled,rotation:S.rotation,rotationId:S.rotationId,emergencyStop:S.emergencyStop,optReal:S.optReal,optFees:S.optFees});
    localStorage.setItem('ddSettings',JSON.stringify(S.settings));
  }catch(e){}
}
function load(){
  try{
    const q=JSON.parse(localStorage[storageKey()]||'{}');
    S.pos=q.pos||[];S.hist=q.hist||[];
    S.eq=N(q.eq)||(S.mode==='PAPER'?N(S.settings.paperCapital)||10000:10000);
    S.real=N(q.real);S.fees=N(q.fees);S.optReal=N(q.optReal);S.optFees=N(q.optFees);S.lastTrade=q.lastTrade||{};
    if(q.optSets&&Array.isArray(q.optSets)&&q.optSets.length===OPT_SETS)S.optSets=q.optSets;
    S.dailyRiskUsed=S.mode==='LIVE'?N(q.dailyRiskUsed):0;S.dailyRiskDate=S.mode==='LIVE'?(q.dailyRiskDate||''):'';
    S.rotation.events=N(q.rotationEvents);S.rotation.enabled=q.rotationEnabled!==false;if(q.rotation&&typeof q.rotation==='object')S.rotation={...S.rotation,...q.rotation};
    // Migration guard: older builds could record a close/open snapshot even when
    // replacement was blocked by the daily-risk gate. Never display that as a
    // real rotation after reload.
    if(S.rotation.lastResult==='BLOCKED'&&/daily risk|risk limit|slot not full/i.test(String(S.rotation.lastReason||''))){
      S.rotation.lastRotation=0;S.rotation.lastEngine='';S.rotation.lastClosed='';S.rotation.lastOpened='';S.rotation.lastReason='';S.rotation.lastResult='';S.rotation.lastAttemptKey='';
    }
    S.rotationId=N(q.rotationId);S.liveTrading=false;S.liveAuto=false;S.emergencyStop=q.emergencyStop===true;
    try{const u=JSON.parse(localStorage.getItem('dd_stable_universe_v1')||'[]');if(Array.isArray(u)&&u.length)S.stableUniverse=u}catch(e){}\n    try{const rj=JSON.parse(localStorage.getItem('dd_testnet_rejected_v1')||'[]');if(Array.isArray(rj))S.testnetRejectedSymbols=new Set(rj.map(String))}catch(e){}
  }catch(e){}
}

/* ===== Trading Calculations (PRESERVED from scanner-v3) ===== */
function calc(s){
  const t=S.t[s]||{},k=S.k[s]||{},m5=closed(k.m5),m15=closed(k.m15),m1=closed(k.m1),
    c5=m5.map(x=>N(x[4])),c15=m15.map(x=>N(x[4])),c1=m1.map(x=>N(x[4]));
  let mom='WAIT',scalp='WAIT',ms=0,ss=0,atr=ATR(m5),mr=[],sr=[];
  let support=0,resistance=0;
  if(m5.length>=10){const rc=m5.slice(-20);support=Math.min(...rc.map(x=>N(x[3])));resistance=Math.max(...rc.map(x=>N(x[2])))}
  if(c5.length>=60&&c15.length>=60){
    const e9=EMA(m5,9),e21=EMA(m5,21),e20=EMA(m15,20),e50=EMA(m15,50),r=RSI(m5),v=VR(m5),
      d=(c5.at(-1)-c5.at(-2))/Math.max(c5.at(-2),1e-9),
      bull=N(c15.at(-1))>e20&&e20>e50&&N(c5.at(-1))>e9&&e9>e21,
      bear=N(c15.at(-1))<e20&&e20<e50&&N(c5.at(-1))<e9&&e9<e21;
    let bs=0,rs=0;
    if(bull)bs+=35;if(bear)rs+=35;
    if(v>=1.15){bs+=15;rs+=15}
    if(d>=.0005)bs+=15;if(d<=-.0005)rs+=15;
    if(r>=53&&r<=70)bs+=20;if(r<=47&&r>=30)rs+=20;
    if(N(t.c)>=.6)bs+=15;if(N(t.c)<=-.6)rs+=15;
    ms=Math.min(100,Math.max(bs,rs));
    if(bs>=80){mom='BUY';mr=['15m EMA20>EMA50','5m EMA9>EMA21','RSI '+r.toFixed(0),'vol '+v.toFixed(2)+'x','24H '+P(t.c)]}
    if(rs>=80){mom='SELL';mr=['15m EMA20<EMA50','5m EMA9<EMA21','RSI '+r.toFixed(0),'vol '+v.toFixed(2)+'x','24H '+P(t.c)]}
  }
  if(c1.length>=70&&c5.length>=70){
    const e8=EMA(m1,8),e21m=EMA(m1,21),e5=EMA(m5,9),e52=EMA(m5,21),r=RSI(m1),v=VR(m1),
      d=(c1.at(-1)-c1.at(-2))/Math.max(c1.at(-2),1e-9),
      bull5=N(c5.at(-1))>e5&&e5>e52,bear5=N(c5.at(-1))<e5&&e5<e52,
      px=N(c1.at(-1)),up=px>e8&&e8>e21m,down=px<e8&&e8<e21m,
      prev=m1.slice(-13,-1),hi=Math.max(...prev.map(x=>N(x[2]))),lo=Math.min(...prev.map(x=>N(x[3]))),
      breakUp=px>hi,breakDn=px<lo,
      body=Math.abs(N(m1.at(-1)[4])-N(m1.at(-1)[1]))/Math.max(N(m1.at(-1)[2])-N(m1.at(-1)[3]),1e-9),
      quality=body>=.35;
    let bs=0,rs=0;
    if(bull5)bs+=28;if(bear5)rs+=28;
    if(up)bs+=22;if(down)rs+=22;
    if(breakUp)bs+=22;if(breakDn)rs+=22;
    if(v>=1.30){bs+=16;rs+=16}
    if(r>=53&&r<=72)bs+=10;if(r<=47&&r>=28)rs+=10;
    if(N(t.c)>=.35)bs+=8;if(N(t.c)<=-.35)rs+=8;
    if(quality){bs+=4;rs+=4}
    ss=Math.min(100,Math.max(bs,rs));
    if(bs>=82&&px>N(m1.at(-2)[4])){scalp='BUY';sr=['5m EMA9>EMA21','1m EMA8>EMA21','breakout '+fmtPrice(hi),'RSI '+r.toFixed(0),'vol '+v.toFixed(2)+'x']}
    if(rs>=82&&px<N(m1.at(-2)[4])){scalp='SELL';sr=['5m EMA9<EMA21','1m EMA8<EMA21','breakdown '+fmtPrice(lo),'RSI '+r.toFixed(0),'vol '+v.toFixed(2)+'x']}
  }
  const trend=mom==='BUY'?'BULLISH':mom==='SELL'?'BEARISH':scalp==='BUY'?'BULLISH':scalp==='SELL'?'BEARISH':'NEUTRAL';
  /* Confirmed Signal Pipeline: STABLE50 -> 24H MOMENTUM -> VOLUME FILTER -> 1M -> 5M -> 15M -> QUALITY SCORE -> stage */
  let stage='WATCH',confirmed=false,qualityScore=0,confirmReasons=[];
  const has24h=Math.abs(N(t.c))>=0.35;
  // Recompute pipeline inputs here so confirmation never depends on block-scoped variables above.
  const pipelineVol=VR(m5);
  const pipelineE20=EMA(m15,20);
  const pipelineE50=EMA(m15,50);
  const lastM1=m1.at(-1);
  const pipelineQuality=lastM1?Math.abs(N(lastM1[4])-N(lastM1[1]))/Math.max(N(lastM1[2])-N(lastM1[3]),1e-9)>=.35:false;
  const hasVol=pipelineVol>=VOL_FILTER;
  const m1Confirm=scalp!=='WAIT';
  const m5Confirm=mom!=='WAIT';
  const m15Bull=c15.length>=50&&N(c15.at(-1))>pipelineE20&&pipelineE20>pipelineE50;
  const m15Bear=c15.length>=50&&N(c15.at(-1))<pipelineE20&&pipelineE20<pipelineE50;
  const m15Confirm=m15Bull||m15Bear;
  if(has24h){confirmReasons.push('24H '+P(t.c))}
  if(hasVol){confirmReasons.push('Vol '+pipelineVol.toFixed(2)+'x')}
  if(m1Confirm){confirmReasons.push('1M '+scalp)}
  if(m5Confirm){confirmReasons.push('5M '+mom)}
  if(m15Confirm){confirmReasons.push('15m '+(m15Bull?'BULL':'BEAR'))}
  const sigDir=mom==='BUY'||scalp==='BUY'?'BUY':mom==='SELL'||scalp==='SELL'?'SELL':'NONE';
  qualityScore=Math.min(100,Math.round((has24h?10:0)+(hasVol?15:0)+(m1Confirm?25:0)+(m5Confirm?25:0)+(m15Confirm?15:0)+(pipelineQuality?10:0)));
  if(has24h&&hasVol&&(m1Confirm||m5Confirm)){stage='SETUP';confirmReasons.push('Quality '+qualityScore)}
  if(stage==='SETUP'&&qualityScore>=QUALITY_MIN&&m15Confirm){stage='CONFIRMED';confirmed=true;confirmReasons.push('CONFIRMED')}
  return{s,p:N(t.p),c:N(t.c),v:N(t.v),m:ms,sc:ss,momentum:mom,scalp,atr,funding:N(t.funding),oi:N(t.oi),support,resistance,trend,
    stage,confirmed,qualityScore,confirmReasons:confirmReasons.join(' · '),
    reasons:(mr.length?mr:sr.length?sr:['Waiting for closed-candle confirmation']).join(' · ')};
}
function signal(x,e){return e==='MOMENTUM'?x.momentum:x.scalp}
function riskModel(x,e,equity){
  const raw=(x.atr||x.p*.006)/Math.max(x.p,1e-9),
    stop=e==='SCALPING'?Math.min(Math.max(raw,.004),.008):Math.min(Math.max(raw*.95,.0055),.012),
    risk=Math.max(N(equity)*.004,5),
    maxNotional=Math.max(N(equity)*.12,100),
    rawQ=risk/Math.max(x.p*stop,1e-9),
    q=Math.min(rawQ,maxNotional/Math.max(x.p,1e-9));
  return{stop,risk,q};
}
function canOpen(x,e){
  if(!x||!x.p||signal(x,e)==='WAIT')return false;
  if(!x.confirmed)return false;
  if(S.emergencyStop)return false;
  if(S.pos.some(p=>p.s===x.s))return false;
  if(S.pos.filter(p=>p.e===e).length>=(e==='MOMENTUM'?MC:e==='SCALPING'?SC:OC))return false;
  const cd=e==='MOMENTUM'?MOM_COOLDOWN:e==='SCALPING'?SCALP_COOLDOWN:COOLDOWN;
  if(Date.now()-N(S.lastTrade[x.s]||0)<cd)return false;
  return true;
}
function dailyRiskReset(){
  const today=new Date().toDateString();
  if(S.dailyRiskDate!==today){S.dailyRiskDate=today;S.dailyRiskUsed=0}
}
function dailyRiskEnabled(){return S.mode==='LIVE'}
function dailyRiskOK(){
  dailyRiskReset();
  // Daily risk limit is a LIVE-only safety gate. PAPER/TESTNET must not
  // stop entries or profit rotation because of the LIVE risk budget.
  return !dailyRiskEnabled()||S.dailyRiskUsed<DAILY_RISK_LIMIT;
}
function recordDailyRisk(risk,equity){
  if(dailyRiskEnabled())S.dailyRiskUsed+=N(risk)/Math.max(N(equity),1);
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
    entryFee:ef,pnl:-ef,feeRate:F,mode:S.mode,reason:x.reasons,opened:Date.now(),signalStage:x.stage,qualityScore:x.qualityScore});
  recordDailyRisk(r.risk,S.eq);
  S.lastTrade[x.s]=Date.now();
  S.hist.unshift({time:Date.now(),s:x.s,e,side:z,action:'ENTRY',price:entryPx,qty:r.q,pnl:0,fees:ef,live:S.mode==='LIVE',mode:S.mode,reason:x.reasons,signalStage:x.stage,qualityScore:x.qualityScore});
  save();return true;
}
async function testnetOpen(x,e){
  // Final server-side/client-side safety gate: TESTNET may never place an
  // automatic or manual order unless the signal is fully CONFIRMED.
  // This protects against any alternate entry path bypassing engine filters.
  if(S.mode!=='TESTNET')return false;
  if(!x||x.confirmed!==true){
    S.err='TESTNET: '+(x?.s||'Unknown symbol')+' skipped — signal is not CONFIRMED. No order was placed.';
    return false;
  }
  if(!['MOMENTUM','SCALPING'].includes(e)||!canOpen(x,e))return false;
  if(!S.testnetSymbolsReady)return false;
  if(S.testnetRejectedSymbols.has(x.s)){return false;}
  if(!S.testnetSymbols.has(x.s)){S.err='TESTNET: '+x.s+' is not supported by Binance Futures Demo — skipped';return false;}
  if(S.testnetRestricted){S.err='TESTNET: Binance Futures Demo is unavailable from this deployment location.';return false}
  const z=signal(x,e),r=riskModel(x,e,N(S.testnetAccount?.availableBalance)||S.eq);
  if(!Number.isFinite(r.q)||r.q<=0)return false;
  try{
    const resp=await fetch(TN_TR,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'order',symbol:x.s,side:z,quantity:r.q,type:'MARKET',stopPct:r.stop})});
    const j=await resp.json();
    if(j.testnetUnavailable||j.restricted){
      S.testnetRestricted=true;S.auto=false;
      try{localStorage.setItem('ddTestnetRestrictedAt',String(Date.now()))}catch(e){}
      S.err='TESTNET: '+(j.error||'Binance Futures Demo trading is unavailable from this deployment location or account eligibility.');
      render();return false;
    }
    if(!resp.ok){
      const msg=String(j.error||j.msg||'Testnet order failed');
      if(Number(j.code)===-1121||/invalid symbol/i.test(msg)){
        S.testnetRejectedSymbols.add(x.s);
        // Remove Demo-rejected symbols from the active universe immediately.
        // This prevents the engine from moving from one rejected coin to another
        // on every scan while keeping the symbol blacklist in memory.
        S.stableUniverse=S.stableUniverse.filter(s=>s!==x.s);
        S.universe=S.universe.filter(s=>s!==x.s);
        S.rows=S.rows.filter(r=>r.s!==x.s);
        try{localStorage.setItem('dd_stable_universe_v1',JSON.stringify(S.stableUniverse))}catch(e){}
        S.err='TESTNET: '+x.s+' — Binance Futures Demo rejected this symbol. No order was placed. It has been removed from the TESTNET trading universe.';
        render();
        return false;
      }
      throw Error(msg);
    }
    const ent=j.entry||j,fillPx=N(ent.avgPrice)||x.p;
    S.pos.push({id:'tn-'+Date.now(),s:x.s,e,side:z,entry:fillPx,current:fillPx,q:N(j.quantity)||r.q,
      sl:z==='BUY'?fillPx*(1-r.stop):fillPx*(1+r.stop),tp:z==='BUY'?fillPx*(1+2*r.stop):fillPx*(1-2*r.stop),
      entryFee:0,pnl:0,feeRate:F,mode:'TESTNET',orderId:ent.orderId,reason:x.reasons,opened:Date.now(),signalStage:x.stage,qualityScore:x.qualityScore});
    recordDailyRisk(r.risk,S.eq);
    S.lastTrade[x.s]=Date.now();
    S.hist.unshift({time:Date.now(),s:x.s,e,side:z,action:'ENTRY',price:fillPx,qty:N(j.quantity)||r.q,pnl:0,fees:0,live:true,mode:'TESTNET',reason:x.reasons,signalStage:x.stage,qualityScore:x.qualityScore});
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
    recordDailyRisk(r.risk,S.eq);
    S.hist.unshift({time:Date.now(),s:x.s,e,side:z,action:'ENTRY',orderId:ent.orderId,price:N(ent.avgPrice)||x.p,qty:r.q,pnl:0,fees:0,live:true,mode:'LIVE',reason:x.reasons,signalStage:x.stage,qualityScore:x.qualityScore});
    S.lastTrade[x.s]=Date.now();await syncAccount();save();return true;
  }catch(err){S.err='LIVE: '+err.message;return false}
}

/* ===== Engine (confirmed-only entries + emergency stop + daily risk) ===== */
async function engine(){
  if(!S.auto||S.emergencyStop)return;
  dailyRiskReset();
  const arr=S.rows.filter(x=>x.confirmed&& (S.mode!=='TESTNET'||(S.testnetSymbolsReady&&S.testnetSymbols.has(x.s)&&!S.testnetRejectedSymbols.has(x.s)))).sort((a,b)=>b.qualityScore-a.qualityScore);
  for(const x of arr){
    if(!dailyRiskOK())break;
    if(S.mode==='PAPER'){
      if(x.momentum!=='WAIT'&&S.pos.filter(p=>p.e==='MOMENTUM').length<MC)paperOpen(x,'MOMENTUM');
      if(x.scalp!=='WAIT'&&S.pos.filter(p=>p.e==='SCALPING').length<SC)paperOpen(x,'SCALPING');
    }else if(S.mode==='TESTNET'){
      if(x.momentum!=='WAIT'&&S.pos.filter(p=>p.e==='MOMENTUM').length<MC)await testnetOpen(x,'MOMENTUM');
      if(x.scalp!=='WAIT'&&S.pos.filter(p=>p.e==='SCALPING').length<SC)await testnetOpen(x,'SCALPING');
    }else if(S.mode==='LIVE'&&S.liveAuto&&S.liveTrading){
      if(liveGates(x,'MOMENTUM').pass&&S.pos.filter(p=>p.e==='MOMENTUM').length<MC)await liveOpen(x,'MOMENTUM');
      if(liveGates(x,'SCALPING').pass&&S.pos.filter(p=>p.e==='SCALPING').length<SC)await liveOpen(x,'SCALPING');
    }
  }
  if(S.rotation.enabled&&!S.emergencyStop)await profitRotation();
}

/* ===== 16-Gate LIVE validation ===== */
function liveGates(x,e){
  const gates=[];
  const g=(id,pass,reason)=>gates.push({id,pass,reason:pass?'':reason});
  g(1,S.mode==='LIVE','Mode is not LIVE');
  g(2,S.liveTrading,'LIVE Trading is OFF');
  g(3,S.liveAuto,'LIVE AUTO is OFF');
  g(4,Boolean(S.account&&S.account.apiReady!==false),'Server credentials missing');
  g(5,S.account&&S.account.availableBalance>0,'API permission invalid or no balance');
  g(6,x&&x.s&&/^[A-Z0-9_]{5,30}$/.test(x.s),'Symbol invalid');
  g(7,N(x.p)>0,'Price invalid');
  g(8,signal(x,e)!=='WAIT','No valid signal');
  const r=riskModel(x,e,S.account?.availableBalance||0);
  g(9,Number.isFinite(r.q)&&r.q>0,'Risk invalid');
  const limit=e==='MOMENTUM'?MC:e==='SCALPING'?SC:OC;
  g(10,S.pos.filter(p=>p.e===e).length<limit,'Position limit reached');
  g(11,!S.pos.some(p=>p.s===x.s),'Duplicate symbol');
  const cd=e==='MOMENTUM'?MOM_COOLDOWN:e==='SCALPING'?SCALP_COOLDOWN:COOLDOWN;
  g(12,Date.now()-N(S.lastTrade[x.s]||0)>=cd,'Cooldown active');
  g(13,x.confirmed,'No confirmed signal');
  g(14,dailyRiskOK(),'Daily risk limit exceeded');
  g(15,!S.emergencyStop,'Emergency Stop is ACTIVE');
  g(16,signal(x,e)==='BUY'||signal(x,e)==='SELL','Invalid side');
  const failed=gates.filter(g=>!g.pass);
  return{pass:!failed.length,gates,failed:failed.map(g=>g.id+': '+g.reason)};
}

/* ===== Profit Rotation ===== */
async function closeForRotation(p){
  if(!p)return false;
  if(p.mode==='PAPER'){
    const px=N(S.t[p.s]?.p);if(!px)return false;
    const gross=p.side==='BUY'?(px-p.entry)*p.q:(p.entry-px)*p.q,ef=px*p.q*F;
    p.pnl=gross-p.entryFee-ef;S.real+=p.pnl;S.eq+=p.pnl;S.fees+=p.entryFee+ef;
    S.hist.unshift({time:Date.now(),s:p.s,e:p.e,side:p.side,action:'EXIT',entry:p.entry,exit:px,qty:p.q,pnl:p.pnl,fees:p.entryFee+ef,live:false,mode:'PAPER',reason:'Rotation',signalStage:p.signalStage||'CONFIRMED',qualityScore:N(p.qualityScore),rotationId:S.rotationId});
    S.pos=S.pos.filter(q=>q.id!==p.id);S.lastTrade[p.s]=Date.now();return true;
  }
  const base=p.mode==='TESTNET'?TN_TR:TR;
  try{
    const resp=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'close',symbol:p.s,side:p.side,quantity:p.q})});
    const j=await resp.json();
    if(!resp.ok)throw Error(j.error||'Rotation close failed');
    const px=N(j.avgPrice)||N(S.t[p.s]?.p)||p.current;
    const gross=p.side==='BUY'?(px-p.entry)*p.q:(p.entry-px)*p.q,ef=px*p.q*F;
    p.pnl=gross-p.entryFee-ef;S.real+=p.pnl;S.eq+=p.pnl;S.fees+=p.entryFee+ef;
    S.hist.unshift({time:Date.now(),s:p.s,e:p.e,side:p.side,action:'EXIT',entry:p.entry,exit:px,qty:p.q,pnl:p.pnl,fees:p.entryFee+ef,live:p.mode==='LIVE',mode:p.mode,reason:'Rotation',signalStage:p.signalStage||'CONFIRMED',qualityScore:N(p.qualityScore),rotationId:S.rotationId});
    S.pos=S.pos.filter(q=>q.id!==p.id);S.lastTrade[p.s]=Date.now();return true;
  }catch(err){S.err=(p.mode||'LIVE')+' rotation close: '+err.message;return false}
}

/* ===== Profit Rotation ===== */
async function profitRotation(){
  if(!S.auto||S.emergencyStop||!S.rotation.enabled)return;
  const confirmed=S.rows.filter(x=>x.confirmed===true&& (S.mode!=='TESTNET'||(S.testnetSymbolsReady&&S.testnetSymbols.has(x.s)&&!S.testnetRejectedSymbols.has(x.s)))).sort((a,b)=>b.qualityScore-a.qualityScore);
  if(!confirmed.length)return;
  const x=confirmed[0];
  const today=new Date().toDateString();if(S.rotation.rotationDate!==today){S.rotation.rotationDate=today;S.rotation.events=0}
  const attemptKey=[x.s,x.momentum,x.scalp,x.qualityScore].join('|');
  if(S.rotation.lastResult==='FAILED'&&S.rotation.lastAttemptKey===attemptKey)return;
  const e=x.momentum!=='WAIT'?'MOMENTUM':x.scalp!=='WAIT'?'SCALPING':'';
  if(!e)return;
  const limit=e==='MOMENTUM'?MC:SC;
  const inEngine=S.pos.filter(p=>p.e===e);
  if(inEngine.length<limit){return}
  if(!dailyRiskOK()){S.rotation.lastResult='BLOCKED';S.rotation.lastReason='Daily risk limit';return}
  if(S.pos.some(p=>p.s===x.s)){S.rotation.lastResult='BLOCKED';S.rotation.lastReason='Confirmed coin already open';return}
  const cd=e==='MOMENTUM'?MOM_COOLDOWN:SCALP_COOLDOWN;
  if(Date.now()-N(S.lastTrade[x.s]||0)<cd){S.rotation.lastResult='BLOCKED';S.rotation.lastReason='Cooldown active';return}
  S.rotation.lastAttemptKey=attemptKey;

  const profitable=inEngine.filter(p=>N(p.pnl)>0).sort((a,b)=>N(b.pnl)-N(a.pnl));
  const candidates=profitable.length?profitable:inEngine.filter(p=>N(p.pnl)<=0).sort((a,b)=>N(a.pnl)-N(b.pnl));
  const closedPos=candidates[0];
  if(!closedPos){S.rotation.lastResult='BLOCKED';S.rotation.lastReason='No position to rotate';return}

  S.rotationId++;
  const rotId=S.rotationId;
  const reason=profitable.length?'PROFIT ROTATION':'WORST LOSS ROTATION';
  if(!(await closeForRotation(closedPos))){
    S.rotation.lastResult='FAILED';S.rotation.lastReason=reason+' — close failed';save();return;
  }

  let opened=false;
  if(S.mode==='PAPER')opened=paperOpen(x,e);
  else if(S.mode==='TESTNET')opened=await testnetOpen(x,e);
  else if(S.mode==='LIVE'&&S.liveAuto&&S.liveTrading){
    const g=liveGates(x,e);
    if(g.pass)opened=await liveOpen(x,e); else S.err='LIVE rotation blocked: '+g.failed.join('; ');
  }

  if(opened){
    const newHist=S.hist[0];if(newHist)newHist.rotationId=rotId;
    S.rotation.lastRotation=Date.now();S.rotation.events++;S.rotation.lastEngine=e;
    S.rotation.lastClosed=closedPos.s+' ₹'+PNL(closedPos.pnl);S.rotation.lastOpened=x.s;
    S.rotation.lastReason=reason;S.rotation.lastResult='SUCCESS';S.rotation.lastAttemptKey=attemptKey;
  }else{
    S.rotation.lastResult='FAILED';S.rotation.lastReason=reason+' — replacement entry failed/blocked';S.rotation.lastAttemptKey=attemptKey;
  }
  save();render();
}

/* ===== Position management (preserved) ===== */
async function managePaper(){
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
      S.hist.unshift({time:Date.now(),s:p.s,e:p.e,side:p.side,action:'EXIT',entry:p.entry,exit:x,pnl:p.pnl,fees:p.entryFee+ef,live:p.mode==='LIVE',mode:p.mode,reason:p.reason,signalStage:p.signalStage||'',qualityScore:N(p.qualityScore)});
      S.lastTrade[p.s]=Date.now();S.pos=S.pos.filter(q=>q.id!==p.id);save();
    }
  }
  manageOptions();
}

/* ===== Account sync ===== */
async function syncAccount(){
  if(S.mode!=='LIVE')return;
  if(Date.now()-S.lastAccount<2500)return;
  S.lastAccount=Date.now();
  try{
    const a=await api(AC,'/fapi/v2/account');const bal=(a.assets||[]).find(x=>x.asset==='USDT');
    S.account={availableBalance:N(a.availableBalance||bal?.availableBalance),walletBalance:N(a.totalWalletBalance||bal?.walletBalance),unrealized:N(a.totalUnrealizedProfit),margin:N(a.totalMarginBalance),apiReady:true};
    if(S.mode==='LIVE')S.pos=(a.positions||[]).filter(p=>Math.abs(N(p.positionAmt))>0).map(p=>({id:'live-'+p.symbol,s:p.symbol,e:'LIVE',side:N(p.positionAmt)>0?'BUY':'SELL',entry:N(p.entryPrice),current:N(p.markPrice),q:Math.abs(N(p.positionAmt)),pnl:N(p.unRealizedProfit),sl:0,tp:0,mode:'LIVE'}));
  }catch(e){S.account={apiReady:false,error:e.message};S.err='Account sync: '+e.message}
}
async function syncTestnet(){
  if(S.mode!=='TESTNET')return;
  try{
    const a=await api(TN_AC,'/fapi/v2/account');
    if(a.testnetUnavailable||a.restricted){
      S.testnetRestricted=true;S.auto=false;
      try{localStorage.setItem('ddTestnetRestrictedAt',String(Date.now()))}catch(e){}
      S.err='TESTNET: '+(a.error||'Binance Futures Demo is unavailable from this deployment location.');
      return;
    }
    S.testnetRestricted=false;
    const bal=(a.assets||[]).find(x=>x.asset==='USDT');
    S.testnetAccount={availableBalance:N(a.availableBalance||bal?.availableBalance),walletBalance:N(a.totalWalletBalance||bal?.walletBalance),unrealized:N(a.totalUnrealizedProfit),margin:N(a.totalMarginBalance)};
  }catch(e){
    const msg=String(e.message||e);
    S.err=/invalid symbol/i.test(msg)?'TESTNET account sync returned an unexpected Invalid symbol response. Trading is blocked until Demo account sync succeeds.':'Testnet sync: '+msg;
  }
}
async function checkTestnetStatus(){
  try{const r=await fetch(TN_STATUS,{cache:'no-store'});if(r.ok)S.testnetStatus=await r.json()}catch(e){S.testnetStatus=null}
  if(S.mode==='TESTNET')await syncTestnetSymbols();
}
async function syncTestnetSymbols(){
  try{
    const r=await fetch(TN_SYMS,{cache:'no-store'});const j=await r.json();
    if(j.testnetUnavailable||j.restricted){S.testnetSymbolsReady=false;S.testnetRestricted=true;S.auto=false;S.err='TESTNET: '+(j.error||'Binance Futures Demo symbols are unavailable from this deployment location.');return false}
    if(!r.ok)throw Error(j.error||'Testnet symbol list failed');
    S.testnetSymbols=new Set(Array.isArray(j.symbols)?j.symbols:[]);
    // A symbol rejected by an actual Demo order remains blocked even if it still
    // appears in exchangeInfo; only a later symbol refresh that removes/re-adds
    // it should change that state.
    for(const s of [...S.testnetRejectedSymbols]){
      if(!S.testnetSymbols.has(s))S.testnetRejectedSymbols.delete(s);
    }
    S.testnetSymbolsReady=S.testnetSymbols.size>0;
    if(S.testnetSymbolsReady&&S.testnetRestricted){S.testnetRestricted=false}
    if(S.testnetSymbolsReady&&S.mode==='TESTNET'&&/invalid symbol|not supported by Binance Futures Demo/i.test(String(S.err||'')))S.err='';
    return true;
  }catch(e){
    S.testnetSymbols=new Set();S.testnetSymbolsReady=false;
    S.err='TESTNET: Demo symbol list could not be verified — '+String(e.message||e);
    return false;
  }
}

/* ===== Scanner (preserved, ranking by absolute 24h change) ===== */
async function scan(){
  if(S.busy)return;S.busy=true;
  try{
    // TESTNET universe must be built only from symbols verified by Binance Futures Demo.
    // The public market feed can contain contracts that Demo rejects for order placement.
    if(S.mode==='TESTNET'&&!S.testnetSymbolsReady){
      await syncTestnetSymbols();
    }
    const ex=await api(PUB,'/fapi/v1/exchangeInfo'),tt=await api(PUB,'/fapi/v1/ticker/24hr');
    const syms=new Set((ex.symbols||[]).filter(x=>x.contractType==='PERPETUAL'&&x.quoteAsset==='USDT'&&x.status==='TRADING').map(x=>x.symbol));
    (Array.isArray(tt)?tt:[]).forEach(x=>{if(syms.has(x.symbol))S.t[x.symbol]={p:N(x.lastPrice),c:N(x.priceChangePercent),v:N(x.quoteVolume)}});
    // Stable universe: pin first scan's top coins, then only update prices for those
    const count=N(S.settings.coinCount)||50;
    if(!S.stableUniverse.length){
      S.stableUniverse=[...syms].sort((a,b)=>Math.abs(N(S.t[b]?.c))-Math.abs(N(S.t[a]?.c))).slice(0,count);
      try{localStorage.setItem('dd_stable_universe_v1',JSON.stringify(S.stableUniverse))}catch(e){}
    }
    const demoOK=s=>S.mode!=='TESTNET'||(S.testnetSymbolsReady&&S.testnetSymbols.has(s)&&!S.testnetRejectedSymbols.has(s));
    const validStable=S.stableUniverse.filter(s=>syms.has(s)&&demoOK(s)&&/^[A-Z0-9_]{1,30}$/.test(s));
    if(validStable.length<count){
      const extras=[...syms].filter(s=>demoOK(s)&&/^[A-Z0-9_]{1,30}$/.test(s)&&!validStable.includes(s))
        .sort((a,b)=>Math.abs(N(S.t[b]?.c))-Math.abs(N(S.t[a]?.c)));
      validStable.push(...extras.slice(0,count-validStable.length));
      S.stableUniverse=validStable.slice(0,count);
      try{localStorage.setItem('dd_stable_universe_v1',JSON.stringify(S.stableUniverse))}catch(e){}
    }
    const top=validStable.slice(0,count);
    S.universe=top;
    if(S.mode==='TESTNET'&&S.err&&/Binance Futures Demo rejected this symbol|not supported by Binance Futures Demo/i.test(String(S.err))){
      S.err='';
    }
    S.rows=top.map(s=>({s,p:N(S.t[s]?.p),c:N(S.t[s]?.c),v:N(S.t[s]?.v),m:0,sc:0,momentum:'WAIT',scalp:'WAIT',atr:0,support:0,resistance:0,trend:'NEUTRAL',funding:0,reasons:'Loading'}));
    // Keep Binance requests below burst/rate limits: process the stable universe in small batches.
    const batchSize=8;
    for(let b=0;b<top.length;b+=batchSize){
      const batch=top.slice(b,b+batchSize);
      await Promise.all(batch.map(async s=>{
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
        }catch(e){
          const i=S.rows.findIndex(x=>x.s===s);
          if(i>=0)S.rows[i].reasons='Feed unavailable: '+String(e.message||'request failed').slice(0,80);
        }
      }));
    }
    S.lastScan=Date.now();S.err='';
    await syncAccount();
    if(S.mode==='TESTNET')await syncTestnetSymbols();
    await syncTestnet();
    await managePaper();await engine();render();
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

/* ===== Options (preserved logic, extended with 4 independent paper sets) ===== */
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
    // Mark-price bid/ask can be zero for thin contracts. Enrich from the
    // official Options ticker so paper execution never pretends a zero-liquidity
    // contract can be filled. Binance documents bid/ask on /eapi/v1/ticker.
    try{
      const ot=await api(PUB,'/eapi/v1/ticker');
      (Array.isArray(ot)?ot:[]).forEach(x=>{
        const q=S.optData.marks[x.symbol]||(S.optData.marks[x.symbol]={});
        q.bid=N(x.bidPrice)||q.bid||0;q.ask=N(x.askPrice)||q.ask||0;
        q.last=N(x.lastPrice)||q.last||0;q.vol=N(x.volume)||q.vol||0;
      });
    }catch(e){}
    const f=await api(PUB,'/fapi/v1/ticker/24hr');S.optData.underlying={};
    (Array.isArray(f)?f:[]).forEach(x=>{S.optData.underlying[x.symbol]={c:N(x.priceChangePercent),v:N(x.quoteVolume),p:N(x.lastPrice)}});
    buildOptions();
    if(S.auto&&S.mode==='PAPER')engineOptions();
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
function optChainData(u,tradableOnly=false){
  const all=S.optData.contracts.filter(x=>x.u===u&&x.ex>Date.now());
  if(!all.length)return null;
  // Same-day/near-expiry contracts remain visible in the radar/chain, but
  // automatic trading only considers expiries with at least 24 hours left.
  const eligible=tradableOnly?all.filter(x=>x.ex-Date.now()>=24*60*60*1000):all;
  if(!eligible.length)return null;
  const exs={};eligible.forEach(x=>{(exs[x.ex]||(exs[x.ex]=[])).push(x)});
  const ex=Object.keys(exs).map(Number).sort((a,b)=>a-b)[0],a=exs[ex]||[];
  const calls=a.filter(x=>x.side==='CALL').sort((x,y)=>x.k-y.k);
  const puts=a.filter(x=>x.side==='PUT').sort((x,y)=>y.k-x.k);
  const strikes=[...new Set(a.map(x=>x.k))].sort((a,b)=>a-b);
  return{calls,puts,strikes,expiry:ex};
}
/* Select a liquid defined-risk debit spread. No naked selling:
   BUY signal = long CALL + short higher-strike CALL.
   SELL signal = long PUT + short lower-strike PUT. */
function pickOptionSpread(u,signal){
  const cd=optChainData(u,true);if(!cd)return null;
  const u24=S.optData.underlying[u],spotPx=N(u24?.p);if(!spotPx)return null;
  const liquid=x=>{const m=S.optData.marks[x?.n];return !!(m&&m.p>0&&m.bid>0&&m.ask>0)};
  const choose=(arr,target,dir)=>{
    return arr.filter(liquid).sort((a,b)=>Math.abs(N(S.optData.marks[a.n]?.d)-target)-Math.abs(N(S.optData.marks[b.n]?.d)-target))[0];
  };
  if(signal==='BUY'){
    const long=choose(cd.calls,0.55,1);if(!long)return null;
    const higher=cd.calls.filter(x=>x.k>long.k).filter(liquid).sort((a,b)=>Math.abs(a.k-long.k)-Math.abs(b.k-long.k))[0];
    if(!higher)return null;
    const lm=S.optData.marks[long.n],sm=S.optData.marks[higher.n];
    const debit=N(lm.ask)-N(sm.bid);
    if(debit<=0)return null;
    return{u,signal,type:'CALL_DEBIT_SPREAD',long,short:higher,longMark:lm,shortMark:sm,debit,spot:spotPx,expiry:cd.expiry};
  }
  if(signal==='SELL'){
    const long=choose(cd.puts,-0.55,-1);if(!long)return null;
    const lower=cd.puts.filter(x=>x.k<long.k).filter(liquid).sort((a,b)=>Math.abs(long.k-a.k)-Math.abs(long.k-b.k))[0];
    if(!lower)return null;
    const lm=S.optData.marks[long.n],sm=S.optData.marks[lower.n];
    const debit=N(lm.ask)-N(sm.bid);
    if(debit<=0)return null;
    return{u,signal,type:'PUT_DEBIT_SPREAD',long,short:lower,longMark:lm,shortMark:sm,debit,spot:spotPx,expiry:cd.expiry};
  }
  return null;
}
function spreadQty(pick){
  const lf=(pick.long.filters||[]).find(x=>x.filterType==='LOT_SIZE')||{};
  const sf=(pick.short.filters||[]).find(x=>x.filterType==='LOT_SIZE')||{};
  const min=Math.max(N(pick.long.minQty),N(pick.short.minQty),N(lf.minQty),N(sf.minQty),0.01);
  const max=Math.min(N(pick.long.maxQty)||Infinity,N(pick.short.maxQty)||Infinity,N(lf.maxQty)||Infinity,N(sf.maxQty)||Infinity);
  const step=Math.max(N(lf.stepSize),N(sf.stepSize),0.01);
  const raw=Math.max((S.eq*OPT_RISK)/(pick.debit*Math.max(pick.spot,1e-9)),min);
  let q=Math.floor(raw/step)*step;
  q=Number(q.toFixed(8));
  if(q<min)q=min;
  if(q>max)q=Math.floor(max/step)*step;
  return q;
}
/* Open one independent paper spread set. Both legs are entered together;
   only the net debit is at risk, so the position is defined-risk. */
function optionOpen(setIdx,u,signal){
  if(S.mode!=='PAPER'||S.emergencyStop)return false;
  const base=S.rows.find(r=>r.s===u);if(!base||!base.confirmed)return false;
  const set=S.optSets[setIdx];if(!set||set.status==='OPEN')return false;
  const pick=pickOptionSpread(u,signal);if(!pick){set.status='ERROR';set.reason='No liquid defined-risk spread (24h+ expiry)';return false}
  const qty=spreadQty(pick);
  if(!Number.isFinite(qty)||qty<=0)return false;
  const entryFee=pick.debit*qty*pick.spot*F;
  const entryPx=pick.debit;
  set.status='OPEN';set.symbol=u;set.side=signal;set.entry=entryPx;set.current=entryPx;set.qty=qty;
  set.contract=pick.long.n+' / '+pick.short.n;set.longContract=pick.long.n;set.shortContract=pick.short.n;
  set.expiry=pick.expiry;set.strike=pick.long.k;set.shortStrike=pick.short.k;set.pnl=-entryFee;set.entryFee=entryFee;
  set.opened=Date.now();set.reason=pick.type+' · BUY '+pick.long.n+' / SELL '+pick.short.n;
  S.hist.unshift({time:Date.now(),s:u,e:'OPTIONS',side:signal,action:'ENTRY',price:entryPx,qty,fees:entryFee,pnl:0,live:false,mode:'PAPER',reason:set.reason,optSet:setIdx+1,contract:set.contract,signalStage:base.stage,qualityScore:base.qualityScore});
  save();return true;
}
function manageOptions(){
  if(S.mode!=='PAPER')return;
  for(const set of S.optSets){
    if(set.status!=='OPEN')continue;
    const lm=S.optData.marks[set.longContract],sm=S.optData.marks[set.shortContract];
    if(!lm||!sm||lm.bid<=0||sm.ask<=0)continue;
    set.current=Math.max(0,N(lm.bid)-N(sm.ask));
    const uSpot=N(S.optData.underlying[set.symbol]?.p);
    const notional=set.current*set.qty*Math.max(uSpot,1e-9);
    const exitFee=notional*F;
    const gross=(set.current-set.entry)*set.qty*Math.max(uSpot,1e-9);
    set.pnl=gross-set.entryFee-exitFee;
    const pnlPct=set.entry>0?(set.current-set.entry)/set.entry:0;
    const hitSL=pnlPct<=-OPT_STOP,hitTP=pnlPct>=OPT_TP,expired=set.expiry&&Date.now()>=set.expiry;
    if(hitSL||hitTP||expired){
      S.real+=set.pnl;S.optReal+=set.pnl;S.eq+=set.pnl;S.fees+=set.entryFee+exitFee;S.optFees+=set.entryFee+exitFee;
      S.hist.unshift({time:Date.now(),s:set.symbol,e:'OPTIONS',side:set.side,action:'EXIT',entry:set.entry,exit:set.current,qty:set.qty,pnl:set.pnl,fees:set.entryFee+exitFee,live:false,mode:'PAPER',reason:expired?'Expiry':(hitSL?'Stop loss':'Take profit'),optSet:set.id,contract:set.contract,signalStage:'CONFIRMED',qualityScore:N((S.rows.find(r=>r.s===set.symbol)||{}).qualityScore)});
      set.status='CLOSED';set.closed=Date.now();set.pnl=0;set.entry=0;set.current=0;set.qty=0;set.contract='';set.longContract='';set.shortContract='';set.entryFee=0;
    }
  }
  save();
}
function engineOptions(){
  if(S.mode!=='PAPER'||!S.auto||S.emergencyStop)return;
  const active=S.optData.rows.filter(x=>x.signal!=='WATCH'&&S.rows.some(r=>r.s===x.u&&r.confirmed));
  if(!active.length)return;
  for(const row of active){
    for(let i=0;i<OPT_SETS;i++){
      const set=S.optSets[i];
      if(set.status==='OPEN')continue;
      if(set.status==='SIGNAL'&&set.symbol===row.u)continue;
      if(Date.now()-N(set.closed)<OPT_COOLDOWN&&set.status==='CLOSED')continue;
      if(S.pos.some(p=>p.s===row.u&&p.e==='OPTIONS'))continue;
      const pick=pickOptionSpread(row.u,row.signal);
      if(!pick){set.status='ERROR';set.reason='No liquid defined-risk spread (24h+ expiry)';continue}
      set.status='SIGNAL';set.symbol=row.u;set.side=row.signal;set.reason='Signal: '+row.signal+' on '+row.u+' ('+P(row.change)+' 24H)';
      if(!optionOpen(i,row.u,row.signal))set.status='ERROR';
      break;
    }
  }
  for(const set of S.optSets){
    if(set.status==='SIGNAL'){
      const stillActive=S.optData.rows.find(x=>x.u===set.symbol&&x.signal===set.side);
      if(!stillActive)set.status='WAITING';
    }
  }
}

/* ===== PNL / Analytics ===== */

function statsFor(histArr){
  // Every completed trade is represented by exactly one EXIT record.
  // ENTRY records are intentionally excluded so dashboard W/L counts cannot
  // disagree with the number of completed trades.
  const exits=histArr.filter(h=>h.action==='EXIT');
  const wins=exits.filter(h=>N(h.pnl)>0),losses=exits.filter(h=>N(h.pnl)<0);
  const totalPnl=exits.reduce((s,h)=>s+N(h.pnl),0),totalFees=exits.reduce((s,h)=>s+N(h.fees),0);
  const winRate=exits.length?wins.length/exits.length*100:0;
  const avgWin=wins.length?wins.reduce((s,h)=>s+N(h.pnl),0)/wins.length:0;
  const avgLoss=losses.length?losses.reduce((s,h)=>s+N(h.pnl),0)/losses.length:0;
  const grossProfit=wins.reduce((s,h)=>s+N(h.pnl),0);
  const grossLoss=Math.abs(losses.reduce((s,h)=>s+N(h.pnl),0));
  const profitFactor=grossLoss?grossProfit/grossLoss:0;
  // EXIT pnl is already NET of entry + exit fees. Do not subtract fees again.
  // Fees are tracked separately for reporting only.
  let peak=0,dd=0,cum=0;
  exits.slice().reverse().forEach(h=>{cum+=N(h.pnl);peak=Math.max(peak,cum);dd=Math.max(dd,peak-cum)});
  return{trades:exits.length,wins:wins.length,losses:losses.length,winRate,totalPnl,totalFees,netPnl:totalPnl,avgWin,avgLoss,profitFactor,maxDD:dd};
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
    const stageCls=x.stage==='CONFIRMED'?'buy':x.stage==='SETUP'?'watch':'neutral-text';
    return '<tr><td>'+(i+1)+'</td><td><span class="coin">'+E(x.s)+'</span></td><td>'+fmtPrice(x.p)+'</td>'+
      '<td class="'+cl(x.c)+'">'+P(x.c)+'</td><td>'+R(x.v/1e6)+'M</td><td>'+volSpike.toFixed(2)+'x</td>'+
      '<td class="'+(x.momentum==='BUY'?'buy':x.momentum==='SELL'?'sell':'neutral-text')+'">'+x.momentum+'</td><td>'+x.m+'</td>'+
      '<td class="'+(x.scalp==='BUY'?'buy':x.scalp==='SELL'?'sell':'neutral-text')+'">'+x.scalp+'</td><td>'+x.sc+'</td>'+
      '<td class="'+stageCls+'">'+E(x.stage||'WATCH')+'</td><td>'+(x.qualityScore||0)+'</td>'+
      '<td class="'+(x.trend==='BULLISH'?'buy':x.trend==='BEARISH'?'sell':'neutral-text')+'">'+x.trend+'</td>'+
      '<td style="font-size:9px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis">'+E(x.confirmReasons||x.reasons)+'</td>'+
      '<td>'+signalBadge(z==='WAIT'?'NEUTRAL':z)+'</td>'+
      '<td>'+((S.mode==='TESTNET'&&S.testnetRejectedSymbols.has(x.s))?'<span class="neutral-text">Demo Skip</span>':'<button class="btn sm blue" onclick="DD.manualEntry(\''+E(x.s)+'\',\''+E(z)+'\')">Trade</button>')+'</td></tr>';
  }).join('');
  const fb='<div class="filters"><span class="filter-label">Search:</span><input class="filter-input" id="filter-coin-scan" placeholder="Coin name…" value="'+E(S.filterCoin)+'" oninput="DD.filterCoin=this.value;DD.render()"></div>';
  return fb+'<div class="table-scroll"><table class="term"><thead><tr><th>#</th><th>Coin</th><th>Price</th><th>24H</th><th>24H Vol</th><th>Vol Spike</th><th>Mom</th><th>Mom Score</th><th>Scalp</th><th>Scalp Score</th><th>Stage</th><th>Quality</th><th>Trend</th><th>Confirmations</th><th>Signal</th><th>Action</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
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
      '<td>'+fmtPrice(h.entry||h.price)+'</td><td>'+fmtPrice(h.exit||0)+'</td><td>'+fmtQty(h.qty)+'</td><td>'+E(h.signalStage||'—')+'</td><td>'+(h.qualityScore!=null?N(h.qualityScore):'—')+'</td><td>'+E(h.rotationId||'—')+'</td>'+
      '<td>₹'+R(h.fees)+'</td><td>₹'+R(N(h.pnl)+N(h.fees))+'</td><td class="'+cl(pnl)+'">₹'+PNL(pnl)+'</td>'+
      '<td class="'+cl(pnl)+'">'+P(pnlPct)+'</td><td>'+(pnl>0?'<span class="buy">WIN</span>':'<span class="sell">LOSS</span>')+'</td></tr>';
  }).join('');
  return fb+'<div class="table-scroll"><table class="term"><thead><tr><th>Time</th><th>Coin</th><th>Mode</th><th>Strategy</th><th>Side</th><th>Entry</th><th>Exit</th><th>Qty</th><th>Stage</th><th>Quality</th><th>Rotation ID</th><th>Fees</th><th>Gross PNL</th><th>Net PNL</th><th>PNL%</th><th>Result</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
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
  return fb+'<div class="table-scroll"><table class="term"><thead><tr><th>Time</th><th>Coin</th><th>Mode</th><th>Strategy</th><th>Side</th><th>Entry</th><th>Exit</th><th>Qty</th><th>Stage</th><th>Quality</th><th>Rotation ID</th><th>Fees</th><th>Gross PNL</th><th>Net PNL</th><th>PNL%</th><th>Result</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
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
  const banner=S.mode==='LIVE'?'<div class="mode-banner live"><b>LIVE TRADING '+(S.liveTrading?'ACTIVE':'OFF')+'</b> — Real Binance orders. Trade carefully.</div>'
    :S.mode==='TESTNET'?'<div class="mode-banner testnet"><b>TESTNET ACTIVE</b> — Binance Futures Demo (simulated funds)</div>'
    :'<div class="mode-banner paper"><b>PAPER TRADING</b> — Local simulation · Real orders OFF</div>';
  const autoRow='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
    '<div class="auto-toggle '+(S.auto?'on':'')+'" onclick="DD.toggleAuto()"><div class="sw"></div><span class="lbl">AUTO '+(S.auto?'ON':'OFF')+'</span></div>'+
    (S.mode==='LIVE'?'<div class="auto-toggle '+(S.liveTrading?'on':'')+'" onclick="DD.toggleLiveTrading()"><div class="sw"></div><span class="lbl">LIVE TRADING '+(S.liveTrading?'ON':'OFF')+'</span></div>'+
    '<div class="auto-toggle '+(S.liveAuto?'on':'')+'" onclick="DD.toggleLiveAuto()"><div class="sw"></div><span class="lbl">LIVE AUTO '+(S.liveAuto?'ON':'OFF')+'</span></div>':'')+
    '<div class="auto-toggle '+(S.emergencyStop?'on':'')+'" onclick="DD.toggleEmergency()" style="'+(S.emergencyStop?'border-color:var(--red)':'')+'"><div class="sw" style="'+(S.emergencyStop?'background:var(--red)':'')+'"></div><span class="lbl" style="'+(S.emergencyStop?'color:var(--red)':'')+'">EMERGENCY '+(S.emergencyStop?'ACTIVE':'OFF')+'</span></div>'+
    '<button class="btn blue sm" onclick="DD.scan()">Refresh Scanner</button>'+
    '<button class="btn sm" onclick="DD.reconnect()">Reconnect WS</button></div>';
  /* System Status Panel */
  const momCount=S.pos.filter(p=>p.e==='MOMENTUM').length;
  const scalpCount=S.pos.filter(p=>p.e==='SCALPING').length;
  const optCount=S.optSets.filter(s=>s.status==='OPEN').length;
  const momStatus=momCount>=MC?'FULL':S.emergencyStop?'BLOCKED':'READY';
  const scalpStatus=scalpCount>=SC?'FULL':S.emergencyStop?'BLOCKED':'READY';
  const optStatus=optCount>=OPT_SETS?'FULL':S.emergencyStop?'BLOCKED':'READY';
  const hasConfirmed=S.rows.some(x=>x.confirmed);
  const riskOK=dailyRiskOK();
  const sysPanel='<div class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">System Status</div></div>'+
    '<div class="kpi-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">'+
    '<div class="stat-badge '+(S.lastScan?'online':'offline')+'"><div class="dot"></div><span>Market Feed</span></div>'+
    '<div class="stat-badge '+(S.lastScan?'online':'offline')+'"><div class="dot"></div><span>Scanner</span></div>'+
    '<div class="stat-badge online"><div class="dot"></div><span>Signal Engine</span></div>'+
    '<div class="stat-badge '+(S.wsStatus==='online'?'online':'connecting')+'"><div class="dot"></div><span>WebSocket '+E(S.wsStatus.toUpperCase())+'</span></div>'+
    '<div class="stat-badge online"><div class="dot"></div><span>Render Loop</span></div>'+
    '</div></div>';
  const enginePanel='<div class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">Trading Engines</div></div>'+
    '<div class="kpi-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">'+
    '<div class="kpi-card"><div class="kpi-label">MOMENTUM</div><div class="kpi-value" style="font-size:14px">'+momCount+'/'+MC+' '+momStatus+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">SCALPING</div><div class="kpi-value" style="font-size:14px">'+scalpCount+'/'+SC+' '+scalpStatus+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">OPTIONS</div><div class="kpi-value" style="font-size:14px">'+optCount+'/'+OPT_SETS+' '+optStatus+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">PROFIT ROTATION</div><div class="kpi-value" style="font-size:14px;color:'+(S.rotation.enabled?'var(--green)':'var(--muted)')+'">'+(S.rotation.enabled?'ON':'OFF')+'</div><div class="kpi-sub">Events: '+S.rotation.events+'</div></div>'+
    '</div></div>';
  const riskPanel='<div class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">Risk & Mode</div></div>'+
    '<div class="kpi-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">'+
    '<div class="kpi-card"><div class="kpi-label">Confirmed Signal</div><div class="kpi-value" style="font-size:14px;color:'+(hasConfirmed?'var(--green)':'var(--muted)')+'">'+(hasConfirmed?'YES':'NO')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Risk Gate</div><div class="kpi-value" style="font-size:14px;color:'+(riskOK?'var(--green)':'var(--red)')+'">'+(riskOK?'PASS':'FAIL')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Daily Risk</div><div class="kpi-value" style="font-size:14px">'+(dailyRiskEnabled()?(S.dailyRiskUsed*100).toFixed(1)+'% / '+(DAILY_RISK_LIMIT*100)+'%':'OFF — LIVE only')+'</div></div>'+    '<div class="kpi-card"><div class="kpi-label">Emergency Stop</div><div class="kpi-value" style="font-size:14px;color:'+(S.emergencyStop?'var(--red)':'var(--green)')+'">'+(S.emergencyStop?'ACTIVE':'OFF')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Paper</div><div class="kpi-value" style="font-size:14px;color:'+(S.mode==='PAPER'?'var(--green)':'var(--muted)')+'">'+(S.mode==='PAPER'?'ACTIVE':'OFF')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Testnet</div><div class="kpi-value" style="font-size:14px;color:'+(S.mode==='TESTNET'?'var(--cyan)':'var(--muted)')+'">'+(S.mode==='TESTNET'?'ACTIVE':'OFF')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Live Trading</div><div class="kpi-value" style="font-size:14px;color:'+(S.liveTrading?'var(--red)':'var(--muted)')+'">'+(S.liveTrading?'ON':'OFF')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Live Auto</div><div class="kpi-value" style="font-size:14px;color:'+(S.liveAuto?'var(--red)':'var(--muted)')+'">'+(S.liveAuto?'ON':'OFF')+'</div></div>'+
    '</div></div>';
  /* Rotation Panel */
  const rotPanel='<div class="panel" style="margin-bottom:8px"><div class="panel-header"><div class="panel-title">Profit Rotation</div><div class="panel-sub">'+(S.rotation.enabled?'ON':'OFF')+' · Events Today: '+S.rotation.events+'</div></div>'+
    '<div class="kpi-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">'+
    '<div class="kpi-card"><div class="kpi-label">Last Rotation</div><div class="kpi-value" style="font-size:12px">'+(S.rotation.lastRotation?new Date(S.rotation.lastRotation).toLocaleTimeString('en-IN'):'—')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Engine</div><div class="kpi-value" style="font-size:12px">'+E(S.rotation.lastEngine||'—')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Closed</div><div class="kpi-value" style="font-size:12px">'+E(S.rotation.lastClosed||'—')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Opened</div><div class="kpi-value" style="font-size:12px">'+E(S.rotation.lastOpened||'—')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Reason</div><div class="kpi-value" style="font-size:12px">'+E(S.rotation.lastReason||'—')+'</div></div>'+
    '<div class="kpi-card"><div class="kpi-label">Result</div><div class="kpi-value" style="font-size:12px;color:'+(S.rotation.lastResult==='SUCCESS'?'var(--green)':S.rotation.lastResult==='FAILED'?'var(--red)':'var(--muted)')+'">'+E(S.rotation.lastResult||'—')+'</div></div>'+
    '</div></div>';
  return banner+autoRow+sysPanel+enginePanel+riskPanel+rotPanel+cards+'<div class="panel"><div class="panel-header"><div class="panel-title">Live Scanner — STABLE '+(S.stableUniverse.length||S.settings.coinCount||50)+' · Top '+(S.rows.length||0)+' by 24H Change</div><div class="panel-sub">Last scan: '+(S.lastScan?new Date(S.lastScan).toLocaleTimeString('en-IN'):'—')+'</div></div>'+scannerTable()+'</div>';
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
  const optOpen=S.optSets.filter(s=>s.status==='OPEN').length;
  const optUnreal=S.optSets.filter(s=>s.status==='OPEN').reduce((a,s)=>a+N(s.pnl),0);
  const optClosed=S.hist.filter(h=>h.e==='OPTIONS'&&h.action==='EXIT').length;
  const optMetrics='<div class="kpi-grid">'+kpiCard('Options Open',optOpen+'/'+OPT_SETS)+kpiCard('Options Closed',optClosed)+kpiCard('Options Realized PNL','₹'+PNL(S.optReal),pnlClass(S.optReal))+kpiCard('Options Unrealized PNL','₹'+PNL(optUnreal),pnlClass(optUnreal))+kpiCard('Options Fees','₹'+R(S.optFees))+kpiCard('Net Contribution','₹'+PNL(S.optReal+optUnreal-S.optFees),pnlClass(S.optReal+optUnreal-S.optFees))+'</div>';
  let html='<div class="panel"><div class="panel-header"><div class="panel-title">Binance Options Radar</div><div class="panel-sub">All underlyings · defined-risk spreads · naked selling OFF</div></div>';
  html=optMetrics+html;
  if(S.optLoading&&!rows.length)return html+'<div class="note">Loading options radar…</div></div>';
  if(!rows.length)return html+'<div class="note">No option data. <button class="btn sm" onclick="DD.scanOptions()">Scan Options</button></div></div>';
  const active=rows.filter(x=>x.signal!=='WATCH');
  html+='<div class="note info">'+rows.length+' option-enabled underlyings · '+active.length+' with qualifying signal · '+OPT_SETS+' independent paper sets</div>';
  const tbl=rows.slice(0,50).map((x,i)=>'<tr><td>'+(i+1)+'</td><td><span class="coin">'+E(x.u)+'</span></td><td>'+x.count+'</td><td class="'+cl(x.change)+'">'+P(x.change)+'</td><td>'+R(x.volume/1e6)+'M</td><td>'+(x.expiry?new Date(x.expiry).toLocaleDateString():'-')+'</td><td>'+(x.signal==='BUY'?'<span class="signal-badge buy">BUY</span>':x.signal==='SELL'?'<span class="signal-badge sell">SELL</span>':'<span class="signal-badge watch">WATCH</span>')+'</td><td><button class="btn sm blue" onclick="DD.optView=\''+E(x.u)+'\';DD.render()">Chain</button></td></tr>').join('');
  html+='<div class="table-scroll"><table class="term"><thead><tr><th>#</th><th>Underlying</th><th>Contracts</th><th>24H</th><th>Volume</th><th>Expiry</th><th>Signal</th><th>Action</th></tr></thead><tbody>'+tbl+'</tbody></table></div></div>';
  // Four independent option sets
  html+='<div class="panel"><div class="panel-header"><div class="panel-title">Option Paper Trading Sets (1–4)</div><div class="panel-sub">Each set trades independently · PAPER mode only · confirmed defined-risk debit spreads · naked selling OFF</div></div>';
  html+='<div class="opt-set-grid">';
  for(let i=0;i<OPT_SETS;i++){
    const set=S.optSets[i];
    const stCls=set.status==='OPEN'?'open':set.status==='SIGNAL'?'signal':set.status==='ERROR'?'error':set.status==='CLOSED'?'closed':'waiting';
    let pnlHtml='';
    if(set.status==='OPEN'){const pnlPct=set.entry>0?((set.current-set.entry)/set.entry*(set.side==='BUY'?1:-1)*100):0;pnlHtml='<div class="pos-pnl '+cl(set.pnl)+'">PNL: ₹'+PNL(set.pnl)+' ('+P(pnlPct)+')</div>'}
    html+='<div class="opt-set-card '+stCls+'"><div class="opt-set-head"><span class="opt-set-num">Set '+(i+1)+'</span>'+
      '<span class="opt-set-status '+stCls+'">'+set.status+'</span></div>'+
      (set.symbol?'<div class="opt-set-info"><span>Symbol:</span> <b>'+E(set.symbol)+'</b></div>':'')+
      (set.side?'<div class="opt-set-info"><span>Side:</span> <b class="'+(set.side==='BUY'?'buy':'sell')+'">'+set.side+'</b></div>':'')+
      (set.contract?'<div class="opt-set-info"><span>Contract:</span> '+E(set.contract).slice(0,24)+'</div>':'')+
      (set.entry?'<div class="opt-set-info"><span>Entry:</span> '+fmtPrice(set.entry)+'</div>':'')+
      (set.status==='OPEN'?'<div class="opt-set-info"><span>Mark:</span> '+fmtPrice(set.current)+'</div>':'')+
      (set.strike?'<div class="opt-set-info"><span>Long Strike:</span> '+fmtPrice(set.strike)+'</div>':'')+(set.shortStrike?'<div class="opt-set-info"><span>Short Strike:</span> '+fmtPrice(set.shortStrike)+'</div>':'')+
      (set.expiry?'<div class="opt-set-info"><span>Expiry:</span> '+new Date(set.expiry).toLocaleDateString()+'</div>':'')+
      (set.reason?'<div class="opt-set-reason">'+E(set.reason)+'</div>':'')+
      pnlHtml+
      (set.status==='OPEN'?'<button class="btn sm red" onclick="DD.closeOptSet('+i+')">Close</button>':'')+
      '</div>';
  }
  html+='</div></div>';
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
  const openOpts=S.optSets.filter(s=>s.status==='OPEN');
  if(!S.pos.length&&!openOpts.length)return '<div class="panel"><div class="empty"><div class="icon">📊</div>No open positions.</div></div>';
  const engines=['MOMENTUM','SCALPING','OPTIONS','LIVE'];
  let html='<div class="panel"><div class="panel-header"><div class="panel-title">Open Positions</div><div class="panel-sub">'+S.pos.length+' position(s) · Mode: '+S.mode+'</div></div>';
  for(const eng of engines){
    const ep=S.pos.filter(p=>p.e===eng);
    if(!ep.length)continue;
    html+='<div style="margin-bottom:12px"><div style="font-size:11px;font-weight:900;color:var(--blue);margin-bottom:6px;letter-spacing:.05em">'+eng+' ('+ep.length+')</div><div class="pos-list">';
    html+=ep.map(p=>{
      const pnl=N(p.pnl),pnlPct=p.entry&&p.current?((p.current-p.entry)/p.entry*100*(p.side==='SELL'?-1:1)):0;
      const age=p.opened?Math.round((Date.now()-p.opened)/60000)+'m':'—';
      return '<div class="pos-card '+(p.side==='SELL'?'sell-side':'')+'"><div class="pos-head"><span class="pos-coin">'+E(p.s)+'</span><span class="pos-tag">'+E(p.e)+'</span><span class="pos-tag">'+E(p.side)+'</span><span class="pos-tag">'+E(p.mode||'PAPER')+'</span>'+(p.signalStage?'<span class="pos-tag">'+E(p.signalStage)+'</span>':'')+(p.sl?'<button class="btn sm red" onclick="DD.close(\''+E(p.s)+'\')">Close</button>':'')+'</div>'+
        '<div class="pos-grid">'+posField('Entry',fmtPrice(p.entry))+posField('Mark',fmtPrice(p.current))+posField('Qty',fmtQty(p.q))+posField('SL',fmtPrice(p.sl))+posField('TP',fmtPrice(p.tp))+posField('Fees','₹'+R(p.entryFee))+posField('Age',age)+posField('Quality',N(p.qualityScore)||'—')+'</div>'+
        '<div class="pos-pnl '+cl(pnl)+'">Net PNL: ₹'+PNL(p.pnl)+' ('+P(pnlPct)+')</div></div>';
    }).join('');
    html+='</div></div>';
  }
  return html+'</div>';
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
    const wl=est.wins+'/'+est.losses;
    return '<div class="acct-card"><h4>'+e+'</h4><div class="acct-row"><span>Open</span><b>'+ep.length+'</b></div><div class="acct-row"><span>Unrealized</span><b class="'+cl(ePnl)+'">₹'+PNL(ePnl)+'</b></div><div class="acct-row"><span>W / L</span><b>'+wl+'</b></div><div class="acct-row"><span>Realized</span><b class="'+cl(est.netPnl)+'">₹'+PNL(est.netPnl)+'</b></div><div class="acct-row"><span>Fees</span><b>₹'+R(est.totalFees)+'</b></div><div class="acct-row"><span>Win Rate</span><b>'+est.winRate.toFixed(1)+'%</b></div></div>';
  }).join('');
  const optSetHtml=S.optSets.map(set=>{
    const stCls=set.status==='OPEN'?'buy':set.status==='SIGNAL'?'watch':set.status==='ERROR'?'sell':'neutral-text';
    let detail='';
    if(set.status==='OPEN'&&set.contract){
      const mk=S.optData.marks[set.contract];
      const pnlPct=set.entry>0?((mk?mk.p:set.current)-set.entry)/set.entry*(set.side==='BUY'?1:-1)*100:0;
      detail='<div class="acct-row"><span>Contract</span><b style="font-size:10px">'+E(set.contract)+'</b></div><div class="acct-row"><span>Mark</span><b>'+fmtPrice(mk?mk.p:set.current)+'</b></div><div class="acct-row"><span>PNL</span><b class="'+cl(pnlPct)+'">'+P(pnlPct)+'</b></div>';
    }else if(set.reason){
      detail='<div class="acct-row"><span>Note</span><b style="font-size:10px">'+E(set.reason)+'</b></div>';
    }
    const closeBtn=set.status==='OPEN'?'<button class="btn sm red" onclick="DD.closeOptSet('+set.id+')">Close</button>':'';
    return '<div class="acct-card"><h4>Set '+set.id+'</h4><div class="acct-row"><span>Status</span><b class="'+stCls+'">'+set.status+'</b></div>'+(set.symbol?'<div class="acct-row"><span>Symbol</span><b>'+E(set.symbol)+'</b></div>':'')+(set.side?'<div class="acct-row"><span>Side</span><b class="'+(set.side==='BUY'?'buy':'sell')+'">'+set.side+'</b></div>':'')+detail+closeBtn+'</div>';
  }).join('');
  return '<div class="mode-banner paper"><b>PAPER TRADING</b> — Local simulation · Real orders OFF · Risk-controlled entries</div>'+
    '<div class="kpi-grid">'+kpiCard('Virtual Capital','₹'+R(S.settings.paperCapital),'acc')+kpiCard('Available Balance','₹'+R(S.eq),'acc')+kpiCard('Used Margin','₹'+R(usedMargin))+kpiCard('Current Exposure','₹'+R(exposure))+kpiCard('Realized PNL','₹'+PNL(S.real),pnlClass(S.real))+kpiCard('Unrealized PNL','₹'+PNL(unreal),pnlClass(unreal))+kpiCard('Fees','₹'+R(S.fees))+kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+'</div>'+
    '<div class="panel"><div class="panel-header"><div class="panel-title">Per-Engine Accounts</div><div class="panel-sub">Selective entries · closed candles · equity-based sizing</div></div><div class="acct-grid">'+ec+'</div></div>'+
    '<div class="panel" style="margin-top:8px"><div class="panel-header"><div class="panel-title">Option Sets (4 Independent)</div><div class="panel-sub">Cooldown '+OPT_COOLDOWN/60e3+'m · Stop '+OPT_STOP*100+'% · Target '+OPT_TP*100+'%</div></div><div class="acct-grid">'+optSetHtml+'</div></div>'+
    '<div class="btn-row" style="margin-top:8px"><button class="btn green sm" onclick="DD.toggleAuto()">Auto Trading: '+(S.auto?'ON':'OFF')+'</button><button class="btn sm blue" onclick="DD.scan()">Scan Now</button><button class="btn sm" onclick="DD.resetPaper()">Reset Paper</button></div>';
}

function renderTestnet(){
  const ta=S.testnetAccount,st=statsFor(S.hist),unreal=S.pos.reduce((a,p)=>a+N(p.pnl),0);
  const ts=S.testnetStatus||{};
  const restricted=S.testnetRestricted||(typeof localStorage!=='undefined'&&localStorage.getItem('ddTestnetRestrictedAt')&&(Date.now()-Number(localStorage.getItem('ddTestnetRestrictedAt'))<600000));
  let statusNote='';
  if(restricted){statusNote='<div class="note warn"><b>Binance Futures Demo trading is unavailable from this deployment location or account eligibility.</b> Auto trading has been stopped. Paper Trading remains fully functional. <button class="btn sm" onclick="DD.retryTestnet()">Retry Testnet</button></div>'}
  else if(ts.apiKeyConfigured===false){statusNote='<div class="note info">Testnet API keys are not configured. To enable Testnet trading, add BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET to your environment. Paper Trading works without configuration.</div>'}
  else if(ts.testnetUnlocked===false){statusNote='<div class="note info">Testnet is locked. Set TESTNET_UNLOCKED=true in your environment to enable Demo orders.</div>'}
  else{statusNote='<div class="note info">Testnet API: Configured · '+(ts.testnetUnlocked?'Unlocked':'Locked')+' · Base: '+E(ts.baseUrl)+'</div>'}
  return '<div class="mode-banner testnet"><b>TESTNET ACTIVE</b> — Binance Futures Demo · Simulated funds</div>'+
    statusNote+
    '<div class="kpi-grid">'+kpiCard('Wallet Balance','₹'+R(ta?.walletBalance||0),'acc')+kpiCard('Available Balance','₹'+R(ta?.availableBalance||0),'acc')+kpiCard('Margin','₹'+R(ta?.margin||0))+kpiCard('Unrealized PNL','₹'+PNL(ta?.unrealized||unreal),pnlClass(ta?.unrealized||unreal))+kpiCard('Realized PNL','₹'+PNL(S.real),pnlClass(S.real))+kpiCard('Fees','₹'+R(S.fees))+kpiCard('Open Positions',S.pos.length+'')+kpiCard('Win Rate',st.winRate.toFixed(1)+'%')+'</div>'+
    '<div class="btn-row" style="margin-top:8px"><button class="btn sm '+(S.auto?'green':'')+'" onclick="DD.toggleAuto()">Testnet Auto: '+(S.auto?'ON':'OFF')+'</button><button class="btn sm blue" onclick="DD.scan()">Scan</button><button class="btn sm" onclick="DD.checkTestnet()">Check Status</button></div>';
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
    '<div class="setting-row"><div><div class="set-label">Coin Count</div><div class="set-desc">Number of coins to scan (applies on next universe reset)</div></div><input type="number" value="'+(S.settings.coinCount||50)+'" min="10" max="100" onchange="DD.updateSetting(\'coinInterval\',+this.value)"></div>'+
    '<div class="setting-row"><div><div class="set-label">Stable Universe</div><div class="set-desc">'+(S.stableUniverse.length?'Pinned to '+S.stableUniverse.length+' coins from first scan':'Not yet pinned — will pin on next scan')+'</div></div><button class="btn sm" onclick="DD.resetUniverse()">Reset Universe</button></div>'+
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
  toggleLiveAuto(){if(S.mode!=='LIVE'||!S.liveTrading){S.liveAuto=false;S.err='LIVE AUTO blocked: LIVE Trading must be ON first.';render();return}if(!S.liveAuto){if(!confirm('Enable LIVE AUTO trading? This will place REAL orders on Binance automatically.'))return}S.liveAuto=!S.liveAuto;render()},toggleLiveTrading(){if(S.mode!=='LIVE'){S.liveTrading=false;render();return}if(!S.liveTrading&&!confirm('Enable LIVE TRADING? Real Binance orders may be placed only when all safety gates pass.'))return;S.liveTrading=!S.liveTrading;if(!S.liveTrading)S.liveAuto=false;render()},toggleEmergency(){S.emergencyStop=!S.emergencyStop;if(S.emergencyStop){S.liveAuto=false;S.auto=false}save();render()},
  setMode(m){
    if(m===S.mode)return;
    if(m==='LIVE'&&!confirm('Switch to LIVE mode? Real Binance orders will be possible. Live Auto stays OFF until you enable it separately.'))return;
    // Save current mode state
    save();
    S.mode=m;S.liveAuto=false;S.liveTrading=false;
    localStorage.setItem('ddMode',m);
    // Load new mode state
    load();render();if(m==='LIVE')syncAccount();if(m==='TESTNET'){syncTestnetSymbols().then(()=>syncTestnet()).then(()=>checkTestnetStatus()).then(render)}
  },
  close(sym){
    const p=S.pos.find(x=>x.s===sym);if(!p)return;
    const x=N(S.t[sym]?.p);if(!x)return;
    const gross=p.side==='BUY'?(x-p.entry)*p.q:(p.entry-x)*p.q,ef=x*p.q*F;
    p.pnl=gross-p.entryFee-ef;S.real+=p.pnl;S.eq+=p.pnl;S.fees+=p.entryFee+ef;
    S.hist.unshift({time:Date.now(),s:p.s,e:p.e,side:p.side,action:'EXIT',entry:p.entry,exit:x,pnl:p.pnl,fees:p.entryFee+ef,live:p.mode==='LIVE',mode:p.mode,reason:'Manual close'});
    S.pos=S.pos.filter(q=>q.id!==p.id);S.lastTrade[sym]=Date.now();save();render();
  },
  openEngine(sym,e){
    if(!['MOMENTUM','SCALPING'].includes(e))return false;
    if(!['PAPER','TESTNET'].includes(S.mode))return false;
    const x=S.rows.find(r=>r.s===sym);if(!x||!canOpen(x,e))return false;
    if(S.mode==='PAPER')return paperOpen(x,e);
    return testnetOpen(x,e);
  },
  manualEntry(sym,side){
    if(side==='WAIT'||!side)return false;
    if(!['PAPER','TESTNET'].includes(S.mode)){alert('Manual entry is available in PAPER and TESTNET modes only.');return false}
    const x=S.rows.find(r=>r.s===sym);if(!x)return false;
    const e=x.momentum===side?'MOMENTUM':x.scalp===side?'SCALPING':'MOMENTUM';
    return this.openEngine(sym,e);
  },
  reconnect(){connectWS()},
  syncAcc(){syncAccount().then(render)},
  checkTestnet(){checkTestnetStatus().then(()=>{syncTestnet();render()})},
  retryTestnet(){S.testnetRestricted=false;try{localStorage.removeItem('ddTestnetRestrictedAt')}catch(e){}S.err='';checkTestnetStatus().then(()=>{syncTestnet();render()})},
  closeOptSet(i){
    const set=S.optSets[i];if(!set||set.status!=='OPEN')return;
    const lm=S.optData.marks[set.longContract],sm=S.optData.marks[set.shortContract];
    const exitPx=(lm&&sm&&lm.bid>0&&sm.ask>0)?Math.max(0,N(lm.bid)-N(sm.ask)):set.current;
    const uSpot=N(S.optData.underlying[set.symbol]?.p);
    const notional=exitPx*set.qty*Math.max(uSpot,1e-9);
    const exitFee=notional*F;
    const gross=(exitPx-set.entry)*set.qty*Math.max(uSpot,1e-9);
    set.pnl=gross-set.entryFee-exitFee;S.real+=set.pnl;S.optReal+=set.pnl;S.eq+=set.pnl;S.fees+=set.entryFee+exitFee;S.optFees+=set.entryFee+exitFee;
    S.hist.unshift({time:Date.now(),s:set.symbol,e:'OPTIONS',side:set.side,action:'EXIT',entry:set.entry,exit:exitPx,qty:set.qty,pnl:set.pnl,fees:set.entryFee+exitFee,live:false,mode:'PAPER',reason:'Manual close',optSet:set.id,contract:set.contract});
    set.status='CLOSED';set.closed=Date.now();set.pnl=0;set.entry=0;set.current=0;set.qty=0;set.contract='';set.longContract='';set.shortContract='';set.entryFee=0;save();render();
  },
  updateSetting(k,v){S.settings[k]=v;save();render()},
  resetPaper(){if(confirm('Complete fresh start for '+S.mode+'? This clears ALL positions, PNL, fees, trade history, rotation history and counters for this mode.')){S.pos=[];S.hist=[];S.eq=N(S.settings.paperCapital)||10000;S.real=0;S.fees=0;S.optReal=0;S.optFees=0;S.lastTrade={};S.dailyRiskUsed=0;S.dailyRiskDate='';S.rotation={enabled:true,lastRotation:0,events:0,rotationDate:'',lastEngine:'',lastClosed:'',lastOpened:'',lastReason:'',lastResult:'',lastAttemptKey:''};S.rotationId=0;S.emergencyStop=false;S.optSets=Array.from({length:OPT_SETS},(_,i)=>({id:i+1,status:'WAITING',symbol:'',side:'',entry:0,current:0,qty:0,contract:'',longContract:'',shortContract:'',expiry:0,strike:0,shortStrike:0,pnl:0,entryFee:0,opened:0,closed:0,reason:''}));save();render()}},
  exportData(){try{const d=localStorage[storageKey()];const blob=new Blob([d],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='dealdost-'+S.mode.toLowerCase()+'-'+Date.now()+'.json';a.click();URL.revokeObjectURL(url)}catch(e){alert('Export failed: '+e.message)}},
  drawLine,drawBar,
  resetUniverse(){S.stableUniverse=[];try{localStorage.removeItem('dd_stable_universe_v1')}catch(e){}render();scan()}
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
  S.manageTimer=setInterval(()=>{managePaper();manageOptions();if(['dashboard','positions','options'].includes(S.tab))renderThrottled()},3000);
  S.optTimer=setInterval(()=>{scanOptions()},30000);
}
// Start only once
if(!window.__DD_BOOTED){window.__DD_BOOTED=true;boot();}
})();
