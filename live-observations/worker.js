import LOCATIONS from '../locations.json';
// Moraga Observatory live station proxy and push alerts. Deploy as a Cloudflare Worker.
import { AlertPush, handlePush, runAlertCheck } from './push.js';
import { WU_STATIONS, WU_PRIMARY, TOWN_COORDS, LOCATION_IDS, wuCurrent, wuToday, wuDay, wuDayObs, skyFor, wuKeyShape, sunElevation } from './wu.js';
// Rain the station is measuring right now beats any sky estimate (airport reports lag passing bands).
// A station's rain rate only overrides the sky when it's believable. One bucket tip (0.01 in/hr) can come
// from a sprinkler, dew or a stray drop and lingers for an hour, so a trace rate needs support:
// humid air (85%+) or nearby airports already reporting precipitation.
// The rate is worked out from the last bucket tip, so one 0.01" tip from dew or fog drip on a cold, saturated
// morning can read as 0.07 in/hr. Unless nearby airports also report precipitation, rain needs at least
// three tips today (0.03") behind it.
function rainingSky(rate, sky, city, humidity, today) {
  if (!(Number(rate) > 0)) return sky;
  const airportsWet = sky && Number(sky.code) >= 51 && Number(sky.code) <= 99;
  if (!airportsWet && Number.isFinite(Number(today)) && today !== null && Number(today) < 0.03) return sky;
  if (Number(rate) < 0.03 && !(Number(humidity) >= 85) && !airportsWet) return sky;
  const c = TOWN_COORDS[city], day = c ? sunElevation(c[0], c[1]) > 0 : true;
  const r = Number(rate);
  return r >= 0.3 ? { text: 'Heavy rain', code: 65, is_day: day, source: 'station_rain_rate', rate_in_hr: r }
       : r >= 0.05 ? { text: 'Rain', code: 63, is_day: day, source: 'station_rain_rate', rate_in_hr: r }
       : { text: 'Light rain', code: 61, is_day: day, source: 'station_rain_rate', rate_in_hr: r };
}
// Valley fog the airports can't see (Lamorinda, San Ramon Valley): the station itself is saturated
// (dew point within ~1.5°F, 97%+ humidity) in calm air. Rain wins. Once the sun is up, the sunlight sensor
// decides: dim light = fog, near-normal light = burned off. With no usable sunlight reading it's "Patchy fog".
function fogSky(sky, o, city) {
  if (!o) return sky;
  if (sky && Number(sky.code) >= 51) return sky;
  const rh = Number(o.humidity_pct), t = Number(o.temperature_f), td = Number(o.dew_point_f), w = Number(o.wind_mph);
  if (!(rh >= 97)) return sky;
  if (Number.isFinite(t) && Number.isFinite(td) && t - td > 1.5) return sky;
  if (Number.isFinite(w) && w > 5) return sky;
  const ratio = Number(sky?.clear_sky_ratio);
  if (Number.isFinite(ratio) && ratio >= 0.55) return sky;
  const c = TOWN_COORDS[city], day = c ? sunElevation(c[0], c[1]) > 0 : !!sky?.is_day;
  return { text: Number.isFinite(ratio) ? 'Fog' : 'Patchy fog', code: 45, is_day: day, source: 'station_saturation',
           humidity_pct: rh, ...(Number.isFinite(ratio) ? { clear_sky_ratio: ratio } : {}), sky_without_fog: sky?.text || null };
}
export { AlertPush };
// Configure secrets XWEATHER_CLIENT_ID, XWEATHER_CLIENT_SECRET and ALLOWED_ORIGIN.
// Never place credentials in the public website or source repository.
const STATION = 'PWS_KCAMORAG71';
// Optional validated station IDs, supplied as Worker environment variables.
// Do not select a station based on proximity alone without checking its exposure and freshness.
const CITY_COORDS = Object.fromEntries(Object.entries(TOWN_COORDS).filter(([k]) => k !== 'moraga').map(([k, c]) => [k, c.join(',')]));
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
const SITE_DATA = 'https://russomatt-wx.github.io/moraga-weather-graphics/';
const NWS_HEADERS = { 'User-Agent': 'DiabloWeatherLab-observations/1.0', Accept: 'application/geo+json' };
async function siteJson(path, ttl) {
  try { const r = await fetch(SITE_DATA + path, { cf: { cacheTtl: ttl, cacheEverything: true } }); return r.ok ? r.json() : null; } catch (_) { return null; }
}
const c2f = (c) => (Number.isFinite(c) ? Math.round((c * 9 / 5 + 32) * 10) / 10 : null);
const kmh2mph = (k) => (Number.isFinite(k) ? Math.round(k * 0.621371 * 10) / 10 : null);
// Dew point (°F) from temperature (°F) and relative humidity (%), Magnus formula.
function dewF(tf, rh) {
  if (!Number.isFinite(tf) || !Number.isFinite(rh) || rh <= 0) return null;
  const tc = (tf - 32) * 5 / 9, g = Math.log(rh / 100) + 17.62 * tc / (243.12 + tc);
  return Math.round((243.12 * g / (17.62 - g) * 9 / 5 + 32) * 10) / 10;
}
// Today so far (Pacific day) from a public station's NWS history: high, low and rain since midnight.
async function publicToday(id, log, airport = false) {
  const now = new Date(), pt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const g = (t) => Number(pt.find((x) => x.type === t).value), date = `${pt.find((x) => x.type === 'year').value}-${pt.find((x) => x.type === 'month').value}-${pt.find((x) => x.type === 'day').value}`;
  const start = new Date(now.getTime() - (g('hour') * 60 + now.getUTCMinutes()) * 60000 - 60000).toISOString();
  try {
    const r = await fetch('https://api.weather.gov/stations/' + id + '/observations?start=' + encodeURIComponent(start), { headers: NWS_HEADERS, cf: { cacheTtl: 600, cacheEverything: true } });
    if (!r.ok) { log.push(id + ' today http ' + r.status); return null; }
    const temps = [], rain = {};
    for (const f of (await r.json()).features || []) {
      const p = f.properties || {}, t = p.temperature?.value;
      if (Number.isFinite(t)) temps.push(c2f(t));
      // Hourly totals (ASOS reports them near :53); keep one per hour.
      const mm = p.precipitationLastHour?.value, ts = Date.parse(p.timestamp || '');
      // Airports (ASOS) omit the rain group in a dry hour, so a routine hourly report with no value means 0.
      if (Number.isFinite(ts) && (Number.isFinite(mm) || (airport && 'precipitationLastHour' in p))) rain[new Date(ts + 7 * 60000).toISOString().slice(0, 13)] = Number.isFinite(mm) ? mm : 0;
    }
    if (temps.length < 2) return null;
    const vals = Object.values(rain);
    return { date, high_f: Math.max(...temps), low_f: Math.min(...temps), rain_in: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / 25.4 * 100) / 100 : null };
  } catch (_) { log.push(id + ' today error'); return null; }
}
async function publicObservation(city, log) {
  const [choice, health] = await Promise.all([siteJson('verification/public_stations.json', 3600), siteJson('verification/public_station_health.json', 3600)]);
  const dropped = new Set((health?.stations || []).filter((s) => s.town === city && s.status === 'drop').map((s) => s.station));
  const list = (choice?.[city]?.stations || []).filter((s) => !dropped.has(s.id));
  const nowcast = async () => { const n = await siteJson('nowcast_current.json', 600), e = n?.towns?.[city]; return e && Number.isFinite(e.estimate_f) && Date.now() - Date.parse(e.valid_utc) < 3 * 3600000 ? e : null; };
  let out = null;
  for (const s of list) {
    try {
      const r = await fetch('https://api.weather.gov/stations/' + s.id + '/observations/latest', { headers: NWS_HEADERS, cf: { cacheTtl: 300, cacheEverything: true } });
      if (!r.ok) { log.push(s.id + ' http ' + r.status); continue; }
      const p = (await r.json()).properties || {};
      const t = Date.parse(p.timestamp || ''), temp = p.temperature?.value;
      if (!Number.isFinite(t) || Date.now() - t > 80 * 60000 || !Number.isFinite(temp)) { log.push(s.id + ' stale'); continue; }
      const rh = Number.isFinite(p.relativeHumidity?.value) ? Math.round(p.relativeHumidity.value) : null;
      if (out) { // filling humidity only: a nearby station that measures it
        if (rh != null && s.miles <= 6) { out.humidity_pct = rh; out.humidity_station = s.id; }
        if (out.humidity_pct != null) break; else continue;
      }
      out = { station: s.id, station_name: s.name, station_distance_mi: s.miles, station_selection: 'public', source: 'Public station (NWS)', observed_utc: new Date(t).toISOString(),
        temperature_f: c2f(temp), dew_point_f: c2f(p.dewpoint?.value), humidity_pct: rh,
        wind_mph: kmh2mph(p.windSpeed?.value) ?? 0, wind_direction_deg: p.windDirection?.value ?? null, wind_gust_mph: kmh2mph(p.windGust?.value),
        pressure_inhg: Number.isFinite(p.barometricPressure?.value) ? Math.round(p.barometricPressure.value / 3386.39 * 100) / 100 : null };
      if (rh != null) break;
    } catch (_) { log.push(s.id + ' error'); }
  }
  if (out) {
    // Some public stations (fire-weather sites) don't report humidity: take it from NOAA's estimate.
    if (out.humidity_pct == null) { const e = await nowcast(); if (e && Number.isFinite(e.humidity_pct)) { out.humidity_pct = Math.round(e.humidity_pct); out.humidity_station = 'NOAA RTMA'; } }
    if (!Number.isFinite(out.dew_point_f) || out.humidity_station) out.dew_point_f = dewF(out.temperature_f, out.humidity_pct);
    return out;
  }
  // Fallback: NOAA's estimate for this spot (hourly, from the estimate job).
  const e = await nowcast();
  if (e) {
    return { station: 'NOAA RTMA', station_selection: 'estimate', source: 'NOAA estimate', observed_utc: e.valid_utc, temperature_f: e.corrected_f ?? e.estimate_f,
      humidity_pct: e.humidity_pct, dew_point_f: dewF(e.corrected_f ?? e.estimate_f, e.humidity_pct), wind_mph: e.wind_mph, wind_gust_mph: e.gust_mph, estimated: true,
      today: e.today || null };
  }
  return null;
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
    // GET /forecast?<Open-Meteo forecast query> : shared, edge-cached copy of the Open-Meteo forecast.
    // Every phone asking for the same location within 10 minutes gets one upstream request, which keeps
    // the site clear of Open-Meteo's per-IP rate limit (HTTP 429) that was blanking wind and hourly data.
    // GET /radar-tile?m=0|5|...|50&z=&x=&y= : NOAA NEXRAD (IEM) tile passed through with CORS so the page can
    // read pixels for Radar Insight (storm tracking). Cached 4 minutes.
    if (url.pathname === '/radar-tile') {
      const m = Number(url.searchParams.get('m') || 0), z = Number(url.searchParams.get('z')), x = Number(url.searchParams.get('x')), y = Number(url.searchParams.get('y'));
      if (![0,5,10,15,20,25,30,35,40,45,50].includes(m) || !Number.isInteger(z) || z < 4 || z > 10 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
        return new Response('Bad request', { status: 400, headers: cors });
      const up = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913' + (m ? '-m' + String(m).padStart(2, '0') + 'm' : '') + '/' + z + '/' + x + '/' + y + '.png';
      const r = await fetch(up, { cf: { cacheTtl: 240, cacheEverything: true } });
      if (!r.ok) return new Response('Upstream ' + r.status, { status: 502, headers: cors });
      return new Response(r.body, { headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=240' } });
    }
    if (url.pathname === '/forecast') {
      const q = new URLSearchParams(url.search);
      const lat = Number(q.get('latitude')), lon = Number(q.get('longitude'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || [...q.keys()].length > 20) return Response.json({error:'Bad request'},{status:400,headers:cors});
      q.set('latitude', lat.toFixed(4)); q.set('longitude', lon.toFixed(4)); q.sort();
      const upstream = 'https://api.open-meteo.com/v1/forecast?' + q.toString();
      const cache = caches.default, key = new Request('https://cache.local/forecast?' + q.toString());
      let hit = await cache.match(key);
      if (!hit) {
        let r = null;
        for (let k = 0; k < 2 && !(r && r.ok); k++) { try { r = await fetch(upstream, {headers:{'User-Agent':'DiabloWeatherLab/1.0'}}); } catch (_) { r = null; } }
        if (!r || !r.ok) return Response.json({error:'Forecast upstream failed', status:r ? r.status : null},{status:502,headers:{...cors,'Cache-Control':'no-store'}});
        hit = new Response(await r.text(), {headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=600'}});
        await cache.put(key, hit.clone());
      }
      return new Response(hit.body, {headers:{...cors,'Content-Type':'application/json','Cache-Control':'public, max-age=300'}});
    }
    // GET /dayobs?city=lafayette&date=YYYY-MM-DD : that town's station readings through the day (estimate-test backfill).
    if (url.pathname === '/dayobs') {
      const c = (url.searchParams.get('city') || '').toLowerCase(), date = url.searchParams.get('date') || '';
      if (!WU_STATIONS[c]) return Response.json({error:'Unknown location'},{status:400,headers:cors});
      const log = [], obs = await wuDayObs(WU_STATIONS[c], date, env, log);
      return Response.json(obs ? {city:c, station:WU_STATIONS[c], date, obs} : {error:'No observations', diagnostics: log}, {status: obs ? 200 : 404, headers:{...cors,'Cache-Control':'public, max-age=3600'}});
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
    if (!LOCATION_IDS.includes(city)) return Response.json({error:'Unknown location'},{status:400,headers:cors});
    const wuLog = [];
    // Observed today-so-far (high/low/rain) for every town, and one pressure for all of them:
    // the owner's Moraga station (KCAMORAG71), so the towns never disagree on pressure.
    const extras = async (base) => {
      const out = {};
      // Station-less neighbourhoods: the public station's NWS history, or the NOAA estimate's running high/low.
      const pubDay = WU_STATIONS[city] ? null : base.station_selection === 'public' ? await publicToday(base.station, wuLog) : base.today;
      const today = WU_STATIONS[city] ? await wuToday(WU_STATIONS[city], env, wuLog) : pubDay;
      if (today) Object.assign(out, { daily_high_f: today.high_f, daily_low_f: today.low_f, daily_date: today.date });
      let rain = base.daily_precipitation_in ?? base.precip_today_in ?? pubDay?.rain_in;
      // Neighbourhood stations rarely have a rain gauge: use the nearest airport's (ASOS) rain since midnight.
      if (!WU_STATIONS[city] && !Number.isFinite(rain)) {
        const ap = LOCATIONS.locations.find((l) => l.id === city)?.sky_airports?.[0];
        if (ap) { const a = await publicToday(ap, wuLog, true); if (a && Number.isFinite(a.rain_in)) { rain = a.rain_in; out.rain_station = ap; } }
      }
      if (Number.isFinite(rain)) out.daily_precipitation_in = rain;
      {
        const m = await wuCurrent(WU_STATIONS.moraga, env, wuLog);
        if (m && Number.isFinite(m.pressure_inhg)) Object.assign(out, { pressure_inhg: m.pressure_inhg, pressure_station: WU_STATIONS.moraga, local_pressure_inhg: base.pressure_inhg ?? null });
      }
      return out;
    };
    const sky = async solar => { try { return await skyFor(city, env, solar, wuLog); } catch (_) { wuLog.push('sky: error'); return null; } finally { if (wuLog.some(x => / 401$/.test(x)) && !wuLog.some(x => x.startsWith('key format'))) wuLog.push(wuKeyShape(env)); } };
    // Neighborhoods without a station of their own: the nearest health-checked public station (NWS feed),
    // else NOAA's corrected current-conditions estimate. Both are licence-free.
    if (!WU_STATIONS[city]) {
      const pub = await publicObservation(city, wuLog);
      if (pub) { const body = {...pub, city, sky: await sky(null)}; body.sky = fogSky(body.sky, body, city); Object.assign(body, await extras(body)); return Response.json(body, {headers:{...cors,'Cache-Control':'public, max-age=120'}}); }
      return Response.json({error:'No fresh public observation', city, diagnostics: wuLog}, {status:503, headers:cors});
    }
    // Hand-picked Weather Underground station first (needs WU_API_KEY); Xweather below is the fallback.
    if (WU_PRIMARY.has(city) && String(env.WU_API_KEY || '').trim()) {
      const wu = await wuCurrent(WU_STATIONS[city], env, wuLog);
      if (wu) { const body = {...wu, city, station_selection:'weather_underground', sky: rainingSky(wu.precip_rate_in_hr, await sky(wu.solar_radiation_wm2), city, wu.humidity_pct, wu.precip_today_in), source:'Weather Underground'}; body.sky = fogSky(body.sky, body, city); Object.assign(body, await extras(body)); return Response.json({...body, diagnostics: wuLog.length ? wuLog : undefined}, {headers:cors}); }
    }
    if (!env.XWEATHER_CLIENT_ID || !env.XWEATHER_CLIENT_SECRET) return Response.json({error:'Live service not configured'},{status:503,headers:cors});
    let station = city === 'moraga' ? STATION : (city === 'lafayette' ? env.LAFAYETTE_STATION_ID : city === 'greenbrook' ? env.GREENBROOK_STATION_ID : city === 'danville' ? env.DANVILLE_STATION_ID : null);
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
        sky:rainingSky(pick('precipRateIN') ?? (WU_STATIONS[city] ? (await wuCurrent(WU_STATIONS[city], env, wuLog))?.precip_rate_in_hr : null), await sky(discovery ? null : [...solarRecent, pick('solradWM2')]), city, pick('humidity'), dailyRain?.inches ?? (WU_STATIONS[city] ? (await wuCurrent(WU_STATIONS[city], env, wuLog))?.precip_today_in : null)),
        diagnostics:wuLog.length?wuLog:undefined,
        source:'Xweather'
      };
      xbody.sky = fogSky(xbody.sky, xbody, city);
      if (!xbody.daily_extrema || xbody.daily_extrema.date) Object.assign(xbody, await extras(xbody));
      if (!Number.isFinite(xbody.daily_high_f) && xbody.daily_extrema?.complete) Object.assign(xbody, { daily_high_f: xbody.daily_extrema.high_f, daily_low_f: xbody.daily_extrema.low_f, daily_date: xbody.daily_extrema.date });
      xbody.diagnostics = wuLog.length ? wuLog : undefined;
      return Response.json(xbody,{headers:cors});
    } catch(e) {
      return Response.json({error:'Latest observation unavailable'},{status:502,headers:{...cors,'Cache-Control':'no-store'}});
    }
  }
};
