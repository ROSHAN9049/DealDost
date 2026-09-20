    p.pnl=gross-p.entryFee-ef;S.real+=p.pnl;S.eq+=p.pnl;S.fees+=p.entryFee+ef;
    S.hist.unshift({time:Date.now(),s:p.s,e:p.e,side:p.side,action:'EXIT',entry:p.entry,exit:px,qty:p.q,pnl:p.pnl,fees:p.entryFee+ef,live:false,mode:'PAPER',reason:'Rotation',signalStage:p.signalStage||'CONFIRMED',qualityScore:N(p.qualityScore),rotationId:S.rotationId});
    S.pos=S.pos.filter(q=>q.id!==p.id);S.lastTrade[p.s]=Date.now();return true;
  }
  const base=p.mode==='TESTNET'?TN_TR:TR;
  try{
    // Never leave a TESTNET rotation stuck in PENDING forever. The trade
    // endpoint has its own upstream timeout, but this client-side timeout
    // also protects the rotation state when a deployment/network request
    // hangs before a response is returned.
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);
    let resp;
    try{
      resp=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'close',symbol:p.s,side:p.side,quantity:p.q}),signal:ctl.signal});
    }finally{clearTimeout(timer)}
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
  if(!S.auto||S.emergencyStop||!S.rotation.enabled||S.rotation.busy)return;
  S.rotation.busy=true;
  try{
  // TESTNET exchange state is authoritative. Reconcile immediately before
  // choosing a position to rotate so a just-opened/closed remote position
  // cannot make the local engine appear to have a free slot or stale symbol.
  if(S.mode==='TESTNET')await syncTestnet();
  // Rotation must use a confirmed candidate that is actually eligible for
  // replacement. The previous logic always selected the highest-quality
  // confirmed row first; if that symbol was already open, rotation stopped
  // with "Confirmed coin already open" even when another eligible signal existed.
  // In TESTNET, do not use the client-side symbol cache as an execution gate;
  // testnetOpen() performs the authoritative server-side preflight.
  const confirmed=S.rows
    .filter(x=>x.confirmed===true&&!S.pos.some(p=>p.s===x.s))
    .sort((a,b)=>b.qualityScore-a.qualityScore);
  if(!confirmed.length)return;
  const today=new Date().toDateString();
  if(S.rotation.rotationDate!==today){S.rotation.rotationDate=today;S.rotation.events=0}

  // Find the first confirmed signal whose engine is full and whose own
  // cooldown is clear. This keeps rotation alive when the top signal is
  // already occupied or temporarily blocked.
  let target=null,e='',inEngine=[];
  for(const candidate of confirmed){
    const ce=candidate.momentum!=='WAIT'?'MOMENTUM':candidate.scalp!=='WAIT'?'SCALPING':'';
    if(!ce)continue;
    const limit=ce==='MOMENTUM'?MC:SC;
    const enginePositions=S.pos.filter(p=>p.e===ce);
    if(enginePositions.length<limit)continue;
    const cd=ce==='MOMENTUM'?MOM_COOLDOWN:SCALP_COOLDOWN;
    if(Date.now()-N(S.lastTrade[candidate.s]||0)<cd)continue;
    target=candidate;e=ce;inEngine=enginePositions;break;
  }
  if(!target)return;

  const x=target;
  const attemptKey=[x.s,x.momentum,x.scalp,x.qualityScore].join('|');
  if(S.rotation.lastResult==='FAILED'&&S.rotation.lastAttemptKey===attemptKey)return;
  if(!dailyRiskOK()){S.rotation.lastResult='BLOCKED';S.rotation.lastReason='Daily risk limit';S.rotation.lastAttemptKey=attemptKey;save();return}
  S.rotation.lastAttemptKey=attemptKey;

  const profitable=inEngine.filter(p=>N(p.pnl)>0).sort((a,b)=>N(b.pnl)-N(a.pnl));
  const candidates=profitable.length?profitable:inEngine.filter(p=>N(p.pnl)<=0).sort((a,b)=>N(a.pnl)-N(b.pnl));
  const closedPos=candidates[0];
  if(!closedPos){S.rotation.lastResult='BLOCKED';S.rotation.lastReason='No position to rotate';save();return}

  S.rotationId++;
  const rotId=S.rotationId;
  const reason=profitable.length?'PROFIT ROTATION':'WORST LOSS ROTATION';
  // Clear the previous rotation snapshot before attempting a new close. This
  // prevents a failed close from incorrectly showing the prior rotation's
  // "Opened" symbol as if this attempt opened a replacement.
  S.rotation.lastRotation=0;S.rotation.lastEngine=e;S.rotation.lastClosed=closedPos.s;S.rotation.lastOpened='';S.rotation.lastReason=reason+' — closing '+closedPos.s;S.rotation.lastResult='PENDING';
  render();
  if(!(await closeForRotation(closedPos))){
    S.rotation.lastResult='FAILED';S.rotation.lastReason=reason+' — close failed';save();render();return;
  }
  // Confirm the close against Binance Demo before attempting the replacement.
  // This prevents a replacement from being opened while the old position is
  // still remote-open, which could otherwise create a 7th TESTNET position.
  if(S.mode==='TESTNET'){
    await syncTestnet();
    if(S.pos.some(p=>p.id===closedPos.id||p.s===closedPos.s&&p.mode==='TESTNET')){
      S.rotation.lastResult='FAILED';S.rotation.lastReason=reason+' — close not confirmed by Binance Demo';save();render();return;
    }
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
  }finally{S.rotation.busy=false}
}

/* ===== Position management (preserved) ===== */
async function managePaper(){