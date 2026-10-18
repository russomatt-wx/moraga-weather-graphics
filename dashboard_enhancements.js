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
 fetch('hourly_matches.csv?skill='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.text()}).then(csv=>{
 const lines=csv.trim().split(/\r?\n/),headers=lines.shift().split(','),idx=Object.fromEntries(headers.map((v,i)=>[v,i]));
 if(['model','valid_utc','error_f'].some(k=>idx[k]===undefined))throw Error();
 const rows=lines.map(l=>l.split(',')).map(c=>({model:(c[idx.model]||'').toUpperCase(),date:new Date(c[idx.valid_utc]),error:Math.abs(Number(c[idx.error_f]))})).filter(r=>r.model&&Number.isFinite(r.error)&&!isNaN(r.date));
 if(!rows.length)throw Error();
 const end=Math.max(...rows.map(r=>r.date.getTime())),start=end-7*86400000;
 const recent=rows.filter(r=>r.date.getTime()>start),groups={};
 for(const r of recent)(groups[r.model]??=[]).push(r.error);
 const ranked=Object.entries(groups).map(([model,a])=>({model,n:a.length,mae:a.reduce((x,y)=>x+y,0)/a.length})).filter(r=>r.n>=5).sort((a,b)=>a.mae-b.mae);
 if(!ranked.length)throw Error();
 const names=['ECMWF','GFS','BLEND','WEIGHTED','CHATGPT'];const matched=names.map(n=>ranked.find(r=>r.model===n)).filter(Boolean);
 const items=matched.length?matched:ranked.slice(0,4);
 const namesAll=['ECMWF','GFS','GEM','ICON','NAM','BLEND','WEIGHTED','CHATGPT'];
 const ordered=namesAll.map(n=>ranked.find(r=>r.model===n)).filter(Boolean);
 const show=ordered.length?ordered:ranked;
 const fmt=v=>Number.isFinite(v)?v.toFixed(2)+'°F':'—';
 const body=show.map(r=>'<tr data-model="'+escape(r.model)+'"><th scope="row">'+escape(r.model)+'</th><td class="skill-unavailable daily-high">—</td><td class="skill-unavailable daily-low">—</td><td><strong>'+fmt(r.mae)+'</strong><small>'+r.n+' hours</small></td></tr>').join('');
 el.innerHTML='<div class="skill-table-wrap"><table class="skill-compare"><thead><tr><th>Model</th><th>High MAE</th><th>Low MAE</th><th>Hourly MAE</th></tr></thead><tbody>'+body+'</tbody></table></div><p class="skill-disclaimer"><strong>Hourly:</strong> rolling 7-day absolute temperature error through '+escape(ptTime(new Date(end)))+'. <strong>High / Low:</strong> <span id="daily-model-status">Collecting prospective model forecasts and complete KCAMORAG71 observation days.</span> Daily verification is independent of hourly scores.</p>';
 fetch('model_daily_verification_latest.json?skill='+Date.now(),{cache:'no-store'})
  .then(r=>{if(!r.ok)throw Error('Daily verification not published');return r.json()})
  .then(d=>{
   let verified=0;
   for(const row of el.querySelectorAll('tr[data-model]')){
    const score=d.model_scores?.[row.dataset.model.toLowerCase()];
    if(!score||!score.verified_days)continue;
    verified+=score.verified_days;
    for(const [selector,key] of [['.daily-high','high_mae_f'],['.daily-low','low_mae_f']]){
     const cell=row.querySelector(selector);
     if(Number.isFinite(score[key])){
      cell.textContent=Number(score[key]).toFixed(2)+'°F';
      cell.classList.remove('skill-unavailable');
      cell.title=score.verified_days+' completed days · bias '+(Number(score[key==='high_mae_f'?'high_bias_f':'low_bias_f'])||0).toFixed(2)+'°F';
     }
    }
   }
   const status=document.getElementById('daily-model-status');
   if(status)status.textContent=verified?'Daily MAE uses prospective archived model highs/lows matched to complete station days; sample counts and signed biases appear on hover.':'Collecting prospective forecasts; no eligible completed station days yet.';
  }).catch(()=>{const status=document.getElementById('daily-model-status');if(status)status.textContent='Daily verification feed pending publication; hourly scores remain available.'});

 }).catch(()=>{el.innerHTML='<p class="day-date">Awaiting verified hourly matches; no rankings inferred.</p>'});
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
