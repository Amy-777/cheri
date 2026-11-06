// templates/lavender.js — "Lavender Aurora": four-point twinkles and faint stardust under the aurora.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#140B2E',
    layers: [
      { type: 'sparkle', count: 26, colors: ['#FFFFFF', '#C9B8FF', '#8FF5E0', '#F5A8FF'], size: [1.3, 3], alpha: 0.9 },
      { type: 'dust', count: 16, colors: ['#C9B8FF', '#8FF5E0'], size: [0.7, 1.6], speed: [2, 8], alpha: 0.55, glow: true },
    ],
    burst: { type: 'sparkle', count: 15, colors: ['#FFFFFF', '#C9B8FF', '#8FF5E0', '#F5A8FF'] },
  });
})();
