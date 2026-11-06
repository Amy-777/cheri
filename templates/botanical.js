// templates/botanical.js — "Botanical Terrace": leaves drifting down through sunlit air; a little leaf shower on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#EEF3EA',
    layers: [
      { type: 'petals', count: 16, colors: ['#5BA36C', '#3E8A55', '#8BC79A', '#C9D96A'], size: [4, 8], speed: [14, 34], alpha: 0.8 },
      { type: 'dust', count: 14, colors: ['#FFF3B0', '#FFFFFF'], size: [0.8, 1.8], speed: [2, 7], alpha: 0.75, glow: true },
    ],
    burst: { type: 'petal', count: 12, colors: ['#5BA36C', '#3E8A55', '#8BC79A'] },
  });
})();
