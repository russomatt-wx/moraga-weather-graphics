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

  // WMO weather code -> transparent illustrated icon (weather-icons/clear/*.png).
  var ICON_LABEL = {
    sun: 'Sunny', mostlySun: 'Mostly sunny', partly: 'Partly cloudy', overcast: 'Cloudy', fog: 'Fog',
    storm: 'Thunderstorms', showersSun: 'Showers', showers: 'Showers', rain: 'Rain', heavyRain: 'Heavy rain',
    drizzle: 'Drizzle', cloudy: 'Cloudy', slightRain: 'Light rain'
  };
  function iconName(code) {
    if (code === 0) return 'sun';
    if (code === 1) return 'mostlySun';
    if (code === 2) return 'partly';
    if (code === 3) return 'overcast';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 95) return 'storm';
    if (code >= 80 && code <= 82) return 'showersSun';
    if (code === 65 || code === 67) return 'heavyRain';
    if (code >= 61 && code <= 67) return 'rain';
    if (code >= 51 && code <= 57) return 'drizzle';
    if (code >= 71 && code <= 77) return 'overcast';
    return 'mostlySun';
  }
  // Icons containing a sun have night versions (moon) in weather-icons/clear/night/.
  var NIGHT = { sun: 1, mostlySun: 1, partly: 1, clearing: 1, showersSun: 1, slightRain: 1 };
  var NIGHT_LABEL = { sun: 'Clear', mostlySun: 'Mostly clear', partly: 'Partly cloudy', clearing: 'Clearing', showersSun: 'Showers', slightRain: 'Light rain' };
  function icon(code, extraClass, night) {
    var name = iconName(code), isNight = !!night && NIGHT[name];
    return '<img class="dwl-icon' + (extraClass ? ' ' + extraClass : '') + '" src="weather-icons/clear/' + (isNight ? 'night/' : '') + name +
      '.png?v=3" alt="' + (isNight ? NIGHT_LABEL[name] : ICON_LABEL[name]) + '" width="72" height="54"' +
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
  function dayCard(o) {
    var hi = tempColor(o.high), lo = tempColor(o.low);
    var tag = o.tag || 'article';
    var rainLine = (o.pop || o.amount)
      ? '<div class="dwl-day-rain">' + (o.pop ? '<span>' + esc(o.pop) + '</span>' : '') +
        (o.amount ? '<span class="dwl-day-amount"><i aria-hidden="true"></i>' + esc(o.amount) + '</span>' : '') + '</div>'
      : '<div class="dwl-day-rain" aria-hidden="true">&nbsp;</div>'; // keep every card the same height
    return '<' + tag + ' class="dwl-day' + (o.cls ? ' ' + o.cls : '') + (o.today ? ' is-today' : '') + '" style="--hi:' + hi + ';--lo:' + lo + '">' +
      '<div class="dwl-day-when">' + (o.today ? '<span class="dwl-pill">Today</span>' : '') +
        '<strong>' + esc(o.day) + '</strong><span>' + esc(o.date) + '</span></div>' +
      '<div class="dwl-day-hi" aria-label="High">' + esc(o.highText) + '</div>' +
      '<div class="dwl-day-sky">' + icon(o.iconCode) +
        '<div class="dwl-day-cond">' + esc(String(o.condition).replace(/^slight chance of (rain|showers)$/i, 'Slight Chance')) + '</div>' + rainLine + '</div>' +
      '<div class="dwl-day-lo" aria-label="Low">' + esc(o.lowText) + '</div>' +
      (o.extra || '') +
      '</' + tag + '>';
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
  function collapseDays(list, key) {
    if (!list) return;
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
    if (!hc || now < 6 || now > 20) return null;
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
      if (hours >= Math.max(3, (24 - now) * 0.75)) models.push({ rain: rain, per: per, cloud: cloud.length ? cloud.reduce(function (a, b) { return a + b; }, 0) / cloud.length : null });
    });
    if (!models.length) return null;
    var avg = function (f) { var v = models.map(f).filter(function (x) { return x !== null; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; };
    var per = { overnight: 0, morning: avg(function (m) { return m.per.morning; }), afternoon: avg(function (m) { return m.per.afternoon; }), evening: avg(function (m) { return m.per.evening; }) };
    return {
      chance: Math.round(100 * models.filter(function (m) { return m.rain >= 0.25; }).length / models.length / 10) * 10,
      amount: avg(function (m) { return m.rain; }) / 25.4,
      cloud: avg(function (m) { return m.cloud; }),
      periods: per
    };
  }
  function applyRestOfToday(o, hc, date) {
    if (!o || !o.today) return o;
    var r = restOfToday(hc, date);
    if (!r) return o;
    if (r.chance < 20 && r.amount < 0.025) {
      var c = r.cloud === null ? 50 : r.cloud;
      o.pop = ''; o.amount = '';
      o.iconCode = c < 30 ? 1 : c < 70 ? 2 : 3;
      o.condition = c < 30 ? 'Mostly sunny' : c < 70 ? 'Partly cloudy' : 'Cloudy';
    } else {
      o.pop = Math.max(20, r.chance) + '%';
      o.amount = r.amount < 0.025 ? '<0.05″' : (Math.round(r.amount / 0.05) * 0.05).toFixed(2) + '″';
      o.iconCode = r.chance >= 60 ? 61 : 80;
      o.condition = timedCondition(r.chance >= 60 ? 'Rain' : r.chance >= 30 ? 'Chance of rain' : 'Slight chance of rain', timingPrefix(r.periods));
    }
    return o;
  }
  // Fold the timing into a rain condition: 'Rain' → 'AM Rain', 'Chance of Rain' → 'PM Showers'.
  function timedCondition(cond, prefix) {
    if (!prefix) return cond;
    var c = String(cond);
    if (/slight chance/i.test(c)) return c;
    if (/heavy rain/i.test(c)) return prefix + ' Heavy Rain';
    if (/^rain$|rain likely/i.test(c)) return prefix + ' Rain';
    if (/chance of (rain|showers)|^showers?$/i.test(c)) return prefix + ' Showers';
    if (/drizzle/i.test(c)) return prefix + ' Drizzle';
    if (/thunder/i.test(c)) return prefix + ' Storms';
    return c;
  }

  window.DWL = { tempColor: tempColor, icon: icon, iconName: iconName, dayCard: dayCard, fetchAlerts: fetchAlerts, collapseDays: collapseDays, resetDays: function (key) { delete expanded[key]; }, timingPrefix: timingPrefix, periodAmounts: periodAmounts, modelPeriodAmounts: modelPeriodAmounts, timedCondition: timedCondition, applyRestOfToday: applyRestOfToday, restOfToday: restOfToday,
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
