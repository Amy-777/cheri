// templates/royal.js — "Royal Court": drifting gold dust, glints, and a sparkle burst on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#25060F',
    layers: [
      { type: 'dust', count: 46, colors: ['#F9E7A6', '#D4AF37', '#FFF3C4'], size: [0.7, 2.2], speed: [5, 16], alpha: 0.85, glow: true },
      { type: 'sparkle', count: 8, colors: ['#F9E7A6', '#FFFFFF'], size: [1.2, 2.4], alpha: 0.9 },
    ],
    burst: { type: 'sparkle', count: 16, colors: ['#F9E7A6', '#D4AF37', '#FFF3C4'] },
  });
})();
