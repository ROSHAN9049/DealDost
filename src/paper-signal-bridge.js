const KEY='paper-engine-state-v1';
const START=10000,MIN_SCORE=75,RR=2,DEFAULT_RISK=.005,MAX_POS=3,COOLDOWN=15*60*1000,DAILY_LOSS=.03;
let lastSeen=new Map();
function read(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return{}}}
function write(s){try{localStorage.setItem(KEY,JSON.stringify(s))}catch{}}
function risk(){const v=Number(localStorage.getItem('engine-risk')||'.5');return Math.min(.01,Math.max(.001,v/100))}
function maxPos(){const v=Number(localStorage.getItem('engine-maxpos')||MAX_POS);return Math.min(5,Math.max(1,Number.isFinite(v)?v:MAX_POS))}
function priceOf(symbol){try{const m=window.__PAPER_LIVE_TICKERS;if(m?.get){const p=Number(m.get(symbol)?.lastPrice);if(Number.isFinite(p)&&p>0)return p}}catch{}try{const m=window.__BINANCE_SCANNER_TICKERS,p=Number(m?.[symbol]?.lastPrice);if(Number.isFinite(p)&&p>0)return p}catch{}return null}
function log(s,text){s.logs=[{time:new Date().toLocaleTimeString(),text},...(s.logs||[])].slice(0,20)}
function openSignal(sig){
 const mode=localStorage.getItem('engine-mode')||'PAPER';if(mode!=='PAPER')return;
 const now=Date.now(),symbol=sig?.symbol,score=Number(sig?.score);if(!symbol||!Number.isFinite(score)||score<MIN_SCORE)return;
 const s=read();s.positions=s.positions||{};s.cooldown=s.cooldown||{};s.logs=s.logs||[];if(Object.keys(s.positions).length>=maxPos()||s.positions[symbol])return;if(now<(Number(s.cooldown[symbol])||0))return;if(now-(Number(sig._ts)||now)>12000)return;
 const day=new Date().toDateString();if(s.day!==day){s.day=day;s.dayStartEquity=Number(s.equity)||START;s.cooldown={}}if(!Number.isFinite(Number(s.equity)))s.equity=START;if(!Number.isFinite(Number(s.dayStartEquity)))s.dayStartEquity=s.equity;if(s.equity-s.dayStartEquity<=-START*DAILY_LOSS)return;
 const price=priceOf(symbol)||Number(sig.price);if(!(price>0))return;
 const atr=Number(sig.atr5)||Number(sig.atr)||0,stop=Math.max(.008,atr>0?atr/price*1.2:.008),q=+(s.equity*risk()/Math.max(price*stop,.00000001)).toFixed(6);if(!(q>0))return;
 const side=sig.signal,sl=side==='BUY'?price*(1-stop):price*(1+stop),tp=side==='BUY'?price*(1+stop*RR):price*(1-stop*RR);
 s.positions[symbol]={symbol,side,qty:q,entry:price,current:price,sl,tp,opened:now,score,spike:Number(sig.spike)||0,atr,stopPct:stop,riskAmount:s.equity*risk(),unrealised:0};s.cooldown[symbol]=now+COOLDOWN;s.trades=(Number(s.trades)||0)+1;log(s,`PAPER SIGNAL ENTRY ${symbol} ${side} · score ${score} · spike ${(Number(sig.spike)||0).toFixed(2)}x · entry ${price} · qty ${q}`);write(s);lastSeen.set(symbol,now);window.dispatchEvent(new Event('paper-pnl-update'));
}
function scanSignals(){try{const list=Array.isArray(window.__BINANCE_SCANNER_SIGNALS)?window.__BINANCE_SCANNER_SIGNALS:[];if(!list.length)return;const now=Date.now();for(const raw of list){const sig={...raw,_ts:now};const key=`${sig.symbol}:${sig.signal}`;if(lastSeen.get(key)&&now-lastSeen.get(key)<5000)continue;openSignal(sig);lastSeen.set(key,now)}}catch{}}
setInterval(scanSignals,1000);setTimeout(scanSignals,1500);
