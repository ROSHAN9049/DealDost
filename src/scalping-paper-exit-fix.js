const SCALP='scalping-paper-state-v3';
const MAIN='paper-engine-state-v1';
const FIX='exact-exit-v3';
const N=v=>Number(v);
const finite=v=>Number.isFinite(N(v));

const snapshots={scalp:new Map(),main:new Map()};

function rememberPositions(key,map){
  try{
    const s=JSON.parse(localStorage.getItem(key)||'null');
    if(!s)return;
    const positions=key===SCALP?(Array.isArray(s.open)?s.open:[]):Object.values(s.positions||{});
    for(const p of positions){
      if(p?.symbol)map.set(p.symbol,{side:p.side,entry:N(p.entry),sl:N(p.sl),tp:N(p.tp),qty:N(p.qty),riskAmount:N(p.riskAmount)});
    }
  }catch{}
}

function closeScalpAtExact(){
  try{
    const raw=localStorage.getItem(SCALP);if(!raw)return false;
    const s=JSON.parse(raw);if(!s||!Array.isArray(s.open)||!Array.isArray(s.history))return false;
    let changed=false;
    const keep=[];
    for(const p of s.open){
      if(!p?.symbol||!finite(p.entry)||!finite(p.qty)||p.qty<=0){keep.push(p);continue}
      const price=N(p.current);
      if(!finite(price)){keep.push(p);continue}
      const hit=p.side==='BUY'?(price<=N(p.sl)||price>=N(p.tp)):(price>=N(p.sl)||price<=N(p.tp));
      if(!hit){keep.push(p);continue}
      const exit=p.side==='BUY'?(price>=N(p.tp)?N(p.tp):N(p.sl)):(price<=N(p.tp)?N(p.tp):N(p.sl));
      if(!finite(exit)){keep.push(p);continue}
      const pnl=(p.side==='BUY'?exit-N(p.entry):N(p.entry)-exit)*N(p.qty);
      const risk=finite(p.riskAmount)&&N(p.riskAmount)>0?N(p.riskAmount):Math.abs(N(p.entry)-N(p.sl))*N(p.qty);
      const reason=p.side==='BUY'?(price>=N(p.tp)?'TP':'SL'):(price<=N(p.tp)?'TP':'SL');
      const now=Date.now();
      s.history.push({time:now,closedAt:now,symbol:p.symbol,side:p.side,entry:N(p.entry),exit,qty:N(p.qty),pnl,r:finite(risk)&&risk>0?pnl/risk:null,sl:N(p.sl),tp:N(p.tp),riskAmount:risk,durationMs:Math.max(0,now-N(p.opened)),reason,exactExitFix:FIX});
      s.equity=(N(s.equity)||10000)+pnl;
      s.wins=(N(s.wins)||0)+(pnl>0?1:0);
      s.losses=(N(s.losses)||0)+(pnl<0?1:0);
      changed=true;
    }
    if(!changed)return false;
    s.open=keep.slice(0,3);
    s.history=s.history.slice(-100);
    s.realized=(N(s.equity)||10000)-10000;
    s.dayRealized=(N(s.equity)||10000)-(N(s.dayStartEquity)||10000);
    localStorage.setItem(SCALP,JSON.stringify(s));
    return true;
  }catch{return false}
}

function closeMainAtExact(){
  try{
    const raw=localStorage.getItem(MAIN);if(!raw)return false;
    const s=JSON.parse(raw);if(!s||!s.positions||typeof s.positions!=='object'||!Array.isArray(s.history))return false;
    let changed=false;
    for(const [symbol,p] of Object.entries(s.positions)){
      if(!p||!finite(p.entry)||!finite(p.qty)||p.qty<=0)continue;
      const price=N(p.current);
      if(!finite(price))continue;
      const hit=p.side==='BUY'?(price<=N(p.sl)||price>=N(p.tp)):(price>=N(p.sl)||price<=N(p.tp));
      if(!hit)continue;
      const exit=p.side==='BUY'?(price>=N(p.tp)?N(p.tp):N(p.sl)):(price<=N(p.tp)?N(p.tp):N(p.sl));
      if(!finite(exit))continue;
      const pnl=(p.side==='BUY'?exit-N(p.entry):N(p.entry)-exit)*N(p.qty);
      const risk=finite(p.riskAmount)&&N(p.riskAmount)>0?N(p.riskAmount):Math.abs(N(p.entry)-N(p.sl))*N(p.qty);
      const reason=p.side==='BUY'?(price>=N(p.tp)?'2R TP':'SL'):(price<=N(p.tp)?'2R TP':'SL');
      const now=Date.now();
      s.history.push({time:now,symbol,side:p.side,pnl,r:finite(risk)&&risk>0?pnl/risk:null,equity:(N(s.equity)||10000)+pnl,exactExitFix:FIX});
      s.equity=(N(s.equity)||10000)+pnl;
      s.realised=(N(s.realised)||0)+pnl;
      s.wins=(N(s.wins)||0)+(pnl>0?1:0);
      s.losses=(N(s.losses)||0)+(pnl<0?1:0);
      delete s.positions[symbol];
      changed=true;
    }
    if(!changed)return false;
    s.history=s.history.slice(-100);
    localStorage.setItem(MAIN,JSON.stringify(s));
    return true;
  }catch{return false}
}

function normalizeScalp(){
  try{
    const raw=localStorage.getItem(SCALP);if(!raw)return false;
    const s=JSON.parse(raw);if(!s||!Array.isArray(s.history))return false;
    let changed=false,delta=0;
    for(const h of s.history){
      if(!h||h.exactExitFix===FIX)continue;
      const entry=N(h.entry),sl=N(h.sl),tp=N(h.tp),qty=N(h.qty);
      if(!finite(entry)||!finite(qty)||qty<=0)continue;
      let exit=N(h.exit);
      if(h.reason==='TP'&&finite(tp))exit=tp;
      else if(h.reason==='SL'&&finite(sl))exit=sl;
      else {h.exactExitFix=FIX;continue}
      if(!finite(exit)){h.exactExitFix=FIX;continue}
      const pnl=(h.side==='BUY'?exit-entry:entry-exit)*qty;
      const old=N(h.pnl)||0;
      h.exit=exit;h.pnl=pnl;
      const risk=N(h.riskAmount);
      h.r=finite(risk)&&risk>0?pnl/risk:null;
      h.exactExitFix=FIX;delta+=pnl-old;changed=true;
    }
    if(!changed)return false;
    s.equity=(N(s.equity)||10000)+delta;
    s.realized=(N(s.equity)||10000)-10000;
    s.dayRealized=(N(s.equity)||10000)-(N(s.dayStartEquity)||10000);
    s.wins=s.history.filter(x=>N(x?.pnl)>0).length;
    s.losses=s.history.filter(x=>N(x?.pnl)<0).length;
    localStorage.setItem(SCALP,JSON.stringify(s));
    return true;
  }catch{return false}
}

function normalizeMain(){
  try{
    const raw=localStorage.getItem(MAIN);if(!raw)return false;
    const s=JSON.parse(raw);if(!s||!Array.isArray(s.history))return false;
    let changed=false,delta=0;
    for(const h of s.history){
      if(!h||h.exactExitFix===FIX)continue;
      const p=snapshots.main.get(h.symbol);
      if(!p||!finite(p.entry)||!finite(p.qty)||p.qty<=0)continue;
      let exit=null;
      const reason=String(h.reason||'');
      if(reason==='SL'&&finite(p.sl))exit=p.sl;
      else if(reason.includes('TP')&&finite(p.tp))exit=p.tp;
      else {h.exactExitFix=FIX;continue}
      const pnl=(p.side==='BUY'?exit-p.entry:p.entry-exit)*p.qty;
      const old=N(h.pnl)||0;
      h.pnl=pnl;
      const risk=finite(p.riskAmount)&&p.riskAmount>0?p.riskAmount:Math.abs(p.entry-p.sl)*p.qty;
      h.r=finite(risk)&&risk>0?pnl/risk:null;
      h.exactExitFix=FIX;delta+=pnl-old;changed=true;
    }
    if(!changed)return false;
    s.equity=(N(s.equity)||10000)+delta;
    s.realised=(N(s.equity)||10000)-10000;
    s.wins=s.history.filter(x=>N(x?.pnl)>0).length;
    s.losses=s.history.filter(x=>N(x?.pnl)<0).length;
    localStorage.setItem(MAIN,JSON.stringify(s));
    return true;
  }catch{return false}
}

function tick(){
  rememberPositions(SCALP,snapshots.scalp);
  rememberPositions(MAIN,snapshots.main);
  const closedScalp=closeScalpAtExact();
  const closedMain=closeMainAtExact();
  const fixedScalp=normalizeScalp();
  const fixedMain=normalizeMain();
  if(closedScalp||closedMain||fixedScalp||fixedMain){
    try{window.dispatchEvent(new StorageEvent('storage',{key:SCALP,newValue:localStorage.getItem(SCALP)}))}catch{}
    try{window.dispatchEvent(new Event('paper-pnl-update'))}catch{}
  }
}

tick();
setInterval(tick,50);
