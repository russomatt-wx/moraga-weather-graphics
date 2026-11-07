(function(){
'use strict';
const $=id=>document.getElementById(id);
const ptDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const ptTime=d=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(d);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function summary(){
 const root=$('weather-at-a-glance');if(!root)return;
 fetch('moraga_forecast_10day.json?summary='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{
 const dates=d.dates||[],today=ptDate(new Date());let i=dates.indexOf(today);if(i<0)i=dates.findIndex(x=>x>today);if(i<0)throw Error('No current forecast');
 const models=d.temperature_models||{};
 const weights=Object.entries(models).filter(([name,m])=>!/(EPS|GEFS)/i.test(name)&&Number.isFinite(m.high_f?.[i])&&Number.isFinite(m.low_f?.[i]));
 const avg=k=>weights.length?weights.reduce((sum,[,m])=>sum+m[k][i],0)/weights.length:null;
 const hi=avg('high_f'),lo=avg('low_f');
 const condition=d.daily_conditions?.[dates[i]]||{};
 const precip=Object.entries(d.model_daily_inches||{}).filter(([,a])=>Number.isFinite(a?.[i])).map(([,a])=>a[i]);
 const wet=precip.filter(v=>v>=0.05).length,agreement=precip.length?Math.round(100*wet/precip.length):null;
 const upcoming=dates.slice(i+1).map((date,j)=>({date,cond:d.daily_conditions?.[date],values:Object.values(d.model_daily_inches||{}).map(a=>a?.[i+1+j]).filter(Number.isFinite)}));
 const change=upcoming.find(x=>x.values.length&&x.values.filter(v=>v>=0.05).length>=Math.max(2,Math.ceil(x.values.length*.4)));
 const next=change?'Potential rain signal '+new Date(change.date+'T12:00:00').toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',weekday:'short',month:'short',day:'numeric'}):'No strong multi-model rain signal in the next 10 days';
 const generated=d.generated_utc?ptTime(new Date(d.generated_utc)):'time unavailable';
 const value=v=>Number.isFinite(v)?Math.round(v)+'°':'—';
 root.innerHTML='<div class="glance-head"><strong>Moraga at a glance</strong><span>Model guidance · '+escape(dates[i])+'</span></div>'+
 '<div class="glance-grid">'+
 '<div><span>Temperature guidance</span><strong>'+value(hi)+' / '+value(lo)+'</strong><small>Unweighted model mean · high / low</small></div>'+
 '<div><span>Conditions</span><strong>'+escape((condition.icon||'')+' '+(condition.label||'Not available'))+'</strong><small>Published daily outlook</small></div>'+
 '<div><span>Rain signal</span><strong>'+(agreement===null?'—':agreement+'%')+'</strong><small>Models forecasting ≥0.05″ today ('+wet+'/'+precip.length+')</small></div>'+
 '<div><span>Marine influence</span><strong><a href="#marine">See marine tracker ↗</a></strong><small>No unverified live marine classification</small></div></div>'+
 '<p class="glance-next">'+escape(next)+'</p><p class="glance-source">Forecast dataset retrieved '+escape(generated)+'. Temperature mean is not the skill-weighted website forecast; see the <a href="#forecast">10-day forecast</a> for calibrated guidance. <a href="#observations">Station observations ↓</a></p>';
 }).catch(()=>{root.innerHTML='<p class="pending">Current summary is awaiting a valid published forecast. <a href="#forecast">Open the 10-day forecast</a>.</p>'});
}
function accuracy(){
 const el=$('skill-snapshot');if(!el)return;
 const article=el.closest('article');
 const title=article?.querySelector('h3');
 if(title)title.textContent='Daily high & low model bias';
 // Retire the redundant hourly leaderboard and its nested 7/30/90-day
 // rankings from this card. The independent daily verification is the source.
 for(const detail of article?.querySelectorAll(':scope > details.model-skill-details')||[])detail.hidden=true;
 const intro=document.createElement('p');
 intro.className='skill-disclaimer';
 intro.textContent='Average difference from KCAMORAG71 actual daily highs and lows. Blue = too cool · Coral = too warm.';
 el.replaceChildren(intro);
 const format=v=>{
  if(!Number.isFinite(v))return {label:'—',color:'#a9bdce',description:'Unavailable'};
  if(Math.abs(v)<.5)return {label:'Near target',color:'#50c6a5',description:'Within 0.5°F on average'};
  return {label:Math.abs(v).toFixed(1)+'°F '+(v>0?'too warm':'too cool'),color:v>0?'#ef9a91':'#8abef0',description:''};
 };
 fetch('model_daily_verification_latest.json?skill='+Date.now(),{cache:'no-store'})
 .then(r=>{if(!r.ok)throw Error('Daily verification unavailable');return r.json()})
 .then(data=>{
  const scores=Object.entries(data.model_scores||{}).filter(([name,score])=>score&&score.verified_days>0)
   .sort((a,b)=>a[0].localeCompare(b[0]));
  if(!scores.length)throw Error('No verified daily highs and lows');
  const grid=document.createElement('div');
  grid.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:9px;margin-top:14px';
  for(const heading of ['Daily high','Daily low']){
   const h=document.createElement('div');h.textContent=heading;h.style.cssText='color:#b7cfdf;font-size:13px;font-weight:750;padding:0 4px 3px';
   grid.append(h);
  }
  const table=document.createElement('div');table.style.cssText='display:grid;gap:9px';
  for(const [name,score] of scores){
   const row=document.createElement('div');row.style.cssText='border:1px solid #35516a;border-radius:12px;padding:12px 10px;background:#112438';
   const heading=document.createElement('div');heading.style.cssText='display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:9px';
   const model=document.createElement('strong');model.textContent=name.toUpperCase();model.style.fontSize='15px';
   const days=document.createElement('small');days.textContent=score.verified_days+' days';days.style.cssText='font-size:11px;color:#9db8c9';
   heading.append(model,days);row.append(heading);
   const cols=document.createElement('div');cols.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px';
   for(const [label,key] of [['High','high_bias_f'],['Low','low_bias_f']]){
    const v=Number(score[key]),info=format(score[key]==null?NaN:v);
    const cell=document.createElement('div');cell.style.cssText='min-width:0';
    const small=document.createElement('div');small.textContent=label;small.style.cssText='font-size:12px;color:#a9bdce;margin-bottom:3px';
    const val=document.createElement('div');val.textContent=info.label;val.style.cssText='font-size:clamp(13px,3.5vw,18px);font-weight:750;color:'+info.color+';line-height:1.3';
    cell.append(small,val);cols.append(cell);
   }
   row.append(cols);table.append(row);
  }
  el.replaceChildren(intro,table);
  const note=document.createElement('p');note.className='skill-disclaimer';
  note.textContent='Signed bias is model forecast minus observed temperature, averaged across completed days. This shows direction, not the size of every individual error.';
  el.append(note);
 }).catch(()=>{const p=document.createElement('p');p.textContent='Waiting for verified daily high and low data.';el.append(p)});
}
function groups(){
 const section=$('westcoast');if(!section)return;
 const grid=section.querySelector(':scope > .grid');if(!grid)return;
 const cards=[...grid.querySelectorAll(':scope > article')];if(!cards.length)return;
 const definitions=[
  {title:'Surface & thickness',description:'Pacific synoptic composite and official surface analysis',match:/Pacific synoptic|Current Pacific surface fronts/i},
  {title:'Upper-air pattern',description:'500 hPa vorticity and 850 hPa temperature / wind',match:/upper-air model|500 hPa vorticity|850 hPa temperature/i},
  {title:'Jet stream',description:'300 hPa jet structure',match:/300 hPa jet/i},
  {title:'Atmospheric moisture',description:'Integrated vapor transport and moisture transport',match:/Integrated vapor transport/i}
 ];
 const grouped=new Set();
 for(const def of definitions){
  const members=cards.filter(card=>def.match.test(card.querySelector('h3')?.textContent||''));
  if(!members.length)continue;
  const details=document.createElement('details');details.className='pacific-group';details.open=true;
  const summary=document.createElement('summary');summary.innerHTML='<span><strong>'+escape(def.title)+'</strong><small>'+escape(def.description)+'</small></span><span aria-hidden="true" class="pacific-chevron">⌄</span>';
  details.append(summary);
  const body=document.createElement('div');body.className='pacific-group-grid';
  members.forEach(card=>{body.append(card);grouped.add(card)});
  details.append(body);grid.append(details);
 }
 for(const card of cards)if(!grouped.has(card))grid.append(card);
 grid.classList.add('pacific-organized');
}
summary();accuracy();groups();
})();
