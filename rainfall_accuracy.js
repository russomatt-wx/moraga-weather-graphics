/* Rainfall verification: intentionally separate from temperature scores. */
(function(){
 const target=document.getElementById('rain-accuracy-results');
 if(!target)return;
 const labels={latest:'Latest verified day','7d':'Rolling seven days','30d':'Rolling 30 days','90d':'Rolling 90 days'};
 const order=['latest','7d','30d','90d'];
 function render(data){
  target.replaceChildren();
  if(!data||!data.windows){target.textContent='Rainfall verification is not available yet.';return;}
  const intro=document.createElement('p');
  intro.style.cssText='color:#b9cddd;margin:12px 0 18px';
  intro.textContent='Verified KCAMORAG71 daily rainfall. Lower absolute error is better. Wet-day error excludes dry days.';
  target.append(intro);
  for(const key of order){
   const block=data.windows[key]||{};
   const heading=document.createElement('h4');
   heading.style.cssText='margin:20px 0 10px;font-size:1.04rem';
   heading.textContent=labels[key]+' · '+(block.days||0)+' verified days';
   target.append(heading);
   const scores=block.models||[];
   if(!scores.length){const p=document.createElement('p');p.style.color='#a8bacb';p.textContent='Awaiting matched forecasts and validated rainfall observations.';target.append(p);continue;}
   for(const r of scores){
    const row=document.createElement('div');row.style.cssText='display:grid;grid-template-columns:76px minmax(0,1fr) 116px;align-items:center;gap:10px;margin:10px 0;font-size:14px';
    const name=document.createElement('strong');name.textContent=r.model.toUpperCase();
    const track=document.createElement('div');track.style.cssText='height:12px;background:#294158;border-radius:10px;overflow:hidden';
    const bar=document.createElement('div');bar.style.cssText='height:100%;background:#7caed2;width:'+Math.max(2,Math.min(100,100*(1-r.mae_in/Math.max(0.1,...scores.map(s=>s.mae_in)))) )+'%';
    track.append(bar);
    const value=document.createElement('span');value.style.textAlign='right';value.textContent=r.mae_in.toFixed(3)+'″ ('+r.days+'d)';
    row.append(name,track,value);target.append(row);
    const detail=document.createElement('div');detail.style.cssText='font-size:12px;color:#9fb7c9;margin:-5px 0 9px 86px';
    detail.textContent='Wet-day MAE: '+(r.wet_day_mae_in==null?'not yet available':r.wet_day_mae_in.toFixed(3)+'″')+' · Hits '+r.hits+' · Misses '+r.misses+' · False alarms '+r.false_alarms;
    target.append(detail);
   }
  }
  const foot=document.createElement('p');foot.style.cssText='font-size:12px;color:#9fb7c9;margin-top:15px';
  foot.textContent='Preliminary: prospective archived forecasts only. Missing or incomplete station rainfall is never scored as zero.';
  target.append(foot);
 }
 fetch('rain_verification_latest.json?ts='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('not published');return r.json()}).then(render).catch(()=>{target.textContent='Rainfall verification is collecting data; rankings will appear after the first validated match.';});
})();
