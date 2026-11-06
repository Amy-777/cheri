// templates/patisserie.js — "Pâtisserie": pastel sprinkles drifting down; add-to-cart pops a little confetti.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#FFF0F0',
    layers: [
      { type: 'confetti', count: 28, colors: ['#F29DB6', '#9EDBBE', '#FFD36B', '#C9B3FF', '#FFFFFF'], size: [2.6, 5], speed: [14, 34], alpha: 0.85 },
    ],
    burst: { type: 'confetti', count: 18, colors: ['#F29DB6', '#9EDBBE', '#FFD36B', '#C9B3FF'] },
  });
})();
