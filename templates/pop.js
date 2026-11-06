// templates/pop.js — "Neo-Pop": outlined circles, triangles, squares and plus-signs drifting; confetti on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#F1EAFF',
    layers: [
      { type: 'shapes', count: 14, colors: ['#FFD84D', '#FF5FA2', '#7CE3B8', '#9B8CFF'], size: [12, 30], alpha: 0.92, line: '#111' },
    ],
    burst: { type: 'confetti', count: 20, colors: ['#FFD84D', '#FF5FA2', '#7CE3B8', '#9B8CFF', '#111111'] },
  });
})();
