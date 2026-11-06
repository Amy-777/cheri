// templates/lokal.js — LOकल: kirakira sparkles + gold dust in the air, and a manga-style Hindi sound-effect
// ("वाह!", "स्वादिष्ट!" …) that pops above the + button when something is added to the cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#090806',
    layers: [
      { type: 'sparkle', count: 24, colors: ['#FFE38A', '#F2CB52', '#FFFFFF'], size: [1.4, 3.4], alpha: 0.95 },
      { type: 'dust', count: 24, colors: ['#F2CB52', '#FFE38A'], size: [0.7, 2], speed: [4, 13], alpha: 0.6, glow: true },
    ],
    burst: { type: 'sparkle', count: 18, colors: ['#FFE38A', '#F2CB52', '#FFFFFF'] },
  });

  const WORDS = ['वाह!', 'स्वादिष्ट!', 'ज़बरदस्त!', 'बढ़िया!', 'मज़ा आ गया!'];
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const base = window.templateHooks && window.templateHooks.onAddToCart;

  window.templateHooks = {
    onAddToCart(btn) {
      if (base) base(btn);
      if (reduced() || !btn || !btn.getBoundingClientRect) return;
      const r = btn.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'lk-sfx';
      el.textContent = WORDS[(Math.random() * WORDS.length) | 0];
      el.style.left = Math.min(Math.max(r.left + r.width / 2, 70), window.innerWidth - 70) + 'px';
      el.style.top = (r.top - 4) + 'px';
      el.style.setProperty('--r', (Math.random() * 20 - 10).toFixed(1) + 'deg');
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1000);
    },
  };
})();
