// templates/blush.js — "Blush Petals": petals drift down the page; tapping + sends a little petal shower.
(function () {
  if (!window.ThemeFX) return;
  ThemeFX.installTheme({
    themeColor: '#FFF3F0',
    layers: [
      { type: 'petals', count: 22, colors: ['#F7A9BF', '#F58FAE', '#FFC7D4', '#FFB79E'], size: [3, 6.5], speed: [16, 40], alpha: 0.82 },
    ],
    burst: { type: 'petal', count: 13, colors: ['#F58FAE', '#FFC7D4', '#F7A9BF', '#FFB79E'] },
  });
})();
