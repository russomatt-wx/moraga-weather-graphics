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
 const title=article?.querySelector('h3');if(title)title.textContent='Daily high & low model bias';
 // Hide only the redundant hourly rankings; keep rainfall verification.
 for(const detail of article?.querySelectorAll(':scope > details.model-skill-details')||[]){
  if(detail.querySelector('#accuracy-results'))detail.hidden=true;
 }
 const intro=document.createElement('p');intro.className='skill-disclaimer';
 intro.textContent='How far each model predicts Moraga’s daily highs and lows too warm or too cool.';
 el.replaceChildren(intro);
 const fmt=v=>!Number.isFinite(v)?['—','#a9bdce']:Math.abs(v)<.5?['Near target','#50c6a5']:[Math.abs(v).toFixed(1)+'°F too '+(v>0?'warm':'cool'),v>0?'#ef9a91':'#8abef0'];
 fetch('model_daily_verification_latest.json?skill='+Date.now(),{cache:'no-store'})
 .then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{
  const tabs=document.createElement('div');tabs.style.cssText='display:flex;gap:7px;flex-wrap:wrap;margin:13px 0';
  const area=document.createElement('div');
  const periods=[['7','7 days'],['30','30 days'],['90','90 days']];
  const buttons=[];
  function render(period){
   for(const [key,btn] of buttons){const active=key===period;btn.style.background=active?'#236f85':'#152b40';btn.style.borderColor=active?'#60d3e7':'#3b566d';btn.setAttribute('aria-pressed',String(active));}
   const latest=Date.parse(data.generated_utc);
   const anchor=Number.isFinite(latest)?latest:Date.now();
   const cutoff=anchor-Number(period)*86400000;
   const rows=Array.isArray(data.matches)?data.matches.filter(r=>{const t=Date.parse(r.valid_local_date+'T12:00:00Z');return Number.isFinite(t)&&t>=cutoff&&t<=anchor;}):null;
   const names=['ecmwf','gfs','icon','gem','nam'];
   area.replaceChildren();
   if(!rows){const p=document.createElement('p');p.className='skill-disclaimer';p.textContent='Historical daily records are awaiting publication. The current all-time averages are shown below.';area.append(p);}
   for(const name of names){
    const matches=rows?.filter(r=>r.model===name)||[];
    const score=data.model_scores?.[name];
    if(rows&&!matches.length)continue;
    if(!rows&&(!score||!score.verified_days))continue;
    const mean=key=>matches.length?matches.reduce((sum,r)=>sum+Number(r[key]),0)/matches.length:Number(score[key]);
    const high=fmt(mean(rows?'high_error_f':'high_bias_f')),low=fmt(mean(rows?'low_error_f':'low_bias_f'));
    const card=document.createElement('div');card.style.cssText='border:1px solid #38546d;border-radius:12px;padding:13px 12px;margin:9px 0;background:#112438';
    const header=document.createElement('div');header.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px';
    const label=document.createElement('strong');label.textContent=name.toUpperCase();label.style.fontSize='16px';
    const count=document.createElement('small');count.textContent=(rows?matches.length:score.verified_days)+' verified days';count.style.color='#9db8c9';header.append(label,count);
    const values=document.createElement('div');values.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px';
    for(const [caption,entry] of [['High',high],['Low',low]]){
     const cell=document.createElement('div');const cap=document.createElement('div');cap.textContent=caption;cap.style.cssText='color:#a9bdce;font-size:12px;margin-bottom:4px';
     const val=document.createElement('div');val.textContent=entry[0];val.style.cssText='color:'+entry[1]+';font-weight:750;font-size:clamp(13px,3.5vw,18px);line-height:1.35';cell.append(cap,val);values.append(cell);
    }
    card.append(header,values);area.append(card);
   }
   if(!area.children.length){area.textContent='Not enough completed verification days in this period.';}
  }
  for(const [key,label] of periods){
   const btn=document.createElement('button');btn.type='button';btn.textContent=label;
   btn.style.cssText='border:1px solid #3b566d;border-radius:9px;padding:8px 12px;color:#e4f3fb;font-weight:700;cursor:pointer';
   btn.addEventListener('click',()=>render(key));buttons.push([key,btn]);tabs.append(btn);
  }
  el.replaceChildren(intro,tabs,area);
  const note=document.createElement('p');note.className='skill-disclaimer';note.textContent='Blue = too cool · Coral = too warm. Signed average bias; a near-target average does not mean every forecast was accurate.';el.append(note);
  render('30');
 }).catch(()=>{el.textContent='Waiting for verified daily high and low data.'});
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
