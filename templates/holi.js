// templates/holi.js — "Holi Hues": soft gulal clouds drifting and tumbling colour flecks; a burst of colour on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#FFF8F2',
    layers: [
      { type: 'bokeh', count: 12, colors: ['#FF3D8B', '#FFC21F', '#1FA2FF', '#24C26B', '#8E44EF'], size: [30, 90], speed: [4, 10], alpha: 0.18 },
      { type: 'confetti', count: 22, colors: ['#FF3D8B', '#FFC21F', '#1FA2FF', '#24C26B', '#8E44EF'], size: [2.6, 5], speed: [12, 30], alpha: 0.85 },
    ],
    burst: { type: 'confetti', count: 24, colors: ['#FF3D8B', '#FFC21F', '#1FA2FF', '#24C26B', '#8E44EF'] },
  });
})();
