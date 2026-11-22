// Save tomorrow's high/low exactly as the Diablo Weather Lab app shows it, for every location.
// Opens the local copy of the site in a headless browser (one page per location) and reads the
// second row of the 10-day forecast. Writes verification/dwl_forecast_archive.json:
//   {location_id: {YYYY-MM-DD: {high_f, low_f, issued}}}
// Usage: node scripts/dwl_forecast_snapshot.js http://localhost:8765
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'verification', 'dwl_forecast_archive.json');
const BASE = process.argv[2] || 'http://localhost:8765';
const locs = JSON.parse(fs.readFileSync(path.join(ROOT, 'locations.json'), 'utf8')).locations;
const pt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

(async () => {
  let arch = {};
  try { arch = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) {}
  const tomorrow = pt(new Date(Date.now() + 24 * 3600e3));
  const issued = new Date().toISOString().slice(0, 16) + 'Z';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let ok = 0;
  for (const l of locs) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/index.html?city=${l.key}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Wait until the 10-day has rendered and has settled (blend + short-range refinements).
      await page.waitForFunction(() => document.querySelectorAll('#public-days .dwl-day').length >= 2, null, { timeout: 60000 });
      await page.waitForTimeout(6000);
      const row = await page.evaluate(() => {
        const r = document.querySelectorAll('#public-days .dwl-day')[1];
        const n = (s) => { const m = String(s || '').match(/-?\d+/); return m ? +m[0] : null; };
        return { hi: n(r.querySelector('.dwl-day-hi')?.textContent), lo: n(r.querySelector('.dwl-day-lo')?.textContent), label: r.querySelector('.dwl-day-when span:last-child')?.textContent };
      });
      if (row.hi !== null && row.lo !== null) {
        (arch[l.id] = arch[l.id] || {})[tomorrow] = { high_f: row.hi, low_f: row.lo, issued };
        ok++;
      } else console.log(l.id, 'no values', JSON.stringify(row));
    } catch (e) {
      console.log(l.id, 'failed:', e.message.split('\n')[0]);
    }
    await page.close();
  }
  await browser.close();
  const cutoff = pt(new Date(Date.now() - 180 * 24 * 3600e3));
  for (const k of Object.keys(arch)) for (const d of Object.keys(arch[k])) if (d < cutoff) delete arch[k][d];
  fs.writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.keys(arch).sort().map(k=>[k,arch[k]])), null, 1) + '\n');
  console.log(`DWL: archived ${ok}/${locs.length} locations for ${tomorrow}`);
})();
