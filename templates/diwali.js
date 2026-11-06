// templates/diwali.js — "Diwali Lights": glowing diya sparks drifting up, a few twinkles; a golden firework sparkle on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#12081F',
    layers: [
      { type: 'dust', count: 34, colors: ['#FFC75F', '#FF9F1C', '#FFE9A8'], size: [0.8, 2.4], speed: [4, 12], alpha: 0.85, glow: true },
      { type: 'sparkle', count: 12, colors: ['#FFE9A8', '#FF8FB0', '#FFFFFF'], size: [1.2, 2.8], alpha: 0.9 },
    ],
    burst: { type: 'sparkle', count: 22, colors: ['#FFE9A8', '#FFC75F', '#FF8FB0', '#FFFFFF'] },
  });
})();
