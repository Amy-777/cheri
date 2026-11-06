// templates/noir.js — "Midnight Velvet": a twinkling night sky with the odd shooting star, champagne sparkle burst.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#070B14',
    layers: [
      { type: 'stars', count: 90, colors: ['#FFFFFF', '#F5E6BE', '#BFD0FF'], size: [0.5, 1.5], alpha: 0.9, shooting: true },
      { type: 'dust', count: 12, colors: ['#E6C98F'], size: [0.8, 1.8], speed: [3, 9], alpha: 0.6, glow: true },
    ],
    burst: { type: 'sparkle', count: 14, colors: ['#F5E6BE', '#C9A66B', '#FFFFFF'] },
  });
})();
