const MAIN='paper-engine-state-v1',SCALP='scalping-paper-state-v3';
const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
const arr=v=>Array.isArray(v)?v.filter(Boolean):[];
const isScalp=h=>h?.engine==='scalping-paper'||(h?.engine!=='momentum-paper'&&['entry','exit','sl','tp','durationMs','riskAmount'].every(k=>h?.[k]!=null));
function repair(){
 try{
  const m=read(MAIN); if(m){const h=arr(m.history);const clean=h.filter(x=>!isScalp(x)).slice(-100);let changed=clean.length!==h.length;for(const x of clean){if(x.engine!=='momentum-paper'){x.engine='momentum-paper';changed=true}}if(changed){m.history=clean;write(MAIN,m)}}
  const s=read(SCALP); if(s){const h=arr(s.history);const clean=h.filter(isScalp).slice(-100);let changed=clean.length!==h.length;for(const x of clean){if(x.engine!=='scalping-paper'){x.engine='scalping-paper';changed=true}}if(changed){s.history=clean;write(SCALP,s)}}
 }catch{}
}
repair();setInterval(repair,500);window.addEventListener('storage',repair);