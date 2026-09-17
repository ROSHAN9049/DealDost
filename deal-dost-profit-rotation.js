/* DealDost Unified Rotation Engine V8
 * PAPER-first. Profit + worst-loss rotation across Futures and Options.
 * Uses both the live Options V2 engine and the terminal's four legacy paper
 * option sets. Only confirmed Top-Mover >= 80 can trigger rotation.
 * LIVE execution is untouched.
 */
(()=>{'use strict';
if(window.__DD_PROFIT_ROTATION_V8)return;window.__DD_PROFIT_ROTATION_V8=true;
const CFG={enabled:true,minProfit:.01,minLoss:.01,minScore:80,cooldown:15000,scanMs:5000};
const N=x=>Number.isFinite(+x)?+x:0,now=()=>Date.now();let rotating=false,lastKey='';const recent={};
const candidates=()=>Array.isArray(window.DD_TOP_MOVERS?.candidates)?window.DD_TOP_MOVERS.candidates:[];
const score=x=>Math.max(N(x?.momentumScore),N(x?.scalpingScore),N(x?.score));
const side=x=>String(x?.direction||'').toUpperCase();
const strong=()=>candidates().filter(x=>x&&x.confirmed&&score(x)>=CFG.minScore&&(side(x)==='BUY'||side(x)==='SELL')).sort((a,b)=>score(b)-score(a));
function futuresPositions(){try{const q=JSON.parse(localStorage.getItem('ddv5_PAPER')||'{}'),ps=Array.isArray(q.pos)?q.pos:[];return ps.filter(p=>p&&p.s&&N(p.entry)>0&&N(p.current)>0).map(p=>{const gross=String(p.side).toUpperCase()==='SELL'?(N(p.entry)-N(p.current))*N(p.q):(N(p.current)-N(p.entry))*N(p.q);const pnl=N(p.pnl);return{...p,_pnl:Number.isFinite(+pnl)?pnl:gross-N(p.entryFee),_kind:'FUTURES',_symbol:p.s}})}catch{return[]}}
function legacyOptionPositions(){try{const q=JSON.parse(localStorage.getItem('ddv5_PAPER')||'{}'),sets=Array.isArray(q.optSets)?q.optSets:[];return sets.filter(p=>p&&p.status==='OPEN'&&p.symbol&&N(p.entry)>0).map(p=>({...p,id:'LEGACY-OPT-'+p.id,_pnl:N(p.pnl),_kind:'LEGACY_OPTIONS',_symbol:p.symbol,_setId:N(p.id)}))}catch{return[]}}
function v2OptionPositions(){try{const ps=window.DDOptions?.getState?.()?.positions;return(Array.isArray(ps)?ps:[]).filter(p=>p&&p.id).map(p=>({...p,_pnl:N(p.pnl),_kind:'OPTIONS',_symbol:p.u}))}catch{return[]}}
function optionPositions(){const v=v2OptionPositions();return v.length?v:legacyOptionPositions()}
function allPositions(){return[...futuresPositions(),...optionPositions()]}
function profitable(){return allPositions().filter(p=>p._pnl>=CFG.minProfit).sort((a,b)=>b._pnl-a._pnl)}
function worstLoss(){return allPositions().filter(p=>p._pnl<=-CFG.minLoss).sort((a,b)=>a._pnl-b._pnl)[0]||null}
function activeSymbols(){return new Set(allPositions().map(p=>String(p._symbol||'').toUpperCase()).filter(Boolean))}
function replacement(){const active=activeSymbols();return strong().find(c=>!active.has(String(c.symbol).toUpperCase()))||null}
async function closePosition(p,reason){if(p._kind==='OPTIONS'&&typeof window.DDOptions?.closePosition==='function')return await Promise.resolve(window.DDOptions.closePosition(p.id,reason));if(p._kind==='LEGACY_OPTIONS'&&typeof window.DD?.closeOptSet==='function'){window.DD.closeOptSet(Math.max(0,N(p._setId)-1));return true}if(p._kind==='FUTURES'&&typeof window.DD?.close==='function'){const r=window.DD.close(p.s);return r!==false}return false}
function openFutures(c){if(typeof window.DD?.manualEntry!=='function')return false;const d=side(c),m=N(c.momentumScore),s=N(c.scalpingScore);if(m>=80){const x=window.DD.manualEntry(c.symbol,d);if(x!==false)return'MOMENTUM'}if(s>=80){const x=window.DD.manualEntry(c.symbol,d);if(x!==false)return'SCALPING'}return false}
function openReplacement(c){if(!c)return false;const f=openFutures(c);if(f)return{section:f};if(typeof window.DDOptions?.openCandidate==='function'){const o=window.DDOptions.openCandidate(c.symbol,side(c));if(o)return{section:'OPTIONS',strategy:o.strategy||o.s}}return false}
async function rotateOne(p,c,type){const key=String(p._symbol||p.id);if(now()-N(recent[key])<CFG.cooldown)return false;const ok=await closePosition(p,type+'_ROTATION');if(ok===false)return false;recent[key]=now();await new Promise(r=>setTimeout(r,250));const opened=openReplacement(c);if(opened)recent[String(c.symbol)]=now();return{type,from:p._symbol,to:c.symbol,section:opened?.section||'NONE',loss:p._pnl}}
async function rotate(){if(rotating||!CFG.enabled||String(localStorage.getItem('ddMode')||'PAPER')!=='PAPER')return;const c=replacement();if(!c)return;rotating=true;try{const ps=profitable();if(ps.length){const r=await rotateOne(ps[0],c,'PROFIT');if(r)return r}const w=worstLoss();if(w)return await rotateOne(w,c,'LOSS')}catch(e){console.warn('Unified rotation tick skipped:',e)}finally{rotating=false}}
function mount(){let el=document.getElementById('dd-profit-rotation');if(el)return el;el=document.createElement('div');el.id='dd-profit-rotation';el.style.cssText='display:block!important;width:100%;box-sizing:border-box;margin:0;padding:8px 10px;background:#04080f;position:relative;z-index:999;';document.body.insertBefore(el,document.body.firstChild);return el}
function panel(){const el=mount(),st=strong()[0],p=profitable(),w=worstLoss(),key=(st?[st.symbol,side(st),score(st)].join('|'):'WAIT')+'|P'+p.length+'|W'+(w?String(w._symbol):'NONE')+'|WP'+(w?w._pnl:'');if(key===lastKey&&el.dataset.ready==='1')return;lastKey=key;el.innerHTML='<div class="panel" style="margin:0"><div class="panel-header"><div class="panel-title">UNIFIED ROTATION V8</div><div class="panel-sub">Profit + worst-loss rotation · confirmed Top-Mover ≥ 80 · PAPER only</div></div><div style="padding:9px;font-size:11px;color:#8ea3b8">'+(st?'Next strong signal: <b>'+String(st.symbol)+'</b> · '+side(st)+' · score '+score(st):'Waiting for confirmed Top-Mover signal ≥ 80…')+' · Profitable: <b>'+p.length+'</b> · Worst loss: <b>'+(w?(String(w._symbol)+' ₹'+w._pnl.toFixed(2)):'None')+'</b></div><div style="padding:0 9px 9px;font-size:10px;color:#71859b">Priority: profitable position first; otherwise one worst-loss position. Replacement may use Momentum, Scalping or Options.</div></div>';el.dataset.ready='1'}
async function tick(){try{panel();await rotate()}catch(e){console.warn('Unified rotation tick skipped:',e)}}
window.DDProfitRotation={config:CFG,refresh:tick,mount};setTimeout(tick,1200);setInterval(tick,CFG.scanMs);
})();
