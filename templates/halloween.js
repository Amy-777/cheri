// templates/halloween.js — the behavioral half of the Halloween skin.
// Loaded by the shared engine (order.html) only when a cafe's menu_template
// is "halloween". Everything here is additive/decorative — the engine never
// depends on this file existing, so a page with no template JS at all still
// works fine (see window.templateHooks' default no-ops in order.html).

(function () {
  // Ambient overlay layers — created once, reused for the life of the page.
  let dripsLayer = document.getElementById('drips');
  if (!dripsLayer) {
    dripsLayer = document.createElement('div');
    dripsLayer.id = 'drips';
    dripsLayer.className = 'drips';
    document.body.appendChild(dripsLayer);
  }

  let emberLayer = document.getElementById('ember-layer');
  if (!emberLayer) {
    emberLayer = document.createElement('div');
    emberLayer.id = 'ember-layer';
    emberLayer.className = 'ember-layer';
    document.body.prepend(emberLayer);
    for (let i = 0; i < 18; i++) {
      const e = document.createElement('span');
      e.style.left = Math.random() * 100 + '%';
      e.style.animationDelay = (Math.random() * 9) + 's';
      e.style.animationDuration = (7 + Math.random() * 5) + 's';
      emberLayer.appendChild(e);
    }
  }

  function spawnBloodDrips(btn) {
    if (!btn || !btn.getBoundingClientRect) return;
    const rect = btn.getBoundingClientRect();
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const d = document.createElement('div');
        d.className = 'drip';
        d.style.left = (rect.left + rect.width / 2 - 4 + (Math.random() * 10 - 5)) + 'px';
        d.style.top = (rect.bottom - 4) + 'px';
        const dist = 60 + Math.random() * 100;
        d.style.setProperty('--drip-dist', dist + 'px');
        d.style.animationDuration = (0.8 + Math.random() * 0.5) + 's';
        dripsLayer.appendChild(d);
        setTimeout(() => d.remove(), 1600);
      }, i * 90);
    }
  }

  // Register with the shared engine — see applyTemplate() in order.html.
  window.templateHooks = {
    onAddToCart(buttonEl) { spawnBloodDrips(buttonEl); },
  };
})();