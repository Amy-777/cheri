// templates/academia.js — "Dark Academia": dust motes turning in lamplight, a few slow embers.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#17120E',
    layers: [
      { type: 'dust', count: 40, colors: ['#FFD9A0', '#F0B870', '#FFF0D0'], size: [0.7, 2.1], speed: [2, 9], alpha: 0.7, glow: true },
      { type: 'dust', count: 6, colors: ['#FF9A4A'], size: [1, 2], speed: [10, 22], alpha: 0.75, glow: true },
    ],
    burst: { type: 'sparkle', count: 12, colors: ['#FFD9A0', '#F0B870', '#FFFFFF'] },
  });
})();
