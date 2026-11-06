// templates/zen.js — "Zen": soft washes of sage, sand and clay drifting like ink in water.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#F1EDE4',
    layers: [
      { type: 'bokeh', count: 9, colors: ['#C4D0BE', '#DBCDB2', '#E4BEAA'], size: [60, 150], speed: [2, 5], alpha: 0.22 },
      { type: 'dust', count: 10, colors: ['#8A8478'], size: [0.7, 1.4], speed: [2, 6], alpha: 0.35 },
    ],
    burst: { type: 'bubble', count: 6, colors: ['#26231F', '#B5432A'] },
  });
})();
