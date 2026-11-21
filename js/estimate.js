/* Diablo Weather Lab — estimate test results (verification/nowcast_log.json). Whole-degree comparisons. */
(function () {
  'use strict';
  const TOWNS = [['moraga', 'Moraga'], ['lafayette', 'Lafayette'], ['danville', 'Sycamore Valley'], ['greenbrook', 'Greenbrook'],
    ['brentwood', 'Brentwood'], ['sacramento', 'East Sacramento'], ['sausalito', 'Marin City']];
  const DAYS = 7;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let rows = [], town = 'moraga';
  try { town = localStorage.getItem('dwl-est-town') || town; } catch (_) {}

  // Learned correction: mean error in the same situation over the 14 days before this hour (6+ hours needed).
  function corrected(all) {
    const byTown = {};
    all.forEach((r) => { (byTown[r.town] = byTown[r.town] || []).push(r); });
    const out = [];
    Object.values(byTown).forEach((list) => {
      list.sort((a, b) => a.valid.localeCompare(b.valid));
      list.forEach((r, i) => {
        if (r.obs_t == null || r.est_t == null) return;
        const t = Date.parse(r.valid), calm = r.est_wind < 6, prior = [];
        for (let k = i - 1; k >= 0; k--) {
          const p = list[k], pt = Date.parse(p.valid);
          if (t - pt > 14 * 864e5) break;
          if (p.obs_t != null && p.day === r.day && (p.est_wind < 6) === calm) prior.push(p.est_t - p.obs_t);
        }
        const bias = prior.length >= 6 ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
        out.push({ ...r, cor_t: bias == null ? null : r.est_t - bias });
      });
    });
    return out;
  }

  function stats(list) {
    const e = list.filter((r) => r.cor_t != null).map((r) => Math.round(r.cor_t) - Math.round(r.obs_t));
    if (!e.length) return null;
    const pct = (f) => Math.round(100 * e.filter(f).length / e.length);
    return { n: e.length, exact: pct((x) => x === 0), w1: pct((x) => Math.abs(x) <= 1), w2: pct((x) => Math.abs(x) <= 2),
      miss: e.reduce((a, x) => a + Math.abs(x), 0) / e.length, bias: e.reduce((a, x) => a + x, 0) / e.length };
  }

  function recent(list) { const cut = Date.now() - DAYS * 864e5; return list.filter((r) => Date.parse(r.valid) >= cut); }

  function table() {
    $('est-table').querySelector('tbody').innerHTML = TOWNS.map(([k, name]) => {
      const s = stats(recent(rows.filter((r) => r.town === k)));
      const cls = (v) => v >= 80 ? 'good' : v >= 60 ? 'ok' : 'low';
      return '<tr data-town="' + k + '"' + (k === town ? ' class="sel"' : '') + '><th>' + esc(name) + '</th>' + (s
        ? '<td class="' + cls(s.exact * 2) + '">' + s.exact + '%</td><td class="' + cls(s.w1) + '">' + s.w1 + '%</td><td class="' + cls(s.w2) + '">' + s.w2 + '%</td><td>' + s.miss.toFixed(1) + '°</td>'
        : '<td colspan="4" class="low">Learning…</td>') + '</tr>';
    }).join('');
  }

  function chart(list) {
    const pts = list.filter((r) => r.obs_t != null).sort((a, b) => a.valid.localeCompare(b.valid));
    if (pts.length < 2) return '<p class="est-empty">Not enough hours yet.</p>';
    const W = 380, H = 220, L = 30, Rr = 4, T = 8, B = 24;
    const t0 = Date.parse(pts[0].valid), t1 = Date.parse(pts[pts.length - 1].valid);
    const vals = pts.flatMap((r) => [r.obs_t, r.cor_t, r.est_t]).filter((v) => v != null);
    const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
    const x = (t) => L + (W - L - Rr) * (t - t0) / Math.max(1, t1 - t0), y = (v) => T + (H - T - B) * (hi - v) / Math.max(1, hi - lo);
    const path = (key) => { let d = '', pen = false, last = 0; pts.forEach((r) => { const t = Date.parse(r.valid); if (r[key] == null || t - last > 3 * 36e5) pen = false; if (r[key] == null) return; d += (pen ? 'L' : 'M') + x(t).toFixed(1) + ' ' + y(Math.round(r[key])).toFixed(1); pen = true; last = t; }); return d; };
    let grid = '';
    const step = Math.max(2, Math.ceil((hi - lo) / 5));
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="g"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="yl">' + v + '°</text>';
    const day0 = new Date(t0); day0.setHours(24, 0, 0, 0);
    for (let d = day0.getTime(); d <= t1; d += 864e5) {
      const label = new Date(d + 12 * 36e5).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' });
      grid += '<line x1="' + x(d) + '" x2="' + x(d) + '" y1="' + T + '" y2="' + (H - B) + '" class="g d"/>' + (d + 12 * 36e5 <= t1 ? '<text x="' + x(d + 12 * 36e5) + '" y="' + (H - 8) + '" class="xl">' + label + '</text>' : '');
    }
    return '<svg class="est-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Station temperature vs estimate">' + grid +
      '<path d="' + path('est_t') + '" class="raw"/><path d="' + path('cor_t') + '" class="cor"/><path d="' + path('obs_t') + '" class="obs"/></svg>' +
      '<div class="est-legend"><span class="obs">Station</span><span class="cor">Corrected estimate</span><span class="raw">Raw estimate</span></div>';
  }

  function detail() {
    const name = (TOWNS.find(([k]) => k === town) || [, ''])[1];
    const list = recent(rows.filter((r) => r.town === town));
    const all = stats(list), day = stats(list.filter((r) => r.day)), night = stats(list.filter((r) => !r.day));
    const latest = list.filter((r) => r.obs_t != null).sort((a, b) => b.valid.localeCompare(a.valid))[0];
    const tile = (label, s) => '<div><span>' + label + '</span>' + (s ? '<b>' + s.w2 + '%</b><small>within 2° · ' + s.exact + '% exact · bias ' + (s.bias >= 0 ? '+' : '') + s.bias.toFixed(1) + '°</small>' : '<b>—</b>') + '</div>';
    $('est-detail').innerHTML = '<h3>' + esc(name) + '</h3>' +
      (latest ? '<p class="est-latest">Latest (' + new Date(latest.valid).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) + '): station <b>' + Math.round(latest.obs_t) + '°</b> · corrected estimate <b>' + (latest.cor_t == null ? '—' : Math.round(latest.cor_t) + '°') + '</b> · raw <b>' + Math.round(latest.est_t) + '°</b></p>' : '') +
      '<div class="pad-stats est-tiles">' + tile('All hours', all) + tile('Day', day) + tile('Night', night) + '</div>' + chart(list);
  }

  function chips() {
    $('est-towns').innerHTML = TOWNS.map(([k, n]) => '<button type="button" data-town="' + k + '" aria-pressed="' + (k === town) + '">' + esc(n) + '</button>').join('');
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-town]');
    if (!b) return;
    town = b.dataset.town;
    try { localStorage.setItem('dwl-est-town', town); } catch (_) {}
    chips(); table(); detail();
    if (b.tagName === 'TR') $('est-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  async function load() {
    try {
      const r = await fetch('verification/nowcast_log.json?t=' + Date.now(), { cache: 'no-store' });
      rows = corrected(await r.json());
      const last = rows.reduce((a, r) => (r.valid > a ? r.valid : a), '');
      $('est-updated').textContent = 'Last estimate ' + new Date(last).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT · ' + rows.length + ' hours logged';
      chips(); table(); detail();
    } catch (e) { $('est-updated').textContent = 'Results are not available right now.'; }
  }
  // 10-day forecast learning: station-trained vs NOAA-trained corrections, both scored against the station.
  const FC = [['lafayette', 'Lafayette'], ['danville', 'Sycamore Valley'], ['greenbrook', 'Greenbrook'], ['brentwood', 'Brentwood'], ['sacramento', 'East Sacramento'], ['sausalito', 'Marin City']];
  async function getJSON(u) { try { const r = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' }); return r.ok ? r.json() : null; } catch (_) { return null; } }
  function corr(file, model, phase) {
    const c = file?.calibration?.[model]?.[phase], s = file?.model_scores?.[model];
    return c && Number(c.factor) > 0 && s ? Number(c.factor) * s[phase + '_bias_f'] : 0;
  }
  async function forecasts() {
    const [obsS, obsN] = await Promise.all([getJSON('verification/town_observed.json'), getJSON('verification/town_observed_noaa.json')]);
    let gapH = [], gapL = [];
    const out = await Promise.all(FC.map(async ([k, name]) => {
      const [st, no, pu] = await Promise.all([getJSON('verification/' + k + '_model_daily_verification.json'), getJSON('verification/' + k + '_model_daily_verification_noaa.json'), getJSON('verification/' + k + '_model_daily_verification_public.json')]);
      Object.entries(obsN?.[k] || {}).forEach(([d, v]) => { const s = obsS?.[k]?.[d]; if (s) { gapH.push(v.high_f - s.high_f); gapL.push(v.low_f - s.low_f); } });
      if (!st || !no || !(st.matches || []).length) return { name, n: 0 };
      const noaaDays = new Set((no.matches || []).map((m) => m.valid_local_date));
      const rows = (st.matches || []).filter((m) => noaaDays.has(m.valid_local_date));
      const res = { name, n: new Set(rows.map((m) => m.valid_local_date)).size };
      for (const phase of ['high', 'low']) {
        const key = phase + '_error_f'; let raw = 0, s = 0, n = 0, pb = 0, c = 0;
        rows.forEach((m) => { const e = m[key]; raw += Math.abs(e); s += Math.abs(e - corr(st, m.model, phase)); n += Math.abs(e - corr(no, m.model, phase)); pb += Math.abs(e - corr(pu, m.model, phase)); c++; });
        res[phase] = c ? { raw: raw / c, st: s / c, no: n / c, pu: pu ? pb / c : null } : null;
      }
      return res;
    }));
    const f = (v) => v == null ? '—' : v.toFixed(1);
    const cell = (r, key) => r.high ? f(r.high[key]) + ' / ' + f(r.low[key]) : '—';
    $('fc-table').querySelector('tbody').innerHTML = out.map((r) => '<tr><th>' + esc(r.name) + '</th>' + (r.n
      ? '<td>' + r.n + '</td><td>' + cell(r, 'raw') + '</td><td>' + cell(r, 'st') + '</td><td class="' + (r.high && (r.high.no + r.low.no) <= (r.high.st + r.low.st) + 0.4 ? 'good' : 'ok') + '">' + cell(r, 'no') + '</td><td class="' + (r.high && r.high.pu != null && (r.high.pu + r.low.pu) <= (r.high.st + r.low.st) + 0.4 ? 'good' : 'ok') + '">' + (r.high && r.high.pu != null ? cell(r, 'pu') : 'collecting') + '</td>'
      : '<td colspan="5" class="low">Waiting for NOAA days…</td>') + '</tr>').join('');
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    $('fc-foot').textContent = gapH.length ? 'Across ' + gapH.length + ' location-days, NOAA’s daily high averaged ' + (avg(gapH) >= 0 ? '+' : '') + avg(gapH).toFixed(1) + '° and its low ' + (avg(gapL) >= 0 ? '+' : '') + avg(gapL).toFixed(1) + '° versus the stations. Moraga always learns from your own station.' : '';
  }
  load();
  forecasts();
  setInterval(load, 15 * 60 * 1000);
})();
