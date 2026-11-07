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
 const title=el.closest('article')?.querySelector('h3');
 if(title)title.textContent='Temperature forecast accuracy';
 fetch('hourly_matches.csv?skill='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.text()}).then(csv=>{
  const lines=csv.trim().split(/\r?\n/),headers=lines.shift().split(','),idx=Object.fromEntries(headers.map((v,i)=>[v,i]));
  if(['model','valid_utc','error_f'].some(k=>idx[k]===undefined))throw Error('Missing columns');
  const rows=lines.map(l=>l.split(',')).map(c=>({model:(c[idx.model]||'').toUpperCase(),date:new Date(c[idx.valid_utc]),error:Math.abs(Number(c[idx.error_f])),signed:Number(c[idx.error_f])})).filter(r=>r.model&&Number.isFinite(r.error)&&Number.isFinite(r.signed)&&!isNaN(r.date));
  if(!rows.length)throw Error('No matches');
  const end=Math.max(...rows.map(r=>r.date.getTime())),start=end-7*86400000,groups={};
  for(const r of rows.filter(r=>r.date.getTime()>start))(groups[r.model]??=[]).push(r);
  const ranked=Object.entries(groups).map(([model,values])=>({model,n:values.length,mae:values.reduce((a,b)=>a+b.error,0)/values.length,bias:values.reduce((a,b)=>a+b.signed,0)/values.length})).filter(r=>r.n>=5).sort((a,b)=>a.mae-b.mae);
  if(!ranked.length)throw Error('No eligible models');
  const max=Math.max(...ranked.map(r=>r.mae),0.1);
  const subtitle=document.createElement('p');subtitle.className='skill-disclaimer';subtitle.textContent='Average hourly forecast error · past 7 days. Shorter bars are better. Results are preliminary when models have different numbers of verified hours.';
  el.replaceChildren(subtitle);
  const list=document.createElement('div');list.className='simple-skill-list';
  for(const [i,r] of ranked.entries()){
   const item=document.createElement('div');item.className='simple-skill-item';
   item.style.cssText='display:grid;grid-template-columns:70px minmax(0,1fr) 78px;column-gap:12px;align-items:center;margin:15px 0';
   const name=document.createElement('strong');name.textContent=(i===0?'🏆 ':'')+r.model;name.style.fontSize='14px';
   const track=document.createElement('div');track.style.cssText='height:13px;background:#2a4157;border-radius:20px;overflow:hidden';
   const fill=document.createElement('div');fill.style.cssText='height:100%;width:'+Math.max(2,100*r.mae/max)+'%;background:'+(i===0?'#50c6a5':'#7eacd0')+';border-radius:20px';
   track.append(fill);
   const value=document.createElement('strong');value.style.cssText='font-size:15px;text-align:right;font-variant-numeric:tabular-nums';value.textContent=r.mae.toFixed(2)+'°F';
   const count=document.createElement('small');count.style.cssText='grid-column:2 / 4;color:#a9bdce;margin-top:4px;font-size:12px';count.textContent=r.n+' verified hours';
   const bias=document.createElement('small');bias.style.cssText='grid-column:2 / 4;font-size:12px;margin-top:3px;font-weight:600';bias.style.color=Math.abs(r.bias)<0.5?'#50c6a5':r.bias>0?'#ef9a91':'#8abef0';bias.textContent='Bias '+(r.bias>0?'+':'')+r.bias.toFixed(2)+'°F · '+(Math.abs(r.bias)<0.5?'Near neutral':r.bias>0?'Too warm':'Too cool');item.append(name,track,value,count,bias);list.append(item);
  }
  el.append(list);
  const note=document.createElement('p');note.className='skill-disclaimer';note.textContent='Daily high and low errors use a separate set of completed days and are shown below; they are not combined with hourly scores.';el.append(note);
  const details=document.createElement('details');details.className='model-skill-details';
  const summary=document.createElement('summary');summary.textContent='Daily high and low forecast errors';
  const body=document.createElement('div');body.style.cssText='overflow-x:auto;padding-top:12px';
  const table=document.createElement('table');table.className='skill-compare';
  const thead=document.createElement('thead');thead.innerHTML='<tr><th>Model</th><th>High Error</th><th>High Bias</th><th>Low Error</th><th>Low Bias</th><th>Days</th></tr>';
  const tbody=document.createElement('tbody');table.append(thead,tbody);body.append(table);details.append(summary,body);el.append(details);
  fetch('model_daily_verification_latest.json?skill='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{
   const names=ranked.map(r=>r.model);
   for(const name of names){
    const score=d.model_scores?.[name.toLowerCase()];
    if(!score||!score.verified_days)continue;
    const tr=document.createElement('tr');
    for(const v of [name,score.high_mae_f==null?'—':Number(score.high_mae_f).toFixed(2)+'°F',score.high_bias_f==null?'—':(Number(score.high_bias_f)>0?'+':'')+Number(score.high_bias_f).toFixed(2)+'°F',score.low_mae_f==null?'—':Number(score.low_mae_f).toFixed(2)+'°F',score.low_bias_f==null?'—':(Number(score.low_bias_f)>0?'+':'')+Number(score.low_bias_f).toFixed(2)+'°F',String(score.verified_days)]){
     const td=document.createElement('td');td.textContent=v;if(v.startsWith('+'))td.style.color='#ef9a91';else if(v.startsWith('−')||v.startsWith('-'))td.style.color='#8abef0';tr.append(td);
    }
    tbody.append(tr);
   }
   if(!tbody.children.length){const p=document.createElement('p');p.textContent='Awaiting completed station days.';body.replaceChildren(p);}
  }).catch(()=>{body.textContent='Daily verification is awaiting publication.';});
 }).catch(()=>{el.textContent='Awaiting verified hourly matches; no rankings inferred.';});
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
