// templates/espresso.js — "Espresso Bar": soft steam rising through the lamplight; a caramel flare on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#1A110C',
    layers: [
      { type: 'bokeh', count: 8, colors: ['#F6EADB', '#E9C9A0'], size: [40, 110], speed: [4, 9], alpha: 0.07 },
      { type: 'dust', count: 22, colors: ['#FFD8A8', '#E8B27C'], size: [0.7, 1.8], speed: [3, 9], alpha: 0.65, glow: true },
    ],
    burst: { type: 'flare', count: 9, colors: ['#E8B27C', '#C8874A', '#F6EADB'] },
  });
})();
