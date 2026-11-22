/* Generate the public local Weather Outlook feed from current NWS + Open-Meteo guidance. */
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/dwl-outlook.js'),'utf8'),{filename:'dwl-outlook.js'});
const locations=JSON.parse(fs.readFileSync(path.join(__dirname,'../locations.json'),'utf8')).locations;
const offices=[...new Set(locations.map(x=>x.nws_office||'MTR'))],now=new Date(),tz='America/Los_Angeles';
const headers={'User-Agent':'DiabloWeatherLab/1.0 (public local forecast outlook)','Accept':'application/geo+json'};
async function get(url){const r=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('HTTP '+r.status+' '+url);return r.json();}
async function afdFor(office){try{const listing=await get('https://api.weather.gov/products/types/AFD/locations/'+office),item=(listing['@graph']||[])[0];if(!item?.id)return null;const p=await get('https://api.weather.gov/products/'+encodeURIComponent(item.id)),issued=Date.parse(p.issuanceTime||item.issuanceTime||'');if(!Number.isFinite(issued)||now-issued>18*3600000||issued>now.getTime()+300000)return null;return{text:String(p.productText||''),issued:new Date(issued).toISOString()};}catch(e){console.warn('AFD unavailable',office,e.message);return null;}}
async function alertsFor(l){try{const d=await get('https://api.weather.gov/alerts/active?point='+l.lat+','+l.lon);return(d.features||[]).map(x=>x.properties?.event).filter(Boolean);}catch(e){return[];}}
async function forecastFor(l){const q=new URLSearchParams({latitude:l.lat,longitude:l.lon,timezone:tz,temperature_unit:'fahrenheit',precipitation_unit:'inch',wind_speed_unit:'mph',forecast_days:'10',hourly:'precipitation,precipitation_probability,wind_gusts_10m,weather_code,temperature_2m,cloud_cover',daily:'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max'});const d=await get('https://api.open-meteo.com/v1/forecast?'+q);if(!d.hourly?.time?.length||!d.daily?.time?.length)throw Error('Incomplete model guidance');return d;}
function publicCopy(s){
 let x=String(s||'');
 // Temperatures belong in the forecast cards, not the editorial synopsis.
 x=x.replace(/\b(?:highs?|lows?|temperatures?)\s+(?:near|around|up to|of)\s+\d{2,3}\s*°(?:F)?/gi,'')
    .replace(/\b(?:highs?|lows?)\s+in the\s+(?:low|mid|upper)\s+\d{2}s/gi,'')
    .replace(/\b\d{2,3}\s*°F?\b/g,'');
 // Translate forecast-office / model language into plain, reader-facing language.
 const rules=[
  [/\ban upper[- ]level (low|trough)\b/gi,'a weather system'],
  [/\bupper[- ]level low\b/gi,'weather system'],
  [/\bupper[- ]level trough\b/gi,'weather system'],
  [/\bshortwave trough\b/gi,'weather disturbance'],
  [/\bshortwave\b/gi,'weather disturbance'],
  [/\bfrontal boundary\b/gi,'front'],
  [/\bpost[- ]frontal\b/gi,'behind the front'],
  [/\bthe models keep things mostly dry\b/gi,'conditions look mostly dry'],
  [/\bmodels keep things mostly dry\b/gi,'conditions look mostly dry'],
  [/\bmodel guidance\b/gi,'the forecast'],
  [/\bthe models\b/gi,'the forecast'],
  [/\bmodels suggest\b/gi,'the forecast points to'],
  [/\bmodels show\b/gi,'the forecast points to'],
  [/\bprecipitation\b/gi,'rain'],
  [/\bprecip\b/gi,'rain'],
  [/\bQPF\b/gi,'rainfall'],
  [/\bconvection\b/gi,'showers and thunderstorms'],
  [/\binstability\b/gi,'conditions favorable for thunderstorms'],
  [/\bmarine layer\b/gi,'low clouds'],
  [/\bstratus\b/gi,'low clouds'],
  [/\bupslope flow\b/gi,'winds pushing moist air up the hills'],
  [/\bdiurnal\b/gi,'afternoon'],
  [/\bimpactful\b/gi,'noticeable']
 ];
 for(const [pattern,wording] of rules)x=x.replace(pattern,wording);
 // Avoid talking about forecast machinery; say what people will experience instead.
 x=x.replace(/\bBeyond that,\s*/gi,'Afterward, ')
    .replace(/\bthrough the extended period\b/gi,'over the next several days')
    .replace(/\bthrough the period\b/gi,'over the next several days')
    .replace(/\bremain mostly dry\b/gi,'stay mostly dry')
    .replace(/\bwill remain dry\b/gi,'should stay dry')
    .replace(/\blooks to remain dry\b/gi,'should stay dry')
    .replace(/\bweather conditions\b/gi,'conditions');
 // Remove editorial leftovers caused by stripping temperature clauses.
 x=x.replace(/\b(?:with|and)\s+(?:a\s+)?(?:high|low)s?\s*(?:,|and|$)/gi,'')
    .replace(/\s{2,}/g,' ').replace(/\s+([,.])/g,'$1')
    .replace(/,\s*,/g,',').replace(/\s+([.!?])/g,'$1').trim();
 return x;
}async function mapLimit(a,n,fn){const out=new Array(a.length);let next=0;await Promise.all(Array.from({length:n},async()=>{while(true){const i=next++;if(i>=a.length)return;out[i]=await fn(a[i]);}}));return out;}
(async()=>{const afd=new Map(await Promise.all(offices.map(async o=>[o,await afdFor(o)])));const outlooks={};const results=await mapLimit(locations,5,async l=>{try{const [f,alerts]=await Promise.all([forecastFor(l),alertsFor(l)]);const place=l.place||l.area||l.short||l.key;const r=DWLOutlook.build({now,hourly:f.hourly,daily:f.daily,afdText:afd.get(l.nws_office||'MTR')?.text||null,issued:afd.get(l.nws_office||'MTR')?.issued||null,alerts,place,region:l.region||place});const headline=publicCopy(r.headline),text=publicCopy(r.text);if(!headline||!text)throw Error('Empty outlook');if(/\b\d{2,3}\s*°\s*F?\b/i.test(headline+' '+text))throw Error('Explicit temperature remained in public synopsis');outlooks[l.outlook_key||l.key]={headline,text};return true;}catch(e){console.error('Failed location',l.key,e.message);return false;}});
const ok=results.filter(Boolean).length;if(ok!==locations.length)throw Error('Only '+ok+'/'+locations.length+' locations generated; refusing incomplete feed');
const stamp=now.toISOString(),label=new Intl.DateTimeFormat('en-US',{timeZone:tz,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(now);
fs.writeFileSync(path.join(__dirname,'../weather_outlooks.json'),JSON.stringify({schema_version:1,generated_utc:stamp,source_label:'Diablo Weather Lab · Updated '+label,horizon_days:7,outlooks},null,2)+'\n');
console.log('Generated local outlooks for '+ok+'/'+locations.length+' locations.');})().catch(e=>{console.error(e);process.exit(1);});
