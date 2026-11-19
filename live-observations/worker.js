// Moraga Observatory live station proxy and push alerts. Deploy as a Cloudflare Worker.
import { AlertPush, handlePush, runAlertCheck } from './push.js';
import { WU_STATIONS, WU_PRIMARY, wuCurrent, wuToday, wuDay, skyFor, wuKeyShape } from './wu.js';
export { AlertPush };
// Configure secrets XWEATHER_CLIENT_ID, XWEATHER_CLIENT_SECRET and ALLOWED_ORIGIN.
// Never place credentials in the public website or source repository.
const STATION = 'PWS_KCAMORAG71';
// Optional validated station IDs, supplied as Worker environment variables.
// Do not select a station based on proximity alone without checking its exposure and freshness.
const CITY_COORDS = {lafayette:'37.890,-122.115',danville:'37.813,-121.974',greenbrook:'37.799,-121.970'};
const MAX_AGE_MS = 45 * 60 * 1000;
// Hand-picked neighborhood stations (Xweather IDs), tried before automatic discovery.
// Weather Underground IDs (e.g. KCADANVI207) are not in Xweather (invalid_location),
// so none are listed yet.
const PREFERRED = {};
async function preferredStation(city, env, log) {
  for (const id of PREFERRED[city] || []) {
    try {
      const endpoint = new URL('https://api.aerisapi.com/observations/'+id);
      endpoint.searchParams.set('client_id', env.XWEATHER_CLIENT_ID);
      endpoint.searchParams.set('client_secret', env.XWEATHER_CLIENT_SECRET);
      const res = await fetch(endpoint.toString(), {cf:{cacheTtl:120,cacheEverything:true}});
      if (!res.ok) { log.push(id+': http '+res.status); continue; }
      const payload = await res.json();
      const record = Array.isArray(payload.response) ? payload.response[0] : payload.response;
      if (fresh(record?.ob)) return id;
      log.push(id+': '+(payload.error?.code || (record?.ob ? 'stale' : 'no observation')));
    } catch (_) { log.push(id+': error'); }
  }
  return null;
}
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
    // GET /station?id=KCAXXXX : a Weather Underground station's location and latest reading (for adding towns).
    if (url.pathname === '/station') {
      const id = (url.searchParams.get('id') || '').toUpperCase();
      if (!/^[A-Z0-9]{4,15}$/.test(id) || !String(env.WU_API_KEY || '').trim()) return Response.json({error:'Bad station id'},{status:400,headers:cors});
      const u = new URL('https://api.weather.com/v2/pws/observations/current');
      u.searchParams.set('stationId', id); u.searchParams.set('format','json'); u.searchParams.set('units','e'); u.searchParams.set('numericPrecision','decimal');
      u.searchParams.set('apiKey', String(env.WU_API_KEY).trim().replace(/^["']+|["']+$/g,''));
      const r = await fetch(u.toString());
      if (!r.ok) return Response.json({error:'Station lookup failed', status:r.status},{status:502,headers:cors});
      const ob = (await r.json())?.observations?.[0] || {};
      return Response.json({station:id, neighborhood:ob.neighborhood ?? null, lat:ob.lat ?? null, lon:ob.lon ?? null, elevation_ft:ob.imperial?.elev ?? null,
        observed_utc:ob.obsTimeUtc ?? null, temperature_f:ob.imperial?.temp ?? null, solar_radiation_wm2:ob.solarRadiation ?? null}, {headers:{...cors,'Cache-Control':'no-store'}});
    }
    // GET /daily?city=lafayette&date=YYYY-MM-DD : that town's observed high/low/rain (verification input).
    if (url.pathname === '/daily') {
      const c = (url.searchParams.get('city') || '').toLowerCase(), date = url.searchParams.get('date') || '';
      if (!WU_STATIONS[c]) return Response.json({error:'Unknown location'},{status:400,headers:cors});
      const log = [], day = await wuDay(WU_STATIONS[c], date, env, log);
      return Response.json(day ? {...day, city:c} : {error:'No observations', city:c, date, diagnostics: log}, {status: day ? 200 : 404, headers:{...cors,'Cache-Control':'public, max-age=3600'}});
    }
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:{...cors,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
    if (request.method !== 'GET' || url.pathname !== '/observations') return new Response('Not found',{status:404,headers:cors});
    const city = (url.searchParams.get('city') || 'moraga').toLowerCase();
    if (!['moraga','lafayette','danville','greenbrook'].includes(city)) return Response.json({error:'Unknown location'},{status:400,headers:cors});
    const wuLog = [];
    // Observed today-so-far (high/low/rain) for every town, and one pressure for all of them:
    // the owner's Moraga station (KCAMORAG71), so the towns never disagree on pressure.
    const extras = async (base) => {
      const out = {};
      const today = await wuToday(WU_STATIONS[city], env, wuLog);
      if (today) Object.assign(out, { daily_high_f: today.high_f, daily_low_f: today.low_f, daily_date: today.date });
      const rain = base.daily_precipitation_in ?? base.precip_today_in;
      if (Number.isFinite(rain)) out.daily_precipitation_in = rain;
      {
        const m = await wuCurrent(WU_STATIONS.moraga, env, wuLog);
        if (m && Number.isFinite(m.pressure_inhg)) Object.assign(out, { pressure_inhg: m.pressure_inhg, pressure_station: WU_STATIONS.moraga, local_pressure_inhg: base.pressure_inhg ?? null });
      }
      return out;
    };
    const sky = async solar => { try { return await skyFor(city, env, solar, wuLog); } catch (_) { wuLog.push('sky: error'); return null; } finally { if (wuLog.some(x => / 401$/.test(x)) && !wuLog.some(x => x.startsWith('key format'))) wuLog.push(wuKeyShape(env)); } };
    // Hand-picked Weather Underground station first (needs WU_API_KEY); Xweather below is the fallback.
    if (WU_PRIMARY.has(city) && String(env.WU_API_KEY || '').trim()) {
      const wu = await wuCurrent(WU_STATIONS[city], env, wuLog);
      if (wu) { const body = {...wu, city, station_selection:'weather_underground', sky: await sky(wu.solar_radiation_wm2), source:'Weather Underground'}; Object.assign(body, await extras(body)); return Response.json({...body, diagnostics: wuLog.length ? wuLog : undefined}, {headers:cors}); }
    }
    if (!env.XWEATHER_CLIENT_ID || !env.XWEATHER_CLIENT_SECRET) return Response.json({error:'Live service not configured'},{status:503,headers:cors});
    let station = city === 'moraga' ? STATION : (city === 'lafayette' ? env.LAFAYETTE_STATION_ID : city === 'greenbrook' ? env.GREENBROOK_STATION_ID : env.DANVILLE_STATION_ID);
    // Never serve the known-problematic Greenbrook station, even if pinned in settings.
    if(city === 'greenbrook' && GREENBROOK_EXCLUDED.has(station)) station = null;
    let discovery = null, preferred = false; const preferredLog = [];
    if (!station && PREFERRED[city]) { station = await preferredStation(city, env, preferredLog); preferred = !!station; }
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
      let dailyExtrema = null, dailyRain = null;
      // Today's rain total from Xweather's daily summary (the station's own running total).
      // ob.precipIN is a rolling reading, not a daily total, so it is never used for this.
      if(city === 'moraga') {
        try {
          const day = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
          const s = new URL('https://api.aerisapi.com/observations/summary/'+station);
          s.searchParams.set('from',day); s.searchParams.set('to',day);
          s.searchParams.set('client_id',env.XWEATHER_CLIENT_ID); s.searchParams.set('client_secret',env.XWEATHER_CLIENT_SECRET);
          const sr = await fetch(s.toString(),{cf:{cacheTtl:300,cacheEverything:true}});
          if(sr.ok){
            const sj = await sr.json();
            const rec = Array.isArray(sj.response) ? sj.response[0] : sj.response;
            for(const period of rec?.periods || []){
              const sum = period?.summary || {};
              if(String(sum.ymd || '').replace(/-/g,'') !== day.replace(/-/g,'')) continue;
              const total = Number(sum.precip?.totalIN);
              if(Number.isFinite(total) && total >= 0 && total < 30) dailyRain = {date: day, inches: Math.round(total*100)/100, count: sum.precip?.count ?? null};
            }
          }
        } catch(_) { /* rainfall is optional */ }
        // The station's own running daily total on Weather Underground matches the owner's app exactly.
        const wuMoraga = await wuCurrent(WU_STATIONS.moraga, env, wuLog);
        if (wuMoraga && Number.isFinite(wuMoraga.precip_today_in)) {
          const day = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
          dailyRain = {date: day, inches: Math.round(wuMoraga.precip_today_in*100)/100, source: 'weather_underground'};
        }
      }
      const solarRecent = []; // sunlight samples from the last 30 minutes (Moraga archive)
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
              const sol = Number(obSample?.solradWM2);
              if(Number.isFinite(sol) && obSample?.solradWM2 !== null && Date.now()-stamp*1000 <= 30*60000) solarRecent.push(sol);
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
      const xbody = {
        station:station.replace(/^PWS_/,''),
        city,
        station_selection:preferred?'preferred_neighborhood_pws':discovery?'automatic_nearest_fresh_pws':'configured',
        preferred_station_check:preferredLog.length?preferredLog:undefined,
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
        solar_radiation_wm2:pick('solradWM2'),
        daily_precipitation_in:dailyRain?.inches ?? null,
        daily_precipitation_date:dailyRain?.date ?? null,
        daily_precipitation_source:dailyRain?.source ?? (dailyRain ? 'xweather_summary' : null),
        // Sunlight only from vetted stations; an auto-discovered station's sensor may be shaded.
        sky:await sky(discovery ? null : [...solarRecent, pick('solradWM2')]),
        diagnostics:wuLog.length?wuLog:undefined,
        source:'Xweather'
      };
      if (!xbody.daily_extrema || xbody.daily_extrema.date) Object.assign(xbody, await extras(xbody));
      if (!Number.isFinite(xbody.daily_high_f) && xbody.daily_extrema?.complete) Object.assign(xbody, { daily_high_f: xbody.daily_extrema.high_f, daily_low_f: xbody.daily_extrema.low_f, daily_date: xbody.daily_extrema.date });
      xbody.diagnostics = wuLog.length ? wuLog : undefined;
      return Response.json(xbody,{headers:cors});
    } catch(e) {
      return Response.json({error:'Latest observation unavailable'},{status:502,headers:{...cors,'Cache-Control':'no-store'}});
    }
  }
};
