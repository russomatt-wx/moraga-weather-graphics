/* Diablo Weather Lab — Paddle conditions page. Renders paddle_conditions.json (hourly workflow). */
(function () {
  'use strict';
  const AREAS = ['SF Coast', 'Marin', 'Peninsula Coast', 'Inside the Bay'];
  const LABEL = ['Go', 'Caution', 'No-go'];
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
        return '<button type="button" style="grid-column:' + (Math.floor(d.getHours() / 3) + 1) + '" class="pad-cell r' + b.rating + '" data-detail="' + esc(dayName(d, now) + ' ' + clock(d) + ': ' + LABEL[b.rating] + ' · ' + b.why + ' · ' + wind(b) + (waves(b) ? ' · ' + waves(b) : '')) + '" aria-label="' + esc(clock(d) + ' ' + LABEL[b.rating]) + '"><span>' + hour(d) + '</span></button>';
      }).join('') + '</div></div>').join('') + '</div>';
  }

  function card(spot, now) {
    const c = current(spot, now);
    const tides = (spot.tides || []).filter((t) => parse(t.t) >= now).slice(0, 3)
      .map((t) => '<span class="pad-tide ' + (t.type === 'High' ? 'hi' : 'lo') + '">' + (t.type === 'High' ? '▲' : '▼') + ' ' + t.type + ' ' + clock(parse(t.t)) + ' <b>' + t.ft + ' ft</b></span>').join('');
    const stats = [
      ['Wind', wind(c)],
      spot.kind === 'coast' ? ['Waves', waves(c) || '—'] : null,
      ['Water', spot.water_f != null ? spot.water_f + '°F' : '—'],
      ['Air', c.air_f != null ? c.air_f + '°F' : '—'],
    ].filter(Boolean).map(([k, v]) => '<div><span>' + k + '</span><b>' + esc(v) + '</b></div>').join('');
    const alerts = (spot.alerts || []).filter((x) => MARINE.test(x)).map((a) => '<span class="pad-alert' + (/warning/i.test(a) ? ' warn' : '') + '">⚠ ' + esc(a) + '</span>').join('');
    return '<article class="pad-card r' + c.rating + '" data-area="' + esc(spot.area) + '">' +
      '<header><div><h3>' + esc(spot.name) + '</h3><p>' + (spot.kind === 'coast' ? 'Open coast' : 'Protected water') + '</p></div>' +
      '<div class="pad-rate"><span class="pad-badge r' + c.rating + '">' + LABEL[c.rating] + '</span><small>' + esc(c.why) + '</small></div></header>' +
      (alerts ? '<div class="pad-alerts">' + alerts + '</div>' : '') +
      '<div class="pad-stats">' + stats + '</div>' +
      (tides ? '<div class="pad-tides">' + tides + '</div>' : '') +
      timeline(spot, now) +
      '<p class="pad-detail" aria-live="polite">' + esc(bestText(spot, now)) + '</p>' +
      '</article>';
  }

  let data = null, area = '';
  function render() {
    const box = document.getElementById('pad-spots');
    if (!data || !data.spots || !data.spots.length) { box.innerHTML = '<p class="pad-empty">Paddle conditions are not available right now.</p>'; return; }
    const now = pacificNow();
    box.innerHTML = AREAS.filter((a) => !area || a === area).map((a) => {
      const spots = data.spots.filter((s) => s.area === a);
      return spots.length ? '<section class="pad-area"><h2>' + esc(a) + '</h2><div class="pad-grid">' + spots.map((s) => card(s, now)).join('') + '</div></section>' : '';
    }).join('');
    const gen = new Date(data.generated_utc);
    document.getElementById('pad-updated').textContent = 'Updated ' + gen.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '.';
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
    } catch (_) {}
    render();
  }
  try { area = sessionStorage.getItem('pad-area') || ''; } catch (_) {}
  document.querySelectorAll('.pad-filter button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.area === area)));
  load();
  setInterval(load, 15 * 60 * 1000);
})();
