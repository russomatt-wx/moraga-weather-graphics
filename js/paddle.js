/* Diablo Weather Lab — Paddle conditions page. Renders paddle_conditions.json (hourly workflow). */
(function () {
  'use strict';
  const AREAS = ['SF Coast', 'Marin', 'Peninsula Coast', 'SF Bay'];
  const LABEL = ['Go', 'Caution', 'No-go'];
  // Round status symbol (styled like the alert badges): check = Go, ! = Caution, X = No-go.
  const SYM = [
    '<path d="M6.5 12.5l3.6 3.6 7.4-8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M12 6.5v7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.5" fill="currentColor"/>',
    '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  ];
  const SVG = (p, vb) => '<svg viewBox="' + (vb || '0 0 24 24') + '" aria-hidden="true">' + p + '</svg>';
  const WAVE_P = '<path d="M2 9c3-3.5 6-3.5 9 0s6 3.5 9 0M2 16c3-3.5 6-3.5 9 0s6 3.5 9 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  const STAT_ICON = {
    'Wind mph': SVG('<path d="M3 8h10a2.6 2.6 0 1 0-2.6-2.6M3 12.5h15a2.6 2.6 0 1 1-2.6 2.6M3 17h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
    'Waves': SVG(WAVE_P), 'Chop (est.)': SVG(WAVE_P),
    'Current kt': SVG('<path d="M3 9h13M12 5l4 4-4 4M21 15H8M12 11l-4 4 4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'),
    'Water': SVG('<path d="M10 4.5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0Z" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 9v7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
    'Rain': SVG('<path d="M12 3.5c3.3 4.2 5.5 7.3 5.5 10a5.5 5.5 0 0 1-11 0c0-2.7 2.2-5.8 5.5-10Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'),
  };
  const sym = (r) => '<span class="pad-sym r' + r + '" role="img" aria-label="' + LABEL[r] + '" title="' + LABEL[r] + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + SYM[r] + '</svg></span>';
  // Alerts that matter on the water (a Flood Advisory for creeks does not).
  const MARINE = /craft|gale|storm|seas|surf|beach|rip current|coastal|tsunami|wind|marine|fog|sneaker/i;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const parse = (t) => { const [d, h] = t.replace(' ', 'T').split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mm] = h.split(':').map(Number); return new Date(y, m - 1, dd, hh, mm || 0); };
  // Local Pacific wall-clock "now" in the same naive form the feed uses.
  function pacificNow() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  const hour = (d) => { const h = d.getHours(); return (h % 12 || 12) + (h < 12 ? 'a' : 'p'); };
  const clock = (d) => { const h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' AM' : ' PM'); };
  function dayName(d, now) {
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()), b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const n = Math.round((a - b) / 864e5);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' });
  }
  // Rain chance shown at 20%+, rounded to 10% (same rule as the local forecast).
  const rainTxt = (b) => b.thunder ? '⚡ Storms' : (b.rain_pct != null && b.rain_pct >= 20 ? '💧 ' + Math.round(b.rain_pct / 10) * 10 + '%' : null);
  // Estimated wind chop for protected water (rounded to the half foot).
  const chopTxt = (b) => b.chop_ft == null ? (b.wind != null ? 'Calm' : '—') : b.chop_ft < .5 ? 'Under ½ ft' : '~' + (Math.round(b.chop_ft * 2) / 2) + ' ft';
  // Tidal current: + flood, - ebb (knots). Under 0.3 kt reads as slack.
  const currentTxt = (b) => b.current_kt == null ? null : Math.abs(b.current_kt) < 0.3 ? 'Slack' : (b.current_kt > 0 ? 'Flood ' : 'Ebb ') + Math.abs(b.current_kt).toFixed(1);
  const wind = (b) => (b.dir ? b.dir + ' ' : '') + (b.gust > b.wind + 2 ? b.wind + '–' + b.gust : b.wind) + ' mph';
  const waves = (b) => b.wave_ft == null ? null : b.wave_ft + ' ft' + (b.period_s ? ' @ ' + b.period_s + 's' : '') + (b.swell_dir ? ' ' + b.swell_dir : '');

  function current(spot, now) {
    // Latest 3-hour block that has started; falls back to the feed's "now".
    let cur = spot.now;
    for (const b of spot.blocks || []) if (parse(b.time) <= now) cur = b;
    return cur;
  }

  function bestText(spot, now) {
    const open = (spot.blocks || []).filter((x) => { const d = parse(x.time), h = d.getHours(); return d > now - 3 * 36e5 && h >= 7 && h <= 17; });
    const b = open.find((x) => x.rating === 0);
    if (b) { const d = parse(b.time); return 'Best window: ' + dayName(d, now) + ' from ' + clock(d) + ' · ' + wind(b) + (waves(b) ? ' · ' + waves(b) : ''); }
    const c = open.find((x) => x.rating === 1);
    if (c) { const d = parse(c.time); return 'No Go window in the next 3 days. Closest: Caution ' + dayName(d, now) + ' from ' + clock(d) + ' · ' + wind(c) + (waves(c) ? ' · ' + waves(c) : ''); }
    return 'No daylight Go or Caution window in the next 3 days.';
  }

  function timeline(spot, now) {
    const days = [];
    for (const b of spot.blocks || []) {
      const d = parse(b.time), key = d.toDateString();
      let g = days[days.length - 1];
      if (!g || g.key !== key) days.push(g = { key, d, items: [] });
      g.items.push(b);
    }
    return '<div class="pad-days">' + days.slice(0, 4).map((g) =>
      '<div class="pad-day"><div class="pad-day-name">' + esc(dayName(g.d, now)) + '</div><div class="pad-cells">' +
      g.items.map((b) => {
        const d = parse(b.time);
        return '<button type="button" style="grid-column:' + (Math.floor(d.getHours() / 3) + 1) + '" class="pad-cell r' + b.rating + '" data-detail="' + esc(dayName(d, now) + ' ' + clock(d) + ': ' + LABEL[b.rating] + ' · ' + b.why + ' · ' + wind(b) + (waves(b) ? ' · ' + waves(b) : '') + (currentTxt(b) ? ' · current ' + currentTxt(b) + (currentTxt(b) === 'Slack' ? '' : ' kt') : b.chop_ft != null ? ' · chop ' + chopTxt(b) : '') + (rainTxt(b) ? ' · ' + rainTxt(b) : '')) + '" aria-label="' + esc(clock(d) + ' ' + LABEL[b.rating]) + '"><span>' + hour(d) + '</span></button>';
      }).join('') + '</div></div>').join('') + '</div>';
  }

  function card(spot, now) {
    const c = current(spot, now);
    const tides = (spot.tides || []).filter((t) => parse(t.t) >= now).slice(0, 4)
      .map((t) => { const d = parse(t.t); return '<div class="pad-tide ' + (t.type === 'High' ? 'hi' : 'lo') + '"><span>' + (t.type === 'High' ? '▲ High' : '▼ Low') + '</span><b>' + clock(d) + '</b><small>' + (dayName(d, now) === 'Today' ? '' : d.toLocaleDateString('en-US', { weekday: 'short' }) + ' · ') + t.ft + ' ft</small></div>'; }).join('');
    const curEv = (spot.current_events || []).filter((e) => parse(e.t) >= now).slice(0, 4).map((e) => {
      const d = parse(e.t), slack = /slack/i.test(e.type) || Math.abs(e.kt) < 0.2;
      const label = slack ? '◦ Slack' : (e.kt > 0 ? '→ Flood' : '← Ebb');
      return '<div class="pad-tide ' + (slack ? 'lo' : 'hi') + '"><span>' + label + '</span><b>' + clock(d) + '</b><small>' + (dayName(d, now) === 'Today' ? '' : d.toLocaleDateString('en-US', { weekday: 'short' }) + ' · ') + (slack ? 'turning' : Math.abs(e.kt).toFixed(1) + ' kt') + '</small></div>';
    }).join('');
    const stats = [
      ['Wind mph', (c.dir ? c.dir + ' ' : '') + (c.gust > c.wind + 2 ? c.wind + '–' + c.gust : c.wind)],
      spot.kind === 'coast' ? ['Waves', c.wave_ft == null ? '—' : c.wave_ft + ' ft' + (c.period_s ? ' · ' + c.period_s + 's' : '')] : null,
      spot.kind === 'coast' ? null : (spot.current_src && c.current_kt != null ? ['Current kt', currentTxt(c)] : ['Chop (est.)', chopTxt(c)]),
      ['Water', spot.water_f != null ? spot.water_f + '°' : '—'],
      ['Rain', c.thunder ? 'Storms' : c.rain_pct != null ? Math.round(c.rain_pct / 10) * 10 + '%' : '—'],
    ].filter(Boolean).map(([k, v]) => '<div><span>' + (STAT_ICON[k] || '') + k.replace(' mph', ' <small>(mph)</small>').replace(' kt', ' <small>(kt)</small>').replace(' (est.)', ' <small>(est.)</small>') + '</span><b>' + esc(v) + '</b></div>').join('');
    const alerts = (spot.alerts || []).filter((x) => MARINE.test(x)).map((a) => '<span class="pad-alert ' + level(a) + '">⚠ ' + esc(a) + '</span>').join('');
    const nAlerts = (spot.alerts || []).filter((x) => MARINE.test(x));
    return '<details class="pad-card r' + c.rating + '" data-id="' + esc(spot.id) + '"' + (openCards.has(spot.id) ? ' open' : '') + '>' +
      '<summary><header><div><h3>' + esc(spot.city ? spot.name : spot.name.split(' · ').pop()) + '</h3><p class="pad-city">' + esc(spot.city || spot.name.split(' · ')[0]) + (c.air_f != null ? ' <span class="pad-temp-l">· ' + c.air_f + '° air</span>' : '') + '</p>' +
      (nAlerts.length ? '<p class="pad-brief-alert ' + level(nAlerts[0]) + '">⚠ ' + esc(nAlerts.join(' · ')) + '</p>' : '') + '</div>' +
      '<div class="pad-rate"><span class="pad-pill r' + c.rating + '">' + LABEL[c.rating] + '</span><small>' + esc(c.why) + '</small></div></header><div class="pad-stats">' + stats + '</div><span class="pad-more">' + SVG(WAVE_P) + '<span class="pad-more-open">Tides &amp; 3-day forecast</span><span class="pad-more-close">Hide details</span><i aria-hidden="true">⌄</i></span></summary>' +
      '<div class="pad-body"><p class="pad-kind">' + (spot.kind === 'coast' ? 'Open coast' : 'Protected water') + '</p>' +
      (spot.water_src ? '<p class="pad-water-src">Water temperature: ' + esc(spot.water_src.name) + (spot.water_src.miles != null ? ', ' + spot.water_src.miles + ' mi away' : '') + (spot.water_src.observed ? ' · read ' + clock(parse(spot.water_src.observed)) : '') + '</p>' : '') +
      (alerts ? '<div class="pad-alerts">' + alerts + '</div>' : '') +
      (tides ? '<h4 class="pad-sub-h">Tides</h4><div class="pad-tides">' + tides + '</div>' : '') +
      (curEv ? '<h4 class="pad-sub-h">Current <span>' + esc(spot.current_src.name) + ' · NOAA prediction</span></h4><div class="pad-tides pad-currents">' + curEv + '</div>' : '') +
      '<h4 class="pad-sub-h">Next 3 days <span>tap a block</span></h4>' + timeline(spot, now) +
      '<p class="pad-detail" aria-live="polite">' + esc(bestText(spot, now)) + '</p>' +
      '</div></details>';
  }

  const level = (ev) => /warning/i.test(ev) ? 'warning' : /statement/i.test(ev) ? 'statement' : 'advisory';
  const when = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  const ICON = '<svg viewBox="0 0 24 24"><path d="M12 3 22 20H2Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 9.5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.3" fill="currentColor"/></svg>';
  // One card per active marine alert, naming the spots it covers. Warnings first.
  function alertCards(spots) {
    const byEvent = new Map();
    for (const s of spots) {
      const list = (s.alert_details && s.alert_details.length) ? s.alert_details : (s.alerts || []).map((event) => ({ event }));
      for (const a of list) {
        if (!MARINE.test(a.event)) continue;
        const g = byEvent.get(a.event) || { ...a, spots: [] };
        if (a.ends && (!g.ends || a.ends > g.ends)) g.ends = a.ends;
        g.spots.push(s.city ? s.name : s.name.split(' · ')[0]);
        byEvent.set(a.event, g);
      }
    }
    const items = [...byEvent.values()].sort((a, b) => (level(a.event) === 'warning' ? 0 : 1) - (level(b.event) === 'warning' ? 0 : 1));
    if (!items.length) return '<p class="pad-noalerts">✓ No marine or surf alerts in effect for these spots.</p>';
    const warn = items.some((a) => level(a.event) === 'warning');
    const short = (ev) => ev.replace(/ (Advisory|Warning|Statement|Watch)$/i, '');
    const kind = warn ? 'Warning' : items.every((a) => /advisory/i.test(a.event)) ? 'Advisor' : 'Alert';
    const head = items.length + ' Active ' + (kind === 'Advisor' ? (items.length === 1 ? 'Advisory' : 'Advisories') : kind + (items.length === 1 ? '' : 's'));
    const now = Date.now();
    return '<div class="pad-alertlist">' + items.map((a) => {
      const upcoming = a.onset && Date.parse(a.onset) > now;
      const t = upcoming ? 'Starts ' + when(a.onset) + (a.ends ? ' · until ' + when(a.ends) : '') : a.ends ? 'Until ' + when(a.ends) : 'In effect';
      const text = String(a.description || a.headline || '').replace(/\n(?!\n)/g, ' ').replace(/\n{2,}/g, '\n').replace(/^ *\* ?([A-Z][A-Z ]+?)\.\.\./gm, (m, k) => k[0] + k.slice(1).toLowerCase() + ': ').trim();
      return '<details class="dwl-alert pad-alert-row is-' + level(a.event) + '"><summary><span class="dwl-alert-badge" aria-hidden="true">' + ICON + '</span>' +
        '<span class="dwl-alert-main"><span class="dwl-alert-eyebrow">NWS ' + level(a.event) + (upcoming ? ' · Upcoming' : '') + '</span>' +
        '<span class="dwl-alert-title">' + esc(a.event) + '</span><span class="dwl-alert-when">' + esc(t) + '</span>' +
        '<span class="pad-alert-spots">' + esc(a.spots.join(' · ')) + '</span></span><span class="dwl-alert-chev" aria-hidden="true">⌄</span></summary>' +
        (text ? '<div class="dwl-alert-body"><p>' + esc(text) + '</p></div>' : '') + '</details>';
    }).join('') + '</div>';
  }

  let data = null, area = '';
  let alertsOpen = false;
  document.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('pad-alertbar')) alertsOpen = e.target.open; }, true);
  const openCards = new Set();
  document.addEventListener('toggle', (e) => { const d = e.target; if (d.classList && d.classList.contains('pad-card')) { d.open ? openCards.add(d.dataset.id) : openCards.delete(d.dataset.id); } }, true);
  function render() {
    const box = document.getElementById('pad-spots');
    if (!data || !data.spots || !data.spots.length) { box.innerHTML = '<p class="pad-empty">Marine and surf conditions are not available right now.</p>'; return; }
    const now = pacificNow();
    const open = new Set([...document.querySelectorAll('#pad-alerts details[open] .dwl-alert-title')].map((x) => x.textContent));
    document.getElementById('pad-alerts').innerHTML = alertCards(data.spots.filter((s) => !area || s.area === area));
    document.querySelectorAll('#pad-alerts details').forEach((d) => { if (open.has(d.querySelector('.dwl-alert-title').textContent)) d.open = true; });
    box.innerHTML = AREAS.filter((a) => !area || a === area).map((a) => {
      const spots = data.spots.filter((s) => s.area === a);
      return spots.length ? '<section class="pad-area"><h2>' + esc(a) + '</h2><div class="pad-grid">' + spots.map((s) => card(s, now)).join('') + '</div></section>' : '';
    }).join('');
    const gen = new Date(data.generated_utc);
    document.getElementById('pad-updated').textContent = 'Updated ' + gen.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + gen.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) + ' PT';
  }

  document.addEventListener('click', (e) => {
    const cell = e.target.closest('.pad-cell');
    if (cell) {
      const cardEl = cell.closest('.pad-card');
      cardEl.querySelectorAll('.pad-cell[aria-pressed="true"]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      cell.setAttribute('aria-pressed', 'true');
      cardEl.querySelector('.pad-detail').textContent = cell.dataset.detail;
      return;
    }
    const f = e.target.closest('.pad-filter button');
    if (f) {
      area = f.dataset.area;
      document.querySelectorAll('.pad-filter button').forEach((b) => b.setAttribute('aria-pressed', String(b === f)));
      try { sessionStorage.setItem('pad-area', area); } catch (_) {}
      render();
    }
  });

  async function load() {
    try {
      const r = await fetch('paddle_conditions.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) data = await r.json();
      if (data && data.spots) data.spots.forEach((s) => { if (s.area === 'Inside the Bay') s.area = 'SF Bay'; });
    } catch (_) {}
    render();
  }
  try { area = (sessionStorage.getItem('pad-area') || '').replace('Inside the Bay', 'SF Bay'); } catch (_) {}
  document.querySelectorAll('.pad-filter button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.area === area)));
  load();
  setInterval(load, 15 * 60 * 1000);
})();
