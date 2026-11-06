// templates/emerald.js — "Emerald Palace": glowing fireflies drift up through the jaali; gold flare on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#06231D',
    layers: [
      { type: 'dust', count: 38, colors: ['#FFE58A', '#C8FF9A', '#F0D060'], size: [1, 2.6], speed: [3, 11], alpha: 0.9, glow: true },
    ],
    burst: { type: 'flare', count: 9, colors: ['#FFE58A', '#D6B35A', '#C8FF9A'] },
  });
})();
