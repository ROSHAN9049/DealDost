/* DealDost V8 DOM stabilizer. Never intercepts Binance API. */
(function(){
'use strict';
const MAX=50,COIN_KEY='dealDostStableCoinsV8',RADAR_KEY='dealDostStableRadarV2';
const get=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return v??d}catch(e){return d}};
const put=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
let coins=Array.isArray(get(COIN_KEY,[]))?get(COIN_KEY,[]):[];
let radar=get(RADAR_KEY,{});if(!radar||typeof radar!=='object')radar={};
function symbolRows(){return [...document.querySelectorAll('#signals tr')].filter(r=>r.querySelector('td:nth-child(2)')).map(r=>({row:r,s:(r.querySelector('td:nth-child(2)')?.textContent||'').trim()})).filter(x=>x.s)}
function stabilizeTable(){const body=document.getElementById('signals');if(!body)return;const rows=symbolRows();if(!rows.length)return;const present=new Set(rows.map(x=>x.s));coins=coins.filter(s=>present.has(s));for(const x of rows){if(coins.length>=MAX)break;if(!coins.includes(x.s))coins.push(x.s)}coins=coins.slice(0,MAX);put(COIN_KEY,coins);const map=new Map(rows.map(x=>[x.s,x.row]));const ordered=coins.map(s=>map.get(s)).filter(Boolean);rows.forEach(x=>{if(!ordered.includes(x.row))ordered.push(x.row)});ordered.forEach(r=>body.appendChild(r));const pos=new Map(ordered.map((r,i)=>[r,i]));ordered.forEach((r,i)=>{const n=r.querySelector('td:first-child');if(n)n.textContent=String(i+1)});}
function readRadarCard(card){const items=[...card.querySelectorAll('li')];return items.map(li=>{const s=(li.querySelector('span')?.textContent||'').trim();const v=(li.querySelector('strong')?.textContent||'').trim();return s?{s,v}:null}).filter(Boolean)}
function stableRadar(){const cards=[...document.querySelectorAll('.radarCard')];if(cards.length<3)return;const titles=['pump','dump','spike'];cards.slice(0,3).forEach((card,idx)=>{const live=readRadarCard(card);if(!live.length)return;let saved=Array.isArray(radar[titles[idx]])?radar[titles[idx]]:[];const liveMap=new Map(live.map(x=>[x.s,x.v]));saved=saved.filter(s=>liveMap.has(s));for(const x of live){if(saved.length>=5)break;if(!saved.includes(x.s))saved.push(x.s)}saved=saved.slice(0,5);radar[titles[idx]]=saved;const old=card.querySelector('ol');if(!old)return;const html=saved.map(s=>{const x=liveMap.get(s);if(x==null)return '';const cls=titles[idx]==='spike'?'hot':x.startsWith('-')?'down':'up';return '<li><span>'+s+'</span><strong class="'+cls+'">'+x+'</strong></li>'}).join('');old.innerHTML=html;});put(RADAR_KEY,radar)}
function run(){stabilizeTable();stableRadar()}
const observer=new MutationObserver(()=>requestAnimationFrame(run));
function boot(){const body=document.getElementById('signals');if(body)observer.observe(body,{childList:true,subtree:true});run()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
setInterval(run,1500);
})();