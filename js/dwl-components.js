/* Diablo Weather Lab shared UI components.
   Both the Local Weather and Observatory views render forecast cards through
   these helpers, so the two views cannot drift apart. Styling lives in css/site.css. */
(function () {
  'use strict';

  /* Share identical same-site data downloads. Several page scripts fetch the same JSON/CSV
     files (each with its own cache-busting ?t=…), which on a phone connection delayed the
     files Local Weather needs. Within 60 s, one download is shared and each caller gets
     its own copy of the response. Cross-site requests are untouched. */
  if (window.fetch && !window.fetch.__dwlShared) {
    var nativeFetch = window.fetch.bind(window), shared = {};
    var sharedFetch = function (input, init) {
      try {
        var method = (init && init.method) || (input && input.method) || 'GET';
        var url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (method === 'GET' && url.origin === location.origin && /\.(json|csv)$/i.test(url.pathname)) {
          var key = url.pathname, hit = shared[key], now = Date.now();
          if (!hit || now - hit.at > 60000) {
            hit = shared[key] = { at: now, p: nativeFetch(input, init) };
            hit.p.then(function (r) { if (!r.ok) delete shared[key]; }, function () { delete shared[key]; });
          }
          return hit.p.then(function (r) { return r.clone(); });
        }
        // Open-Meteo forecasts go through the worker's shared, edge-cached copy first (Open-Meteo
        // rate-limits busy IPs with HTTP 429); a direct request is the fallback.
        if (method === 'GET' && url.href.indexOf('https://api.open-meteo.com/v1/forecast?') === 0) {
          var viaWorker = 'https://moraga-live-observations.russo-matt.workers.dev/forecast' + url.search;
          return nativeFetch(viaWorker, init).then(function (r) { return r.ok ? r : nativeFetch(input, init); }, function () { return nativeFetch(input, init); });
        }
      } catch (e) { /* fall through to a normal fetch */ }
      return nativeFetch(input, init);
    };
    sharedFetch.__dwlShared = true;
    window.fetch = sharedFetch;
  }

  // Single temperature palette for the whole site (20–110 °F).
  var STOPS = [
    [20, [105, 68, 186]], [30, [88, 114, 217]], [40, [54, 158, 224]], [50, [28, 181, 184]],
    [60, [55, 185, 90]], [70, [255, 220, 55]], [80, [255, 144, 36]], [90, [228, 44, 51]],
    [100, [218, 42, 115]], [110, [239, 79, 161]]
  ];
  function tempColor(t) {
    if (!Number.isFinite(t)) return '#9fb6c8';
    if (t <= STOPS[0][0]) return 'rgb(' + STOPS[0][1].join(',') + ')';
    for (var k = 1; k < STOPS.length; k++) {
      if (t <= STOPS[k][0]) {
        var a = STOPS[k - 1], b = STOPS[k], w = (t - a[0]) / (b[0] - a[0]);
        return 'rgb(' + a[1].map(function (v, i) { return Math.round(v + (b[1][i] - v) * w); }).join(',') + ')';
      }
    }
    return 'rgb(' + STOPS[STOPS.length - 1][1].join(',') + ')';
  }

  // WMO weather code -> transparent illustrated icon (weather-icons/v5/*.png).
  var ICON_LABEL = {
    sun: 'Sunny', mostlySun: 'Mostly sunny', partly: 'Partly cloudy', overcast: 'Cloudy', fog: 'Fog',
    storm: 'Thunderstorms', showersSun: 'Showers', showers: 'Showers', rain: 'Rain', heavyRain: 'Heavy rain',
    drizzle: 'Drizzle', cloudy: 'Mostly cloudy', slightRain: 'Light rain', chance: 'Chance of rain', clearing: 'Clearing', snow: 'Snow'
  };
  function iconName(code) {
    if (code === 0) return 'sun';
    if (code === 1) return 'mostlySun';
    if (code === 2) return 'partly';
    if (code === 2.5) return 'cloudy'; // 'Mostly cloudy' text from the observed sky
    if (code === 3) return 'overcast';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 95) return 'storm';
    if (code >= 80 && code <= 82) return 'showersSun';
    if (code === 65 || code === 67) return 'heavyRain';
    if (code >= 61 && code <= 67) return 'rain';
    if (code >= 51 && code <= 57) return 'drizzle';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    return 'mostlySun';
  }
  // Icons containing a sun have night versions (moon) in weather-icons/v5/night/.
  var NIGHT = { sun: 1, mostlySun: 1, partly: 1, clearing: 1, cloudy: 1, showersSun: 1, slightRain: 1, chance: 1, showers: 1, storm: 1, snow: 1 };
  var NIGHT_LABEL = { sun: 'Clear', mostlySun: 'Mostly clear', partly: 'Partly cloudy', clearing: 'Clearing', showersSun: 'Showers', slightRain: 'Showers', cloudy: 'Mostly cloudy', chance: 'Chance of rain', showers: 'Showers', storm: 'Thunderstorms', snow: 'Snow' };
  function icon(code, extraClass, night) {
    var name = iconName(code), isNight = !!night && NIGHT[name];
    return '<img class="dwl-icon' + (extraClass ? ' ' + extraClass : '') + '" src="weather-icons/v5/' + (isNight ? 'night/' : '') + name +
      '.png?v=7" alt="' + (isNight ? NIGHT_LABEL[name] : ICON_LABEL[name]) + '" width="72" height="54"' +
      (isNight ? ' onerror="this.onerror=null;this.src=this.src.replace(\'/night/\',\'/\')"' : '') + '>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* One forecast day card.
     o = { today, day, date, high, low (numbers °F), highText, lowText, iconCode,
           condition, pop ('70%' or ''), amount ('0.25″' or ''), extra (trusted HTML), tag, cls } */
  // One compact row per day: when | icon | condition + rain | high | temperature bar | low.
  // The bar is a plain high-to-low colour gradient.
  // Title Case for condition text ("Chance of Rain", "Mostly Cloudy"); short joining words stay lower case.
  function titleCase(t) {
    return String(t == null ? '' : t).replace(/\b([a-z])([a-z]*)/g, function (w, a, b, i) { return i && /^(of|in|at|by|the|and|or|to|after|before|until|then|with)$/.test(w) ? w : a.toUpperCase() + b; });
  }
  function dayCard(o) {
    var hi = tempColor(o.high), lo = tempColor(o.low);
    var tag = o.tag || 'article';
    // No rain forecast (0.00″ and under a 20% chance): drop the rain line so the condition sits centred.
    var popN = parseFloat(o.pop), amtN = parseFloat(String(o.amount || '').replace(/[^0-9.]/g, ''));
    var dry = (!o.amount || (/^0?\.00/.test(String(o.amount).trim()) && amtN === 0)) && !(popN >= 20);
    var rainLine = !dry && (o.pop || o.amount)
      ? '<div class="dwl-day-rain"><i class="dwl-day-drop" aria-hidden="true"></i>' + (o.pop ? '<span>' + esc(o.pop) + '</span>' : '') +
        (o.pop && o.amount ? '<span class="dwl-day-dot" aria-hidden="true">·</span>' : '') +
        (o.amount ? '<span class="dwl-day-amount">' + esc(o.amount) + '</span>' : '') + '</div>'
      : '';
    var dataT = (Number.isFinite(o.high) ? ' data-hi="' + o.high + '"' : '') + (Number.isFinite(o.low) ? ' data-lo="' + o.low + '"' : '');
    return '<' + tag + ' class="dwl-day' + (o.cls ? ' ' + o.cls : '') + (o.today ? ' is-today' : '') + '" style="--hi:' + hi + ';--lo:' + lo + '"' + dataT + '>' +
      '<div class="dwl-day-when">' + (o.today ? '<span class="dwl-pill">Today</span>' : '') +
        '<strong>' + esc(o.day) + '</strong><span>' + esc(o.date) + '</span></div>' +
      '<div class="dwl-day-icon">' + icon(o.iconCode, '', o.night) + '</div>' +
      '<div class="dwl-day-sky"><div class="dwl-day-cond">' + esc(titleCase(String(o.condition).replace(/^(early am|late am|am|pm|early|late|morning|afternoon|evening|overnight)\s+(?=\S)/i, '').replace(/^slight chance of (rain|showers)$/i, 'Slight Chance').replace(/^./, function (c) { return c.toUpperCase(); }))) + '</div>' + rainLine + '</div>' +
      '<div class="dwl-day-hi" aria-label="High">' + esc(o.highText) + '</div>' +
      '<div class="dwl-day-bar" aria-hidden="true"></div>' +
      '<div class="dwl-day-lo" aria-label="Low">' + esc(o.lowText) + '</div>' +
      (o.wind ? '<div class="dwl-day-wind"><i aria-hidden="true"></i>' + esc(o.wind) + '</div>' : '') +
      (o.extra || '') +
      '</' + tag + '>';
  }
  // Position each day's dot on the coldest-low .. warmest-high range of the whole list.
  function rangeBars(list) {
    if (!list) return;
    var cards = [].slice.call(list.querySelectorAll('.dwl-day[data-hi][data-lo]'));
    if (!cards.length) return;
    var lows = cards.map(function (c) { return +c.dataset.lo; }), highs = cards.map(function (c) { return +c.dataset.hi; });
    var min = Math.min.apply(null, lows), max = Math.max.apply(null, highs), span = Math.max(1, max - min);
    cards.forEach(function (c) {
      var mid = (+c.dataset.hi + +c.dataset.lo) / 2;
      c.style.setProperty('--pos', Math.max(0, Math.min(1, (mid - min) / span)).toFixed(3));
    });
  }


  /* Moraga blended forecast, published by the Observatory renderer so Local Weather
     shows exactly the same skill-weighted, bias-corrected highs and lows. */
  var moraga = {};
  function publishBlend(date, high, low) {
    if (Number.isFinite(high) && Number.isFinite(low)) moraga[date] = { high: high, low: low };
  }
  function blendReady() { window.dispatchEvent(new CustomEvent('dwl:blend')); }
  function moragaBlend(date) { return moraga[date] || null; }

  /* NWS alerts for a location. A point query alone misses storm-based alerts (Flood Advisory,
     Flash Flood / Severe Thunderstorm Warning) whose polygon edge passes just outside the point —
     e.g. the Nov 13 2026 Flood Advisory for central Contra Costa skirted Moraga by ~20 m.
     So also include alerts issued for the location's county, flagged as "nearby". */
  var zoneCache = {};
  function countyFor(lat, lon) {
    var key = lat.toFixed(3) + ',' + lon.toFixed(3);
    if (!zoneCache[key]) {
      zoneCache[key] = fetch('https://api.weather.gov/points/' + lat.toFixed(4) + ',' + lon.toFixed(4), { headers: { Accept: 'application/geo+json' } })
        .then(function (r) { if (!r.ok) throw Error('points ' + r.status); return r.json(); })
        .then(function (j) { return String(j.properties && j.properties.county || '').split('/').pop() || 'CAC013'; })
        .catch(function () { return 'CAC013'; }); // Contra Costa County: all Local Weather towns
    }
    return zoneCache[key];
  }
  var RANK = function (p) {
    var e = String(p.event || '');
    if (/warning/i.test(e) || p.severity === 'Extreme' || p.severity === 'Severe') return 0;
    if (/watch/i.test(e)) return 1;
    if (/advisory/i.test(e)) return 2;
    return 3;
  };
  function fetchAlerts(lat, lon) {
    var get = function (q) {
      return fetch('https://api.weather.gov/alerts/active?' + q, { headers: { Accept: 'application/geo+json' }, cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw Error('NWS alerts ' + r.status); return r.json(); })
        .then(function (j) { return Array.isArray(j.features) ? j.features : []; });
    };
    var point = get('point=' + lat.toFixed(4) + ',' + lon.toFixed(4));
    var county = countyFor(lat, lon).then(function (z) { return get('zone=' + z); }).catch(function () { return []; });
    return Promise.all([point, county]).then(function (res) {
      var now = Date.now(), seen = {}, out = [];
      var keep = function (f, nearby) {
        var p = f.properties || {}, id = p.id || f.id;
        if (!id || seen[id] || p.status !== 'Actual' || p.messageType === 'Cancel') return;
        var end = Date.parse(p.ends || p.expires || '');
        if (Number.isFinite(end) && end <= now) return;
        seen[id] = 1; f._nearby = nearby; f._upcoming = Number.isFinite(Date.parse(p.onset)) && Date.parse(p.onset) > now; out.push(f);
      };
      res[0].forEach(function (f) { keep(f, false); });
      res[1].forEach(function (f) { keep(f, true); });
      return out.sort(function (a, b) { return RANK(a.properties) - RANK(b.properties) || (a._nearby - b._nearby); });
    });
  }

  /* Show the first 5 forecast days, with a button for the rest. State is remembered per list
     (key), so re-rendering the cards keeps the reader's choice. */
  var expanded = {};
  // California state holidays (CalHR list, without Cesar Chavez Day and the day after Thanksgiving):
  // [name, emoji, theme colour 1, theme colour 2] for a given year.
  function holidays(y) {
    var nth = function (m, wd, n) { var d = new Date(y, m, 1); var off = (wd - d.getDay() + 7) % 7; return new Date(y, m, 1 + off + 7 * (n - 1)); };
    var last = function (m, wd) { var d = new Date(y, m + 1, 0); return new Date(y, m, d.getDate() - ((d.getDay() - wd + 7) % 7)); };
    var easter = (function () { var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
      return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1); })();
    var list = [
      [new Date(y, 0, 1), "New Year's Day", '🎉', '#ffd34d', '#c9d6e8'],
      [nth(0, 1, 3), 'MLK Day', '✊', '#c9a227', '#7a5cff'],
      [nth(1, 1, 3), "Presidents' Day", '🇺🇸', '#e0313f', '#3b6cff'],
      [last(4, 1), 'Memorial Day', '🇺🇸', '#e0313f', '#3b6cff'],
      [new Date(y, 6, 4), 'Independence Day', '🎆', '#e0313f', '#3b6cff'],
      [nth(8, 1, 1), 'Labor Day', '🇺🇸', '#e0313f', '#3b6cff'],
      [new Date(y, 10, 11), 'Veterans Day', '🇺🇸', '#e0313f', '#3b6cff'],
      [nth(10, 4, 4), 'Thanksgiving', '🦃', '#f59e0b', '#b45309'],
      [new Date(y, 11, 25), 'Christmas', '🎄', '#e0313f', '#22c55e'],
    ];
    var out = {};
    list.forEach(function (h) { out[(h[0].getMonth() + 1) + '-' + h[0].getDate()] = h.slice(1); });
    return out;
  }
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // Tag 10-day cards that fall on a holiday (reads the "Nov 26" date label on each card).
  function markHolidays(list) {
    if (!list) return;
    var now = new Date();
    list.querySelectorAll('.dwl-day').forEach(function (card) {
      card.classList.remove('is-holiday'); var old = card.querySelector('.dwl-holiday'); if (old) old.remove();
      var label = (card.querySelector('.dwl-day-when span:last-child') || {}).textContent || '';
      var m = label.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/);
      if (!m || MONTHS[m[1].toLowerCase()] === undefined) return;
      var mon = MONTHS[m[1].toLowerCase()], day = +m[2], y = now.getFullYear();
      if (mon < now.getMonth() - 6) y++;
      var h = holidays(y)[(mon + 1) + '-' + day];
      if (!h) return;
      card.classList.add('is-holiday');
      card.style.setProperty('--hol1', h[2]); card.style.setProperty('--hol2', h[3]);
      card.insertAdjacentHTML('beforeend', '<span class="dwl-holiday"><b aria-hidden="true">' + h[1] + '</b>' + esc(h[0]) + '</span>');
    });
  }
  function collapseDays(list, key) {
    if (!list) return;
    rangeBars(list);
    var cards = list.querySelectorAll('.dwl-day');
    var btn = list.nextElementSibling && list.nextElementSibling.classList.contains('dwl-more') ? list.nextElementSibling : null;
    if (cards.length <= 5) { list.classList.remove('is-collapsed'); if (btn) btn.remove(); return; }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'dwl-more';
      list.insertAdjacentElement('afterend', btn);
      btn.addEventListener('click', function () { expanded[key] = !expanded[key]; collapseDays(list, key); });
    }
    var open = !!expanded[key], more = cards.length - 5;
    list.classList.toggle('is-collapsed', !open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Show fewer days' : 'Show ' + more + ' more days';
  }

  /* Rain timing for a day's condition label. amounts = expected rain (in) in each local period:
     {overnight: 0-6h, morning: 6-12h, afternoon: 12-18h, evening: 18-24h}. Returns a short prefix,
     or '' when rain is spread through the day. */
  function timingPrefix(a) {
    if (!a) return '';
    var o = a.overnight || 0, m = a.morning || 0, f = a.afternoon || 0, e = a.evening || 0, t = o + m + f + e;
    if (t < 0.01) return '';
    if (e / t >= 0.65) return 'Evening';
    if (o / t >= 0.65) return 'Early AM';
    if ((o + m) / t >= 0.7) return 'AM';
    if ((f + e) / t >= 0.7) return 'PM';
    return '';
  }
  // Hourly series {time:['YYYY-MM-DDTHH:MM'], precipitation:[in]} → per-period totals for one date.
  function periodAmounts(hourly, date) {
    if (!hourly || !hourly.time) return null;
    var out = { overnight: 0, morning: 0, afternoon: 0, evening: 0 }, n = 0;
    for (var i = 0; i < hourly.time.length; i++) {
      var t = hourly.time[i];
      if (t.slice(0, 10) !== date) continue;
      var v = Number(hourly.precipitation[i]); if (!Number.isFinite(v)) continue;
      var h = Number(t.slice(11, 13)); n++;
      out[h < 6 ? 'overnight' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'] += Math.max(0, v);
    }
    return n >= 18 ? out : null;
  }
  // Same per-period amounts from a feed's hourly_conditions {model: {time, precipitation_mm}}:
  // average of the models that cover at least 18 hours of that date. Used by both views.
  function modelPeriodAmounts(hc, date) {
    if (!hc) return null;
    var out = { overnight: 0, morning: 0, afternoon: 0, evening: 0 }, models = [];
    Object.keys(hc).forEach(function (name) {
      var sr = hc[name]; if (!sr || !sr.time) return;
      var hours = [];
      sr.time.forEach(function (t, i) { if (t.slice(0, 10) === date) { var v = Number(sr.precipitation_mm && sr.precipitation_mm[i]); if (Number.isFinite(v)) hours.push({ h: Number(t.slice(11, 13)), v: Math.max(0, v) }); } });
      if (hours.length >= 18) models.push(hours);
    });
    if (!models.length) return null;
    models.forEach(function (hours) { hours.forEach(function (x) { out[x.h < 6 ? 'overnight' : x.h < 12 ? 'morning' : x.h < 18 ? 'afternoon' : 'evening'] += x.v / models.length; }); });
    return out;
  }
  /* Today's card should describe the rest of today, not rain that already fell before dawn.
     From the published multi-model hours: share of models with ≥0.01" still to come (as a
     rounded chance), mean remaining amount, cloud cover and timing. Null before 6 AM or late
     at night, when the whole-day numbers are still the right summary. */
  function laHour() { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(new Date())); }
  function restOfToday(hc, date) {
    var now = laHour();
    if (!hc || now < 6) return null; // before 6 AM the whole-day forecast is still the right story
    var models = [];
    Object.keys(hc).forEach(function (name) {
      var sr = hc[name]; if (!sr || !sr.time) return;
      var rain = 0, cloud = [], hours = 0, per = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };
      sr.time.forEach(function (t, i) {
        var h = Number(t.slice(11, 13));
        if (t.slice(0, 10) !== date || h < now) return;
        var v = Number(sr.precipitation_mm && sr.precipitation_mm[i]), c = Number(sr.cloud_cover_pct && sr.cloud_cover_pct[i]);
        if (Number.isFinite(v)) { rain += Math.max(0, v); hours++; per[h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'] += Math.max(0, v); }
        if (Number.isFinite(c)) cloud.push(c);
      });
      if (hours >= Math.max(1, Math.floor((24 - now) * 0.75))) models.push({ rain: rain, per: per, cloud: cloud.length ? cloud.reduce(function (a, b) { return a + b; }, 0) / cloud.length : null });
    });
    if (!models.length) return null;
    var avg = function (f) { var v = models.map(f).filter(function (x) { return x !== null; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; };
    var per = { overnight: 0, morning: avg(function (m) { return m.per.morning; }), afternoon: avg(function (m) { return m.per.afternoon; }), evening: avg(function (m) { return m.per.evening; }) };
    return {
      chance: Math.round(100 * models.filter(function (m) { return m.rain >= 0.01; }).length / models.length / 10) * 10,
      amount: avg(function (m) { return m.rain; }),
      night: now >= 18,
      cloud: avg(function (m) { return m.cloud; }),
      periods: per
    };
  }
  // Rest of today from the live hourly forecast (the same data as the Next 24 Hours cards), so the
  // Today row and the hourly strip never disagree. Amounts are inches (precipitation_unit=inch).
  function liveRestOfToday(hourly, date) {
    var t = hourly && hourly.time, now = laHour();
    if (!t || !hourly.precipitation_probability || now < 6) return null;
    var pops = [], rain = 0, cloud = [], per = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };
    t.forEach(function (x, i) {
      var h = Number(x.slice(11, 13));
      if (x.slice(0, 10) !== date || h < now) return;
      var p = Number(hourly.precipitation_probability[i]), v = Number(hourly.precipitation && hourly.precipitation[i]), c = Number(hourly.cloud_cover && hourly.cloud_cover[i]);
      if (Number.isFinite(p)) pops.push(p);
      if (Number.isFinite(v)) { rain += Math.max(0, v); per[h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'] += Math.max(0, v); }
      if (Number.isFinite(c)) cloud.push(c);
    });
    if (!pops.length) return null;
    return { chance: Math.round(Math.max.apply(null, pops) / 10) * 10, amount: rain, night: now >= 18,
      cloud: cloud.length ? cloud.reduce(function (a, b) { return a + b; }, 0) / cloud.length : null, periods: per };
  }
  function applyRestOfToday(o, hc, date, hourly) {
    if (!o || !o.today) return o;
    var r = liveRestOfToday(hourly, date) || restOfToday(hc, date);
    if (!r) return o;
    if (r.chance < 20 && r.amount < 0.025) {
      var c = r.cloud === null ? 50 : r.cloud;
      o.pop = ''; o.amount = '';
      o.iconCode = c < 30 ? 1 : c < 70 ? 2 : 3;
      o.night = r.night;
      o.condition = r.night ? (c < 30 ? 'Clear' : c < 70 ? 'Partly cloudy' : 'Cloudy') : (c < 30 ? 'Mostly sunny' : c < 70 ? 'Partly cloudy' : 'Cloudy');
    } else {
      o.pop = Math.max(20, r.chance) + '%';
      // Same precision as the 36-hour rain bars (hundredths), so the two add up.
      o.amount = r.amount < 0.005 ? '0.00″' : r.amount < 0.01 ? '<0.01″' : r.amount.toFixed(2) + '″';
      o.iconCode = r.chance >= 60 ? 61 : 80;
      o.condition = timedCondition(r.chance >= 60 ? 'Rain' : r.chance >= 30 ? 'Chance of rain' : 'Slight chance of rain', timingPrefix(r.periods));
    }
    return o;
  }
  // Fold the timing into a rain condition: 'Rain' → 'AM Rain', 'Chance of Rain' → 'PM Showers'.
  // Timing words (AM/PM/Evening...) are no longer shown on day cards; the condition stays plain.
  function timedCondition(cond, prefix) {
    return cond;
    var c = String(cond);
    if (/slight chance/i.test(c)) return c;
    if (/heavy rain/i.test(c)) return prefix + ' Heavy Rain';
    if (/^rain$|rain likely/i.test(c)) return prefix + ' Rain';
    if (/chance of (rain|showers)|^showers?$/i.test(c)) return prefix + ' Showers';
    if (/drizzle/i.test(c)) return prefix + ' Drizzle';
    if (/thunder/i.test(c)) return prefix + ' Storms';
    return c;
  }

  // ---- Structured alert card: parse the NWS WHAT / WHERE / WHEN / IMPACTS text into a summary,
  // key numbers and key actions (rule-based, from the official text only). ----
  var AI = {
    layers: '<path d="M12 3 3 8l9 5 9-5Z M3 12.5l9 5 9-5 M3 17l9 5 9-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    paw: '<circle cx="7" cy="9" r="1.9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="9" r="1.9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="5.2" r="1.9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="14" cy="5.2" r="1.9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 11c-3 0-5.5 3.4-5.5 5.6 0 2 2 2.6 3.2 2.2 1-.3 1.6-.6 2.3-.6s1.3.3 2.3.6c1.2.4 3.2-.2 3.2-2.2 0-2.2-2.5-5.6-5.5-5.6Z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    leaf: '<path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15M5 19c3-4 6-7 10-9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    flame: '<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.7 3-5.6 4-9 2.5 1.6 3.5 3.6 3.5 5.6 1-.6 1.6-1.6 1.8-2.8C17 10.5 18.5 12.8 18.5 15c0 3.4-2.5 6-6.5 6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    home: '<path d="M4 11 12 4l8 7v9h-5v-5h-6v5H4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    car: '<path d="M5 16V12l2-5h10l2 5v4M4 16h16v3H4ZM7.5 19v1.5M16.5 19v1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>',
    water: '<path d="M12 3.5c3.3 4.2 5.5 7.3 5.5 10a5.5 5.5 0 0 1-11 0c0-2.7 2.2-5.8 5.5-10Z" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    wind: '<path d="M3 8h10a2.6 2.6 0 1 0-2.6-2.6M3 12.5h15a2.6 2.6 0 1 1-2.6 2.6M3 17h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    wave: '<path d="M2 9c3-3.5 6-3.5 9 0s6 3.5 9 0M2 16c3-3.5 6-3.5 9 0s6 3.5 9 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    thermo: '<path d="M10 4.5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 9v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 2 3-2M9 20l3-2 3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    clock: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    spark: '<path d="M12 2.5c.7 4.8 3.7 7.8 8.5 8.5v1c-4.8.7-7.8 3.7-8.5 8.5h-1c-.7-4.8-3.7-7.8-8.5-8.5v-1C7.3 10.3 10.3 7.3 11 2.5Z" fill="currentColor"/>'
  };
  var svgi = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + AI[k] + '</svg>'; };
  var ACTIONS = [
    [/layers/i, 'layers', 'Dress in layers'], [/pets|livestock|animals/i, 'paw', 'Protect pets & livestock'],
    [/crops|plants|vegetation/i, 'leaf', 'Cover sensitive plants'], [/heater/i, 'flame', 'Use heaters safely'],
    [/warming cent|cooling cent/i, 'home', 'Find a warming center'], [/turn around|flooded road|flood waters/i, 'car', 'Avoid flooded roads'],
    [/hydrat|drink plenty/i, 'water', 'Stay hydrated'], [/secure|loose objects|outdoor objects/i, 'wind', 'Secure outdoor items'],
    [/power outage|downed (power )?lines|trees/i, 'bolt', 'Prepare for outages'], [/rocks|jetties|beach|surf|water'?s edge/i, 'wave', 'Stay off rocks & jetties'],
    [/travel|drive|driving|motorists/i, 'car', 'Use caution driving'], [/air condition|shade|strenuous/i, 'home', 'Limit time outdoors'],
    [/indoors|shelter/i, 'home', 'Stay indoors']
  ];
  function alertParts(p) {
    var d = String(p.description || ''), sect = {};
    d.replace(/\* ?([A-Z][A-Z ]+?)\.\.\.([\s\S]*?)(?=\n\s*\n\* ?[A-Z]|\n\* ?[A-Z][A-Z ]+?\.\.\.|$)/g, function (m, k, v) { sect[k.trim()] = v.replace(/\s+/g, ' ').trim(); });
    var what = sect.WHAT || String(p.headline || '').replace(/ by NWS.*$/, ''), impacts = sect.IMPACTS || '';
    var where = (sect.WHERE || '').replace(/^(The|Portions of|Parts of)\s+/i, '').replace(/\.$/, '');
    if (!where) where = String(p.areaDesc || '').split(';')[0];
    if (where.length > 28) where = where.split(/,| and /)[0].trim();
    var stats = [], m;
    if ((m = what.match(/(?:temperatures?|lows?|highs?|wind chills?|heat (?:index|indices))[^.]*?(-?\d{1,3})\s*(?:to|-|–)\s*(-?\d{1,3})/i))) stats.push(['thermo', /wind chill/i.test(m[0]) ? 'Wind chill' : 'Temps', m[1] + '–' + m[2] + '°']);
    else if ((m = what.match(/(?:as low as|as high as|near|around)\s+(-?\d{1,3})\s*degrees/i))) stats.push(['thermo', 'Temps', m[1] + '°']);
    if ((m = what.match(/winds?\s+(\d{1,3})\s*(?:to|-|–)\s*(\d{1,3})\s*mph(?:[^.]*?gusts?\s+(?:up to\s+)?(\d{1,3})\s*mph)?/i))) stats.push(['wind', 'Wind', m[1] + '–' + m[2] + ' mph']);
    if ((m = what.match(/gusts?\s+(?:up to\s+)?(\d{1,3})\s*mph/i))) stats.push(['wind', 'Gusts', m[1] + ' mph']);
    if ((m = what.match(/(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)\s*inch/i))) stats.push(['water', 'Rain', m[1] + '–' + m[2] + '″']);
    if ((m = what.match(/(?:waves?|seas|surf|breakers)[^.]*?(\d{1,2})\s*(?:to|-|–)\s*(\d{1,2})\s*(?:ft|feet)/i))) stats.push(['wave', 'Waves', m[1] + '–' + m[2] + ' ft']);
    var on = Date.parse(p.onset || p.effective || ''), off = Date.parse(p.ends || p.expires || ''), win = '';
    if (Number.isFinite(on) && Number.isFinite(off) && off > on) {
      var hrs = Math.round((off - on) / 36e5);
      stats.push([/cold|freeze|frost|winter/i.test(p.event) ? 'snow' : 'clock', 'Duration', hrs < 48 ? hrs + ' hour' + (hrs === 1 ? '' : 's') : Math.round(hrs / 24) + ' days']);
      var f = function (t, o) { return new Date(t).toLocaleString('en-US', Object.assign({ timeZone: 'America/Los_Angeles', hour: 'numeric' }, o || {})).replace(':00', ''); };
      var dayOn = f(on, { weekday: 'short', hour: undefined }), dayOff = f(off, { weekday: 'short', hour: undefined });
      win = dayOn + ' ' + f(on) + ' – ' + (dayOn === dayOff ? '' : dayOff + ' ') + f(off);
    }
    if (where) stats.push(['pin', 'Area', where]);
    var first = what.replace(/\s+expected\.?$/i, '').replace(/\.$/, '');
    first = first.replace(/temperatures? as (low|high) as (-?\d+) to (-?\d+) degrees/i, 'temps $2–$3°').replace(/(-?\d+) to (-?\d+) degrees/i, '$1–$2°')
      .replace(/^(\w+) conditions with /i, function (m, w) { return 'A ' + w.toLowerCase() + ' stretch with '; }).replace(/ miles per hour/gi, ' mph').replace(/(\d+) to (\d+) mph/gi, '$1–$2 mph');
    // Combined NWS products ("For the Coastal Flood Advisory, ... For the Coastal Flood Warning, ..."): keep only this alert's part.
    var parts = first.split(/(?=\bFor the [A-Z][\w ]+?(?:Warning|Advisory|Watch|Statement),)/);
    if (parts.length > 1) {
      var mine = parts.filter(function (x) { return x.toLowerCase().indexOf('for the ' + String(p.event || '').toLowerCase() + ',') === 0; })[0];
      if (mine) first = mine.replace(/^For the [^,]+,\s*/, '').replace(/[.\s]+$/, '');
    }
    first = first.charAt(0).toUpperCase() + first.slice(1);
    var imp = impacts.split(/(?<=\.)\s/)[0] || '';
    imp = imp.replace(/^[A-Z][a-z]+ conditions will be hazardous,?\s*/i, 'Hazardous, ').replace(/\s+/g, ' ');
    var acts = [], txt = String(p.instruction || '') + ' ' + impacts;
    ACTIONS.forEach(function (a) { if (acts.length < 3 && a[0].test(txt) && !acts.some(function (x) { return x[1] === a[2]; })) acts.push([a[1], a[2]]); });
    return { where: where, window: win, summary: first + '.', impact: imp, stats: stats.slice(0, 3), actions: acts };
  }
  function alertRich(A) {
    var s = '<div class="dwl-ar-sum"><div><b>' + esc(A.summary) + '</b>' + (A.impact ? '<span>' + esc(A.impact) + '</span>' : '') + '</div></div>';
    if (A.stats.length) s += '<div class="dwl-ar-stats">' + A.stats.map(function (x) { return '<div>' + svgi(x[0]) + '<span><small>' + esc(x[1]) + '</small><b>' + esc(x[2]) + '</b></span></div>'; }).join('') + '</div>';
    if (A.actions.length) s += '<div class="dwl-ar-acts"><b>Key actions</b>' + A.actions.map(function (x) { return '<div>' + svgi(x[0]) + '<span>' + esc(x[1]) + '</span></div>'; }).join('') + '</div>';
    return s;
  }
  window.DWL = { titleCase: titleCase, alertParts: alertParts, alertRich: alertRich, markHolidays: markHolidays, holidays: holidays, tempColor: tempColor, icon: icon, iconName: iconName, dayCard: dayCard, fetchAlerts: fetchAlerts, collapseDays: collapseDays, resetDays: function (key) { delete expanded[key]; }, timingPrefix: timingPrefix, periodAmounts: periodAmounts, modelPeriodAmounts: modelPeriodAmounts, timedCondition: timedCondition, applyRestOfToday: applyRestOfToday, restOfToday: restOfToday,
    publishBlend: publishBlend, blendReady: blendReady, moragaBlend: moragaBlend };

  // Section tabs: highlight the tab for the section currently in view.
  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.querySelector('main > nav');
    if (!nav || !('IntersectionObserver' in window)) return;
    var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    function activate(id) {
      links.forEach(function (a) { a.classList.toggle('is-active', a === byId[id]); });
      var a = byId[id];
      if (a && nav.scrollWidth > nav.clientWidth) {
        nav.scrollTo({ left: a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2, behavior: 'smooth' });
      }
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) activate(e.target.id); });
    }, { rootMargin: '-35% 0px -60% 0px' });
    Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
    activate(links[0] && links[0].getAttribute('href').slice(1));
  });
})();
