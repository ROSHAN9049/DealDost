const KEY='scalping-paper-state-v3';
const FIX='exact-exit-v1';
const N=v=>Number(v);

function fixExactPaperExits(){
  try{
    const raw=localStorage.getItem(KEY);
    if(!raw)return;
    const s=JSON.parse(raw);
    if(!s||!Array.isArray(s.history))return;
    let changed=false;
    let delta=0;
    for(const h of s.history){
      if(!h||h.exactExitFix===FIX)continue;
      const entry=N(h.entry),sl=N(h.sl),tp=N(h.tp),qty=N(h.qty);
      if(!Number.isFinite(entry)||!Number.isFinite(qty)||qty<=0)continue;
      let exit=N(h.exit);
      if(h.reason==='TP'&&Number.isFinite(tp))exit=tp;
      else if(h.reason==='SL'&&Number.isFinite(sl))exit=sl;
      else {h.exactExitFix=FIX;continue}
      if(!Number.isFinite(exit)){h.exactExitFix=FIX;continue}
      const pnl=(h.side==='BUY'?exit-entry:entry-exit)*qty;
      const old=N(h.pnl)||0;
      const risk=N(h.riskAmount);
      h.exit=exit;
      h.pnl=pnl;
      h.r=Number.isFinite(risk)&&risk>0?pnl/risk:null;
      h.exactExitFix=FIX;
      delta+=pnl-old;
      changed=true;
    }
    if(!changed)return;
    s.equity=(N(s.equity)||10000)+delta;
    s.realized=(N(s.equity)||10000)-10000;
    s.dayRealized=(N(s.equity)||10000)-(N(s.dayStartEquity)||10000);
    s.wins=s.history.filter(x=>N(x?.pnl)>0).length;
    s.losses=s.history.filter(x=>N(x?.pnl)<=0).length;
    localStorage.setItem(KEY,JSON.stringify(s));
    window.dispatchEvent(new StorageEvent('storage',{key:KEY,newValue:JSON.stringify(s)}));
  }catch(e){}
}

fixExactPaperExits();
setInterval(fixExactPaperExits,500);
