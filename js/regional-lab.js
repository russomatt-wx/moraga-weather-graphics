/* Diablo Weather Lab — Regional Lab (Forecast Lab).
   Moraga's chart set (temperature guidance, ensemble spread, 14-day rainfall, upper air) for each regional
   site, drawn in one consistent style from the data files the chart jobs publish
   (moraga_*.json for Moraga, lab/{id}_*.json for the others) plus live hourly model temperatures. */
(function () {
  'use strict';
  var HUBS = [['moraga', 'Moraga'], ['soma', 'San Francisco'], ['downtownoakland', 'Oakland'], ['northgate', 'Walnut Creek'],
    ['danville', 'Danville'], ['claytonvalley', 'Concord'], ['livermorewine', 'Livermore'], ['sacramento', 'Sacramento']];
  var C = { GFS: '#5aa9ff', ECMWF: '#ffbf2e', HRRR: '#37d67a', NAM: '#ff7a59', ICON: '#a78bfa', GEM: '#f472b6', EPS: '#ffbf2e', GEFS: '#5aa9ff', 'EPS mean': '#ffd98a', 'GEFS mean': '#9cc9ff' };
  var TZ = 'America/Los_Angeles';
  var host = document.getElementById('regional-lab'); if (!host) return;
  var LOC = {}; (window.DWL_LOCATIONS || []).forEach(function (l) { LOC[l.id] = l; });
  LOC.moraga = { lat: 37.8201932, lon: -122.1193876 };
  var state = { id: 'moraga', hidden: {}, charts: {}, data: {} };
  try { var sv = localStorage.getItem('dwl-lab-hub'); if (sv && HUBS.some(function (h) { return h[0] === sv; })) state.id = sv; } catch (e) {}

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var num = function (v) { return v !== null && v !== undefined && Number.isFinite(Number(v)); };
  var nameOf = function (id) { return (HUBS.find(function (h) { return h[0] === id; }) || [])[1]; };
  var getJSON = function (u) { return fetch(u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 600000)).then(function (r) { if (!r.ok) throw Error(r.status); return r.json(); }); };
  // Local wall-clock time string ("2026-11-23T14:00", with or without offset) -> ms on one local axis.
  var tms = function (t) { return Date.parse(String(t).slice(0, 16) + ':00Z'); };
  var dayLbl = function (ms) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(ms).getUTCDay()]; };
  var nowLocal = function () { var p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()); var g = function (k) { return p.find(function (x) { return x.type === k; }).value; }; return tms(g('year') + '-' + g('month') + '-' + g('day') + 'T' + g('hour') + ':00'); };

  /* ---------- One chart style for every line chart ---------- */
  function lineChart(spec) {
    var W = 560, H = spec.h || 330, L = 44, R = 12, T = spec.top ? 26 : 12, B = 28;
    var start = spec.daily ? Math.floor(nowLocal() / 86400e3) * 86400e3 : nowLocal() - 3600e3, end = start + (spec.days || 10) * 86400e3;
    var vis = function (n) { return !state.hidden[spec.key + ':' + n]; };
    var vals = [];
    spec.series.forEach(function (s) { if (!vis(s.name)) return; s.t.forEach(function (t, i) { var m = tms(t); if (m >= start && m <= end && num(s.v[i])) vals.push(+s.v[i]); }); });
    (spec.bands || []).forEach(function (b) { if (!vis(b.name)) return; b.t.forEach(function (t, i) { var m = tms(t); if (m >= start && m <= end) { if (num(b.lo[i])) vals.push(+b.lo[i]); if (num(b.hi[i])) vals.push(+b.hi[i]); } }); });
    if (!vals.length) return '<p class="rl-empty">No data for this chart yet.</p>';
    var step = spec.step || 5, lo = Math.max(spec.min !== undefined ? spec.min : -1e9, Math.floor((Math.min.apply(null, vals) - step / 2) / step) * step), hi = Math.ceil((Math.max.apply(null, vals) + step / 2) / step) * step;
    var x = function (m) { return L + (W - L - R) * (m - start) / (end - start); }, y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var g = '';
    for (var v = lo; v <= hi + 1e-9; v += step) g += '<line class="rl-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="rl-ax" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + spec.fmt(v) + '</text>';
    for (var d = Math.ceil(start / 86400e3) * 86400e3; d <= end; d += 86400e3) g += '<line class="rl-day" x1="' + x(d).toFixed(1) + '" x2="' + x(d).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>' + (x(d + 86400e3) <= W - R + 1 ? '<text class="rl-ax" x="' + (x(d) + (x(d + 86400e3) - x(d)) / 2).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle">' + dayLbl(d) + '</text>' : '');
    (spec.bands || []).forEach(function (b) {
      if (!vis(b.name)) return; var top = [], bot = [];
      b.t.forEach(function (t, i) { var m = tms(t); if (m >= start && m <= end && num(b.lo[i]) && num(b.hi[i])) { top.push(x(m).toFixed(1) + ',' + y(+b.hi[i]).toFixed(1)); bot.push(x(m).toFixed(1) + ',' + y(+b.lo[i]).toFixed(1)); } });
      if (top.length > 1) g += '<path d="M' + top.join('L') + 'L' + bot.reverse().join('L') + 'Z" fill="' + b.color + '" opacity=".18"/>';
    });
    spec.series.forEach(function (s) {
      if (!vis(s.name)) return; var seg = [], segs = [];
      s.t.forEach(function (t, i) { var m = tms(t); if (m < start || m > end) return; if (num(s.v[i])) seg.push(x(m).toFixed(1) + ',' + y(+s.v[i]).toFixed(1)); else if (seg.length) { segs.push(seg); seg = []; } });
      if (seg.length) segs.push(seg);
      segs.forEach(function (sg) { if (sg.length > 1) g += '<polyline points="' + sg.join(' ') + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 2) + '"' + (s.dash ? ' stroke-dasharray="6 4"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>'; });
      if (spec.dots) segs.forEach(function (sg) { sg.forEach(function (pt) { var q = pt.split(','); g += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="2.6" fill="' + s.color + '"/>'; }); });
    });
    (spec.top || []).forEach(function (tl) { var m = tms(tl.t); if (m >= start && m <= end) g += '<text class="rl-pop" x="' + x(m).toFixed(1) + '" y="' + (T - 10) + '" text-anchor="middle">' + tl.label + '</text>'; });
    g += '<line class="rl-cursor" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" visibility="hidden"/><rect class="rl-hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '"/>';
    state.charts[spec.key] = { spec: spec, start: start, end: end, L: L, R: R, W: W };
    var names = spec.series.map(function (s) { return [s.name, s.color]; }).concat((spec.bands || []).filter(function (b) { return !spec.series.some(function (s) { return s.name === b.name; }); }).map(function (b) { return [b.name, b.color]; }));
    return '<div class="rl-plot" data-chart="' + spec.key + '"><svg viewBox="0 0 ' + W + ' ' + H + '" class="rl-chart" role="img" aria-label="' + esc(spec.label) + '">' + g + '</svg><div class="rl-tip" hidden></div></div>' +
      '<div class="rl-legend">' + names.map(function (n) { return '<button type="button" data-toggle="' + esc(spec.key + ':' + n[0]) + '" aria-pressed="' + vis(n[0]) + '"><i style="background:' + n[1] + '"></i>' + esc(n[0]) + '</button>'; }).join('') + '</div>';
  }

  // Tap / drag on a chart: cursor line + every visible series' value at that time.
  function inspect(plot, clientX) {
    var c = state.charts[plot.dataset.chart]; if (!c) return; var svg = plot.querySelector('svg'), r = svg.getBoundingClientRect();
    var px = (clientX - r.left) / r.width * c.W; if (px < c.L || px > c.W - c.R) return;
    var m = c.start + (px - c.L) / (c.W - c.L - c.R) * (c.end - c.start), rows = [];
    var near = function (t, arr) { var best = -1, bd = 1e18; t.forEach(function (tt, i) { var d = Math.abs(tms(tt) - m); if (d < bd && num(arr[i])) { bd = d; best = i; } }); return bd <= (c.spec.daily ? 12 : 3) * 3600e3 ? best : -1; };
    c.spec.series.forEach(function (s) { if (state.hidden[c.spec.key + ':' + s.name]) return; var i = near(s.t, s.v); if (i >= 0) rows.push('<span><i style="background:' + s.color + '"></i>' + esc(s.name) + ' <b>' + c.spec.fmt(+s.v[i], true) + '</b></span>'); });
    (c.spec.bands || []).forEach(function (b) { if (state.hidden[c.spec.key + ':' + b.name]) return; var i = near(b.t, b.lo); if (i >= 0) rows.push('<span><i style="background:' + b.color + '"></i>' + esc(b.name) + ' range <b>' + c.spec.fmt(+b.lo[i], true) + '–' + c.spec.fmt(+b.hi[i], true) + '</b></span>'); });
    var d = new Date(m), when = c.spec.daily ? new Date(Math.floor(m / 86400e3) * 86400e3 + 43200e3).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }) : dayLbl(m) + ' ' + ((d.getUTCHours() % 12) || 12) + (d.getUTCHours() < 12 ? ' AM' : ' PM');
    var cur = svg.querySelector('.rl-cursor'); cur.setAttribute('x1', px); cur.setAttribute('x2', px); cur.setAttribute('visibility', 'visible');
    var tip = plot.querySelector('.rl-tip'); tip.innerHTML = '<b>' + when + '</b>' + rows.join(''); tip.hidden = false;
  }

  var MODELS = [['GFS', 'ncep_gfs_seamless'], ['ECMWF', 'ecmwf_ifs025'], ['HRRR', 'ncep_hrrr_conus'], ['NAM', 'ncep_nam_conus'], ['ICON', 'icon_seamless'], ['GEM', 'gem_seamless']];
  function tempGuidance(site) {
    return Promise.allSettled(MODELS.map(function (m) {
      var q = new URLSearchParams({ latitude: site.lat, longitude: site.lon, hourly: 'temperature_2m', models: m[1], temperature_unit: 'fahrenheit', timezone: TZ, forecast_days: '11' });
      return fetch('https://api.open-meteo.com/v1/forecast?' + q).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) { return { name: m[0], color: C[m[0]], t: j.hourly.time, v: j.hourly.temperature_2m }; });
    })).then(function (res) { return res.filter(function (r) { return r.status === 'fulfilled'; }).map(function (r) { return r.value; }); });
  }
  var degF = function (v) { return Math.round(v) + '°'; };
  var specs = {
    temp: function () { return { key: 'temp', label: 'Temperature guidance', series: state.data.temp, fmt: degF, days: 10 }; },
    ens: function () { return { key: 'ens', label: 'Ensemble spread', series: state.data.ens.series, bands: state.data.ens.bands, fmt: degF, days: 11 }; },
    z500: function () { return { key: 'z500', label: '500 mb height', series: state.data.up.z, fmt: function (v) { return Math.round(v); }, step: 60, h: 240, days: 10 }; },
    t850: function () { return { key: 't850', label: '850 mb temperature', series: state.data.up.t, fmt: function (v, tip) { return (tip ? (+v).toFixed(1) : Math.round(v)) + '°'; }, step: 2, h: 240, days: 10 }; }
  };
  var upHTML = function () { return '<h4 class="rl-h4">500 mb height (m)</h4>' + lineChart(specs.z500()) + '<h4 class="rl-h4">850 mb temperature (°C)</h4>' + lineChart(specs.t850()); };

  function render() {
    var id = state.id, name = nameOf(id), pre = id === 'moraga' ? 'moraga' : 'lab/' + id, site = LOC[id];
    state.charts = {}; state.data = {};
    host.innerHTML = '<div class="rl-picker" role="tablist" aria-label="Choose a regional site">' + HUBS.map(function (h) { return '<button type="button" role="tab" data-hub="' + h[0] + '" aria-selected="' + (h[0] === id) + '">' + esc(h[1]) + '</button>'; }).join('') + '</div>' +
      '<div class="rl-cards">' +
      '<article class="card rl-card"><h3>Temperature guidance</h3><p class="rl-sub">Hourly temperature from six models · tap the chart for values</p><div id="rl-c-temp" class="rl-body"><p class="rl-empty">Loading…</p></div></article>' +
      '<article class="card rl-card"><h3>Ensemble spread</h3><p class="rl-sub">Shaded = 10th–90th percentile of each ensemble · line = median</p><div id="rl-c-ens" class="rl-body"><p class="rl-empty">Loading…</p></div></article>' +
      '<article class="card rl-card"><h3>14-day rainfall</h3><p class="rl-sub">Daily rain by model (inches) · % = chance of measurable rain · tap for values</p><div id="rl-c-rain" class="rl-body"><p class="rl-empty">Loading…</p></div></article>' +
      '<article class="card rl-card"><h3>Upper air · 10 days</h3><p class="rl-sub">500 mb height (higher = ridge, lower = trough) and 850 mb temperature (air mass)</p><div id="rl-c-up" class="rl-body"><p class="rl-empty">Loading…</p></div></article>' +
      '<article class="card rl-card"><h3>Which model is best here?</h3><div id="rl-acc" class="rl-body"><p class="rl-empty">Loading…</p></div></article>' +
      '</div>';
    var put = function (el, html) { if (state.id === id) { var e = document.getElementById(el); if (e) e.innerHTML = html; } };
    var pending = '<p class="rl-empty">Chart data for ' + esc(name) + ' is being prepared — check back shortly.</p>';
    tempGuidance(site).then(function (s) { if (state.id !== id) return; state.data.temp = s; put('rl-c-temp', s.length ? lineChart(specs.temp()) : '<p class="rl-empty">Live model guidance unavailable right now.</p>'); });
    getJSON(pre + '_ensemble_range.json').then(function (j) {
      if (state.id !== id) return; var ser = [], bands = [];
      Object.keys(j.models || {}).forEach(function (k) { var m = j.models[k], nm = /EPS|ECMWF/.test(k) ? 'EPS' : 'GEFS'; bands.push({ name: nm, color: C[nm], t: m.time, lo: m.p10, hi: m.p90 }); ser.push({ name: nm, color: C[nm], t: m.time, v: m.median, width: 2.4 }); });
      state.data.ens = { series: ser, bands: bands }; put('rl-c-ens', lineChart(specs.ens()));
    }).catch(function () { put('rl-c-ens', pending); });
    getJSON(pre + '_rainfall_10day.json').then(function (j) { if (state.id !== id) return; state.data.rain = j; put('rl-c-rain', rainChart()); }).catch(function () { put('rl-c-rain', pending); });
    getJSON(pre + '_upper_air_10day.json').then(function (j) {
      if (state.id !== id) return; var ms = Object.keys(j.models || {}).filter(function (k) { return j.models[k].time; });
      if (!ms.length) throw 0;
      var mk = function (field) { return ms.map(function (k) { return { name: k + (/EPS|GEFS/.test(k) ? ' mean' : ''), color: C[k], t: j.models[k].time, v: j.models[k][field], dash: /EPS|GEFS/.test(k) }; }); };
      state.data.up = { z: mk('z500_m'), t: mk('t850_c') }; put('rl-c-up', upHTML());
    }).catch(function () { put('rl-c-up', pending); });
    loadAccuracy(id);
  }

  // Rain: one line per model through each day's total; chance of rain along the top. Tap for values.
  function rainSpec() {
    var j = state.data.rain, dates = (j.dates || []).slice(0, 14), pop = j.ensemble_rain_probability_pct || {};
    var t = dates.map(function (d) { return d + 'T12:00'; }), max = 0;
    var series = Object.keys(j.model_daily_inches || {}).map(function (m) { var v = (j.model_daily_inches[m] || []).slice(0, 14); v.forEach(function (q) { if (num(q) && q > max) max = +q; }); return { name: m, color: C[m] || '#cbd5e1', t: t, v: v, dash: / mean$/.test(m), width: / mean$/.test(m) ? 2.6 : 2 }; });
    var st = [.05, .1, .25, .5].find(function (q) { return max / q <= 5; }) || 1;
    return { key: 'rain', label: '14-day rainfall by model', series: series, fmt: function (v) { return (+v).toFixed(2) + (arguments[1] ? '″' : ''); }, step: st, min: 0, dots: true, days: 14, daily: true,
      top: dates.filter(function (d) { return num(pop[d]); }).map(function (d) { return { t: d + 'T12:00', label: Math.round(pop[d] / 10) * 10 + '%' }; }) };
  }
  function rainChart() { return lineChart(rainSpec()); }
  function rainDay(i) {
    var j = state.data.rain, d = j && j.dates[i], tip = document.getElementById('rl-raintip'); if (!d || !tip) return;
    var pop = (j.ensemble_rain_probability_pct || {})[d];
    tip.innerHTML = '<b>' + new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + (num(pop) ? ' · ' + Math.round(pop) + '% chance' : '') + '</b>' +
      Object.keys(j.model_daily_inches).map(function (m) { var v = j.model_daily_inches[m][i]; return '<span><i style="background:' + (C[m] || '#cbd5e1') + '"></i>' + esc(m) + ' <b>' + (num(v) ? (+v).toFixed(2) + '″' : '—') + '</b></span>'; }).join('');
  }

  function loadAccuracy(id) {
    var tries = id === 'moraga' ? ['verification/moraga_model_daily_verification_noaa.json', 'model_daily_verification_latest.json'] : ['verification/' + id + '_model_daily_verification_noaa.json', 'verification/' + id + '_model_daily_verification.json'];
    (function next(k) {
      if (k >= tries.length) { var a = document.getElementById('rl-acc'); if (a) a.innerHTML = '<p class="rl-empty">Accuracy builds as verified days accumulate.</p>'; return; }
      getJSON(tries[k]).then(function (v) { if (id !== state.id) return; if (!v.calibration) throw 0; var a = document.getElementById('rl-acc'); if (a) a.innerHTML = accuracy(v); }).catch(function () { next(k + 1); });
    })(0);
  }
  function accuracy(v) {
    var rows = Object.keys(v.calibration).filter(function (m) { var c = v.calibration[m]; return c.high && c.high.holdout_days >= 8; }).map(function (m) {
      var c = v.calibration[m]; return { m: m.toUpperCase(), d: c.high.holdout_days, hr: c.high.raw_holdout_mae_f, hc: c.high.selected_holdout_mae_f, lr: c.low.raw_holdout_mae_f, lc: c.low.selected_holdout_mae_f };
    }).sort(function (a, b) { return (a.hc + a.lc) - (b.hc + b.lc); });
    var most = Math.max.apply(null, rows.map(function (r) { return r.d; }).concat([0])); rows = rows.filter(function (r) { return r.d >= most * .6; });
    if (!rows.length) return '<p class="rl-empty">Accuracy builds as verified days accumulate.</p>';
    var src = v.verified_against === 'station' ? 'the local station' : v.verified_against === 'public_stations' ? 'nearby public stations' : 'NOAA observed temperatures';
    return '<div class="rl-scroll"><table class="rl-acc"><thead><tr><th>Model</th><th>High miss</th><th>Low miss</th><th>Days</th></tr></thead><tbody>' + rows.map(function (r, k) {
      return '<tr' + (k === 0 ? ' class="best"' : '') + '><th scope="row">' + esc(r.m) + (k === 0 ? ' <small>best</small>' : '') + '</th><td>' + r.hr.toFixed(1) + '° → <b>' + r.hc.toFixed(1) + '°</b></td><td>' + r.lr.toFixed(1) + '° → <b>' + r.lc.toFixed(1) + '°</b></td><td>' + r.d + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="rl-note">Average next-day miss against ' + src + ', before → after this site\'s learned corrections.</p>';
  }

  function redraw(key) {
    var d = state.data;
    if (key === 'temp' && d.temp) document.getElementById('rl-c-temp').innerHTML = lineChart(specs.temp());
    if (key === 'ens' && d.ens) document.getElementById('rl-c-ens').innerHTML = lineChart(specs.ens());
    if (key === 'rain' && d.rain) document.getElementById('rl-c-rain').innerHTML = rainChart();
    if ((key === 'z500' || key === 't850') && d.up) document.getElementById('rl-c-up').innerHTML = upHTML();
  }

  host.addEventListener('click', function (e) {
    var b = e.target.closest('[data-hub]');
    if (b) { state.id = b.dataset.hub; try { localStorage.setItem('dwl-lab-hub', state.id); } catch (_) {} render(); return; }
    var t = e.target.closest('[data-toggle]');
    if (t) { var k = t.dataset.toggle; state.hidden[k] = !state.hidden[k]; redraw(k.split(':')[0]); return; }
    var r = e.target.closest('[data-rainday]'); if (r) { rainDay(+r.dataset.rainday); return; }
    var p = e.target.closest('.rl-plot'); if (p) inspect(p, e.clientX);
  });
  host.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.buttons) { var p = e.target.closest('.rl-plot'); if (p) inspect(p, e.clientX); } });
  render();
})();
