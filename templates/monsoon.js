// templates/monsoon.js — "Monsoon Chai": rain in two depths; add-to-cart splashes a few drops.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#0C171C',
    layers: [
      { type: 'rain', count: 110, colors: ['#BFD9E6'], speed: [520, 900], slant: 0.16, alpha: 0.34 },
    ],
    burst: { type: 'drop', count: 12, colors: ['#BFD9E6', '#F0B35A'] },
  });
})();
