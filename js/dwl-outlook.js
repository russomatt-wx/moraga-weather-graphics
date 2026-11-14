/* Diablo Weather Lab — 72-hour outlook writer.
   Builds a 3–4 sentence synopsis for one location from:
     • the latest NWS Bay Area (MTR) Area Forecast Discussion: key messages, short/long term, and
     • that location's hourly model guidance (rain, wind gusts, weather codes) and blended daily temps.
   High-impact weather leads. Local numbers always come from model data; the NWS discussion supplies
   the meteorological "why" (fronts, systems) and forward-looking highlights. Never invents values. */
(function (root) {
  'use strict';

  var DAY_PARTS = ['overnight', 'morning', 'afternoon', 'evening']; // 0-6, 6-12, 12-18, 18-24

  /* ---------- NWS discussion ---------- */
  function parseAfd(text) {
    var out = { key: [], short: '', long: '', wwa: '' };
    if (!text) return out;
    var re = /^\.([A-Z][A-Z \/]+?)\.\.\.[^\n]*\n([\s\S]*?)(?=^\s*&&|^\.[A-Z][A-Z \/]+?\.\.\.|\$\$)/gm, m;
    while ((m = re.exec(text))) {
      var name = m[1].trim(), body = m[2].replace(/^(Updated|Issued) at [^\n]*\n/i, '').replace(/^\([^)]*\)\s*\n/, '');
      if (/KEY MESSAGES/.test(name)) {
        out.key = body.split(/\n\s*-\s+/).map(clean).filter(function (s) { return s.length > 8; });
      } else if (/SHORT TERM|SYNOPSIS|DISCUSSION/.test(name)) out.short += ' ' + clean(body);
      else if (/LONG TERM/.test(name)) out.long += ' ' + clean(body);
      else if (/WATCHES\/WARNINGS/.test(name)) out.wwa = body;
    }
    return out;
  }
  function clean(s) { return String(s || '').replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').trim(); }
  function sentences(s) { return (String(s || '').match(/[^.!?]+[.!?]+/g) || []).map(clean); }

  // Find what the NWS says is driving rain on a given weekday ("a second cold front", "an atmospheric river").
  function causeFor(afd, dayName, isNow) {
    var text = afd ? afd.short + ' ' + afd.long : '';
    if (!text) return '';
    var pool = sentences(text);
    if (isNow) {
      if (/post[- ]frontal/i.test(text)) return 'post-frontal';
      return '';
    }
    for (var i = 0; i < pool.length; i++) {
      var s = pool[i];
      if (dayName && s.indexOf(dayName) === -1) continue;
      var m = s.match(/\b(?:a |an |the )?(second|third|another|next|stronger|weaker|weak|strong)?\s*(cold front|warm front|atmospheric river|frontal system|storm system|upper[- ]level low|cutoff low|trough)\b/i);
      if (m) {
        var adj = (m[1] || '').toLowerCase(), kind = m[2].toLowerCase().replace(/upper level/, 'upper-level');
        var phrase = (adj ? adj + ' ' : '') + kind;
        return (/^[aeiou]/.test(phrase) ? 'an ' : 'a ') + phrase;
      }
    }
    return '';
  }

  // Inland-relevant, forward-looking NWS key message not already covered locally.
  function nwsHighlight(afd) {
    if (!afd) return '';
    var skip = /coast|beach|surf|tide|marine|waves|harbor|bay waters|through this (?:afternoon|evening)|today/i;
    var keys = afd.key.filter(function (k) { return !skip.test(k); });
    var extra = /landslide|soil saturation|saturat/i.test(afd.long) ? ' as soils saturate and the risk of shallow landslides rises' : '';
    var pick = keys.find(function (k) { return /next week|continue|through|weekend|pattern|later/i.test(k); }) || keys[keys.length - 1];
    if (!pick) return '';
    pick = pick.replace(/\.$/, '');
    pick = pick.charAt(0).toLowerCase() + pick.slice(1);
    return 'NWS: ' + pick + (extra ? ', with rising concern for saturated soils and landslides' : '') + '.';
  }

  /* ---------- Local model timeline ---------- */
  function localNowParts(now) {
    var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    var g = function (k) { return (p.find(function (x) { return x.type === k; }) || {}).value; };
    return { date: g('year') + '-' + g('month') + '-' + g('day'), hour: Number(g('hour')) };
  }
  function weekday(date) { return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }); }
  function addDays(date, n) { var d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  // 6-hour blocks for the next 72 hours, labelled the way a forecaster would say them.
  function blocks(h, nowParts) {
    var stamp = nowParts.date + 'T' + String(nowParts.hour).padStart(2, '0') + ':00';
    var rows = (h && h.time || []).map(function (t, i) {
      return { t: t, rain: num(h.precipitation, i), pop: num(h.precipitation_probability, i), gust: num(h.wind_gusts_10m, i), code: num(h.weather_code, i), temp: num(h.temperature_2m, i) };
    }).filter(function (r) { return r.t >= stamp; }).slice(0, 72);
    var map = {}, order = [];
    rows.forEach(function (r) {
      var date = r.t.slice(0, 10), hr = Number(r.t.slice(11, 13)), part = Math.floor(hr / 6);
      // Overnight hours belong to the previous evening's "night".
      var labelDate = part === 0 ? addDays(date, -1) : date;
      var key = date + '|' + part;
      if (!map[key]) { map[key] = { date: date, labelDate: labelDate, part: part, rain: 0, pop: 0, gust: 0, thunder: false, hours: 0 }; order.push(key); }
      var b = map[key];
      b.rain += Math.max(0, r.rain || 0); b.pop = Math.max(b.pop, r.pop || 0); b.gust = Math.max(b.gust, r.gust || 0);
      b.thunder = b.thunder || r.code >= 95; b.hours++;
    });
    var today = nowParts.date, tomorrow = addDays(today, 1);
    return order.map(function (k) {
      var b = map[k];
      b.wet = b.rain >= 0.03 || (b.pop >= 50 && b.rain >= 0.01);
      b.label = blockLabel(b, today);
      b.dayName = weekday(b.labelDate);
      b.isNow = b === map[order[0]];
      return b;
    });
  }
  function blockLabel(b, today) {
    if (b.part === 0 && b.date === today) return 'early this morning';
    if (b.labelDate === today) return b.part === 0 ? 'overnight' : 'this ' + DAY_PARTS[b.part];
    var name = weekday(b.labelDate);
    return name + ' ' + (b.part === 0 ? 'night' : DAY_PARTS[b.part]);
  }
  function num(a, i) { var v = a ? Number(a[i]) : NaN; return Number.isFinite(v) ? v : null; }

  // Merge consecutive wet/dry blocks into runs and describe their span.
  function runs(bs) {
    var out = [];
    bs.forEach(function (b) {
      var last = out[out.length - 1];
      if (last && last.wet === b.wet) { last.blocks.push(b); last.rain += b.rain; last.gust = Math.max(last.gust, b.gust); last.thunder = last.thunder || b.thunder; }
      else out.push({ wet: b.wet, blocks: [b], rain: b.rain, gust: b.gust, thunder: b.thunder });
    });
    // Fold tiny dry gaps (≤6 h) between wet runs into the surrounding rain.
    for (var i = 1; i < out.length - 1; i++) {
      if (!out[i].wet && out[i].blocks.length === 1 && out[i - 1].wet && out[i + 1].wet) {
        var a = out[i - 1], c = out[i + 1];
        a.blocks = a.blocks.concat(out[i].blocks, c.blocks); a.rain += c.rain; a.gust = Math.max(a.gust, c.gust); a.thunder = a.thunder || c.thunder;
        out.splice(i, 2); i--;
      }
    }
    out.forEach(function (r) { r.span = span(r.blocks); r.start = r.blocks[0]; });
    return out;
  }
  function span(bl) {
    var first = bl[0], last = bl[bl.length - 1];
    if (first === last) return first.label;
    var full = {};
    bl.forEach(function (b) { if (b.part !== 0) full[b.labelDate] = (full[b.labelDate] || 0) + 1; });
    var dates = Object.keys(full).sort();
    // A whole future day (morning, afternoon, evening) reads best as just the weekday.
    if (dates.length === 1 && full[dates[0]] === 3 && !/^this|^overnight|^early/.test(first.label)) return weekday(dates[0]);
    if (first.labelDate === last.labelDate && first.part !== 0) {
      var tail = last.part === 0 ? 'night' : DAY_PARTS[last.part];
      var head = first.label;
      return head + ' and ' + (/^this /.test(head) && tail === 'evening' ? 'evening' : tail === 'night' && /^this /.test(head) ? 'tonight' : tail);
    }
    return first.label + ' into ' + last.label;
  }
  // When does a dry stretch "feel" like: a named day if it covers one, else its start.
  function dryName(r) {
    var full = {};
    r.blocks.forEach(function (b) { if (b.part !== 0) full[b.labelDate] = (full[b.labelDate] || 0) + 1; });
    var day = Object.keys(full).sort().find(function (d) { return full[d] === 3; });
    return day ? weekday(day) : r.start.label;
  }
  function startDay(r) {
    var b = r.blocks.find(function (x) { return x.part !== 0; }) || r.start;
    return /^this|^overnight|^early/.test(b.label) ? b.label : weekday(b.labelDate);
  }

  function inches(v) {
    if (v < 0.05) return 'a few hundredths of an inch';
    if (v < 0.095) return 'under a tenth of an inch';
    return 'about ' + v.toFixed(2) + '″';
  }
  function rainWord(r) {
    if (r.thunder) return r.rain >= 0.3 ? 'heavy rain and a chance of thunder' : 'showers and a chance of thunder';
    if (r.rain >= 0.75) return 'heavy rain';
    if (r.rain >= 0.3) return 'a soaking rain';
    if (r.rain >= 0.1) return 'steady rain';
    return 'a few light showers';
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- Sentences ---------- */
  function storySentence(rs, afd) {
    if (!rs.length) return '';
    var wet = rs.filter(function (r) { return r.wet; });
    var main = wet.reduce(function (a, r) { return !a || r.rain > a.rain ? r : a; }, null);
    if (!main) return 'Dry weather holds for the next three days';
    if (main.rain < 0.05) return 'Mostly dry, with just a few light showers ' + main.span;
    var i = rs.indexOf(main), before = rs[i - 1], after = rs[i + 1];
    var ongoing = main.start.isNow;
    var cause = causeFor(afd, main.start.dayName, ongoing);
    var day = startDay(main);
    var lead = '';
    if (main.thunder) lead = 'Stormy ' + day + ': ';
    else if (/second|third|another/.test(cause)) lead = (/third/.test(cause) ? 'Round three' : 'Round two') + ' arrives ' + day + ': ';
    else if (main.rain >= 0.75 && !ongoing) lead = 'A soaker is on the way: ';
    var core;
    var amt = amountOf(main.rain);
    if (ongoing) {
      var what = main.rain >= 0.75 ? 'heavy rain continues' : main.rain >= 0.3 ? 'rain continues' : cause === 'post-frontal' ? 'post-frontal showers continue' : 'showers continue';
      core = what + ' ' + until(main) + ', adding ' + amt;
    } else if (cause && cause !== 'post-frontal') {
      core = cause + ' brings ' + amt + ' of ' + rainWord(main).replace(/^a /, '') + ' ' + main.span;
    } else {
      core = amt + ' of ' + rainWord(main).replace(/^a /, '') + ' falls ' + main.span;
    }
    var pre = (!ongoing && before && !before.wet) ? 'after a dry ' + dryName(before) + ', ' : '';
    var post = after && !after.wet ? ', clearing by ' + (startDay(after) === day ? after.start.label.replace(day + ' ', '') : startDay(after)) : '';
    var body = pre + core + post;
    return lead ? lead + body : cap(body);
  }
  function amountOf(v) { return v < 0.095 ? 'a few hundredths of an inch' : 'about ' + v.toFixed(2) + '″'; }
  function until(r) {
    var last = r.blocks[r.blocks.length - 1];
    return 'through ' + (last.label === 'overnight' ? 'tonight' : last.label);
  }

  function amountSentence(rs, place) {
    var wet = rs.filter(function (r) { return r.wet; });
    var total = rs.reduce(function (s, r) { return s + r.rain; }, 0);
    var main = wet.reduce(function (a, r) { return !a || r.rain > a.rain ? r : a; }, null);
    var gust = Math.max.apply(null, rs.map(function (r) { return r.gust; }).concat([0]));
    var bits = [];
    if (main && main.rain >= 0.05 && total - main.rain >= 0.1) bits.push(place + ' totals about ' + total.toFixed(2) + '″ over the 72 hours');
    else if (main && main.rain >= 0.05) bits.push('That is about ' + main.rain.toFixed(2) + '″ for ' + place);
    if (gust >= 25) {
      var peak = null;
      rs.forEach(function (r) { r.blocks.forEach(function (b) { if (!peak || b.gust > peak.gust) peak = b; }); });
      var g = Math.round(gust / 5) * 5;
      var w = (gust >= 45 ? 'damaging gusts near ' : gust >= 35 ? 'strong gusts to ' : 'gusts to ') + g + ' mph';
      return bits.length && bits[0].indexOf('totals') > 0 ? bits[0] + ', with ' + w + ' ' + peak.label : cap(w) + ' are possible ' + peak.label;
    }
    return bits.length && bits[0].indexOf('totals') > 0 ? bits[0] : '';
  }
  function possessive(d) { return /^this |^overnight|^early/.test(d) ? d.replace(/^this /, "this ") + "'s" : d + "'s"; }

  function tempSentence(daily, nowParts) {
    if (!daily || !daily.time) return '';
    var idx = [];
    daily.time.forEach(function (t, i) { if (t >= nowParts.date && idx.length < 3) idx.push(i); });
    var lows = idx.map(function (i) { return { v: Number(daily.temperature_2m_min[i]), i: i }; }).filter(function (x) { return Number.isFinite(x.v); });
    var highs = idx.map(function (i) { return Number(daily.temperature_2m_max[i]); }).filter(Number.isFinite);
    if (!lows.length || !highs.length) return '';
    // Skip today's low once the morning is over: it has already happened.
    var future = lows.filter(function (x) { return !(daily.time[x.i] === nowParts.date && nowParts.hour >= 9); });
    var coldest = (future.length ? future : lows).reduce(function (a, b) { return b.v < a.v ? b : a; });
    var morning = daily.time[coldest.i] === nowParts.date ? 'this morning' : weekday(daily.time[coldest.i]) + ' morning';
    var lo = Math.round(coldest.v), hiMin = Math.round(Math.min.apply(null, highs)), hiMax = Math.round(Math.max.apply(null, highs));
    var band = function (v) { var d = v % 10; return (d <= 3 ? 'low ' : d <= 6 ? 'mid ' : 'upper ') + (v - d) + 's'; };
    var highTxt = hiMax - hiMin <= 4 ? 'in the ' + band(Math.round((hiMin + hiMax) / 2)) : 'between ' + hiMin + '° and ' + hiMax + '°';
    if (lo <= 32) return 'A hard freeze is possible ' + morning + ' with lows near ' + lo + '°, and afternoons only reach ' + highTxt.replace(/^in the /, 'the ');
    if (lo <= 36) return 'Frost is possible ' + morning + ' as lows dip to ' + lo + '°, while afternoons stay ' + highTxt;
    if (hiMax >= 95) return 'Heat builds with highs up to ' + hiMax + '°, and nights only cool to the ' + band(lo);
    if (lo <= 42) return 'Mornings turn chilly, with lows near ' + lo + '° ' + morning + ', while afternoons stay ' + highTxt;
    return 'Highs ' + highTxt + ', lows near ' + lo + '° ' + morning;
  }

  /* ---------- Public API ---------- */
  function build(opts) {
    var now = opts.now || new Date();
    var nowParts = localNowParts(now);
    var afd = opts.afdText ? parseAfd(opts.afdText) : null;
    if (afd && !afd.short && !afd.long && !afd.key.length) afd = null;
    var rs = runs(blocks(opts.hourly, nowParts));
    var out = [storySentence(rs, afd), amountSentence(rs, opts.place || 'Moraga'), tempSentence(opts.daily, nowParts), nwsHighlight(afd)]
      .filter(Boolean).map(function (s) { return /[.!?]$/.test(s) ? s : s + '.'; });
    var issued = opts.issued ? new Date(opts.issued).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) : '';
    return {
      text: out.join(' '),
      source: afd ? 'Based on the NWS Bay Area forecast discussion (' + issued + ') and local model guidance' : 'Local model guidance · NWS discussion not available'
    };
  }

  root.DWLOutlook = { build: build, parseAfd: parseAfd };
})(typeof window !== 'undefined' ? window : globalThis);
