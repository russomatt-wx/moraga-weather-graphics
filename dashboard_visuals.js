(function(){
'use strict';
const $=id=>document.getElementById(id),pt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hour12:true});
const dayFmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',weekday:'short'});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fetchJson=p=>fetch(p+'?v='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('unavailable');return r.json()});
function sky(cloud,rain){if(Number.isFinite(rain)&&rain>=.04)return ['🌧️','Rain'];if(Number.isFinite(rain)&&rain>=.004)return ['🌦️','Showers'];if(!Number.isFinite(cloud))return ['🌤️','Forecast'];return cloud<=15?['☀️','Sunny']:cloud<=45?['🌤️','Partly cloudy']:cloud<=80?['🌥️','Mostly cloudy']:['☁️','Cloudy']}
function run(){
 Promise.allSettled([fetchJson('moraga_forecast_10day.json'),fetchJson('moraga_mesoscale_data.json')]).then(results=>{
 const forecast=results[0].status==='fulfilled'?results[0].value:null,meso=results[1].status==='fulfilled'?results[1].value:null;
 const hero=$('station-hero'),timeline=$('hourly-strip');if(!hero||!timeline)return;
 const moraga=meso?.transect?.Moraga,now=Date.now();
 const stationReading=null; // No verified live KCAMORAG71 feed is published by this website. Never substitute model output for observations.
 const idx=(moraga?.times||[]).findIndex(t=>Date.parse(t)>=now-3600000);
 const modelNow=idx>=0?moraga.temperature_f?.[idx]:null;
 const localDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const di=forecast?.dates?.indexOf(localDate)??-1,cond=di>=0?forecast.daily_conditions?.[localDate]:null;
 const models=di>=0?Object.entries(forecast.temperature_models||{}).filter(([n,m])=>!/(EPS|GEFS)/i.test(n)&&Number.isFinite(m.high_f?.[di])&&Number.isFinite(m.low_f?.[di])):[];
 const mean=k=>models.length?Math.round(models.reduce((n,[,m])=>n+m[k][di],0)/models.length):null;
 const hi=mean('high_f'),lo=mean('low_f');
 const temp=stationReading===null?'—':Math.round(stationReading)+'°F';
 const label=cond?.label||'Moraga weather',icon=cond?.icon||'🌤️';
 hero.className='station-hero '+(label.toLowerCase().includes('rain')?'hero-rain':label.toLowerCase().includes('cloud')?'hero-cloud':'hero-clear');
 hero.innerHTML='<div class="hero-top"><span class="hero-eyebrow">MORAGA · KCAMORAG71</span><span class="hero-live-status">Station reading unavailable</span></div>'+
 '<div class="hero-primary"><div><div class="hero-temp">'+temp+'</div><div class="hero-temp-caption">Current observed temperature</div></div><div class="hero-condition"><span aria-hidden="true">'+escape(icon)+'</span><strong>'+escape(label)+'</strong><small>Today’s model outlook</small></div></div>'+
 '<div class="hero-bottom"><div><span>Today’s model high</span><strong>'+(hi===null?'—':hi+'°F')+'</strong></div><div><span>Today’s model low</span><strong>'+(lo===null?'—':lo+'°F')+'</strong></div><div><span>Forecast Moraga temp</span><strong>'+(Number.isFinite(modelNow)?Math.round(modelNow)+'°F':'—')+'</strong></div></div>'+
 '<p class="hero-foot">Model values are guidance, not station observations. Current station temperature will appear only when a verified live feed is connected. <a href="#observations">Station chart ↗</a></p>';
 if(!moraga?.times?.length){timeline.innerHTML='<p class="pending">Hourly Moraga guidance unavailable.</p>';return}
 const fModels=Object.entries(forecast?.hourly_conditions||{}).filter(([name])=>['ECMWF','GFS','ICON','GEM'].includes(name));
 const nextIndex=moraga.times.findIndex(t=>Date.parse(t)>=now-3600000);if(nextIndex<0){timeline.innerHTML='<p class="pending">Hourly model guidance is out of date. Awaiting the next published update.</p>';return}const start=nextIndex;
 const rows=moraga.times.slice(start,start+24).map((t,k)=>{
 const i=start+k,ts=Date.parse(t);
 const conditions=fModels.map(([,v])=>{const ix=v.time?.indexOf(t.slice(0,16));return ix>=0?{cloud:v.cloud_cover_pct?.[ix],rain:v.precipitation_mm?.[ix]}:null}).filter(Boolean);
 const avg=key=>{const a=conditions.map(c=>c[key]).filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
 const [icon,desc]=sky(avg('cloud'),avg('rain'));
 const wind=moraga.wind_mph?.[i],temp=moraga.temperature_f?.[i];
 return '<div class="hourly-cell"><span>'+escape(dayFmt.format(ts))+' '+escape(pt.format(ts))+'</span><span class="hourly-icon" title="'+escape(desc)+'">'+icon+'</span><strong>'+(Number.isFinite(temp)?Math.round(temp)+'°':'—')+'</strong><small>'+(Number.isFinite(wind)?Math.round(wind)+' mph':'Wind —')+'</small><small>'+escape(desc)+'</small></div>';
 });
 timeline.innerHTML='<div class="hourly-head"><div><strong>Next 24 hours</strong><small>Moraga model forecast · temperature, wind and sky</small></div><span>Swipe to explore →</span></div><div class="hourly-scroll" tabindex="0" aria-label="24-hour model forecast timeline">'+rows.join('')+'</div><p class="hourly-source">Temperature and wind: published Moraga mesoscale model guidance. Sky icons: available model cloud and precipitation forecasts. Not live observations. '+(meso.generated_utc?'Model dataset retrieved '+escape(new Date(meso.generated_utc).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))+' PT.':'')+'</p>';
 }).catch(()=>{});
}
run();
})();
