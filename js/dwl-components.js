/* Diablo Weather Lab shared UI components.
   Both the Local Weather and Observatory views render forecast cards through
   these helpers, so the two views cannot drift apart. Styling lives in css/site.css. */
(function () {
  'use strict';

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
      '.png?v=3" alt="' + (isNight ? NIGHT_LABEL[name] : ICON_LABEL[name]) + '" width="72" height="54" decoding="async">';
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
      : '';
    return '<' + tag + ' class="dwl-day' + (o.cls ? ' ' + o.cls : '') + (o.today ? ' is-today' : '') + '" style="--hi:' + hi + ';--lo:' + lo + '">' +
      '<div class="dwl-day-when">' + (o.today ? '<span class="dwl-pill">Today</span>' : '') +
        '<strong>' + esc(o.day) + '</strong><span>' + esc(o.date) + '</span></div>' +
      '<div class="dwl-day-hi" aria-label="High">' + esc(o.highText) + '</div>' +
      '<div class="dwl-day-sky">' + icon(o.iconCode) +
        '<div class="dwl-day-cond">' + esc(o.condition) + '</div>' + rainLine + '</div>' +
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

  window.DWL = { tempColor: tempColor, icon: icon, iconName: iconName, dayCard: dayCard,
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
