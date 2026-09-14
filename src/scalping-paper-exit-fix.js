const SCALP='scalping-paper-state-v3';
const MAIN='paper-engine-state-v1';
const FIX='exact-exit-v4';
const N=v=>Number(v);
const finite=v=>Number.isFinite(N(v));
const snapshots={scalp:new Map(),main:new Map()};

function rememberPositions(key,map){
  try{
    const s=JSON.parse(localStorage.getItem(key)||'null');if(!s)return;
    const positions=key===SCALP?(Array.isArray(s.open)?s.open:[]):Object.values(s.positions||{});
    for(const p of positions){
      if(p?.symbol)map.set(p.symbol,{side:p.side,entry:N(p.entry),sl:N(p.sl),tp:N(p.tp),qty:N(p.qty),riskAmount:N(p.riskAmount)});
    }
  }catch{}
}

function closeScalpAtExact(){
  try{
    const s=JSON.parse(localStorage.getItem(SCALP)||'null');
    if(!s||!Array.isArray(s.open)||!Array.isArray(s.history))return false;
    let changed=false;const keep=[];
    for(const p of s.open){
      if(!p?.symbol||!finite(p.entry)||!finite(p.qty)||p.qty<=0){keep.push(p);continue}
      const price=N(p.current);if(!finite(price)){keep.push(p);continue}
      const sl=N(p.sl),tp=N(p.tp);
      const hit=p.side==='BUY'?(price<=sl||price>=tp):(price>=sl||price<=tp);
      if(!hit){keep.push(p);continue}
      const isTp=p.side==='BUY'?price>=tp:price<=tp;
      const exit=isTp?tp:sl;if(!finite(exit)){keep.push(p);continue}
      const pnl=(p.side==='BUY'?exit-N(p.entry):N(p.entry)-exit)*N(p.qty);
      const risk=finite(p.riskAmount)&&N(p.riskAmount)>0?N(p.riskAmount):Math.abs(N(p.entry)-sl)*N(p.qty);
      const now=Date.now();
      s.history.push({time:now,closedAt:now,symbol:p.symbol,side:p.side,entry:N(p.entry),exit,qty:N(p.qty),pnl,r:finite(risk)&&risk>0?pnl/risk:null,sl,tp,riskAmount:risk,durationMs:Math.max(0,now-N(p.opened)),reason:isTp?'TP':'SL',exactExitFix:FIX});
      s.equity=(N(s.equity)||10000)+pnl;changed=true;
    }
    if(!changed)return false;
    s.open=keep.slice(0,3);s.history=s.history.slice(-100);
    s.realized=(N(s.equity)||10000)-10000;
    s.dayRealized=(N(s.equity)||10000)-(N(s.dayStartEquity)||10000);
    s.wins=s.history.filter(x=>N(x?.pnl)>0).length;s.losses=s.history.filter(x=>N(x?.pnl)<0).length;
    localStorage.setItem(SCALP,JSON.stringify(s));return true;
  }catch{return false}
}

function normalizeScalp(){
  try{
    const s=JSON.parse(localStorage.getItem(SCALP)||'null');
    if(!s||!Array.isArray(s.history))return false;
    let changed=false,delta=0;
    for(const h of s.history){
      if(!h)continue;
      const entry=N(h.entry),sl=N(h.sl),tp=N(h.tp),qty=N(h.qty);
      if(!finite(entry)||!finite(qty)||qty<=0)continue;
      const reason=String(h.reason||'').toUpperCase();
      let exit=null;
      if(reason.includes('TP')&&finite(tp))exit=tp;
      else if(reason.includes('SL')&&finite(sl))exit=sl;
      else continue;
      const pnl=(String(h.side).toUpperCase()==='BUY'?exit-entry:entry-exit)*qty;
      const old=N(h.pnl)||0;
      const oldExit=N(h.exit);
      const risk=finite(h.riskAmount)&&N(h.riskAmount)>0?N(h.riskAmount):Math.abs(entry-sl)*qty;
      if(oldExit!==exit||Math.abs(old-pnl)>1e-12||h.exactExitFix!==FIX||!finite(h.r))changed=true;
      h.exit=exit;h.pnl=pnl;h.r=finite(risk)&&risk>0?pnl/risk:null;h.exactExitFix=FIX;
      delta+=pnl-old;
    }
    if(!changed)return false;
    s.equity=(N(s.equity)||10000)+delta;
    s.realized=(N(s.equity)||10000)-10000;
    s.dayRealized=(N(s.equity)||10000)-(N(s.dayStartEquity)||10000);
    s.wins=s.history.filter(x=>N(x?.pnl)>0).length;s.losses=s.history.filter(x=>N(x?.pnl)<0).length;
    localStorage.setItem(SCALP,JSON.stringify(s));return true;
  }catch{return false}
}

function closeMainAtExact(){
  try{
    const s=JSON.parse(localStorage.getItem(MAIN)||'null');
    if(!s||!s.positions||typeof s.positions!=='object'||!Array.isArray(s.history))return false;
    let changed=false;
    for(const [symbol,p] of Object.entries(s.positions)){
      if(!p||!finite(p.entry)||!finite(p.qty)||p.qty<=0)continue;
      const price=N(p.current);if(!finite(price))continue;
      const sl=N(p.sl),tp=N(p.tp);const hit=p.side==='BUY'?(price<=sl||price>=tp):(price>=sl||price<=tp);
      if(!hit)continue;
      const isTp=p.side==='BUY'?price>=tp:price<=tp;const exit=isTp?tp:sl;if(!finite(exit))continue;
      const pnl=(p.side==='BUY'?exit-N(p.entry):N(p.entry)-exit)*N(p.qty);
      const risk=finite(p.riskAmount)&&N(p.riskAmount)>0?N(p.riskAmount):Math.abs(N(p.entry)-sl)*N(p.qty);
      s.history.push({time:Date.now(),symbol,side:p.side,pnl,r:finite(risk)&&risk>0?pnl/risk:null,equity:(N(s.equity)||10000)+pnl,exactExitFix:FIX});
      s.equity=(N(s.equity)||10000)+pnl;s.realised=(N(s.realised)||0)+pnl;s.wins=(N(s.wins)||0)+(pnl>0?1:0);s.losses=(N(s.losses)||0)+(pnl<0?1:0);delete s.positions[symbol];changed=true;
    }
    if(!changed)return false;
    s.history=s.history.slice(-100);localStorage.setItem(MAIN,JSON.stringify(s));return true;
  }catch{return false}
}

function normalizeMain(){
  try{
    const s=JSON.parse(localStorage.getItem(MAIN)||'null');if(!s||!Array.isArray(s.history))return false;
    let changed=false,delta=0;
    for(const h of s.history){
      if(!h)continue;
      const p=snapshots.main.get(h.symbol);if(!p||!finite(p.entry)||!finite(p.qty)||p.qty<=0)continue;
      const reason=String(h.reason||'').toUpperCase();let exit=null;
      if(reason.includes('SL')&&finite(p.sl))exit=p.sl;else if(reason.includes('TP')&&finite(p.tp))exit=p.tp;else continue;
      const pnl=(p.side==='BUY'?exit-p.entry:p.entry-exit)*p.qty;const old=N(h.pnl)||0;
      const risk=finite(p.riskAmount)&&p.riskAmount>0?p.riskAmount:Math.abs(p.entry-p.sl)*p.qty;
      if(Math.abs(old-pnl)>1e-12||h.exactExitFix!==FIX)changed=true;
      h.pnl=pnl;h.r=finite(risk)&&risk>0?pnl/risk:null;h.exactExitFix=FIX;delta+=pnl-old;
    }
    if(!changed)return false;
    s.equity=(N(s.equity)||10000)+delta;s.realised=(N(s.equity)||10000)-10000;s.wins=s.history.filter(x=>N(x?.pnl)>0).length;s.losses=s.history.filter(x=>N(x?.pnl)<0).length;localStorage.setItem(MAIN,JSON.stringify(s));return true;
  }catch{return false}
}

function tick(){
  rememberPositions(SCALP,snapshots.scalp);rememberPositions(MAIN,snapshots.main);
  const a=closeScalpAtExact(),b=closeMainAtExact(),c=normalizeScalp(),d=normalizeMain();
  if(a||b||c||d){try{window.dispatchEvent(new StorageEvent('storage',{key:SCALP,newValue:localStorage.getItem(SCALP)}))}catch{}try{window.dispatchEvent(new Event('paper-pnl-update'))}catch{}}
}

tick();setInterval(tick,50);
