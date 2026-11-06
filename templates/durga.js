// templates/durga.js — "Durga Puja": pink lotus and marigold petals drifting down, diya sparks rising;
// a little shower of lotus and marigold petals on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#3A0D0F',
    layers: [
      { type: 'petals', count: 16, colors: ['#E8A6BC', '#F2BFD0', '#F28C1B', '#F7A928'], size: [3.5, 6.5], speed: [12, 28], alpha: 0.85 },
      { type: 'dust', count: 20, colors: ['#FFC46B', '#F6B04A', '#FFE2A8'], size: [0.8, 2.2], speed: [4, 11], alpha: 0.8, glow: true },
    ],
    burst: { type: 'petal', count: 14, colors: ['#E8A6BC', '#F28C1B', '#F7A928', '#F2BFD0'] },
  });
})();
