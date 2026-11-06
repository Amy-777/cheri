// templates/sunset.js — "Golden Hour": warm bokeh drifting up like light through leaves; warm flare on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#FFEFE0',
    layers: [
      { type: 'bokeh', count: 15, colors: ['#FFD58A', '#FF9E7A', '#FF7AA8', '#FFE9B0'], size: [28, 84], speed: [3, 10], alpha: 0.26 },
      { type: 'dust', count: 16, colors: ['#FFFFFF', '#FFE3A6'], size: [0.8, 1.8], speed: [6, 16], alpha: 0.7, glow: true },
    ],
    burst: { type: 'flare', count: 9, colors: ['#FFC078', '#FF8A8A', '#FFE08A'] },
  });
})();
