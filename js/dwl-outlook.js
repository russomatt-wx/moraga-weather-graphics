/* Diablo Weather Lab — 72-hour outlook writer.
   Builds a headline and a short, lively forecast story (next 72 hours, then the 10-day horizon) from:
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
    return 'Looking ahead, the National Weather Service says ' + pick + (extra ? ", and they're keeping an eye on soggy hillsides for mudslides" : '') + '.';
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
      return { t: t, rain: num(h.precipitation, i), pop: num(h.precipitation_probability, i), gust: num(h.wind_gusts_10m, i), code: num(h.weather_code, i), temp: num(h.temperature_2m, i), cloud: num(h.cloud_cover, i) };
    }).filter(function (r) { return r.t >= stamp; }).slice(0, 72);
    var map = {}, order = [];
    rows.forEach(function (r) {
      var date = r.t.slice(0, 10), hr = Number(r.t.slice(11, 13)), part = Math.floor(hr / 6);
      // Overnight hours belong to the previous evening's "night".
      var labelDate = part === 0 ? addDays(date, -1) : date;
      var key = date + '|' + part;
      if (!map[key]) { map[key] = { date: date, labelDate: labelDate, part: part, rain: 0, pop: 0, gust: 0, thunder: false, hours: 0, cloudSum: 0, cloudN: 0 }; order.push(key); }
      var b = map[key];
      b.rain += Math.max(0, r.rain || 0); b.pop = Math.max(b.pop, r.pop || 0); b.gust = Math.max(b.gust, r.gust || 0);
      b.thunder = b.thunder || r.code >= 95; b.hours++;
      if (r.cloud !== null) { b.cloudSum += r.cloud; b.cloudN++; }
    });
    var today = nowParts.date, tomorrow = addDays(today, 1);
    return order.map(function (k) {
      var b = map[k];
      b.wet = b.rain >= 0.03 || (b.pop >= 50 && b.rain >= 0.01);
      b.cloud = b.cloudN ? b.cloudSum / b.cloudN : null;
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

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- Plain-language building blocks ---------- */
  function amountWords(v) {
    if (v < 0.08) return 'a few hundredths of an inch';
    if (v < 0.15) return 'around a tenth of an inch';
    if (v < 0.3) return 'about a quarter inch';
    if (v < 0.42) return 'about a third of an inch';
    if (v < 0.65) return 'around half an inch';
    if (v < 0.9) return 'close to three-quarters of an inch';
    if (v < 1.25) return 'around an inch';
    if (v < 1.75) return 'an inch to an inch and a half';
    var half = Math.round(v * 2) / 2, whole = Math.floor(half);
    return 'about ' + whole + (half > whole ? '½' : '') + ' inches';
  }
  function rainType(r) {
    if (r.thunder) return 'rain and a few thunderstorms';
    if (r.rain >= 0.75) return 'heavy rain';
    if (r.rain >= 0.3) return 'a good soaking';
    if (r.rain >= 0.1) return 'steady rain';
    return 'a few showers';
  }
  function tip(r, gust) {
    var t = [];
    if (r && r.thunder) t.push('if you hear thunder, head indoors');
    else if (r && r.rain >= 0.75) t.push('watch for ponding on roads and give yourself extra time');
    else if (r && r.rain >= 0.25) t.push('plan on wet roads and keep the umbrella handy');
    else if (r && r.rain >= 0.1) t.push('keep the umbrella handy');
    if (gust >= 35) t.push('secure anything loose outdoors');
    return t.join(', and ');
  }
  // Average daytime cloud cover of a set of blocks → words people use.
  function sky(bl) {
    var day = bl.filter(function (b) { return (b.part === 1 || b.part === 2) && b.cloud !== null; });
    var use = day.length ? day : bl.filter(function (b) { return b.cloud !== null; });
    if (!use.length) return '';
    var c = use.reduce(function (s, b) { return s + b.cloud; }, 0) / use.length, night = !day.length;
    if (c < 25) return night ? 'clear skies' : 'plenty of sunshine';
    if (c < 50) return night ? 'mostly clear skies' : 'mostly sunny skies';
    if (c < 75) return night ? 'partly cloudy skies' : 'a mix of sun and clouds';
    return 'mostly cloudy skies';
  }
  function until(r) {
    var last = r.blocks[r.blocks.length - 1];
    return 'through ' + (last.label === 'overnight' ? 'tonight' : last.label);
  }
  function maxGust(rs) {
    var peak = null;
    rs.forEach(function (r) { r.blocks.forEach(function (b) { if (!peak || b.gust > peak.gust) peak = b; }); });
    return peak || { gust: 0, label: '' };
  }

  /* ---------- The story, told like a TV forecast ---------- */
  function story(rs, afd, place) {
    var out = [], closing = '';
    var wet = rs.filter(function (r) { return r.wet; });
    var main = wet.reduce(function (a, r) { return !a || r.rain > a.rain ? r : a; }, null);
    var peak = maxGust(rs), windy = peak.gust >= 35, g = Math.round(peak.gust / 5) * 5;
    var windBit = windy ? ', plus gusty winds up to ' + g + ' mph' : '';

    if (!main || main.rain < 0.05) {
      // Quiet stretch: describe the days.
      var days = {}, order = [];
      rs.forEach(function (r) { r.blocks.forEach(function (b) { if (b.part === 1 || b.part === 2) { if (!days[b.labelDate]) { days[b.labelDate] = []; order.push(b.labelDate); } days[b.labelDate].push(b); } }); });
      var desc = order.slice(0, 3).map(function (d) { return { sky: sky(days[d]), day: d === order[0] && d === rs[0].start.labelDate && rs[0].start.label.indexOf('this') === 0 ? 'today' : weekday(d) }; }).filter(function (x) { return x.sky; });
      var merged = [];
      desc.forEach(function (x) { var last = merged[merged.length - 1]; if (last && last.sky === x.sky) last.days.push(x.day); else merged.push({ sky: x.sky, days: [x.day] }); });
      var phrase = merged.map(function (m) { return m.sky + ' ' + (m.days.length > 1 ? m.days[0] + ' through ' + m.days[m.days.length - 1] : m.days[0]); }).join(', then ');
      var lead = main ? 'Mostly dry weather is on tap, with just a stray shower ' + main.span : 'Quiet weather is on tap';
      out.push(lead + (phrase ? (main ? '. Expect ' : ': expect ') + phrase : '') + windBit + (windy ? ' — ' + tip(null, peak.gust) : ''));
      return { sentences: out, closing: closing };
    }

    var i = rs.indexOf(main), before = rs[i - 1], after = rs[i + 1], next = rs.slice(i + 2).find(function (r) { return r.wet && r.rain >= 0.1; });
    var cause = causeFor(afd, main.start.dayName, main.start.isNow);
    var day = startDay(main), amt = amountWords(main.rain), t = tip(main, peak.gust);

    if (main.start.isNow) {
      var verb = main.thunder ? 'Storms keep rolling in' : main.rain >= 0.75 ? 'Heavy rain keeps coming down' : main.rain >= 0.3 ? 'The rain sticks around' : 'Showers hang around';
      out.push(verb + ' ' + until(main) + ', adding ' + amt + ' for ' + place + windBit + (t ? ' — ' + t : ''));
      if (after && !after.wet) closing = 'We dry out ' + startDay(after) + (sky(after.blocks) ? ' with ' + sky(after.blocks) : '');
      if (next) { out.push((closing ? closing + ' before another round of rain arrives ' : 'Another round of rain arrives ') + startDay(next)); closing = ''; }
    } else {
      var round = /third/.test(cause) ? 'round three' : /second|another/.test(cause) ? 'round two' : '';
      var coming = main.thunder ? 'storms are on the way' : round ? round + ' is on the way' : 'rain is on the way';
      if (before && !before.wet) {
        var dn = dryName(before), bsky = sky(before.blocks);
        if (/day$/.test(dn)) out.push('Enjoy a dry ' + dn + (bsky ? ' with ' + bsky : '') + ', because ' + coming);
      }
      var who = cause && cause !== 'post-frontal' ? cap(cause) + ' sweeps in ' + main.span + ' with ' + rainType(main) : cap(rainType(main)) + ' moves in ' + main.span;
      out.push(who + ', bringing ' + amt + ' to ' + place + windBit + (t ? ' — ' + t : ''));
      if (after && !after.wet) closing = 'Skies clear out ' + startDay(after);
      if (next) { out.push((closing ? closing + ' before another round arrives ' : 'Another round arrives ') + startDay(next)); closing = ''; }
    }
    return { sentences: out, closing: closing };
  }

  function tempSentence(daily, nowParts, closing) {
    if (!daily || !daily.time) return closing;
    var idx = [];
    daily.time.forEach(function (t, i) { if (t >= nowParts.date && idx.length < 3) idx.push(i); });
    var lows = idx.map(function (i) { return { v: Number(daily.temperature_2m_min[i]), i: i }; }).filter(function (x) { return Number.isFinite(x.v); });
    var highs = idx.map(function (i) { return Number(daily.temperature_2m_max[i]); }).filter(Number.isFinite);
    if (!lows.length || !highs.length) return closing;
    // Skip today's low once the morning is over: it has already happened.
    var future = lows.filter(function (x) { return !(daily.time[x.i] === nowParts.date && nowParts.hour >= 9); });
    var coldest = (future.length ? future : lows).reduce(function (a, b) { return b.v < a.v ? b : a; });
    var morning = daily.time[coldest.i] === nowParts.date ? 'this morning' : weekday(daily.time[coldest.i]) + ' morning';
    var lo = Math.round(coldest.v), hiMin = Math.round(Math.min.apply(null, highs)), hiMax = Math.round(Math.max.apply(null, highs));
    var band = function (v) { var d = ((v % 10) + 10) % 10; return (d <= 3 ? 'low ' : d <= 6 ? 'mid ' : 'upper ') + (v - d) + 's'; };
    var highTxt = hiMax - hiMin <= 4 ? 'in the ' + band(Math.round((hiMin + hiMax) / 2)) : 'from the ' + band(hiMin) + ' to the ' + band(hiMax);
    var lead = closing ? closing + ', ' : '';
    if (lo <= 32) return (closing ? closing + '. ' : '') + 'Bundle up — a hard freeze is possible ' + morning + ' with lows near ' + lo + '°, so protect pipes, pets and plants';
    if (lo <= 36) return (closing ? closing + '. ' : '') + 'Bundle up ' + morning + ': lows near ' + lo + '° could bring patchy frost, so cover sensitive plants';
    if (hiMax >= 95) return (closing ? closing + '. ' : '') + 'It turns hot, with highs up to ' + hiMax + '° — stay hydrated and take it easy in the afternoon';
    if (hiMax <= 62 || lo <= 45) return lead + (closing ? 'but ' : '') + (closing ? 'it' : 'It') + ' stays cool, with highs ' + highTxt + ' and a chilly start ' + morning + ' in the ' + band(lo);
    return lead + (closing ? 'and ' : '') + (closing ? 'temperatures' : 'Temperatures') + ' stay comfortable, with highs ' + highTxt + ' and lows in the ' + band(lo);
  }

  /* ---------- Beyond 72 hours: what the models show through day 10 ---------- */
  function dayIdx(daily, nowParts) {
    var t = daily && daily.time || [], start = t.indexOf(nowParts.date);
    return start < 0 ? 0 : start;
  }
  function dayName(daily, i, i0) {
    var w = weekday(daily.time[i]);
    return i - i0 >= 7 ? 'next ' + w : w;
  }
  function horizon(daily, nowParts, place) {
    if (!daily || !daily.time) return { text: '', total10: 0, bigLater: null, frost: false };
    var i0 = dayIdx(daily, nowParts), n = Math.min(daily.time.length, i0 + 10);
    var amt = function (i) { var v = Number(daily.precipitation_sum && daily.precipitation_sum[i]); return Number.isFinite(v) ? v : 0; };
    var pop = function (i) { var v = Number(daily.precipitation_probability_max && daily.precipitation_probability_max[i]); return Number.isFinite(v) ? v : 0; };
    var total10 = 0; for (var k = i0; k < n; k++) total10 += amt(k);
    // Wet-day runs after the first 72 hours.
    var runsL = [], cur = null;
    for (var i = i0 + 3; i < n; i++) {
      var wet = pop(i) >= 50 && amt(i) >= 0.15;
      if (wet) { if (!cur) { cur = { a: i, b: i, total: 0 }; runsL.push(cur); } cur.b = i; cur.total += amt(i); } else cur = null;
    }
    var big = runsL.reduce(function (x, r) { return !x || r.total > x.total ? r : x; }, null);
    var parts = [];
    var range = function (r) { return r.a === r.b ? dayName(daily, r.a, i0) : dayName(daily, r.a, i0) + ' into ' + weekday(daily.time[r.b]); };
    if (big) {
      var label = big.total >= 2 ? 'a potent storm' : big.total >= 1 ? 'a stronger storm' : big.total >= 0.5 ? 'another solid round of rain' : 'more showers';
      parts.push('the models are lining up ' + label + ' for ' + range(big) + ', with ' + amountWords(big.total) + ' possible');
      // A dry spell after it?
      var dry = 0, j = big.b + 1; while (j < n && amt(j) < 0.05) { dry++; j++; }
      if (dry >= 3) parts[parts.length - 1] += ', before things dry out ' + (big.b + 1 - i0 >= 7 ? 'next ' : '') + weekday(daily.time[big.b + 1]);
    } else {
      var anyLater = false; for (var q = i0 + 3; q < n; q++) if (amt(q) >= 0.05 && pop(q) >= 40) anyLater = true;
      parts.push(anyLater ? 'the models show only light, hit-or-miss showers' : 'the models keep things dry right through ' + dayName(daily, n - 1, i0));
    }
    // Temperature trend and cold mornings later in the period.
    var hi = function (i) { return Number(daily.temperature_2m_max[i]); }, lo = function (i) { return Number(daily.temperature_2m_min[i]); };
    var avg = function (a, b, f) { var v = [], m; for (m = a; m < b; m++) if (Number.isFinite(f(m))) v.push(f(m)); return v.length ? v.reduce(function (x, y) { return x + y; }, 0) / v.length : NaN; };
    var near = avg(i0, i0 + 3, hi), later = avg(i0 + 3, n, hi), trend = '';
    if (later - near >= 6) trend = 'a nice warm-up';
    else if (near - later >= 6) trend = 'colder air settling in';
    var coldest = null; for (var c = i0 + 3; c < n; c++) if (Number.isFinite(lo(c)) && (!coldest || lo(c) < coldest.v)) coldest = { v: lo(c), i: c };
    var frost = coldest && coldest.v <= 36;
    if (frost) trend = (trend ? trend + ' and ' : '') + 'frosty mornings near ' + Math.round(coldest.v) + '° by ' + dayName(daily, coldest.i, i0);
    var text = 'Looking further out, ' + parts.join(' ') + (trend ? (big ? ', along with ' : ', with ') + trend : '');
    if (total10 >= 1) text += '. All told, ' + place + ' could pick up ' + amountWords(total10).replace(/^around /, 'about ') + ' over the next 10 days';
    return { text: text, total10: total10, bigLater: big, frost: frost };
  }

  /* ---------- What the NWS forecasters are talking about, in plain English ---------- */
  var INSIGHTS = [
    [/landslide|mudslide|debris flow/i, "soggy hillsides could see mudslides"],
    [/soil(?:s)? (?:saturat|are saturat)|saturated soil|soil saturation/i, "soils are getting saturated, so each storm runs off faster"],
    [/power outage|downed trees|down(?:ed)? (?:trees|branches)/i, "gusty winds could bring down branches and knock out power"],
    [/atmospheric river/i, "an atmospheric river is in the mix"],
    [/snowpack|sierra/i, "the Sierra is picking up a healthy dose of snow"],
    [/fire weather threat|fire season|reducing our fire|red flag/i, "the rain is great news for fire season"],
    [/freez|frost|cold weather (?:products|advisory)/i, "cold mornings could bring frost to the valleys"],
    [/thunderstorm|lightning|hail/i, "a few thunderstorms with lightning can't be ruled out"],
    [/above (?:the )?(?:seasonal )?(?:average|normal)|active pattern|pattern remains active/i, "the pattern looks active, with rain running above normal into late November"],
    [/heat advisory|excessive heat|record (?:high|heat)/i, "the heat could approach records"],
  ];
  function nwsInsight(afd, already) {
    if (!afd) return '';
    var text = afd.key.join(' . ') + ' ' + afd.short + ' ' + afd.long, got = [];
    INSIGHTS.forEach(function (x) { if (got.length < 2 && x[0].test(text) && !(already && already.test(x[1]))) got.push(x[1]); });
    if (!got.length) return '';
    var list = got.length === 1 ? got[0] : got[0] + ', and ' + got[1];
    return 'The National Weather Service notes that ' + list;
  }

  function headline(rs, hz, daily, nowParts, region) {
    var wet72 = rs.filter(function (r) { return r.wet; }).reduce(function (s, r) { return s + r.rain; }, 0);
    var thunder = rs.some(function (r) { return r.thunder; });
    var hiMax = -99, i0 = daily && daily.time ? dayIdx(daily, nowParts) : 0;
    if (daily && daily.time) for (var i = i0; i < Math.min(daily.time.length, i0 + 10); i++) hiMax = Math.max(hiMax, Number(daily.temperature_2m_max[i]) || -99);
    if (thunder) return 'Thunder is in the forecast';
    if (hz.bigLater && hz.bigLater.total >= 1 && hz.bigLater.total > wet72) return 'The biggest storm is still to come';
    if (hz.total10 >= 2) return 'A soggy stretch is setting up across ' + region;
    if (wet72 >= 0.5) return 'A wet few days ahead for ' + region;
    if (hiMax >= 95) return 'Heat is building across ' + region;
    if (hz.frost) return 'Frosty mornings are on the way';
    if (hz.total10 < 0.05) return 'Dry, quiet weather settles in';
    return '';
  }

  /* ---------- Public API ---------- */
  function build(opts) {
    var now = opts.now || new Date();
    var nowParts = localNowParts(now);
    var afd = opts.afdText ? parseAfd(opts.afdText) : null;
    if (afd && !afd.short && !afd.long && !afd.key.length) afd = null;
    var rs = runs(blocks(opts.hourly, nowParts));
    var place = opts.place || 'Moraga', region = opts.region || 'Lamorinda';
    var st = story(rs, afd, place);
    var hz = horizon(opts.daily, nowParts, place);
    var dot = function (x) { return /[.!?]$/.test(x) ? x : x + '.'; };
    var nearTerm = st.sentences.concat([tempSentence(opts.daily, nowParts, st.closing)]).filter(Boolean).map(dot);
    var farTerm = [hz.text, nwsInsight(afd, /mudslide|frost/.test(hz.text) ? /frost/ : null) || nwsHighlight(afd)].filter(Boolean).map(dot);
    var issued = opts.issued ? new Date(opts.issued).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) : '';
    return {
      headline: headline(rs, hz, opts.daily, nowParts, region),
      text: nearTerm.join(' ') + (farTerm.length ? '\n\n' + farTerm.join(' ') : ''),
      source: afd ? 'Based on the NWS Bay Area forecast discussion (' + issued + ') and local model guidance' : 'Local model guidance · NWS discussion not available'
    };
  }

  root.DWLOutlook = { build: build, parseAfd: parseAfd };
})(typeof window !== 'undefined' ? window : globalThis);
