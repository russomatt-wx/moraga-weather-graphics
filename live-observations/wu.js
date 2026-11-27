// Weather Underground / The Weather Company data for the live observations worker.
// Needs the Worker secret WU_API_KEY (a PWS owner's API key). Without it, nothing here is used.
//
// - wuObservation(): current readings from a hand-picked Weather Underground station.
// - skyFor(): the current sky, in order of preference:
//     1. rain / drizzle / fog / thunder reported by The Weather Company's current conditions
//     2. daytime: the station's measured sunlight (30-minute average) vs. the clear-sky amount
//     3. The Weather Company's sky phrase
//   (the site falls back to the nearest airport report when this returns nothing)

// Hand-picked Weather Underground stations per town (temperature and sunlight).
// Stations without a sunlight sensor borrow a nearby station's sunlight for the sky estimate.
import LOCATIONS from '../locations.json';
// Stations and coordinates come from locations.json (one list for the whole system).
const LOCS = LOCATIONS.locations;
export const SOLAR_STATIONS = Object.fromEntries(LOCS.filter((l) => l.sun_station).map((l) => [l.id, l.sun_station]));
export const WU_STATIONS = Object.fromEntries(LOCS.filter((l) => l.station).map((l) => [l.id, l.station]));
// Towns whose temperature/humidity/wind come from Weather Underground (Moraga keeps Xweather + its archive).
export const WU_PRIMARY = new Set(LOCS.filter((l) => l.station && l.id !== 'moraga').map((l) => l.id));
export const TOWN_COORDS = Object.fromEntries(LOCS.map((l) => [l.id, [l.lat, l.lon]]));
export const LOCATION_IDS = LOCS.map((l) => l.id);
const MAX_AGE_MS = 45 * 60 * 1000;
// The secret as pasted, minus stray whitespace/quotes.
const wuKey = (env) => String(env.WU_API_KEY || '').trim().replace(/^["']+|["']+$/g, '');
// Shape of the key for diagnostics only (never the key itself). WU API keys are 32 hex characters.
export const wuKeyShape = (env) => { const k = wuKey(env); return k ? (/^[0-9a-f]{32}$/i.test(k) ? 'key format ok' : 'key format unexpected: ' + k.length + ' chars' + (/[^0-9a-z]/i.test(k) ? ', has non-alphanumeric characters' : '')) : 'no key'; };
const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

async function getJson(url, ttl, log, label) {
  const res = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } });
  if (res.status === 204) { log.push(label + ': no data'); return null; }
  if (!res.ok) { log.push(label + ': http ' + res.status); return null; }
  return res.json();
}

function pwsUrl(path, station, key) {
  const u = new URL('https://api.weather.com/v2/pws/' + path);
  u.searchParams.set('stationId', station); u.searchParams.set('format', 'json'); u.searchParams.set('units', 'e');
  u.searchParams.set('numericPrecision', 'decimal'); u.searchParams.set('apiKey', key);
  return u.toString();
}

// Current Weather Underground reading, or null. Shape matches the worker's /observations fields.
export async function wuCurrent(station, env, log) {
  if (!wuKey(env) || !station) return null;
  try {
    const data = await getJson(pwsUrl('observations/current', station, wuKey(env)), 60, log, station);
    const ob = data?.observations?.[0];
    const at = Date.parse(ob?.obsTimeUtc || '');
    if (!ob || !Number.isFinite(at) || Date.now() - at > MAX_AGE_MS || at > Date.now() + 5 * 60000) { if (ob) log.push(station + ': stale'); return null; }
    const imp = ob.imperial || {};
    if (num(imp.temp) === null) { log.push(station + ': no temperature'); return null; }
    return {
      station, observed_utc: new Date(at).toISOString(),
      temperature_f: num(imp.temp), humidity_pct: num(ob.humidity), dew_point_f: num(imp.dewpt),
      wind_mph: num(imp.windSpeed), wind_direction_deg: num(ob.winddir), wind_gust_mph: num(imp.windGust),
      pressure_inhg: num(imp.pressure), precip_rate_in_hr: num(imp.precipRate), precip_today_in: num(imp.precipTotal),
      solar_radiation_wm2: num(ob.solarRadiation),
    };
  } catch (_) { log.push(station + ': error'); return null; }
}

// Today's observed high/low (local calendar day) from the station's 5-minute history.
export async function wuToday(station, env, log) {
  if (!wuKey(env) || !station) return null;
  try {
    const data = await getJson(pwsUrl('observations/all/1day', station, wuKey(env)), 240, log, station + ' 1day');
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    let hi = -Infinity, lo = Infinity, n = 0;
    for (const ob of data?.observations || []) {
      const t = Date.parse(ob.obsTimeUtc || '');
      if (!Number.isFinite(t)) continue;
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
      if (d !== day) continue;
      const h = num(ob.imperial?.tempHigh), l = num(ob.imperial?.tempLow);
      if (h !== null) hi = Math.max(hi, h);
      if (l !== null) lo = Math.min(lo, l);
      n++;
    }
    return n >= 3 && Number.isFinite(hi) && Number.isFinite(lo) ? { date: day, high_f: hi, low_f: lo, samples: n } : null;
  } catch (_) { log.push(station + ' today: error'); return null; }
}

// A past local day's observed high/low/rain from a station's full history (for forecast verification).
export async function wuDay(station, date, env, log) {
  if (!wuKey(env) || !station || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const u = new URL('https://api.weather.com/v2/pws/history/all');
  u.searchParams.set('stationId', station); u.searchParams.set('format', 'json'); u.searchParams.set('units', 'e');
  u.searchParams.set('numericPrecision', 'decimal'); u.searchParams.set('date', date.replace(/-/g, '')); u.searchParams.set('apiKey', wuKey(env));
  try {
    const data = await getJson(u.toString(), 3600, log, station + ' history');
    let hi = -Infinity, lo = Infinity, rain = null, n = 0, first = null, last = null;
    for (const ob of data?.observations || []) {
      const t = Date.parse(ob.obsTimeUtc || '');
      if (!Number.isFinite(t)) continue;
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
      if (d !== date) continue;
      const h = num(ob.imperial?.tempHigh), l = num(ob.imperial?.tempLow), p = num(ob.imperial?.precipTotal);
      if (h !== null) hi = Math.max(hi, h);
      if (l !== null) lo = Math.min(lo, l);
      if (p !== null) rain = Math.max(rain ?? 0, p);
      n++; first = first === null ? t : Math.min(first, t); last = last === null ? t : Math.max(last, t);
    }
    if (!n || !Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return { station, date, high_f: hi, low_f: lo, precip_in: rain, samples: n,
             first_utc: new Date(first).toISOString(), last_utc: new Date(last).toISOString() };
  } catch (_) { log.push(station + ' history: error'); return null; }
}

// One day of a station's readings (5-minute averages): [utc, temp F, humidity %, wind mph].
// Used to backfill the current-conditions estimate test.
export async function wuDayObs(station, date, env, log) {
  if (!wuKey(env) || !station || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const u = new URL('https://api.weather.com/v2/pws/history/all');
  u.searchParams.set('stationId', station); u.searchParams.set('format', 'json'); u.searchParams.set('units', 'e');
  u.searchParams.set('numericPrecision', 'decimal'); u.searchParams.set('date', date.replace(/-/g, '')); u.searchParams.set('apiKey', wuKey(env));
  try {
    // Today's history is still growing: cache it 10 minutes; past days an hour.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
    const data = await getJson(u.toString(), date === today ? 600 : 3600, log, station + ' history obs');
    return (data?.observations || []).map((ob) => [ob.obsTimeUtc, num(ob.imperial?.tempAvg), num(ob.humidityAvg), num(ob.imperial?.windspeedAvg)])
      .filter((r) => r[0] && r[1] !== null);
  } catch (_) { log.push(station + ' history obs: error'); return null; }
}

// Mean of the last 30 minutes of sunlight (5-minute highs) plus the current reading.
async function wuSolarAverage(station, env, current, log) {
  const values = Number.isFinite(current) ? [current] : [];
  try {
    const data = await getJson(pwsUrl('observations/all/1day', station, wuKey(env)), 240, log, station + ' 1day');
    for (const ob of data?.observations || []) {
      const t = Date.parse(ob.obsTimeUtc || '');
      if (Number.isFinite(t) && Date.now() - t <= 30 * 60000) {
        const v = num(ob.solarRadiationHigh ?? ob.solarRadiationAvg);
        if (v !== null) values.push(v);
      }
    }
  } catch (_) { /* current reading alone */ }
  return values.length ? values : null;
}

// Solar elevation in degrees (NOAA approximation).
export function sunElevation(lat, lon, date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0), day = (date - start) / 86400000;
  const g = 2 * Math.PI / 365 * (day - 1 + (date.getUTCHours() - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const tst = date.getUTCHours() * 60 + date.getUTCMinutes() + eq + 4 * lon;
  const ha = (tst / 4 - 180) * Math.PI / 180, la = lat * Math.PI / 180;
  return Math.asin(Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha)) * 180 / Math.PI;
}

// Clear-sky sunlight on a flat surface (Haurwitz model), W/m².
export const clearSkyGhi = (elevDeg) => { const c = Math.sin(elevDeg * Math.PI / 180); return c > 0 ? 1098 * c * Math.exp(-0.059 / c) : 0; };

// Sky words from the measured / clear-sky ratio. Code is the site's weather code (WMO style).
export function solarSky(ratio) {
  if (ratio >= 0.85) return { text: 'Sunny', code: 0 };
  if (ratio >= 0.65) return { text: 'Mostly sunny', code: 1 };
  if (ratio >= 0.45) return { text: 'Partly cloudy', code: 2 };
  if (ratio >= 0.25) return { text: 'Mostly cloudy', code: 2 };
  return { text: 'Cloudy', code: 3 };
}

// The Weather Company icon codes -> site weather codes.
function twcCode(icon) {
  if ([3, 4, 37, 38, 47].includes(icon)) return 95;
  if ([20, 21, 22].includes(icon)) return 45;
  if ([9].includes(icon)) return 51;
  if ([11, 12, 40].includes(icon)) return 61;
  if ([39, 45].includes(icon)) return 80;
  if ([5, 6, 7, 8, 10, 13, 14, 15, 16, 17, 18, 41, 42, 43, 46].includes(icon)) return 71;
  if ([32, 31, 36].includes(icon)) return 0;
  if ([34, 33].includes(icon)) return 1;
  if ([30, 29, 44, 28, 27].includes(icon)) return 2;
  if ([26, 19, 23, 24, 25].includes(icon)) return 3;
  return null;
}
const sentence = (s) => String(s || '').toLowerCase().replace(/^./, (c) => c.toUpperCase()).replace(/\bt-storms?\b/gi, 'thunderstorms');

export async function skyFor(city, env, solarNow, log) {
  const coords = TOWN_COORDS[city];
  if (!coords) return null;
  const elev = sunElevation(coords[0], coords[1]);
  let twc = null;
  // The Weather Company's current-conditions feed needs a commercial key (a PWS owner key gets 401).
  // Set the Worker variable TWC_CURRENT=1 only if the key is upgraded.
  if (wuKey(env) && env.TWC_CURRENT === '1') {
    try {
      const u = new URL('https://api.weather.com/v3/wx/observations/current');
      u.searchParams.set('geocode', coords[0] + ',' + coords[1]); u.searchParams.set('units', 'e');
      u.searchParams.set('language', 'en-US'); u.searchParams.set('format', 'json'); u.searchParams.set('apiKey', wuKey(env));
      const d = await getJson(u.toString(), 300, log, 'twc current');
      const code = twcCode(num(d?.iconCode));
      if (d && code !== null) twc = { text: sentence(d.wxPhraseLong || d.wxPhraseMedium), code, is_day: d.dayOrNight !== 'N', cloud_cover_pct: num(d.cloudCover) };
    } catch (_) { log.push('twc current: error'); }
  }
  if (twc && twc.code >= 45) return { ...twc, source: 'twc' };
  // Daytime with the sun high enough for a meaningful reading.
  const station = SOLAR_STATIONS[city] || WU_STATIONS[city];
  if (SOLAR_STATIONS[city]) solarNow = null; // own station has no sensor
  // solarNow: one reading or an array of recent readings (W/m²).
  const given = (Array.isArray(solarNow) ? solarNow : [solarNow]).filter(Number.isFinite);
  if (elev >= 15 && (station || given.length)) {
    const samples = station && wuKey(env) ? (await wuSolarAverage(station, env, given[given.length - 1], log)) || given : given;
    const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    const clear = clearSkyGhi(elev);
    if (Number.isFinite(avg) && clear > 0) {
      const ratio = avg / clear;
      // A shaded sensor reads 'cloudy' under a clear sky: if The Weather Company sees few clouds, trust it.
      if (twc && ratio < 0.4 && Number.isFinite(twc.cloud_cover_pct) && twc.cloud_cover_pct <= 25) return { ...twc, source: 'twc', clear_sky_ratio: Math.round(ratio * 100) / 100 };
      let s = solarSky(ratio);
      // Sunlight jumping between bright and dim within 30 minutes means broken clouds, not a clear sky.
      const swing = samples.length >= 3 ? (Math.max(...samples) - Math.min(...samples)) / clear : 0;
      if (swing > 0.35 && s.code < 2) s = { text: 'Partly cloudy', code: 2 };
      // A thin cloud deck lets most sunlight through, so the sensor alone reads it as partly cloudy or sunny.
      // When the nearby airports measure a broken/overcast deck, trust them unless the sun is at full strength.
      if (ratio < 0.95) {
        const deck = await airportSky(city, true, null, log, true);
        const cov = deck ? Math.max(deck.cover || 0, deck.near || 0) : 0;
        if (cov >= 3 && s.code <= 2 && s.text !== 'Cloudy') {
          s = cov >= 4 && ratio < 0.9 ? { text: 'Cloudy', code: 3 } : { text: 'Mostly cloudy', code: 2 };
          s.thin_deck = true;
        }
      }
      return { ...s, is_day: true, source: 'station_sunlight', clear_sky_ratio: Math.round(ratio * 100) / 100, samples: samples.length };
    }
  }
  if (twc) return { ...twc, source: 'twc' };
  // After dark (or with no sunlight sensor): what the nearest airports actually report beats a model guess.
  const model = await modelSky(coords, log);
  const seen = await airportSky(city, elev > 0, model, log);
  return seen || model;
}

// Nearest NWS airport reports (ASOS/AWOS ceilometers, free, public domain). Cached 10 minutes.
const COVER = { SKC: 0, CLR: 0, FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 4 };
async function airportSky(city, day, model, log, raw) {
  const ids = (LOCS.find((l) => l.id === city)?.sky_airports || []).slice(0, 2);
  const covers = [];
  let fog = false, wet = null, nearVis = null;
  for (const id of ids) {
    try {
      const res = await fetch('https://api.weather.gov/stations/' + id + '/observations/latest', { headers: { 'User-Agent': 'DiabloWeatherLab-observations/1.0', Accept: 'application/geo+json' }, cf: { cacheTtl: 600, cacheEverything: true } });
      if (!res.ok) { log.push('airport sky ' + id + ': http ' + res.status); continue; }
      const j = await res.json(), p = j?.properties, loc = j?.geometry;
      if (!p || Date.now() - Date.parse(p.timestamp) > 90 * 60000) continue;
      const layers = (p.cloudLayers || []).map((l) => COVER[l.amount]).filter((v) => v !== undefined);
      if (!layers.length) continue;
      // Weight by distance: the airport next door decides; a farther one only nudges (inverse-square).
      const here = TOWN_COORDS[city], at = loc && loc.coordinates;
      const mi = here && at ? Math.max(2, Math.hypot(at[1] - here[0], (at[0] - here[1]) * Math.cos(here[0] * Math.PI / 180)) * 69) : 10;
      covers.push({ c: Math.max(...layers), w: 1 / (mi * mi), mi });
      const tx = p.textDescription || '';
      if (!wet && /thunder/i.test(tx)) wet = { text: 'Thunderstorms', code: 95 };
      else if (!wet && /rain|shower/i.test(tx)) wet = /heavy/i.test(tx) ? { text: 'Heavy rain', code: 65 } : /light/i.test(tx) ? { text: 'Light rain', code: 61 } : { text: 'Rain', code: 63 };
      else if (!wet && /drizzle/i.test(tx)) wet = { text: 'Drizzle', code: 51 };
      // Fog only when visibility is actually low (under ~1 mile). 'Fog/Mist' with miles of visibility is
      // mist under a cloud deck: the cloud cover says more than 'Fog'.
      const vis = num(p.visibility?.value);
      if (vis !== null && mi <= 15) nearVis = nearVis === null ? vis : Math.min(nearVis, vis);
      // Fog is local (valley fog can sit over Concord and not Moraga): only an airport within ~6 miles counts.
      if (/fog/i.test(tx) && !/patches|shallow/i.test(tx) && vis !== null && vis < 1600 && mi <= 6) fog = true;
    } catch (_) { log.push('airport sky ' + id + ': error'); }
  }
  if (!covers.length) return null;
  if (wet) return { ...wet, is_day: day, source: 'airports', airports: ids, near_vis_m: nearVis };
  if (fog) return { text: 'Fog', code: 45, is_day: day, source: 'airports', airports: ids, near_vis_m: nearVis };
  const W = covers.reduce((a, b) => a + b.w, 0);
  let c = Math.round(covers.reduce((a, b) => a + b.c * b.w, 0) / W);
  const near = Math.max(0, ...covers.filter((x) => x.mi <= 13).map((x) => x.c));
  if (raw) return { cover: c, near };
  // A broken/overcast deck at an airport within ~13 miles usually covers the neighbourhood too.
  if (near >= 3 && c < 3) c = 3;
  // Ceilometers see only below ~12,000 ft: let a thick high-cloud deck from the model show through.
  if (c <= 1 && Number(model?.cloud_cover_high) >= 75) c = 2;
  const text = [day ? 'Sunny' : 'Clear', day ? 'Mostly sunny' : 'Mostly clear', 'Partly cloudy', 'Mostly cloudy', 'Cloudy'][c];
  return { text, code: [0, 1, 2, 3, 3][c], is_day: day, source: 'airports', airports: ids, cloud_cover_pct: [5, 20, 45, 75, 95][c], near_vis_m: nearVis };
}

// Last resort (night, or no sunlight reading): the forecast model's current sky, cached 15 minutes.
const MODEL_TEXT = (c, day) => c >= 95 ? 'Thunderstorms' : c >= 71 && c <= 86 && c !== 80 && c !== 81 && c !== 82 ? 'Snow' : c >= 80 ? 'Showers' : c >= 61 ? 'Rain' : c >= 51 ? 'Drizzle' : c >= 45 ? 'Fog'
  : c === 3 ? 'Cloudy' : c === 2 ? 'Partly cloudy' : c === 1 ? (day ? 'Mostly sunny' : 'Mostly clear') : (day ? 'Sunny' : 'Clear');
async function modelSky(coords, log) {
  try {
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + coords[0].toFixed(3) + '&longitude=' + coords[1].toFixed(3) + '&current=weather_code,is_day,cloud_cover,cloud_cover_high';
    const d = await getJson(u, 900, log, 'model sky');
    const c = num(d?.current?.weather_code);
    if (c === null) return null;
    const day = d.current.is_day === 1;
    return { text: MODEL_TEXT(c, day), code: c, is_day: day, source: 'model', cloud_cover_pct: num(d.current.cloud_cover), cloud_cover_high: num(d.current.cloud_cover_high) };
  } catch (_) { log.push('model sky: error'); return null; }
}
