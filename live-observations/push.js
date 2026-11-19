// Diablo Weather Lab push alerts.
// A single Durable Object (AlertPush) keeps the push subscriptions and the alerts already sent.
// Every 2 minutes (cron) it checks NWS active alerts for each town and sends a Web Push
// notification to the phones subscribed to that town. No third-party push service or secrets:
// the VAPID signing key is generated inside the Durable Object on first use and never leaves it.

export const TOWNS = {
  Moraga: [37.8202, -122.1194],
  Lafayette: [37.8900, -122.1150],
  Danville: [37.8130, -121.9740],
  Greenbrook: [37.7990, -121.9700],
};
const SITE = 'https://russomatt-wx.github.io/moraga-weather-graphics/';
const NWS_HEADERS = { 'User-Agent': 'DiabloWeatherLab-alerts/1.0', Accept: 'application/geo+json' };

// ---------- base64url helpers ----------
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const utf8 = (s) => new TextEncoder().encode(s);

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// RFC 8291 (aes128gcm) payload encryption for one subscription.
export async function encryptPayload(sub, payload) {
  const uaPublic = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(utf8(payload), new Uint8Array([2]))));
  const header = new Uint8Array(21); header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// VAPID (RFC 8292) authorization header for a push endpoint.
async function vapidHeader(endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const head = b64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(utf8(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://russomatt-wx.github.io' })));
  const priv = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, utf8(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + keys.publicKey;
}

const when = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(':00', '');

export class AlertPush {
  constructor(state, env) {
    this.state = state; this.env = env; this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, p256dh TEXT, auth TEXT, towns TEXT, created INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS seen (town TEXT, id TEXT, event TEXT, ends INTEGER, PRIMARY KEY (town, id))');
  }

  async keys() {
    let k = await this.state.storage.get('vapid');
    if (!k) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      k = { privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)) };
      await this.state.storage.put('vapid', k);
    }
    return k;
  }

  // Returns the HTTP status from the push service (201 = delivered to it).
  async send(sub, message) {
    const keys = await this.keys();
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidHeader(sub.endpoint, keys), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '21600', Urgency: 'high' },
      body: await encryptPayload(sub, JSON.stringify(message)),
    });
    if (res.status === 404 || res.status === 410) this.sql.exec('DELETE FROM subs WHERE endpoint = ?', sub.endpoint);
    return res.status;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/push/key') return Response.json({ publicKey: (await this.keys()).publicKey });
    if (url.pathname === '/cron') return Response.json(await this.check());
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const data = await request.json().catch(() => ({}));
    const sub = data.subscription || {};
    if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return Response.json({ error: 'Bad subscription' }, { status: 400 });
    if (url.pathname === '/push/unsubscribe') { this.sql.exec('DELETE FROM subs WHERE endpoint = ?', sub.endpoint); return Response.json({ ok: true, towns: [] }); }
    // /push/subscribe: replace this phone's town list.
    const towns = [...new Set((Array.isArray(data.towns) ? data.towns : []).filter((t) => TOWNS[t]))];
    if (!towns.length) { this.sql.exec('DELETE FROM subs WHERE endpoint = ?', sub.endpoint); return Response.json({ ok: true, towns }); }
    const before = this.sql.exec('SELECT towns FROM subs WHERE endpoint = ?', sub.endpoint).toArray()[0];
    this.sql.exec('INSERT OR REPLACE INTO subs VALUES (?, ?, ?, ?, ?)', sub.endpoint, sub.keys.p256dh, sub.keys.auth, JSON.stringify(towns), Date.now());
    const added = towns.filter((t) => !(before ? JSON.parse(before.towns) : []).includes(t));
    let status = null;
    if (added.length) status = await this.send({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, {
      title: 'Diablo Weather Lab', body: 'Push alerts are on for ' + added.join(', ') + '. You will be notified when the National Weather Service issues an alert there.', url: SITE, tag: 'dwl-welcome',
    });
    return Response.json({ ok: true, towns, welcome: status });
  }

  // Check NWS for every town and notify subscribers of new alerts.
  async check() {
    const subs = this.sql.exec('SELECT * FROM subs').toArray().map((s) => ({ ...s, towns: JSON.parse(s.towns) }));
    const now = Date.now(), sent = {};
    this.sql.exec('DELETE FROM seen WHERE ends < ?', now - 24 * 3600 * 1000);
    for (const [town, [lat, lon]] of Object.entries(TOWNS)) {
      let features;
      try {
        const r = await fetch('https://api.weather.gov/alerts/active?point=' + lat + ',' + lon, { headers: NWS_HEADERS });
        if (!r.ok) continue;
        features = (await r.json()).features || [];
      } catch (_) { continue; }
      for (const f of features) {
        const p = f.properties || {}, id = p.id || f.id;
        if (!id || p.status !== 'Actual' || p.messageType === 'Cancel' || !p.event) continue;
        const ends = Date.parse(p.ends || p.expires || '') || now + 6 * 3600 * 1000;
        if (ends <= now) continue;
        if (this.sql.exec('SELECT 1 FROM seen WHERE town = ? AND id = ?', town, id).toArray().length) continue;
        // An update/extension of an alert already sent (same event) is recorded but not re-sent.
        const refs = (p.references || []).map((r) => r.identifier || r['@id']).filter(Boolean);
        const repeat = refs.some((r) => this.sql.exec('SELECT 1 FROM seen WHERE town = ? AND event = ? AND (id = ? OR ? LIKE \'%\' || id)', town, p.event, r, r).toArray().length);
        this.sql.exec('INSERT OR REPLACE INTO seen VALUES (?, ?, ?, ?)', town, id, p.event, ends);
        if (repeat) continue;
        const upcoming = Date.parse(p.onset || '') > now;
        const message = {
          title: '⚠ ' + p.event + ' · ' + town,
          body: (upcoming ? 'Starts ' + when(p.onset) + '. ' : '') + (p.ends || p.expires ? 'Until ' + when(p.ends || p.expires) + '. ' : '') + String(p.headline || '').replace(/ by NWS.*$/, '').slice(0, 160),
          url: SITE + '?city=' + town, tag: 'dwl-' + town + '-' + p.event,
        };
        for (const s of subs.filter((s) => s.towns.includes(town))) {
          try { await this.send(s, message); sent[town] = (sent[town] || 0) + 1; } catch (_) { /* one bad endpoint never blocks the rest */ }
        }
      }
    }
    return { subscribers: subs.length, sent };
  }
}

// Route /push/* requests to the Durable Object; adds CORS for the site.
export async function handlePush(request, env, cors) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (!['/push/key', '/push/subscribe', '/push/unsubscribe'].includes(url.pathname)) return new Response('Not found', { status: 404, headers: cors });
  const stub = env.ALERT_PUSH.get(env.ALERT_PUSH.idFromName('main'));
  const res = await stub.fetch(request);
  return new Response(res.body, { status: res.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function runAlertCheck(env) {
  const stub = env.ALERT_PUSH.get(env.ALERT_PUSH.idFromName('main'));
  return stub.fetch('https://internal/cron');
}
