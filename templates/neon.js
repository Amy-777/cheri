// templates/neon.js — "Neon Alley": light rain streaking through the neon, the odd pink/cyan glint; a neon flare on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#07060F',
    layers: [
      { type: 'rain', count: 70, colors: ['#9EF4FF'], speed: [620, 980], slant: 0.22, alpha: 0.26 },
      { type: 'dust', count: 14, colors: ['#FF2E88', '#29E7FF', '#B57BFF'], size: [1, 2.4], speed: [3, 9], alpha: 0.8, glow: true },
    ],
    burst: { type: 'flare', count: 10, colors: ['#FF2E88', '#29E7FF', '#FFFFFF'] },
  });
})();
