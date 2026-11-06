// templates/retro.js — "70s Retro": lava-lamp blobs of mustard, tomato and teal; confetti pop on add-to-cart.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#FFF1D0',
    layers: [
      { type: 'bokeh', count: 12, colors: ['#F2A900', '#E4572E', '#2A9D8F'], size: [34, 90], speed: [4, 11], alpha: 0.22 },
    ],
    burst: { type: 'confetti', count: 18, colors: ['#F2A900', '#E4572E', '#2A9D8F', '#3B2314'] },
  });
})();
