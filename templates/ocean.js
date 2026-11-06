// templates/ocean.js — "Ocean Breeze": bubbles drift up; add-to-cart pops a few bubbles.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#E6FAF8',
    layers: [
      { type: 'bubbles', count: 22, colors: ['#5FC7D8', '#FFFFFF', '#8FE3D6'], size: [3, 13], speed: [12, 36], alpha: 0.6 },
    ],
    burst: { type: 'bubble', count: 11, colors: ['#3FB6C4', '#FFFFFF', '#8FE3D6'] },
  });
})();
