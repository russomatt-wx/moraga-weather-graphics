// Moraga Observatory live station proxy and push alerts. Deploy as a Cloudflare Worker.
import { AlertPush, handlePush, runAlertCheck } from './push.js';
export { AlertPush };
// Configure secrets XWEATHER_CLIENT_ID, XWEATHER_CLIENT_SECRET and ALLOWED_ORIGIN.
// Never place credentials in the public website or source repository.
const STATION = 'PWS_KCAMORAG71';
// Optional validated station IDs, supplied as Worker environment variables.
// Do not select a station based on proximity alone without checking its exposure and freshness.
const CITY_COORDS = {lafayette:'37.890,-122.115',danville:'37.813,-121.974',greenbrook:'37.799,-121.970'};
const MAX_AGE_MS = 45 * 60 * 1000;
// Greenbrook station excluded after inconsistent local temperature reports.
const GREENBROOK_EXCLUDED = new Set(['PWS_KCASANRA808']);
function fresh(ob) {
  const timestamp = Number(ob?.timestamp);
  return Number.isFinite(timestamp) && timestamp > 0 &&
    Date.now() - timestamp * 1000 <= MAX_AGE_MS &&
    timestamp * 1000 <= Date.now() + 5 * 60 * 1000 &&
    Number.isFinite(Number(ob?.tempF)) && ob.tempF !== null;
}
async function discoverStation(city, env) {
  const endpoint = new URL('https://api.aerisapi.com/observations/closest');
  endpoint.searchParams.set('p', CITY_COORDS[city]);
  endpoint.searchParams.set('radius', '6mi');
  endpoint.searchParams.set('limit', '30');
  endpoint.searchParams.set('filter', 'allstations');
  endpoint.searchParams.set('client_id', env.XWEATHER_CLIENT_ID);
  endpoint.searchParams.set('client_secret', env.XWEATHER_CLIENT_SECRET);
  const res = await fetch(endpoint.toString(), {cf:{cacheTtl:600,cacheEverything:true}});
  if (!res.ok) throw new Error('Station discovery failed');
  const payload = await res.json();
  const records = Array.isArray(payload.response) ? payload.response : (payload.response ? [payload.response] : []);
  const candidates = records.filter(record => {
    const id = String(record?.id || '');
    return /^PWS_[A-Za-z0-9_-]+$/.test(id) && fresh(record?.ob) && (city !== 'greenbrook' || !GREENBROOK_EXCLUDED.has(id));
  });
  // Prefer recent, complete observations; distance breaks ties rather than
  // allowing an incomplete nearby station to beat a usable neighborhood PWS.
  const fields = ['humidity','dewpointF','windSpeedMPH','pressureIN','windGustMPH'];
  const completeness = record => fields.reduce((n,key) => {
    const value = record?.ob?.[key];
    return n + (value !== null && value !== '' && Number.isFinite(Number(value)) ? 1 : 0);
  },0);
  candidates.sort((a,b) => {
    const quality = completeness(b)-completeness(a);
    if (quality) return quality;
    const aAge = Date.now()-Number(a.ob.timestamp)*1000;
    const bAge = Date.now()-Number(b.ob.timestamp)*1000;
    if (Math.abs(aAge-bAge)>15*60000) return aAge-bAge;
    return Number(a?.relativeTo?.distanceMI ?? 999)-Number(b?.relativeTo?.distanceMI ?? 999);
  });
  return {candidate:candidates[0] || null, searched:records.length, fresh_pws:candidates.length, api_error:payload.error?.code || null};
}
export default {
  // Cron (wrangler.toml): check NWS alerts for every town and send push notifications.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlertCheck(env));
  },
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://russomatt-wx.github.io';
    const cors = {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Cache-Control': 'public, max-age=120'};
    const url = new URL(request.url);
    if (url.pathname.startsWith('/push/')) return handlePush(request, env, {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin'});
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:{...cors,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
    if (request.method !== 'GET' || url.pathname !== '/observations') return new Response('Not found',{status:404,headers:cors});
    if (!env.XWEATHER_CLIENT_ID || !env.XWEATHER_CLIENT_SECRET) return Response.json({error:'Live service not configured'},{status:503,headers:cors});
    const city = (url.searchParams.get('city') || 'moraga').toLowerCase();
    if (!['moraga','lafayette','danville','greenbrook'].includes(city)) return Response.json({error:'Unknown location'},{status:400,headers:cors});
    let station = city === 'moraga' ? STATION : (city === 'lafayette' ? env.LAFAYETTE_STATION_ID : city === 'greenbrook' ? env.GREENBROOK_STATION_ID : env.DANVILLE_STATION_ID);
    // Never serve the known-problematic Greenbrook station, even if pinned in settings.
    if(city === 'greenbrook' && GREENBROOK_EXCLUDED.has(station)) station = null;
    let discovery = null;
    if (!station && city !== 'moraga') {
      try { discovery = await discoverStation(city, env); station = discovery?.candidate?.id; }
      catch (_) { return Response.json({error:'Nearby station discovery unavailable',city},{status:503,headers:cors}); }
    }
    if (!station || !/^PWS_[A-Za-z0-9_-]+$/.test(station)) return Response.json({error:'No fresh nearby PWS available',city,stations_returned:discovery?.searched ?? null,fresh_pws:discovery?.fresh_pws ?? null,upstream_error:discovery?.api_error ?? null},{status:503,headers:cors});
    const endpoint = new URL('https://api.aerisapi.com/observations/'+station);
    endpoint.searchParams.set('client_id',env.XWEATHER_CLIENT_ID);
    endpoint.searchParams.set('client_secret',env.XWEATHER_CLIENT_SECRET);
    try {
      const response = await fetch(endpoint.toString(),{cf:{cacheTtl:120,cacheEverything:true}});
      if (!response.ok) throw new Error('Upstream '+response.status);
      const payload = await response.json();
      const record = Array.isArray(payload.response) ? payload.response[0] : payload.response;
      const ob = record?.ob;
      if (!ob || !Number.isFinite(Number(ob.timestamp))) throw new Error('Invalid observation timestamp');
      if(!fresh(ob)) throw new Error('Stale or invalid observation');
      const pick = key => Number.isFinite(Number(ob[key])) && ob[key] !== null && ob[key] !== '' ? Number(ob[key]) : null;
      // Recover today's full Pacific-day temperature range from archived station samples.
      // This does not depend on GitHub Actions or an open browser tab.
      let dailyExtrema = null;
      try {
        if(city === 'moraga') {
        const pacificDate = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        const archive = new URL('https://api.aerisapi.com/observations/archive/'+station);
        archive.searchParams.set('from',pacificDate);
        archive.searchParams.set('client_id',env.XWEATHER_CLIENT_ID);
        archive.searchParams.set('client_secret',env.XWEATHER_CLIENT_SECRET);
        const archivedResponse = await fetch(archive.toString(),{cf:{cacheTtl:600,cacheEverything:true}});
        if(archivedResponse.ok){
          const archived = await archivedResponse.json();
          const records = Array.isArray(archived.response)?archived.response:[archived.response];
          const values = [];
          const timestamps = [];
          for(const record of records){
            for(const sample of (Array.isArray(record?.periods)?record.periods:Array.isArray(record?.observations)?record.observations:[record])){
              const obSample = sample?.ob||sample;
              const stamp = Number(obSample?.timestamp);
              const temp = Number(obSample?.tempF);
              if(!Number.isFinite(stamp)||!Number.isFinite(temp)||temp< -30||temp>130)continue;
              const sampleDay = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp*1000));
              if(sampleDay===pacificDate && stamp*1000<=Date.now()+60000){values.push(temp);timestamps.push(stamp*1000);}
            }
          }
          if(values.length){
            timestamps.sort((a,b)=>a-b);
            const nowMs=Date.now();
            const first=timestamps[0],last=timestamps[timestamps.length-1];
            // Derive Pacific midnight as an absolute instant from the current local date,
            // accounting for the timezone's current UTC offset.
            const dayStart=Date.parse(pacificDate+'T00:00:00')+
              (nowMs-new Date(new Date(nowMs).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})).getTime());
            let largestGap=0;
            for(let i=1;i<timestamps.length;i++)largestGap=Math.max(largestGap,timestamps[i]-timestamps[i-1]);
            const startGap=Math.max(0,first-dayStart);
            const endGap=Math.max(0,nowMs-last);
            const complete=startGap<=30*60000&&endGap<=30*60000&&largestGap<=45*60000;
            dailyExtrema={date:pacificDate,high_f:Math.max(...values),low_f:Math.min(...values),samples:values.length,
              complete,first_observed_utc:new Date(first).toISOString(),last_observed_utc:new Date(last).toISOString(),
              largest_gap_minutes:Math.round(largestGap/60000),
              coverage_status:complete?'complete':'incomplete'};
          }
        }
        }
      }catch(_err){/* Keep current observations available when archive is delayed. */}
      return Response.json({
        station:station.replace(/^PWS_/,''),
        city,
        station_selection:discovery?'automatic_nearest_fresh_pws':'configured',
        station_distance_mi:discovery?.candidate?.relativeTo?.distanceMI ?? null,
        station_completeness_fields:['humidity','dewpointF','windSpeedMPH','pressureIN','windGustMPH'].filter(key=>ob[key]!==null&&ob[key]!==''&&Number.isFinite(Number(ob[key]))).length,
        observed_utc:new Date(Number(ob.timestamp)*1000).toISOString(),
        temperature_f:pick('tempF'),
        daily_extrema:dailyExtrema,
        humidity_pct:pick('humidity'),
        dew_point_f:pick('dewpointF'),
        wind_mph:pick('windSpeedMPH'),
        wind_direction_deg:pick('windDirDEG'),
        wind_direction:typeof ob.windDir==='string'?ob.windDir:null,
        wind_gust_mph:pick('windGustMPH'),
        wind_gust_direction_deg:pick('windGustDirDEG'),
        wind_gust_direction:typeof ob.windGustDir==='string'?ob.windGustDir:null,
        pressure_inhg:pick('pressureIN'),
        source:'Xweather'
      },{headers:cors});
    } catch(e) {
      return Response.json({error:'Latest observation unavailable'},{status:502,headers:{...cors,'Cache-Control':'no-store'}});
    }
  }
};
