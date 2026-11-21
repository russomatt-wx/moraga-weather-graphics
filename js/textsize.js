/* Diablo Weather Lab — page size control. Scales the whole page (text, icons, spacing) like browser
   zoom; the choice is saved on this phone. The saved size is applied by a tiny inline script in <head>
   before the page draws, so there is no jump. */
(function () {
  'use strict';
  var STEPS = [0.85, 0.92, 1, 1.1, 1.2, 1.32];
  var LABELS = ['Smallest', 'Smaller', 'Default', 'Larger', 'Large', 'Largest'];
  var KEY = 'dwl-page-zoom';
  function current() { var v = 1; try { v = parseFloat(localStorage.getItem(KEY)) || 1; } catch (e) {} return v; }
  function idx(v) { var best = 2; STEPS.forEach(function (s, i) { if (Math.abs(s - v) < Math.abs(STEPS[best] - v)) best = i; }); return best; }
  function apply(v) {
    if (window.dwlZoom) window.dwlZoom(v);
    try { if (v === 1) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(v)); } catch (e) {}
    var lab = document.getElementById('dwl-size-label'); if (lab) lab.textContent = LABELS[idx(v)];
    var dn = document.getElementById('dwl-size-down'), up = document.getElementById('dwl-size-up');
    if (dn) dn.disabled = idx(v) === 0; if (up) up.disabled = idx(v) === STEPS.length - 1;
  }
  function build() {
    if (document.getElementById('dwl-size-btn')) return;
    // Home: in the location bar. Other pages: beside the page title.
    var host = document.querySelector('#public-shell .dwl-locbar') || document.querySelector('.pad-intro h1');
    if (!host) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'dwl-size-btn'; btn.className = 'dwl-size-btn';
    btn.setAttribute('aria-label', 'Text size'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="s">A</span><span class="l">A</span>';
    host.appendChild(btn);
    var pop = document.createElement('div');
    pop.id = 'dwl-size-pop'; pop.className = 'dwl-size-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Text size');
    pop.innerHTML = '<div class="dwl-size-title">Text size</div><div class="dwl-size-row">' +
      '<button type="button" id="dwl-size-down" aria-label="Smaller"><span class="s">A</span>−</button>' +
      '<span id="dwl-size-label">Default</span>' +
      '<button type="button" id="dwl-size-up" aria-label="Larger"><span class="l">A</span>+</button></div>' +
      '<button type="button" class="dwl-size-reset" id="dwl-size-reset">Reset</button>';
    document.body.appendChild(pop);
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden));
      if (!pop.hidden) { var r = btn.getBoundingClientRect(); pop.style.top = Math.round(r.bottom + 8) + 'px'; pop.style.right = Math.max(8, Math.round(document.documentElement.clientWidth - r.right)) + 'px'; }
    });
    window.addEventListener('scroll', function () { if (!pop.hidden) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } }, { passive: true });
    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { if (!pop.hidden) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    document.getElementById('dwl-size-down').onclick = function () { apply(STEPS[Math.max(0, idx(current()) - 1)]); };
    document.getElementById('dwl-size-up').onclick = function () { apply(STEPS[Math.min(STEPS.length - 1, idx(current()) + 1)]); };
    document.getElementById('dwl-size-reset').onclick = function () { apply(1); };
    apply(current());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
