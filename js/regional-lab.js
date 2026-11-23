/* Diablo Weather Lab — Regional Lab (Forecast Lab).
   Interactive model guidance for a few regional hubs, drawn in the browser from each location's
   published forecast feed ({id}_forecast_10day.json) and verification files. No extra jobs or images. */
(function () {
  'use strict';
  var HUBS = [
    ['moraga', 'Moraga'], ['soma', 'San Francisco'], ['downtownoakland', 'Oakland'], ['northgate', 'Walnut Creek'],
    ['danville', 'Danville'], ['claytonvalley', 'Concord'], ['livermorewine', 'Livermore'], ['sacramento', 'Sacramento']
  ];
  var COLORS = { EPS: '#a78bfa', GEFS: '#f472b6', ECMWF: '#3fd8f5', GFS: '#fbbf24', ICON: '#34d399', GEM: '#fb923c', NAM: '#94a3b8' };
  var host = document.getElementById('regional-lab'); if (!host) return;
  var state = { id: 'moraga', hidden: {}, day: 0, feed: null };
  try { var saved = localStorage.getItem('dwl-lab-hub'); if (saved && HUBS.some(function (h) { return h[0] === saved; })) state.id = saved; } catch (e) {}

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmtDay = function (d) { var t = new Date(d + 'T12:00:00'); return { dow: t.toLocaleDateString('en-US', { weekday: 'short' }), md: t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }; };
  var r1 = function (v) { return Math.round(v); };
  var num = function (v) { return v !== null && v !== undefined && Number.isFinite(Number(v)); };

  function picker() {
    return '<div class="rl-picker" role="tablist" aria-label="Choose a regional site">' + HUBS.map(function (h) {
      return '<button type="button" role="tab" data-hub="' + h[0] + '" aria-selected="' + (h[0] === state.id) + '">' + esc(h[1]) + '</button>';
    }).join('') + '</div>';
  }

  // Temperature chart: each model's daily high (solid) and low (dashed); shaded band = spread across models.
  function tempChart(f) {
    var dates = f.dates.slice(0, 10), models = Object.keys(f.temperature_models || {});
    var W = 560, H = 360, L = 34, R = 10, T = 14, B = 30, n = dates.length;
    var vals = [];
    models.forEach(function (m) { var tm = f.temperature_models[m]; dates.forEach(function (d) { var i = tm.dates.indexOf(d); if (i >= 0) { [tm.high_f[i], tm.low_f[i]].forEach(function (q) { if (num(q)) vals.push(+q); }); } }); });
     if (!vals.length) return '<p class="rl-empty">No model temperatures yet.</p>';
    var lo = Math.floor((Math.min.apply(null, vals) - 3) / 5) * 5, hi = Math.ceil((Math.max.apply(null, vals) + 3) / 5) * 5;
    var x = function (i) { return L + (W - L - R) * (n === 1 ? .5 : i / (n - 1)); }, y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var g = '';
    for (var v = lo; v <= hi; v += 5) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="rl-grid"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="rl-ax" text-anchor="end">' + v + '°</text>';
    dates.forEach(function (d, i) { var fd = fmtDay(d); g += '<text x="' + x(i) + '" y="' + (H - 14) + '" class="rl-ax" text-anchor="middle">' + fd.dow + '</text>'; });
    // spread bands
    ['high_f', 'low_f'].forEach(function (k) {
      var top = [], bot = [];
      dates.forEach(function (d, i) { var vs = models.filter(function (m) { return !state.hidden[m]; }).map(function (m) { var tm = f.temperature_models[m], j = tm.dates.indexOf(d); return j >= 0 && num(tm[k][j]) ? +tm[k][j] : null; }).filter(function (q) { return q !== null; });
        if (vs.length) { top.push([x(i), y(Math.max.apply(null, vs))]); bot.push([x(i), y(Math.min.apply(null, vs))]); } });
      if (top.length > 1) g += '<path class="rl-band ' + (k === 'high_f' ? 'hi' : 'lo') + '" d="M' + top.map(function (p) { return p.join(','); }).join('L') + 'L' + bot.reverse().map(function (p) { return p.join(','); }).join('L') + 'Z"/>';
    });
    models.forEach(function (m) {
      if (state.hidden[m]) return; var tm = f.temperature_models[m], c = COLORS[m] || '#cbd5e1';
      ['high_f', 'low_f'].forEach(function (k) {
        var pts = dates.map(function (d, i) { var j = tm.dates.indexOf(d); return j >= 0 && num(tm[k][j]) ? x(i) + ',' + y(tm[k][j]) : null; }).filter(Boolean);
        if (pts.length > 1) g += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + c + '" stroke-width="2" ' + (k === 'low_f' ? 'stroke-dasharray="5 4"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>';
      });
    });
    g += '<line class="rl-sel" x1="' + x(state.day) + '" x2="' + x(state.day) + '" y1="' + T + '" y2="' + (H - B) + '"/>';
    dates.forEach(function (d, i) { g += '<rect class="rl-hit" data-day="' + i + '" x="' + (x(i) - (W - L - R) / (n - 1) / 2) + '" y="' + T + '" width="' + ((W - L - R) / (n - 1)) + '" height="' + (H - T - B) + '"/>'; });
    var legend = '<div class="rl-legend">' + models.map(function (m) {
      return '<button type="button" data-model="' + esc(m) + '" aria-pressed="' + !state.hidden[m] + '"><i style="background:' + (COLORS[m] || '#cbd5e1') + '"></i>' + esc(m) + '</button>';
    }).join('') + '<span class="rl-key"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" stroke-width="2"/></svg>High <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/></svg>Low</span></div>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="rl-chart" role="img" aria-label="Daily high and low temperature by model">' + g + '</svg>' + legend;
  }

  // Rain chart: expected amount per day (bar) and chance (label above).
  function rainChart(f) {
    var dates = f.dates.slice(0, 10), rg = f.rain_guidance || {}, pop = f.ensemble_rain_probability_pct || {};
    var amts = dates.map(function (d) { return Number(rg[d] && rg[d].expected_inches) || 0; }), max = Math.max(.25, Math.max.apply(null, amts));
    return '<div class="rl-rain">' + dates.map(function (d, i) {
      var p = Number(rg[d] && rg[d].derived_pop_pct); if (!isFinite(p)) p = Number(pop[d]); var fd = fmtDay(d), a = amts[i];
      return '<button type="button" class="rl-rbar' + (i === state.day ? ' is-sel' : '') + '" data-day="' + i + '"><span class="rl-pop">' + (isFinite(p) ? Math.round(p / 10) * 10 + '%' : '') + '</span><span class="rl-track"><i style="height:' + Math.max(a > 0.004 ? 4 : 0, Math.round(64 * a / max)) + 'px"></i></span><span class="rl-amt">' + (a >= .01 ? a.toFixed(2) + '″' : '—') + '</span><span class="rl-dow">' + fd.dow + '</span></button>';
    }).join('') + '</div>';
  }

  // Selected day: every model's high / low / rain.
  function dayDetail(f) {
    var d = f.dates[state.day]; if (!d) return ''; var fd = fmtDay(d), rows = '';
    Object.keys(f.temperature_models || {}).forEach(function (m) {
      var tm = f.temperature_models[m], j = tm.dates.indexOf(d), rain = (f.model_daily_inches || {})[m] || (f.model_daily_inches || {})[m + ' mean'];
      if (j < 0) return; var ri = rain && rain[state.day];
      rows += '<tr><th scope="row"><i style="background:' + (COLORS[m] || '#cbd5e1') + '"></i>' + esc(m) + '</th><td class="h">' + (num(tm.high_f[j]) ? r1(tm.high_f[j]) + '°' : '—') + '</td><td class="l">' + (num(tm.low_f[j]) ? r1(tm.low_f[j]) + '°' : '—') + '</td><td>' + (num(ri) ? Number(ri).toFixed(2) + '″' : '—') + '</td></tr>';
    });
    var rg = (f.rain_guidance || {})[d] || {}, th = rg.ensemble_threshold_pct || {};
    var odds = th['0.1'] !== undefined ? '<p class="rl-odds">Ensemble odds: ' + (th['0.01'] || 0) + '% any rain · ' + (th['0.1'] || 0) + '% ≥ 0.10″ · ' + (th['0.25'] || 0) + '% ≥ 0.25″ · ' + (th['0.5'] || 0) + '% ≥ 0.50″</p>' : '';
    return '<div class="rl-day"><h4>' + fd.dow + ', ' + fd.md + '</h4><div class="rl-scroll"><table><thead><tr><th>Model</th><th>High</th><th>Low</th><th>Rain</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + odds + '</div>';
  }

  // Accuracy: per-model next-day error at this site, raw vs after local correction.
  function accuracy(v) {
    if (!v || !v.calibration) return '<p class="rl-empty">Accuracy builds as verified days accumulate.</p>';
    var rows = Object.keys(v.calibration).filter(function (m) { var c = v.calibration[m]; return c.high && c.high.holdout_days >= 8; }).map(function (m) {
      var c = v.calibration[m]; return { m: m.toUpperCase(), d: c.high.holdout_days, hr: c.high.raw_holdout_mae_f, hc: c.high.selected_holdout_mae_f, lr: c.low.raw_holdout_mae_f, lc: c.low.selected_holdout_mae_f };
    }).sort(function (a, b) { return (a.hc + a.lc) - (b.hc + b.lc); });
    if (!rows.length) return '<p class="rl-empty">Accuracy builds as verified days accumulate.</p>';
    var src = v.verified_against === 'station' ? 'the local station' : v.verified_against === 'public_stations' ? 'nearby public stations' : 'NOAA observed temperatures';
    return '<div class="rl-scroll"><table class="rl-acc"><thead><tr><th>Model</th><th>High miss</th><th>Low miss</th><th>Days</th></tr></thead><tbody>' + rows.map(function (r, k) {
      return '<tr' + (k === 0 ? ' class="best"' : '') + '><th scope="row">' + esc(r.m) + (k === 0 ? ' <small>best</small>' : '') + '</th><td>' + r.hr.toFixed(1) + '° → <b>' + r.hc.toFixed(1) + '°</b></td><td>' + r.lr.toFixed(1) + '° → <b>' + r.lc.toFixed(1) + '°</b></td><td>' + r.d + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="rl-note">Average next-day miss against ' + src + ', before → after this site\'s learned corrections (scored only on days the corrections had not seen).</p>';
  }

  function render() {
    var f = state.feed, name = (HUBS.find(function (h) { return h[0] === state.id; }) || [])[1];
    host.innerHTML = picker() + (f ? (
      '<div class="rl-meta">' + esc(name) + ' · updated ' + new Date(f.generated_utc).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</div>' +
      '<article class="card rl-card"><h3>Model temperatures · 10 days</h3><p class="rl-sub">Tap a day for every model\'s numbers. Tap a model to show or hide it.</p>' + tempChart(f) + '</article>' +
      '<article class="card rl-card"><h3>Rain outlook · 10 days</h3><p class="rl-sub">Bar = expected amount (blended). Above = chance of measurable rain.</p>' + rainChart(f) + dayDetail(f) + '</article>' +
      '<article class="card rl-card"><h3>Which model is best here?</h3><div id="rl-acc"><p class="rl-empty">Loading accuracy…</p></div></article>'
    ) : '<p class="rl-empty">Loading ' + esc(name) + '…</p>');
  }

  function load() {
    state.feed = null; lastAcc = ''; render(); var id = state.id;
    fetch(id + '_forecast_10day.json?t=' + Math.floor(Date.now() / 600000)).then(function (r) { return r.json(); }).then(function (f) {
      if (id !== state.id) return; state.feed = f; state.day = 0; render();
      var tries = id === 'moraga' ? ['verification/moraga_model_daily_verification_noaa.json', 'model_daily_verification_latest.json'] : ['verification/' + id + '_model_daily_verification_noaa.json', 'verification/' + id + '_model_daily_verification.json'];
      (function next(k) {
        if (k >= tries.length) { var a = document.getElementById('rl-acc'); if (a) a.innerHTML = accuracy(null); return; }
        fetch(tries[k] + '?t=' + Math.floor(Date.now() / 600000)).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (v) {
          if (id !== state.id) return; if (!v.calibration) throw 0; var a = document.getElementById('rl-acc'); if (a) a.innerHTML = accuracy(v);
        }).catch(function () { next(k + 1); });
      })(0);
    }).catch(function () { host.innerHTML = picker() + '<p class="rl-empty">Forecast unavailable right now.</p>'; });
  }

  host.addEventListener('click', function (e) {
    var b = e.target.closest('[data-hub]');
    if (b) { state.id = b.dataset.hub; try { localStorage.setItem('dwl-lab-hub', state.id); } catch (_) {} load(); return; }
    var m = e.target.closest('[data-model]');
    if (m && state.feed) { state.hidden[m.dataset.model] = !state.hidden[m.dataset.model]; render(); fillAcc(); return; }
    var d = e.target.closest('[data-day]');
    if (d && state.feed) { state.day = +d.dataset.day; render(); fillAcc(); }
  });
  // Re-rendering replaces the accuracy box; keep the last result.
  var lastAcc = '';
  new MutationObserver(function () { var a = document.getElementById('rl-acc'); if (a && !/Loading accuracy/.test(a.textContent)) lastAcc = a.innerHTML; }).observe(host, { childList: true, subtree: true });
  function fillAcc() { var a = document.getElementById('rl-acc'); if (a && lastAcc) a.innerHTML = lastAcc; }
  load();
})();
