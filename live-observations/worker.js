// Moraga Observatory live station proxy. Deploy as a Cloudflare Worker.
// Configure secrets XWEATHER_CLIENT_ID, XWEATHER_CLIENT_SECRET and ALLOWED_ORIGIN.
// Never place credentials in the public website or source repository.
const STATION = 'PWS_KCAMORAG71';
export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://russomatt-wx.github.io';
    const cors = {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Cache-Control': 'public, max-age=120'};
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:{...cors,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
    if (request.method !== 'GET' || url.pathname !== '/observations') return new Response('Not found',{status:404,headers:cors});
    if (!env.XWEATHER_CLIENT_ID || !env.XWEATHER_CLIENT_SECRET) return Response.json({error:'Live service not configured'},{status:503,headers:cors});
    const endpoint = new URL('https://api.aerisapi.com/observations/'+STATION);
    endpoint.searchParams.set('client_id',env.XWEATHER_CLIENT_ID);
    endpoint.searchParams.set('client_secret',env.XWEATHER_CLIENT_SECRET);
    try {
      const response = await fetch(endpoint.toString(),{cf:{cacheTtl:120,cacheEverything:true}});
      if (!response.ok) throw new Error('Upstream '+response.status);
      const payload = await response.json();
      const record = Array.isArray(payload.response) ? payload.response[0] : payload.response;
      const ob = record?.ob;
      if (!ob || !Number.isFinite(Number(ob.timestamp))) throw new Error('Invalid observation timestamp');
      const pick = key => Number.isFinite(Number(ob[key])) && ob[key] !== null && ob[key] !== '' ? Number(ob[key]) : null;
      return Response.json({
        station:'KCAMORAG71',
        observed_utc:new Date(Number(ob.timestamp)*1000).toISOString(),
        temperature_f:pick('tempF'),
        humidity_pct:pick('humidity'),
        dew_point_f:pick('dewpointF'),
        wind_mph:pick('windSpeedMPH'),
        wind_gust_mph:pick('windGustMPH'),
        pressure_inhg:pick('pressureIN'),
        source:'Xweather'
      },{headers:cors});
    } catch(e) {
      return Response.json({error:'Latest observation unavailable'},{status:502,headers:{...cors,'Cache-Control':'no-store'}});
    }
  }
};
