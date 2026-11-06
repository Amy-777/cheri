/* about-page.js — the About-page / website engine.
 *
 * Shared by order.html (the swipe-left About panel), about.html (the cafe's
 * standalone website) and about-studio.js (the live preview inside the
 * dashboard's studio), so what the admin designs is exactly what customers
 * get. Plain JS, no build step.
 *
 * A cafe's page is stored as one JSON document (cafe.about_layout):
 *
 *   { v: 2,
 *     style:  { bg, ink, accent, accent2, headFont, bodyFont, radius, edge, space, align },
 *     site:   { nav, logo, title, ctaLabel, ctaGoto, ctaLink, footer, footNote,
 *               phone, whatsapp, instagram, email },          // header + footer
 *     shop:   { settings: { whatsapp, upi, payee, pickup, delivery, fee, min, note },
 *               products: [ { id, name, price, mrp, imgId, desc, cat, tag, out } ] },
 *     images: [ { id, src, k? } ],         // k: 'p' marks a product photo
 *     blocks: [ { id, type, navLabel, width, ...props } ]
 *   }
 *
 * v1 layouts (no site / shop) load fine — those parts just take defaults.
 *
 * Responsive layout uses CONTAINER queries on .ab-site, not media queries,
 * so the same HTML is a phone page inside order.html's swipe panel, a full
 * desktop site in about.html, and either one inside the studio's preview.
 *
 * The shop has no backend of its own: the cart lives in this browser
 * (localStorage, per cafe) and checkout hands a ready-made order to the
 * cafe's WhatsApp — same idea as the booking form.
 *
 * Everything that reaches the page goes through normalize(): colours, fonts,
 * enums, numbers and URLs are whitelisted, text is escaped.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Fonts                                                              */
  /* ------------------------------------------------------------------ */
  const HEAD_FONTS = [
    { id: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif", gf: 'Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600', weight: 600, scale: 1.1,  caps: false, tag: 'Elegant' },
    { id: 'Playfair Display',   stack: "'Playfair Display', Georgia, serif",   gf: 'Playfair+Display:ital,wght@0,600;0,700;0,800;1,600',            weight: 700, scale: 1,    caps: false, tag: 'Classic' },
    { id: 'DM Serif Display',   stack: "'DM Serif Display', Georgia, serif",   gf: 'DM+Serif+Display:ital@0;1',                                       weight: 400, scale: 1,    caps: false, tag: 'Chunky serif' },
    { id: 'Abril Fatface',      stack: "'Abril Fatface', Georgia, serif",      gf: 'Abril+Fatface',                                                   weight: 400, scale: 1,    caps: false, tag: 'Vintage poster' },
    { id: 'Fraunces',           stack: "'Fraunces', Georgia, serif",           gf: 'Fraunces:opsz,wght@9..144,600;9..144,800',                        weight: 700, scale: 1,    caps: false, tag: 'Soft & quirky' },
    { id: 'Bebas Neue',         stack: "'Bebas Neue', Impact, sans-serif",     gf: 'Bebas+Neue',                                                      weight: 400, scale: 1.2,  caps: true,  tag: 'Loud poster' },
    { id: 'Caveat',             stack: "'Caveat', 'Comic Sans MS', cursive",   gf: 'Caveat:wght@600;700',                                             weight: 700, scale: 1.25, caps: false, tag: 'Handwritten' },
    { id: 'Space Grotesk',      stack: "'Space Grotesk', system-ui, sans-serif", gf: 'Space+Grotesk:wght@500;700',                                    weight: 700, scale: 1,    caps: false, tag: 'Modern' },
  ];
  const BODY_FONTS = [
    { id: 'Inter',   stack: "'Inter', -apple-system, system-ui, sans-serif", gf: 'Inter:wght@400;500;600;700' },
    { id: 'Lora',    stack: "'Lora', Georgia, serif",                        gf: 'Lora:ital,wght@0,400;0,500;0,600;1,400' },
    { id: 'DM Sans', stack: "'DM Sans', -apple-system, system-ui, sans-serif", gf: 'DM+Sans:wght@400;500;700' },
  ];
  /* Fonts the free-text block can use (per block, or on any selected words). */
  const WORD_FONTS = [
    { id: 'Inter', stack: "'Inter', system-ui, sans-serif", gf: 'Inter:wght@400;600;700' },
    { id: 'DM Sans', stack: "'DM Sans', system-ui, sans-serif", gf: 'DM+Sans:wght@400;700' },
    { id: 'Poppins', stack: "'Poppins', system-ui, sans-serif", gf: 'Poppins:wght@400;600;700' },
    { id: 'Montserrat', stack: "'Montserrat', system-ui, sans-serif", gf: 'Montserrat:wght@400;600;800' },
    { id: 'Raleway', stack: "'Raleway', system-ui, sans-serif", gf: 'Raleway:wght@400;600;800' },
    { id: 'Nunito', stack: "'Nunito', system-ui, sans-serif", gf: 'Nunito:wght@400;700;800' },
    { id: 'Oswald', stack: "'Oswald', Impact, sans-serif", gf: 'Oswald:wght@400;600' },
    { id: 'Anton', stack: "'Anton', Impact, sans-serif", gf: 'Anton' },
    { id: 'Bebas Neue', stack: "'Bebas Neue', Impact, sans-serif", gf: 'Bebas+Neue' },
    { id: 'Space Grotesk', stack: "'Space Grotesk', system-ui, sans-serif", gf: 'Space+Grotesk:wght@500;700' },
    { id: 'Lora', stack: "'Lora', Georgia, serif", gf: 'Lora:ital,wght@0,400;0,600;1,400' },
    { id: 'Merriweather', stack: "'Merriweather', Georgia, serif", gf: 'Merriweather:wght@400;700' },
    { id: 'Libre Baskerville', stack: "'Libre Baskerville', Georgia, serif", gf: 'Libre+Baskerville:wght@400;700' },
    { id: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", gf: 'Playfair+Display:wght@500;700' },
    { id: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif", gf: 'Cormorant+Garamond:wght@500;700' },
    { id: 'DM Serif Display', stack: "'DM Serif Display', Georgia, serif", gf: 'DM+Serif+Display' },
    { id: 'Abril Fatface', stack: "'Abril Fatface', Georgia, serif", gf: 'Abril+Fatface' },
    { id: 'Fraunces', stack: "'Fraunces', Georgia, serif", gf: 'Fraunces:wght@500;800' },
    { id: 'Roboto Slab', stack: "'Roboto Slab', Georgia, serif", gf: 'Roboto+Slab:wght@400;700' },
    { id: 'Caveat', stack: "'Caveat', 'Comic Sans MS', cursive", gf: 'Caveat:wght@500;700' },
    { id: 'Dancing Script', stack: "'Dancing Script', cursive", gf: 'Dancing+Script:wght@500;700' },
    { id: 'Pacifico', stack: "'Pacifico', cursive", gf: 'Pacifico' },
    { id: 'Lobster', stack: "'Lobster', cursive", gf: 'Lobster' },
    { id: 'Great Vibes', stack: "'Great Vibes', cursive", gf: 'Great+Vibes' },
    { id: 'Space Mono', stack: "'Space Mono', 'Courier New', monospace", gf: 'Space+Mono:wght@400;700' },
  ];
  const wordFont = id => WORD_FONTS.find(f => f.id === id);
  const headFont = id => HEAD_FONTS.find(f => f.id === id) || HEAD_FONTS[0];
  const bodyFont = id => BODY_FONTS.find(f => f.id === id) || BODY_FONTS[0];

  /* ------------------------------------------------------------------ */
  /* Vibes (one-tap presets for the whole page)                         */
  /* ------------------------------------------------------------------ */
  const VIBES = [
    { id: 'editorial', name: 'Warm Editorial', emoji: '🍂',
      style: { bg: '#F6F2E9', ink: '#23241E', accent: '#B96A45', accent2: '#4E5A34', headFont: 'Cormorant Garamond', bodyFont: 'Inter',   radius: 'soft',  edge: 'clean' } },
    { id: 'vintage', name: 'Bengali Vintage', emoji: '🏮',
      style: { bg: '#F1E2BC', ink: '#2B1810', accent: '#B5322A', accent2: '#D99A1C', headFont: 'Abril Fatface',      bodyFont: 'Lora',    radius: 'sharp', edge: 'bold' } },
    { id: 'midnight', name: 'Midnight Jazz', emoji: '🎷',
      style: { bg: '#14110F', ink: '#F1E7D6', accent: '#E3B04B', accent2: '#8C3B2B', headFont: 'Playfair Display',   bodyFont: 'DM Sans', radius: 'soft',  edge: 'clean' } },
    { id: 'mint', name: 'Fresh Mint', emoji: '🌿',
      style: { bg: '#F0FAF4', ink: '#12332A', accent: '#16A075', accent2: '#FFB547', headFont: 'DM Serif Display',   bodyFont: 'DM Sans', radius: 'round', edge: 'clean' } },
    { id: 'pop', name: 'Pop Sticker', emoji: '🍭',
      style: { bg: '#FFF4DC', ink: '#17171C', accent: '#FF4D6D', accent2: '#FFD23F', headFont: 'Bebas Neue',        bodyFont: 'DM Sans', radius: 'round', edge: 'bold' } },
    { id: 'ocean', name: 'Ocean Resort', emoji: '🌊',
      style: { bg: '#F3F8FA', ink: '#0F2A38', accent: '#0E7C9B', accent2: '#F2B544', headFont: 'Playfair Display',   bodyFont: 'DM Sans', radius: 'soft',  edge: 'clean', btn: 'glass', cards: 'glass', motion: 'parallax' } },
    { id: 'boutique', name: 'Boutique Gold', emoji: '✨',
      style: { bg: '#FBF8F2', ink: '#201A14', accent: '#A8812F', accent2: '#3C2F25', headFont: 'Cormorant Garamond', bodyFont: 'Inter',   radius: 'sharp', edge: 'clean', btn: 'outline', cards: 'flat', motion: 'zoom' } },
    { id: 'aurora', name: 'Glass Aurora', emoji: '🔮',
      style: { bg: '#0F1424', ink: '#EAF0FF', accent: '#7C8CFF', accent2: '#4FD1C5', headFont: 'Space Grotesk',     bodyFont: 'DM Sans', radius: 'round', edge: 'clean', btn: 'glass', cards: 'glass', motion: 'parallax' } },
  ];

  const STYLE_DEFAULT = Object.assign({ vibe: 'editorial', space: 'cozy', align: 'left', btn: 'solid', cards: 'flat', motion: 'none' }, VIBES[0].style);

  /* ------------------------------------------------------------------ */
  /* Block catalogue (defaults + what the studio's "add" grid shows)     */
  /* ------------------------------------------------------------------ */
  const BLOCK_META = {
    hero:       { emoji: '🎬', name: 'Big header',    blurb: 'Cover photo, name, tagline & a button' },
    text:       { emoji: '✍️', name: 'Story',         blurb: 'Words about your cafe' },
    words:      { emoji: '📝', name: 'Free text',     blurb: 'Word-style editor: any font, size, colour, wrap around a photo' },
    split:      { emoji: '↔️', name: 'Photo + words', blurb: 'Photo beside a short story' },
    photo:      { emoji: '🖼️', name: 'Photo',         blurb: 'One photo, any size, any spot' },
    gallery:    { emoji: '🎞️', name: 'Gallery',       blurb: 'Grid, swipe strip or collage' },
    shop:       { emoji: '🛍️', name: 'Shop',          blurb: 'Products people can order' },
    highlights: { emoji: '✨', name: 'Highlights',    blurb: 'Emoji + quick blurbs' },
    quote:      { emoji: '💬', name: 'Quote',         blurb: 'A loud line or a review' },
    cta:        { emoji: '📣', name: 'Banner',        blurb: 'A bold band with one button' },
    hours:      { emoji: '🕐', name: 'Opening hours', blurb: 'When you\'re open' },
    book:       { emoji: '📅', name: 'Book us',       blurb: 'Table booking → WhatsApp or email' },
    visit:      { emoji: '📍', name: 'Find us',       blurb: 'Address, call, WhatsApp, Insta' },
    ribbon:     { emoji: '🎀', name: 'Ribbon',        blurb: 'Scrolling banner text' },
    rooms:      { emoji: '🛏️', name: 'Rooms & booking', blurb: 'Room types, live availability, booking requests' },
    banquet:    { emoji: '🎉', name: 'Banquet halls',  blurb: 'Halls with a free / booked date calendar' },
    faq:        { emoji: '❓', name: 'Questions',     blurb: 'Tap-to-open questions and answers' },
    list:       { emoji: '📋', name: 'Price list',    blurb: 'Items with prices — for menus and services' },
    video:      { emoji: '▶️', name: 'Video',         blurb: 'A YouTube or Vimeo video' },
    spacer:     { emoji: '➖', name: 'Space / line',  blurb: 'Breathing room or a thin divider' },
  };
  /* Only offered to hotel accounts. */
  const HOTEL_ONLY = ['rooms', 'banquet'];
  /* Plain line icons for the studio (no emoji). */
  const SVG = d => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICONS = {
    hero: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M3 20h12"/>', text: '<path d="M4 6h16M4 11h16M4 16h10"/>', words: '<path d="M5 5h14M12 5v14M9 19h6"/>',
    split: '<rect x="3" y="5" width="8" height="14" rx="1.5"/><path d="M14 8h7M14 12h7M14 16h5"/>', photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
    gallery: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
    shop: '<path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    highlights: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>', quote: '<path d="M5 17v-5a4 4 0 0 1 4-4M13 17v-5a4 4 0 0 1 4-4"/>',
    cta: '<rect x="3" y="8" width="18" height="8" rx="4"/>', hours: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', book: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    visit: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>', ribbon: '<path d="M3 8l18-2v10L3 18z"/>',
    rooms: '<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.5"/>', banquet: '<path d="M4 20h16M6 20V9l6-5 6 5v11M10 20v-5h4v5"/>',
    faq: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>', list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>', spacer: '<path d="M4 12h16M12 4v3M12 17v3"/>',
  };
  Object.keys(BLOCK_META).forEach(k => { BLOCK_META[k].emoji = SVG(ICONS[k] || ICONS.text); });
  const ICON_EYE = SVG('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
  const ICON_EYE_OFF = SVG('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>');
  const TYPES = Object.keys(BLOCK_META);

  /* Blocks that may sit side by side with another half-width block on big screens. */
  const HALF_OK = ['text', 'words', 'photo', 'gallery', 'highlights', 'quote', 'cta', 'hours', 'book', 'visit', 'faq', 'list', 'video'];

  const BD = {
    hero:       { title: '', titleHtml: '', tagline: '', tagHtml: '', badge: '', imgId: '', look: 'cover', height: 'm', overlay: 40, align: 'center', titleSize: 'm',
                  btnLabel: '', goto: '', link: '' },
    text:       { eyebrow: '', heading: '', body: '', look: 'plain', size: 'm', align: 'inherit' },
    words:      { html: '', font: 'inherit', size: 16, lh: 170, ls: 0, pgap: 14, color: '', align: 'inherit', cols: 1, maxw: 'm', look: 'plain', hyph: false,
                  imgId: '', imgPos: 'right', imgW: 35, imgShape: 'theme', imgRatio: 'auto', imgFrame: 'none', caption: '' },
    photo:      { imgId: '', size: 'm', align: 'center', ratio: 'auto', shape: 'theme', frame: 'none', tilt: 0, caption: '' },
    split:      { imgId: '', imgSide: 'left', imgWidth: 'm', ratio: '3/4', shape: 'theme', frame: 'none', tilt: 0, eyebrow: '', heading: '', body: '' },
    gallery:    { heading: '', imgIds: [], layout: 'grid', cols: 2, ratio: '1/1', gap: 'm', shape: 'theme' },
    shop:       { heading: 'Shop', blurb: '', show: '', layout: 'grid', cols: 3, chips: true },
    highlights: { heading: '', look: 'list', rows: [{ emoji: '', title: '', text: '' }] },
    quote:      { text: '', by: '', look: 'big' },
    cta:        { heading: '', text: '', btnLabel: '', goto: '', link: '', look: 'accent' },
    hours:      { heading: 'Opening hours', rows: [{ day: '', time: '' }], note: '' },
    book:       { heading: 'Book a table', blurb: '', mode: 'form', via: 'whatsapp', whatsapp: '', phone: '', email: '', link: '', linkLabel: '', buttonLabel: '',
                  guestsMax: 10, askDate: true, askTime: true, askNote: true, fine: '', look: 'card' },
    visit:      { heading: 'Find us', showAddress: true, phone: '', whatsapp: '', instagram: '', mapsUrl: '', showDirections: true },
    ribbon:     { text: '', look: 'accent', tilt: -2, speed: 'm' },
    rooms:      { heading: 'Rooms & rates', blurb: '', buttonLabel: 'Book', fine: '', rows: [] },
    banquet:    { heading: 'Banquet halls', blurb: '', buttonLabel: 'Check free dates', fine: '', rows: [] },
    faq:        { heading: 'Questions people ask', rows: [{ q: '', a: '' }], look: 'lines' },
    list:       { heading: 'Menu', blurb: '', rows: [{ name: '', price: '', text: '' }], note: '', look: 'lines' },
    video:      { heading: '', url: '', caption: '', ratio: '16/9' },
    spacer:     { size: 'm', line: false },
  };
  /* Every block can be named in the top menu and (where it makes sense) be half width. */
  Object.keys(BD).forEach(t => Object.assign(BD[t], { navLabel: '', width: 'full', hidden: false, bg: 'none', pad: 'm' }));

  const SHAPES = ['theme', 'square', 'arch', 'circle'];
  const FRAMES = ['none', 'polaroid', 'outline', 'shadow'];
  const EN = {
    'hero.look': ['cover', 'split'], 'hero.height': ['s', 'm', 'l'], 'hero.align': ['left', 'center'], 'hero.titleSize': ['s', 'm', 'l', 'xl', 'xxl'],
    'text.look': ['plain', 'card', 'note'], 'text.size': ['s', 'm', 'l', 'xl', 'xxl'], 'text.align': ['inherit', 'left', 'center', 'right', 'justify'],
    'words.font': ['inherit'].concat(WORD_FONTS.map(f => f.id)), 'words.align': ['inherit', 'left', 'center', 'right', 'justify'],
    'words.maxw': ['s', 'm', 'l', 'full'], 'words.look': ['plain', 'card', 'note'], 'words.imgPos': ['none', 'left', 'right', 'top'],
    'words.imgShape': SHAPES, 'words.imgRatio': ['auto', '1/1', '4/3', '3/4'], 'words.imgFrame': FRAMES,
    'photo.size': ['s', 'm', 'l', 'full'], 'photo.align': ['left', 'center', 'right'],
    'photo.ratio': ['auto', '1/1', '4/3', '16/9', '3/4'], 'photo.shape': SHAPES, 'photo.frame': FRAMES,
    'split.imgSide': ['left', 'right'], 'split.imgWidth': ['s', 'm', 'l'], 'split.ratio': ['3/4', '1/1', '4/3'],
    'split.shape': SHAPES, 'split.frame': FRAMES,
    'gallery.layout': ['grid', 'strip', 'collage'], 'gallery.ratio': ['1/1', '4/3', '3/4', 'auto'],
    'gallery.gap': ['s', 'm', 'l'], 'gallery.shape': SHAPES,
    'shop.layout': ['grid', 'rows'],
    'highlights.look': ['list', 'cards', 'chips'], 'quote.look': ['big', 'boxed'], 'cta.look': ['accent', 'ink', 'pop'],
    'book.mode': ['form', 'buttons'], 'book.via': ['whatsapp', 'email'], 'book.look': ['card', 'bold', 'plain'],
    'ribbon.look': ['accent', 'ink', 'outline'], 'ribbon.speed': ['s', 'm', 'l'],
    'faq.look': ['lines', 'cards'], 'list.look': ['lines', 'cards'], 'video.ratio': ['16/9', '4/3', '1/1'], 'spacer.size': ['s', 'm', 'l', 'xl'],
    '*.width': ['full', 'half'],
    '*.bg': ['none', 'soft', 'dark', 'accent'], '*.pad': ['s', 'm', 'l'],
  };
  const NUM = { 'words.size': [10, 160], 'words.lh': [100, 300], 'words.ls': [-5, 50], 'words.pgap': [0, 80], 'words.cols': [1, 3], 'words.imgW': [15, 70], overlay: [0, 70], tilt: [-8, 8], cols: [2, 3], 'shop.cols': [2, 4], 'ribbon.tilt': [-4, 4], 'book.guestsMax': [2, 30] };
  // URLs need room (a Google Maps link is easily 200+ chars); everything else is short copy.
  const LIM = { url: 400, body: 3000, text: 800, blurb: 300, fine: 200, link: 400, mapsUrl: 400, navLabel: 24, show: 30, btnLabel: 30, default: 160 };
  const ROWS = {
    'highlights.rows': { max: 10, f: { emoji: 8, title: 60, text: 140 } },
    'hours.rows':      { max: 10, f: { day: 40, time: 60 } },
    'faq.rows':        { max: 15, f: { q: 140, a: 600 } },
    'list.rows':       { max: 40, f: { name: 70, price: 24, text: 140 } },
    'rooms.rows':      { max: 12, f: { typeId: 40, imgId: 24, text: 160 } },
    'banquet.rows':    { max: 8, f: { hallId: 40, imgId: 24, text: 160 } },
  };
  const MAX_BLOCKS = 40, MAX_SHELF = 16, MAX_PRODUCTS = 60, MAX_IMAGES = MAX_SHELF + MAX_PRODUCTS;

  const SITE_D = { nav: 'bar', logo: true, title: '', ctaLabel: '', ctaGoto: '', ctaLink: '', footer: true, footNote: '',
                   phone: '', whatsapp: '', instagram: '', email: '', announce: '', announceLink: '', announceTone: 'accent' };
  const SHOP_D = { whatsapp: '', upi: '', payee: '', pickup: true, delivery: false, fee: 0, min: 0, note: '',
                   payCash: true, payUpi: true, payOnline: false, serverOrders: false, freeAbove: 0, slots: '', eta: '', coupons: [] };
  const PRODUCT_D = { name: '', price: 0, mrp: 0, imgId: '', desc: '', cat: '', tag: '', out: false, stock: 0, optName: '', opts: '' };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                      */
  /* ------------------------------------------------------------------ */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const uid = () => Math.random().toString(36).slice(2, 8);
  const clone = o => JSON.parse(JSON.stringify(o));
  const pick = (v, allowed, fb) => (allowed.indexOf(v) >= 0 ? v : fb);

  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  function hex6(h, fb) {
    if (typeof h !== 'string' || !HEX.test(h)) return fb;
    h = h.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return '#' + h.toLowerCase();
  }
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const luminance = h => { const c = rgb(h); return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); };
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const readableOn = bg => (contrast(bg, '#17171C') >= contrast(bg, '#FFFFFF') ? '#17171C' : '#FFFFFF');

  function safeImg(src) {
    if (typeof src !== 'string') return '';
    if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i.test(src.slice(0, 64))) return src;
    if (src.length < 2000 && /^https?:\/\/[^\s"'<>]+$/i.test(src)) return src;
    return '';
  }
  const safeUrl = u => { u = String(u || '').trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; };
  const telDigits = s => String(s || '').replace(/[^\d+]/g, '');
  const igHandle = s => String(s || '').trim().replace(/^.*instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');

  /* Tiny formatter: blank line = new paragraph, **bold**, *italic*. Escapes first. */
  function fmt(text) {
    const paras = String(text || '').replace(/\r/g, '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    return paras.map(p => '<p>' + esc(p)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\n/g, '<br>') + '</p>').join('');
  }

  const idStr = v => String(v == null ? '' : v).replace(/[^a-z0-9_-]/gi, '').slice(0, 20);
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const bool = (v, dv) => (v === undefined ? dv : !(v === false || v === 'false' || v === 0));
  const money = v => { const n = Number(v); return isFinite(n) && n > 0 ? Math.min(1e7, Math.round(n * 100) / 100) : 0; };
  const RS = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const EMAIL = /^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]{2,}$/;
  const UPI = /^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$/i;

  /* ------------------------------------------------------------------ */
  /* Rich text: anything typed or pasted is rebuilt from a short whitelist */
  /* ------------------------------------------------------------------ */
  const decEnt = t => t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
  function cssColor(v) {
    v = String(v || '').trim().toLowerCase();
    if (HEX.test(v)) return hex6(v, '');
    const m = v.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/);
    return m ? toHex([+m[1], +m[2], +m[3]]) : '';
  }
  function cssClean(style, block) {
    const out = [];
    decEnt(String(style || '')).split(';').forEach(d => {
      const i = d.indexOf(':'); if (i < 0) return;
      const p = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).trim().toLowerCase(), raw = d.slice(i + 1).trim();
      if (block) { if (p === 'text-align' && /^(left|center|right|justify)$/.test(v)) out.push('text-align:' + v); return; }
      let m;
      if (p === 'color') { const c = cssColor(v); if (c) out.push('color:' + c); }
      else if (p === 'background-color' || p === 'background') { const c = cssColor(v); if (c) out.push('background-color:' + c); }
      else if (p === 'font-size') {
        m = v.match(/(\d+(?:\.\d+)?)px/);
        if (m) { const n = Math.max(8, Math.min(200, Math.round(+m[1]))); out.push('font-size:max(min(' + n + 'px,16px),calc(' + n + 'px*var(--ws,1)))'); }
      }
      else if (p === 'font-family') {
        const first = raw.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
        const f = WORD_FONTS.find(x => x.id.toLowerCase() === first);
        if (f) out.push('font-family:' + f.stack);
      }
      else if (p === 'letter-spacing') { m = v.match(/^(-?\d+(?:\.\d+)?)px$/); if (m) out.push('letter-spacing:' + Math.max(-3, Math.min(30, +m[1])) + 'px'); }
      else if (p === 'font-weight') { if (/^(bold|[6-9]00)$/.test(v)) out.push('font-weight:700'); else if (/^(normal|[1-4]00)$/.test(v)) out.push('font-weight:400'); }
      else if (p === 'font-style') { if (v === 'italic') out.push('font-style:italic'); }
      else if (p === 'text-decoration' || p === 'text-decoration-line') {
        const u = /underline/.test(v), t = /line-through/.test(v);
        if (u || t) out.push('text-decoration:' + (u ? 'underline' : '') + (u && t ? ' ' : '') + (t ? 'line-through' : ''));
      }
    });
    return out.join(';');
  }
  const RT_INLINE = { strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u', s: 's', strike: 's', del: 's', sub: 'sub', sup: 'sup' };
  const RT_BLOCK = { p: 'p', div: 'p', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', li: 'li', blockquote: 'blockquote' };
  const RT_FLOW = { p: 1, h1: 1, h2: 1, h3: 1, h4: 1 };
  const RT_MAX = 12000;
  function cleanHtml(html) {
    html = String(html == null ? '' : html).slice(0, 60000)
      .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript|head|title)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
    const parts = html.split(/(<[^>]*>)/), stack = [];
    let out = '';
    const closeTo = n => { while (stack.length > n) { const e = stack.pop(); if (e.e) out += '</' + e.t + '>'; } };
    const attr = (a, n) => { const m = a.match(new RegExp('(?:^|\\s)' + n + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? decEnt(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : ''; };
    const inPara = () => stack.some(e => e.t === 'p' || e.t === 'li' || /^h\d$/.test(e.t) || e.t === 'blockquote');
    const ensurePara = () => { if (!inPara()) { out += '<p>'; stack.push({ t: 'p', e: true }); } };
    for (let k = 0; k < parts.length && out.length < RT_MAX; k++) {
      const part = parts[k];
      if (!part) continue;
      if (part.charAt(0) !== '<') {
        const txt = decEnt(part).replace(/[\r\n\t]+/g, ' ');
        if (!txt.trim() && !stack.length) continue;
        if (txt) { if (txt.trim()) ensurePara(); out += esc(txt); }
        continue;
      }
      const m = part.match(/^<(\/?)([a-z][a-z0-9]*)([\s\S]*?)\/?>$/i);
      if (!m) continue;
      const closing = !!m[1], name = m[2].toLowerCase(), at = m[3];
      const tag = RT_INLINE[name] || RT_BLOCK[name] || (name === 'ul' || name === 'ol' ? name : (name === 'span' || name === 'font' || name === 'a' ? name : ''));
      if (closing) {
        if (!tag) continue;
        const want = RT_INLINE[name] || RT_BLOCK[name] || name;
        let idx = -1;
        for (let j = stack.length - 1; j >= 0; j--) if (stack[j].t === want || (name === 'font' && stack[j].t === 'span')) { idx = j; break; }
        if (idx >= 0) closeTo(idx);
        continue;
      }
      if (name === 'br') { ensurePara(); out += '<br>'; continue; }
      if (name === 'hr') { closeTo(0); out += '<hr>'; continue; }
      if (!tag) continue;
      if (RT_BLOCK[name]) {
        const t = RT_BLOCK[name];
        if (t !== 'li') { while (stack.length && RT_FLOW[stack[stack.length - 1].t]) closeTo(stack.length - 1); }
        if (t === 'li') {
          for (let j = stack.length - 1; j >= 0 && stack[j].t !== 'ul' && stack[j].t !== 'ol'; j--) if (stack[j].t === 'li') { closeTo(j); break; }
        }
        if (t === 'li' && !stack.some(e => e.t === 'ul' || e.t === 'ol')) { out += '<ul>'; stack.push({ t: 'ul', e: true }); }
        const st = cssClean(attr(at, 'style'), true);
        out += '<' + t + (st ? ' style="' + st + '"' : '') + '>'; stack.push({ t: t, e: true }); continue;
      }
      if (name === 'ul' || name === 'ol') {
        while (stack.length && RT_FLOW[stack[stack.length - 1].t]) closeTo(stack.length - 1);
        out += '<' + name + '>'; stack.push({ t: name, e: true }); continue;
      }
      ensurePara();
      if (RT_INLINE[name]) { const t = RT_INLINE[name]; out += '<' + t + '>'; stack.push({ t: t, e: true }); continue; }
      if (name === 'a') {
        const h = attr(at, 'href').trim();
        const ok = safeUrl(h) || (/^mailto:[^\s"'<>]+$/i.test(h) ? h : '') || (/^tel:[+\d\s()-]+$/i.test(h) ? h.replace(/\s/g, '') : '');
        if (ok) { out += '<a href="' + esc(ok) + '"' + (/^https?:/i.test(ok) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>'; stack.push({ t: 'a', e: true }); }
        else stack.push({ t: 'a', e: false });
        continue;
      }
      // span / font
      let st = cssClean(attr(at, 'style'), false);
      if (name === 'font') { const c = cssColor(attr(at, 'color')); if (c) st = 'color:' + c + (st ? ';' + st : ''); }
      if (st) { out += '<span style="' + st + '">'; stack.push({ t: 'span', e: true }); } else stack.push({ t: 'span', e: false });
    }
    closeTo(0);
    return out;
  }
  /* One-line version (headline, tagline): no paragraphs or lists, just styled words. */
  const cleanInline = h => cleanHtml(h).replace(/<\/p>\s*<p[^>]*>/g, '<br>').replace(/<\/?(?:p|h[1-4]|ul|ol|li|blockquote|hr)[^>]*>/g, '').slice(0, 1500);
  const richText = h => String(h || '').replace(/<(?:br|\/p|\/h[1-4]|\/li|\/blockquote)[^>]*>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  /* ------------------------------------------------------------------ */
  /* Normalization — the only door into the renderer                    */
  /* ------------------------------------------------------------------ */
  function normStyle(s) {
    s = s && typeof s === 'object' ? s : {};
    const d = STYLE_DEFAULT;
    return {
      vibe: typeof s.vibe === 'string' ? s.vibe.slice(0, 20) : 'custom',
      bg: hex6(s.bg, d.bg), ink: hex6(s.ink, d.ink), accent: hex6(s.accent, d.accent), accent2: hex6(s.accent2, d.accent2),
      headFont: headFont(s.headFont).id, bodyFont: bodyFont(s.bodyFont).id,
      radius: pick(s.radius, ['sharp', 'soft', 'round'], d.radius),
      edge: pick(s.edge, ['clean', 'bold'], d.edge),
      space: pick(s.space, ['compact', 'cozy', 'airy'], d.space),
      align: pick(s.align, ['left', 'center'], d.align),
      btn: pick(s.btn, ['solid', 'glass', 'outline', 'gradient'], d.btn),
      cards: pick(s.cards, ['flat', 'glass'], d.cards),
      motion: pick(s.motion, ['none', 'parallax', 'zoom'], d.motion),
    };
  }

  function normSite(s) {
    s = s && typeof s === 'object' ? s : {};
    return {
      nav: pick(s.nav, ['bar', 'center', 'off'], SITE_D.nav), logo: bool(s.logo, true),
      title: str(s.title, 60), ctaLabel: str(s.ctaLabel, 30), ctaGoto: idStr(s.ctaGoto), ctaLink: str(s.ctaLink, 400),
      footer: bool(s.footer, true), footNote: str(s.footNote, 200),
      phone: str(s.phone, 30), whatsapp: str(s.whatsapp, 30), instagram: str(s.instagram, 60), email: str(s.email, 80),
      announce: str(s.announce, 120), announceLink: str(s.announceLink, 400), announceTone: pick(s.announceTone, ['accent', 'ink', 'pop'], 'accent'),
    };
  }

  function normProduct(p) {
    if (!p || typeof p !== 'object') return null;
    return {
      id: idStr(p.id) || uid(), name: str(p.name, 80), price: money(p.price), mrp: money(p.mrp), imgId: idStr(p.imgId),
      desc: str(p.desc, 400), cat: str(p.cat, 30).trim(), tag: str(p.tag, 20), out: bool(p.out, false),
      stock: Math.max(0, Math.min(999, Math.round(Number(p.stock) || 0))), optName: str(p.optName, 20).trim(), opts: str(p.opts, 400),
    };
  }

  function normCoupons(v) {
    return (Array.isArray(v) ? v : []).slice(0, 8).map(c => {
      c = c && typeof c === 'object' ? c : {};
      const kind = c.kind === 'flat' ? 'flat' : 'pct';
      return { code: String(c.code == null ? '' : c.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16), kind: kind,
               value: Math.min(kind === 'pct' ? 100 : 1e6, money(c.value)), min: money(c.min) };
    });
  }
  /* "250 g | 450" lines → [{label, price|null}] (price blank = same as the product) */
  function parseOpts(p) {
    return String(p.opts || '').split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 8).map(line => {
      const i = line.lastIndexOf('|'); let label = line, price = null;
      if (i > 0 && line.slice(i + 1).trim() !== '') {
        const n = Number(line.slice(i + 1).replace(/[₹,\s]/g, ''));
        if (isFinite(n) && n >= 0) { label = line.slice(0, i).trim(); price = n; }
      }
      return { label: label.slice(0, 40), price: price };
    }).filter(o => o.label);
  }
  const optLow = p => { const os = parseOpts(p); return os.length ? Math.min.apply(null, os.map(o => o.price == null ? p.price : o.price)) : p.price; };
  function optCtl(p, cart) {
    const n = Object.keys(cart || {}).reduce((a, id) => a + (id.indexOf(p.id + '~') === 0 ? cart[id] : 0), 0);
    return '<button type="button" class="ab-add" data-shop="view" data-pid="' + esc(p.id) + '">' + (n ? 'In cart (' + n + ') · options' : 'Choose options') + '</button>';
  }

  function normShop(sh) {
    sh = sh && typeof sh === 'object' ? sh : {};
    const st = sh.settings && typeof sh.settings === 'object' ? sh.settings : {};
    const seen = {};
    const products = (Array.isArray(sh.products) ? sh.products : []).slice(0, MAX_PRODUCTS).map(normProduct).filter(Boolean)
      .map(p => { while (seen[p.id]) p.id = uid(); seen[p.id] = 1; return p; });
    return {
      settings: {
        whatsapp: str(st.whatsapp, 30), upi: str(st.upi, 60).trim(), payee: str(st.payee, 60),
        pickup: bool(st.pickup, true), delivery: bool(st.delivery, false), fee: money(st.fee), min: money(st.min), note: str(st.note, 200),
        payCash: bool(st.payCash, true), payUpi: bool(st.payUpi, true), payOnline: bool(st.payOnline, false), serverOrders: bool(st.serverOrders, false),
        freeAbove: money(st.freeAbove), slots: str(st.slots, 240), eta: str(st.eta, 60), coupons: normCoupons(st.coupons),
      },
      products: products,
    };
  }

  function normRows(key, v, dv) {
    const spec = ROWS[key];
    const src = Array.isArray(v) ? v : dv;
    return src.slice(0, spec.max).map(r => {
      const o = {};
      Object.keys(spec.f).forEach(f => { o[f] = String((r && r[f]) == null ? '' : r[f]).slice(0, spec.f[f]); });
      return o;
    });
  }

  function normBlock(b) {
    if (!b || typeof b !== 'object' || !BD[b.type]) return null;
    const type = b.type, d = BD[type], out = { id: idStr(b.id) || uid(), type: type };
    Object.keys(d).forEach(k => {
      const dv = d[k], v = (b[k] === undefined ? dv : b[k]), full = type + '.' + k;
      if (k === 'imgIds') {
        out[k] = (Array.isArray(v) ? v : []).map(idStr).slice(0, MAX_IMAGES);
      } else if (full === 'words.html') {
        out[k] = cleanHtml(v);
      } else if (full === 'hero.titleHtml' || full === 'hero.tagHtml') {
        out[k] = cleanInline(v);
      } else if (full === 'words.color') {
        out[k] = hex6(v, '');
      } else if (Array.isArray(dv)) {
        out[k] = normRows(full, v, dv);
      } else if (typeof dv === 'boolean') {
        out[k] = bool(v, dv);
      } else if (typeof dv === 'number') {
        const r = NUM[full] || NUM[k] || [-1e9, 1e9];
        const n = Number(v);
        out[k] = isFinite(n) ? Math.max(r[0], Math.min(r[1], Math.round(n))) : dv;
      } else {
        const en = EN[full] || EN['*.' + k];
        if (en) out[k] = en.indexOf(String(v)) >= 0 ? String(v) : dv;
        else if (k === 'imgId' || k === 'goto') out[k] = idStr(v);
        else out[k] = String(v == null ? '' : v).slice(0, LIM[k] || LIM.default);
      }
    });
    return out;
  }

  function normalize(layout) {
    if (typeof layout === 'string') { try { layout = JSON.parse(layout); } catch (e) { layout = null; } }
    layout = layout && typeof layout === 'object' ? layout : {};
    const seen = {};
    const images = (Array.isArray(layout.images) ? layout.images : []).map(im => {
      const id = idStr(im && im.id);
      const src = safeImg(im && im.src);
      if (!id || !src || seen[id]) return null;
      seen[id] = 1;
      return im.k === 'p' ? { id: id, src: src, k: 'p' } : { id: id, src: src };
    }).filter(Boolean).slice(0, MAX_IMAGES);
    const ids = {};
    const blocks = (Array.isArray(layout.blocks) ? layout.blocks : []).slice(0, MAX_BLOCKS).map(normBlock).filter(Boolean)
      .map(b => { while (ids[b.id]) b.id = uid(); ids[b.id] = 1; return b; });
    return { v: 2, style: normStyle(layout.style), site: normSite(layout.site), shop: normShop(layout.shop), images: images, blocks: blocks };
  }

  function newBlock(type) {
    const b = clone(BD[type]);
    b.id = uid(); b.type = type;
    return b;
  }
  function newProduct() { const p = clone(PRODUCT_D); p.id = uid(); return p; }

  /* ------------------------------------------------------------------ */
  /* Seeds                                                              */
  /* ------------------------------------------------------------------ */
  function hasLegacy(cafe) {
    return !!(cafe && ((cafe.about_text && String(cafe.about_text).trim()) || (Array.isArray(cafe.about_photos) && cafe.about_photos.length)));
  }

  /* Old cafes only have about_text + about_photos — turn those into a nice page. */
  function fromLegacy(cafe) {
    const imgs = (Array.isArray(cafe.about_photos) ? cafe.about_photos : []).map(safeImg).filter(Boolean).slice(0, MAX_SHELF)
      .map((src, i) => ({ id: 'p' + (i + 1), src: src }));
    const blocks = [];
    const hero = newBlock('hero'); hero.imgId = imgs[0] ? imgs[0].id : ''; blocks.push(hero);
    if (cafe.about_text && String(cafe.about_text).trim()) {
      const t = newBlock('text'); t.heading = 'Our story'; t.body = String(cafe.about_text); t.navLabel = 'Story'; blocks.push(t);
    }
    if (imgs.length > 1) { const g = newBlock('gallery'); g.imgIds = imgs.slice(1).map(i => i.id); g.navLabel = 'Photos'; blocks.push(g); }
    const v = newBlock('visit'); v.navLabel = 'Visit'; blocks.push(v);
    return normalize({ style: STYLE_DEFAULT, images: imgs, blocks: blocks });
  }

  /* Brand-new page in the studio: an all-empty skeleton (nothing fake can go live). */
  function starter() {
    const b = t => newBlock(t);
    const hero = b('hero'), text = b('text'), hl = b('highlights'), shop = b('shop'), hours = b('hours'), visit = b('visit'), book = b('book');
    text.navLabel = 'Story'; shop.navLabel = 'Shop'; visit.navLabel = 'Visit'; book.navLabel = 'Book';
    hours.width = 'half'; visit.width = 'half';
    return normalize({ style: STYLE_DEFAULT, images: [], blocks: [hero, b('ribbon'), text, b('photo'), hl, shop, hours, visit, book] });
  }

  function hotelStarter() {
    const b = t => newBlock(t);
    const hero = b('hero'), text = b('text'), rooms = b('rooms'), banquet = b('banquet'), gal = b('gallery'), visit = b('visit');
    hero.tagline = 'Rest, dine and celebrate'; hero.btnLabel = 'Check availability'; hero.goto = rooms.id;
    text.heading = 'Welcome'; text.navLabel = 'About';
    rooms.navLabel = 'Rooms'; banquet.navLabel = 'Banquets'; gal.heading = 'Gallery'; gal.navLabel = 'Gallery'; visit.navLabel = 'Find us';
    return normalize({ style: STYLE_DEFAULT, images: [], blocks: [hero, text, rooms, banquet, gal, visit] });
  }

  /* One-tap website templates, by kind of business. Each is a block order + a vibe (colours, fonts, effects). */
  const TEMPLATES = [
    { id: 'h-classic', kind: 'hotel', name: 'Classic hotel', blurb: 'Welcome, rooms, banquets, gallery, find us', vibe: 'editorial', blocks: ['hero', 'text', 'rooms', 'banquet', 'gallery', 'visit'] },
    { id: 'h-resort', kind: 'hotel', name: 'Resort showcase', blurb: 'Big photos first, glass buttons, parallax', vibe: 'ocean', blocks: ['hero', 'gallery', 'text', 'rooms', 'banquet', 'visit'] },
    { id: 'h-boutique', kind: 'hotel', name: 'Boutique stay', blurb: 'Quiet and elegant: story, rooms, gallery', vibe: 'boutique', blocks: ['hero', 'text', 'rooms', 'gallery', 'visit'] },
    { id: 'h-night', kind: 'hotel', name: 'Modern glass', blurb: 'Dark, glassy, rooms up front', vibe: 'aurora', blocks: ['hero', 'rooms', 'text', 'gallery', 'banquet', 'visit'] },
    { id: 'c-classic', kind: 'cafe', name: 'Classic café', blurb: 'Story, highlights, shop, hours, visit', vibe: 'editorial', blocks: ['hero', 'ribbon', 'text', 'photo', 'highlights', 'shop', 'hours', 'visit', 'book'] },
    { id: 'c-menu', kind: 'cafe', name: 'Menu first', blurb: 'Straight to what you sell', vibe: 'mint', blocks: ['hero', 'shop', 'highlights', 'hours', 'visit'] },
    { id: 'c-pop', kind: 'cafe', name: 'Pop one-pager', blurb: 'Bold, loud, easy to share', vibe: 'pop', blocks: ['hero', 'ribbon', 'text', 'highlights', 'book', 'visit'] },
    { id: 'c-night', kind: 'cafe', name: 'Late-night lounge', blurb: 'Dark and glassy for evenings', vibe: 'aurora', blocks: ['hero', 'text', 'shop', 'hours', 'visit'] },
  ];
  function fromTemplate(id) {
    const t = TEMPLATES.find(x => x.id === id); if (!t) return null;
    const v = VIBES.find(x => x.id === t.vibe) || VIBES[0];
    const blocks = t.blocks.map(ty => newBlock(ty));
    const by = ty => blocks.find(b => b.type === ty);
    const hero = by('hero'), rooms = by('rooms'), text = by('text'), gal = by('gallery'), vis = by('visit'), ban = by('banquet');
    if (t.kind === 'hotel') { hero.tagline = 'Rest, dine and celebrate'; hero.btnLabel = 'Check availability'; if (rooms) hero.goto = rooms.id; if (text) { text.heading = 'Welcome'; text.navLabel = 'About'; } if (rooms) rooms.navLabel = 'Rooms'; if (ban) ban.navLabel = 'Banquets'; if (gal) { gal.heading = 'Gallery'; gal.navLabel = 'Gallery'; } if (vis) vis.navLabel = 'Find us'; }
    else { const shop = by('shop'), hours = by('hours'), book = by('book'); if (text) text.navLabel = 'Story'; if (shop) shop.navLabel = 'Shop'; if (vis) vis.navLabel = 'Visit'; if (book) book.navLabel = 'Book'; if (hours && vis) { hours.width = 'half'; vis.width = 'half'; } }
    return normalize({ style: Object.assign({}, STYLE_DEFAULT, v.style, { vibe: v.id }), images: [], blocks: blocks });
  }

  function rawLayout(cafe) {
    let l = cafe && cafe.about_layout;
    if (typeof l === 'string') { try { l = JSON.parse(l); } catch (e) { l = null; } }
    return l && typeof l === 'object' && Array.isArray(l.blocks) ? l : null;
  }

  /* What customers see: saved layout → legacy fields → null (nothing to show). */
  function resolve(cafe) {
    const l = rawLayout(cafe);
    if (l) return normalize(l);
    if (hasLegacy(cafe)) return fromLegacy(cafe);
    return null;
  }
  /* What the studio opens with. */
  function resolveForEdit(cafe) {
    return resolve(cafe) || (cafe && cafe.business_type === 'hotel' ? hotelStarter() : starter());
  }

  /* ------------------------------------------------------------------ */
  /* Fonts loader                                                       */
  /* ------------------------------------------------------------------ */
  function loadFonts(style, everything) {
    const fams = [];
    if (everything) { HEAD_FONTS.forEach(f => fams.push(f.gf)); BODY_FONTS.forEach(f => fams.push(f.gf)); WORD_FONTS.forEach(f => { if (fams.indexOf(f.gf) < 0) fams.push(f.gf); }); }
    else if (style) { fams.push(headFont(style.headFont).gf, bodyFont(style.bodyFont).gf); }
    const doc = root.document;
    if (!doc || !fams.length) return;
    const href = 'https://fonts.googleapis.com/css2?' + fams.map(f => 'family=' + f).join('&') + '&display=swap';
    const id = 'ab-fonts-' + (everything ? 'all' : 'page');
    let link = doc.getElementById(id);
    if (!link) { link = doc.createElement('link'); link.id = id; link.rel = 'stylesheet'; doc.head.appendChild(link); }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }

  /* ------------------------------------------------------------------ */
  /* Cart (per cafe, in this browser only)                              */
  /* ------------------------------------------------------------------ */
  const CARTS = {};     // cart key → { productId: qty }
  const SHOPS = {};     // cart key → { byId, order, settings, to, cafeName } — registered by each live render
  const cartKey = cafe => 'ab-cart-' + (String(cafe && cafe.id != null ? cafe.id : 'page').replace(/[^\w-]/g, '') || 'page');
  function loadCart(k) {
    if (CARTS[k]) return CARTS[k];
    let c = {};
    try { c = JSON.parse(root.localStorage.getItem(k) || '{}') || {}; } catch (e) { c = {}; }
    CARTS[k] = c && typeof c === 'object' ? c : {};
    return CARTS[k];
  }
  function saveCart(k) { try { root.localStorage.setItem(k, JSON.stringify(CARTS[k] || {})); } catch (e) { /* private mode */ } }
  /* Drops anything that no longer exists, is sold out, or has a silly quantity. */
  function cleanCart(k, byId) {
    const c = loadCart(k);
    Object.keys(c).forEach(id => {
      const q = Math.round(Number(c[id]));
      if (!byId[id] || byId[id].out || byId[id].noadd || !(q > 0)) delete c[id]; else c[id] = Math.min(byId[id].stock > 0 ? byId[id].stock : 99, q);
    });
    return c;
  }
  const cartCount = c => Object.keys(c).reduce((n, id) => n + c[id], 0);
  const cartSub = (c, byId) => Object.keys(c).reduce((n, id) => n + (byId[id] ? byId[id].price * c[id] : 0), 0);
  /* Where shop orders go: the shop's own WhatsApp, else the site's. */
  function orderTo(L) {
    const wa = telDigits(L.shop.settings.whatsapp || L.site.whatsapp).replace(/^\+/, '');
    return wa.length >= 6 ? wa : '';
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                          */
  /* ------------------------------------------------------------------ */
  const SAMPLE = {
    text:       { heading: 'Our story', body: 'Tell people why this place exists — the first cup, the recipe that started it all, the corner you fell in love with.\n\nUse a **blank line** for a new paragraph.' },
    words:      { html: '<h2>Write it your way</h2><p>Pick any <strong>font</strong>, make words <span style="color:#B96A45">any colour</span> or <span style="font-size:max(min(28px,16px),calc(28px*var(--ws,1)))">any size</span>, add a photo and let the text wrap around it.</p><p>Use the toolbar in the editor: headings, lists, links, alignment, spacing — it works like a document.</p>' },
    quote:      { text: 'The kind of place you plan to stay 20 minutes and leave 3 hours later.', by: 'A happy regular' },
    highlights: { heading: 'Why people love it', rows: [{ emoji: '', title: 'Freshly brewed', text: 'Made the slow way' }, { emoji: '', title: 'Good music', text: 'Always the right mood' }, { emoji: '', title: 'Baked daily', text: 'Sweet things, made here' }] },
    hours:      { heading: 'Opening hours', rows: [{ day: 'Mon – Fri', time: '8:00 am – 10:00 pm' }, { day: 'Sat – Sun', time: '9:00 am – 11:00 pm' }] },
    ribbon:     { text: 'Fresh brew, Good company, Come as you are' },
    book:       { whatsapp: '919999999999', email: 'hello@example.com' },
    cta:        { heading: 'Come hungry, leave happy', text: 'Walk-ins welcome all day.', btnLabel: 'Book a table' },
    faq:        { heading: 'Questions people ask', rows: [{ q: 'Do you take walk-ins?', a: 'Always — we only need a booking for groups of 8 or more.' }, { q: 'Is there parking?', a: 'Yes, free parking right outside.' }] },
    list:       { heading: 'Menu', rows: [{ name: 'Filter coffee', price: '₹90', text: 'South Indian style' }, { name: 'Cold brew', price: '₹180', text: '' }, { name: 'Butter croissant', price: '₹120', text: 'Baked every morning' }] },
    video:      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    shop:       {},
    rooms:      {},
    banquet:    {},
  };
  const SAMPLE_PRODUCTS = [
    { id: 's1', name: 'House blend beans, 250 g', price: 450, mrp: 0, imgId: '', desc: 'The coffee we pour every morning, to brew at home.', cat: 'Coffee', tag: 'Bestseller', out: false },
    { id: 's2', name: 'Cold brew bottle', price: 180, mrp: 220, imgId: '', desc: 'Steeped overnight. Keeps for five days chilled.', cat: 'Coffee', tag: '', out: false },
    { id: 's3', name: 'Tote bag', price: 350, mrp: 0, imgId: '', desc: 'Heavy cotton, printed in town.', cat: 'Merch', tag: '', out: false },
  ];
  const SAMPLE_TYPES = Object.keys(SAMPLE);

  function shopList(b, c) {
    if (c.cur && c.cur.sample) return SAMPLE_PRODUCTS;
    return b.show ? c.shop.products.filter(p => p.cat === b.show) : c.shop.products;
  }

  /* Only YouTube and Vimeo links are turned into players. */
  function videoSrc(url) {
    url = String(url || '').trim();
    let m = url.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})(?:[?&#/]|$)/i);
    if (m) return 'https://www.youtube-nocookie.com/embed/' + m[1];
    m = url.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?(\d{5,12})(?:[?&#/]|$)/i);
    return m ? 'https://player.vimeo.com/video/' + m[1] : '';
  }
  function announceHtml(L) {
    const s = L.site, t = s.announce.trim(); if (!t) return '';
    const url = safeUrl(s.announceLink);
    return '<div class="ab-ann ab-ann-' + s.announceTone + '" role="note">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + ' <span aria-hidden="true">→</span></a>' : '<span>' + esc(t) + '</span>') + '</div>';
  }

  function isEmpty(b, ctx) {
    switch (b.type) {
      case 'text':       return !b.body.trim() && !b.heading.trim();
      case 'words':      return !richText(b.html) && !ctx.img(b.imgId);
      case 'photo':      return !ctx.img(b.imgId);
      case 'split':      return !ctx.img(b.imgId) && !b.body.trim() && !b.heading.trim();
      case 'gallery':    return !b.imgIds.some(id => ctx.img(id));
      case 'shop':       return !shopList(b, { shop: ctx.shop }).length;
      case 'highlights': return !b.rows.some(r => r.title.trim() || r.text.trim());
      case 'quote':      return !b.text.trim();
      case 'cta':        return !b.heading.trim() && !b.text.trim();
      case 'hours':      return !b.rows.some(r => r.day.trim() || r.time.trim());
      case 'ribbon':     return !phrases(b.text).length;
      case 'faq':        return !b.rows.some(r => r.q.trim() && r.a.trim());
      case 'list':       return !b.rows.some(r => r.name.trim());
      case 'video':      return !videoSrc(b.url);
      case 'book':       return !bookBits(b).any;
      case 'visit':      return !visitBits(b, ctx.cafe).any;
      case 'rooms':      return !(((ctx.cafe || {}).hotel || {}).types || []).length;
      case 'banquet':    return !(((ctx.cafe || {}).hotel || {}).halls || []).length;
      default:           return false;
    }
  }

  const phrases = t => String(t || '').split(/[\n,•✦]+/).map(s => s.trim()).filter(Boolean).slice(0, 12);

  function visitBits(b, cafe) {
    cafe = cafe || {};
    const address = b.showAddress ? String(cafe.address_text || cafe.address || '').trim() : '';
    const phone = telDigits(b.phone || cafe.phone);
    const wa = telDigits(b.whatsapp).replace(/^\+/, '');
    const ig = igHandle(b.instagram);
    let dir = '';
    if (b.showDirections) {
      dir = safeUrl(b.mapsUrl);
      if (!dir && cafe.latitude != null && cafe.longitude != null && isFinite(cafe.latitude) && isFinite(cafe.longitude)) {
        dir = 'https://www.google.com/maps/dir/?api=1&destination=' + Number(cafe.latitude) + ',' + Number(cafe.longitude);
      }
      if (!dir && address) dir = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
    }
    return { address: address, phone: phone, wa: wa.length >= 6 ? wa : '', ig: ig, dir: dir, any: !!(address || phone || wa.length >= 6 || ig || dir) };
  }

  /* Where can a booking go? WhatsApp falls back to the block's own call number; nothing is borrowed from elsewhere. */
  function bookBits(b) {
    const phone = telDigits(b.phone);
    const wa = telDigits(b.whatsapp || b.phone).replace(/^\+/, '');
    const waOk = wa.length >= 6 ? wa : '';
    const email = EMAIL.test(String(b.email || '').trim()) ? String(b.email).trim() : '';
    const link = safeUrl(b.link);
    const form = b.mode === 'form' && ((b.via === 'whatsapp' && !!waOk) || (b.via === 'email' && !!email));
    return { phone: phone, wa: waOk, email: email, link: link, form: form, any: !!(waOk || phone || email || link) };
  }
  const localToday = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const linkBtn = (href, label, solid, ext) => '<a class="ab-btn' + (solid ? ' ab-btn-solid' : '') + '" href="' + esc(href) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';

  /* A button that either opens a web link or scrolls to another section on the page.
     A target section that isn't showing simply drops the button (it'd go nowhere). */
  function goBtn(label, gotoId, link, c, cls) {
    label = String(label || '').trim();
    if (!label) return '';
    const url = safeUrl(link);
    if (url) return '<a class="' + cls + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>';
    if (gotoId && c.ids[gotoId]) return '<a class="' + cls + '" href="#s-' + esc(gotoId) + '" data-go="' + esc(gotoId) + '">' + esc(label) + '</a>';
    return c.preview ? '<span class="' + cls + '">' + esc(label) + '</span>' : '';
  }

  const eyebrow = t => (t ? '<div class="ab-eyebrow">' + esc(t) + '</div>' : '');
  const h2 = t => (t ? '<h2 class="ab-h2">' + esc(t) + '</h2>' : '');

  function figure(src, o, caption) {
    const ratio = o.shape === 'circle' ? '1/1' : o.ratio;
    const st = [];
    if (ratio && ratio !== 'auto') st.push('--ratio:' + ratio);
    if (o.tilt) st.push('--tilt:' + o.tilt + 'deg');
    const cap = caption ? '<figcaption class="ab-cap">' + esc(caption) + '</figcaption>' : '';
    return '<figure class="ab-fig ab-sh-' + o.shape + ' ab-fr-' + o.frame + (ratio === 'auto' ? ' ab-ratio-auto' : '') + '"' + (st.length ? ' style="' + st.join(';') + '"' : '') + '>' +
      '<div class="ab-fig-in"><img src="' + esc(src) + '" alt="' + esc(caption || '') + '" loading="lazy" decoding="async"></div>' + cap + '</figure>';
  }

  function placeholder(icon, text) {
    return '<div class="ab-ph"><span>' + icon + '</span>' + esc(text) + '</div>';
  }

  /* Stamps each block's root tag: its anchor (#s-id, for the top menu), which block it is (tap-to-edit
     in the studio), its stagger index for the entrance animation, and whether it is sample copy. */
  const rootAttrs = (c, extra) => ' id="s-' + esc(c.cur.bid) + '" data-bid="' + esc(c.cur.bid) + '"' + (c.cur.sample ? ' data-sample="1"' : '') +
    ' style="--i:' + c.cur.i + (extra ? ';' + extra : '') + '"';

  /* Shop bits */
  const prodInitial = p => esc((String(p.name).trim().charAt(0) || '•').toUpperCase());
  function prodMedia(p, c, cls) {
    const src = c.img(p.imgId);
    return src ? '<img class="' + cls + '" src="' + esc(src) + '" alt="" loading="lazy" decoding="async">'
      : '<span class="' + cls + ' ab-prod-ph" aria-hidden="true">' + prodInitial(p) + '</span>';
  }
  const priceHtml = p => '<span class="ab-price">' + RS(p.price) + (p.mrp > p.price ? ' <s>' + RS(p.mrp) + '</s>' : '') + '</span>';
  /* Amazon-style price: big price, struck-through M.R.P., "% off" */
  const offPct = p => (p.mrp > p.price && p.price > 0) ? Math.round((p.mrp - p.price) / p.mrp * 100) : 0;
  const priceBlock = p => '<span class="ab-pb"><b class="ab-pb-now">' + RS(p.price) + '</b>' + (offPct(p) ? '<s class="ab-pb-mrp">' + RS(p.mrp) + '</s><em class="ab-pb-off">' + offPct(p) + '% off</em>' : '') + '</span>';
  function deliveryHtml(st) {
    st = st || {}; const out = [];
    if (st.delivery) out.push(Number(st.fee) > 0 ? 'Delivery ' + RS(st.fee) : '<b>FREE</b> delivery');
    if (st.pickup) out.push('Pick up at the café');
    return out.join(' · ');
  }
  function buyCtl(id, qty, name) {
    return qty > 0
      ? '<span class="ab-step"><button type="button" data-shop="dec" data-pid="' + esc(id) + '" aria-label="One less ' + esc(name) + '">−</button><b aria-live="polite">' + qty + '</b>' +
        '<button type="button" data-shop="inc" data-pid="' + esc(id) + '" aria-label="One more ' + esc(name) + '">+</button></span>'
      : '<button type="button" class="ab-add" data-shop="inc" data-pid="' + esc(id) + '">Add to cart</button>';
  }

  const RENDER = {
    hero(b, c) {
      const src = c.img(b.imgId);
      const title = b.title.trim() || (c.cafe && c.cafe.name) || 'Welcome';
      const btn = goBtn(b.btnLabel, b.goto, b.link, c, 'ab-btn ab-btn-solid ab-hero-btn');
      const head = (b.badge ? '<span class="ab-badge">' + esc(b.badge) + '</span>' : '') +
        '<h1 class="ab-hero-title ab-ts-' + b.titleSize + '">' + (b.titleHtml && richText(b.titleHtml) ? b.titleHtml : esc(title)) + '</h1>' +
        (b.tagHtml && richText(b.tagHtml) ? '<p class="ab-hero-tag">' + b.tagHtml + '</p>' : b.tagline ? '<p class="ab-hero-tag">' + esc(b.tagline) + '</p>' : '') +
        (btn ? '<div class="ab-hero-acts">' + btn + '</div>' : '');
      if (src && b.look === 'split') {
        return '<section class="ab-b ab-t-hero ab-hero-split ab-h-' + b.height + ' ab-ha-' + b.align + '"' + rootAttrs(c) + '>' +
          '<div class="ab-hs-in"><div class="ab-hs-text">' + head + '</div>' +
          '<div class="ab-hs-media"><img src="' + esc(src) + '" alt=""></div></div></section>';
      }
      return '<section class="ab-b ab-t-hero ab-h-' + b.height + ' ab-ha-' + b.align + (src ? ' ab-hero-photo' : ' ab-hero-plain') + '"' + rootAttrs(c, '--ov:' + (b.overlay / 100).toFixed(2)) + '>' +
        (src ? '<img class="ab-hero-img" src="' + esc(src) + '" alt=""><div class="ab-hero-scrim"></div>' : '') +
        '<div class="ab-hero-in">' + head + '</div></section>';
    },

    text(b, c) {
      return '<section class="ab-b ab-t-text ab-lk-' + b.look + ' ab-al-' + b.align + ' ab-fs-' + b.size + '"' + rootAttrs(c) + '><div class="ab-in"><div class="ab-textbox">' +
        eyebrow(b.eyebrow) + h2(b.heading) + '<div class="ab-body">' + fmt(b.body) + '</div></div></div></section>';
    },

    words(b, c) {
      const src = c.img(b.imgId), pos = src ? (b.cols > 1 && b.imgPos !== 'none' ? 'top' : b.imgPos) : 'none';   // columns + a side photo can't share a row, so the photo goes above
      const wf = wordFont(b.font);
      const v = ['--w-fs:' + b.size + 'px', '--w-lh:' + (b.lh / 100), '--w-ls:' + (b.ls / 100) + 'em', '--w-pg:' + b.pgap + 'px', '--w-cols:' + b.cols, '--w-img:' + b.imgW + '%',
        '--w-max:' + ({ s: '560px', m: '720px', l: '960px', full: '100%' }[b.maxw])];
      if (b.color) v.push('--w-c:' + b.color);
      if (wf) v.push('--w-ff:' + wf.stack);
      if (b.hyph) v.push('--w-hy:auto');
      const fig = pos !== 'none' ? '<div class="ab-wimg ab-wsh-' + b.imgShape + '">' + figure(src, { shape: b.imgShape, ratio: b.imgRatio, frame: b.imgFrame, tilt: 0 }, b.caption) + '</div>' : '';
      return '<section class="ab-b ab-t-words ab-lk-' + b.look + ' ab-wa-' + b.align + ' ab-wp-' + pos + '"' + rootAttrs(c) + '><div class="ab-in"><div class="ab-textbox ab-wbox" lang="en" style="' + v.join(';') + '">' +
        fig + '<div class="ab-wrich">' + b.html + '</div></div></div></section>';
    },

    photo(b, c) {
      const src = c.img(b.imgId);
      const inner = src ? figure(src, b, b.caption) : placeholder(SVG(ICONS.photo), 'Pick a photo for this spot');
      return '<section class="ab-b ab-t-photo ab-ps-' + b.size + ' ab-pa-' + b.align + '"' + rootAttrs(c) + '>' + inner + '</section>';
    },

    split(b, c) {
      const src = c.img(b.imgId);
      const media = src ? figure(src, b, '') : placeholder(SVG(ICONS.photo), 'Pick a photo');
      return '<section class="ab-b ab-t-split ab-side-' + b.imgSide + ' ab-sw-' + b.imgWidth + '"' + rootAttrs(c) + '><div class="ab-in ab-split-in">' +
        '<div class="ab-split-media">' + media + '</div>' +
        '<div class="ab-split-text">' + eyebrow(b.eyebrow) + h2(b.heading) + '<div class="ab-body">' + fmt(b.body) + '</div></div></div></section>';
    },

    gallery(b, c) {
      const imgs = b.imgIds.map(id => c.img(id)).filter(Boolean);
      const alt = b.ratio === 'auto' ? ' ab-ratio-auto' : '';
      const items = imgs.map(src => '<figure class="ab-gi ab-sh-' + b.shape + alt + '"><div class="ab-fig-in"><img src="' + esc(src) + '" alt="" loading="lazy" decoding="async"></div></figure>').join('');
      // Columns on big screens: 2–4, whichever leaves the fewest photos stranded on the last row.
      const n = imgs.length, wc = n <= 4 ? Math.max(2, n) : n % 4 === 0 ? 4 : n % 3 === 0 ? 3 : (n % 4 >= n % 3 ? 4 : 3);
      return '<section class="ab-b ab-t-gallery ab-gl-' + b.layout + ' ab-cols-' + b.cols + ' ab-wc-' + wc + ' ab-gap-' + b.gap + '"' + rootAttrs(c, '--ratio:' + (b.ratio === 'auto' ? 'auto' : b.ratio)) + '>' +
        (b.heading ? '<div class="ab-in">' + h2(b.heading) + '</div>' : '') + '<div class="ab-gal">' + items + '</div></section>';
    },

    highlights(b, c) {
      const rows = b.rows.filter(r => r.title.trim() || r.text.trim());
      const items = rows.map(r => {
        const em = r.emoji.trim() ? '<span class="ab-hl-em">' + esc(r.emoji) + '</span>' : '';
        if (b.look === 'chips') return '<li class="ab-hl">' + em + '<span class="ab-hl-t">' + esc(r.title || r.text) + '</span></li>';
        return '<li class="ab-hl">' + em + '<span class="ab-hl-body"><span class="ab-hl-t">' + esc(r.title) + '</span>' + (r.text ? '<span class="ab-hl-x">' + esc(r.text) + '</span>' : '') + '</span></li>';
      }).join('');
      return '<section class="ab-b ab-t-highlights ab-hl-' + b.look + '"' + rootAttrs(c) + '><div class="ab-in">' + h2(b.heading) + '<ul class="ab-hl-list">' + items + '</ul></div></section>';
    },

    quote(b, c) {
      return '<section class="ab-b ab-t-quote ab-q-' + b.look + '"' + rootAttrs(c) + '><div class="ab-in"><blockquote class="ab-quote"><span class="ab-qmark" aria-hidden="true">“</span><p>' +
        esc(b.text) + '</p>' + (b.by ? '<cite>' + esc(b.by) + '</cite>' : '') + '</blockquote></div></section>';
    },

    hours(b, c) {
      const rows = b.rows.filter(r => r.day.trim() || r.time.trim()).map(r =>
        '<div class="ab-hr"><span class="ab-hr-d">' + esc(r.day) + '</span><i></i><span class="ab-hr-t">' + esc(r.time) + '</span></div>').join('');
      return '<section class="ab-b ab-t-hours"' + rootAttrs(c) + '><div class="ab-in"><div class="ab-textbox ab-card">' + h2(b.heading) + '<div class="ab-hours">' + rows + '</div>' +
        (b.note ? '<p class="ab-note">' + esc(b.note) + '</p>' : '') + '</div></div></section>';
    },

    book(b, c) {
      const v = bookBits(b);
      const cafeName = (c.cafe && c.cafe.name) || '';
      let form = '';
      if (v.form) {
        const opts = [];
        for (let n = 1; n <= b.guestsMax; n++) opts.push('<option value="' + n + '"' + (n === 2 ? ' selected' : '') + '>' + n + (n === 1 ? ' guest' : ' guests') + '</option>');
        const label = b.buttonLabel.trim() || (b.via === 'email' ? 'Send by email' : 'Book on WhatsApp');
        form = '<form class="ab-book-form" data-via="' + b.via + '" data-to="' + esc(b.via === 'email' ? v.email : v.wa) + '" data-cafe="' + esc(cafeName) + '">' +
          '<label class="ab-fld full"><span>Your name</span><input name="name" type="text" required maxlength="60" autocomplete="name" placeholder="Name"></label>' +
          '<label class="ab-fld' + (b.askTime ? '' : ' full') + '"><span>Guests</span><select name="guests">' + opts.join('') + '</select></label>' +
          (b.askTime ? '<label class="ab-fld"><span>Time</span><input name="time" type="time" required></label>' : '') +
          (b.askDate ? '<label class="ab-fld full"><span>Date</span><input name="date" type="date" min="' + localToday() + '" required></label>' : '') +
          (b.askNote ? '<label class="ab-fld full"><span>Anything we should know?</span><textarea name="note" rows="2" maxlength="200" placeholder="Birthday, high chair, allergies…"></textarea></label>' : '') +
          '<button type="submit" class="ab-btn ab-btn-solid ab-book-go">' + esc(label) + '</button>' +
          '<p class="ab-book-msg" role="status" aria-live="polite"></p></form>';
      }
      const acts = [];
      if (!v.form) {   // no form → the buttons ARE the booking
        if (v.wa) acts.push(linkBtn('https://wa.me/' + v.wa + '?text=' + encodeURIComponent('Hi' + (cafeName ? ' ' + cafeName : '') + '! I\'d like to book a table.'), 'Book on WhatsApp', true, true));
        if (v.email) acts.push(linkBtn('mailto:' + v.email + '?subject=' + encodeURIComponent('Table booking'), 'Email us', !acts.length, false));
      }
      if (v.phone) acts.push(linkBtn('tel:' + v.phone, 'Call to book', !acts.length && !v.form, false));
      if (v.link) acts.push(linkBtn(v.link, esc(b.linkLabel.trim() || 'Book online') + ' ↗', !acts.length && !v.form, true));
      return '<section class="ab-b ab-t-book ab-bkl-' + b.look + '"' + rootAttrs(c) + '><div class="ab-in"><div class="ab-textbox ab-book' + (b.look === 'card' ? ' ab-card' : '') + '">' +
        h2(b.heading) + (b.blurb ? '<p class="ab-blurb">' + esc(b.blurb) + '</p>' : '') + form +
        (form && acts.length ? '<div class="ab-or"><span>or</span></div>' : '') +
        (acts.length ? '<div class="ab-actions">' + acts.join('') + '</div>' : '') +
        (b.fine ? '<p class="ab-fine">' + esc(b.fine) + '</p>' : '') + '</div></div></section>';
    },

    rooms(b, c) {
      const ico = (a, px) => { try { return window.Amenities ? window.Amenities.svg(a, px) : ''; } catch (e) { return ''; } };
      const amLi = (a, px) => '<li><i class="ab-am-i" aria-hidden="true">' + ico(a, px || 16) + '</i>' + esc(a) + '</li>';
      const amList = list => '<ul class="ab-rm-am">' + list.slice(0, 4).map(a => amLi(a)).join('') + (list.length > 4 ? '<li class="ab-am-more"><button type="button" data-hotel="det-room">+' + (list.length - 4) + ' more</button></li>' : '') + '</ul>';
      const hot = (c.cafe && c.cafe.hotel) || {}, demo = !(hot.types || []).length;
      const types = demo ? [{ id: 'd1', name: 'Deluxe Room', capacity: 2, desc: 'King bed · AC · city view', rate: 3200 }, { id: 'd2', name: 'Family Suite', capacity: 4, desc: 'Two rooms · lounge · balcony', rate: 6500 }] : hot.types;
      const byT = {}; types.forEach(t => { byT[t.id] = t; });
      let list = b.rows.filter(r => byT[r.typeId]).map(r => ({ t: byT[r.typeId], r: r }));
      if (!list.length) list = types.map(t => ({ t: t, r: {} }));
      const today = localToday();
      const guests = []; for (let n = 1; n <= 6; n++) guests.push('<option value="' + n + '"' + (n === 2 ? ' selected' : '') + '>' + n + (n === 1 ? ' adult' : ' adults') + '</option>');
      const cards = list.map(x => {
        const img = c.img(x.r.imgId), t = x.t, am = Array.isArray(t.amenities) ? t.amenities : [];
        const facts = [t.size ? t.size + ' m²' : '', 'Sleeps ' + Number(t.capacity || 2), t.bed || ''].filter(Boolean).map(f => '<span>' + esc(f) + '</span>').join('');
        return '<article class="ab-rm" data-type="' + esc(t.id) + '">' + (img ? '<div class="ab-rm-img" data-hotel="det-room"><img src="' + esc(img) + '" alt="" loading="lazy"></div>' : '') +
          '<div class="ab-rm-b"><h3>' + esc(t.name) + '</h3><p class="ab-rm-facts">' + facts + '</p>' +
          (t.desc ? '<p class="ab-rm-meta">' + esc(t.desc) + '</p>' : '') +
          (am.length ? amList(am) : '') + '<button type="button" class="ab-link" data-hotel="det-room">Room details &#8250;</button>' +
          (x.r.text ? '<p class="ab-rm-txt">' + esc(x.r.text) + '</p>' : '') +
          '<div class="ab-rm-foot"><div class="ab-rm-price"><s class="ab-rm-rack" hidden></s><div><b data-base="' + Number(t.rate || 0) + '">' + RS(t.rate) + '</b><small> per night</small></div><small class="ab-rm-tot">before taxes</small></div>' +
          '<div class="ab-rm-act"><span class="ab-rm-st"></span><button type="button" class="ab-btn ab-btn-solid ab-rm-go" data-hotel="room-ask" data-label="' + esc(b.buttonLabel || 'Book') + '" disabled>Pick your dates</button></div></div></div></article>';
      }).join('');
      const facil = demo ? ['Free Wi-Fi', 'Free parking', '24-hour reception', 'Restaurant', 'Power backup', 'Room service'] : (Array.isArray(hot.amenities) ? hot.amenities : []);
      const popular = facil.slice(0, 6);
      const facilHtml = facil.length ? '<div class="ab-fac"><h3>Most popular facilities</h3><ul class="ab-pop">' + popular.map(a => '<li><i class="ab-am-i" aria-hidden="true">' + ico(a, 26) + '</i><span>' + esc(a) + '</span></li>').join('') + '</ul>' +
        (facil.length > popular.length ? '<button type="button" class="ab-link" data-hotel="det-fac">See all ' + facil.length + ' facilities &#8250;</button>' : '') + '</div>' : '';
      const det = { fac: facil, types: list.map(x => ({ id: x.t.id, name: x.t.name, rate: Number(x.t.rate || 0), cap: Number(x.t.capacity || 2), bed: x.t.bed || '', size: x.t.size || '', desc: x.t.desc || '', text: x.r.text || '', img: c.img(x.r.imgId) || '', am: Array.isArray(x.t.amenities) ? x.t.amenities : [] })) };
      return '<section class="ab-b ab-t-rooms"' + rootAttrs(c) + ' data-cafe="' + esc((c.cafe && c.cafe.id) || '') + '" data-det="' + esc(JSON.stringify(det)) + '"><div class="ab-in"><div class="ab-textbox">' +
        h2(b.heading) + (b.blurb ? '<p class="ab-blurb">' + esc(b.blurb) + '</p>' : '') + facilHtml +
        '<form class="ab-rm-search ab-card" novalidate><label class="ab-fld"><span>Check-in</span><input type="date" name="ci" min="' + today + '"></label>' +
        '<label class="ab-fld"><span>Check-out</span><input type="date" name="co" min="' + today + '"></label>' +
        '<label class="ab-fld"><span>Guests</span><select name="adults">' + guests.join('') + '</select></label>' +
        '<button type="submit" class="ab-btn ab-btn-solid">Check availability</button></form>' +
        '<p class="ab-book-msg ab-rm-msg" role="status" aria-live="polite"></p>' +
        '<div class="ab-rm-list">' + cards + '</div>' +
        '<p class="ab-fine">' + esc(b.fine || 'Your booking is confirmed once the hotel checks it.') + '</p></div></div></section>';
    },

    banquet(b, c) {
      const hot = (c.cafe && c.cafe.hotel) || {}, demo = !(hot.halls || []).length;
      const halls = demo ? [{ id: 'd1', name: 'Grand Ballroom', capacity: 400, desc: 'AC · stage · parking for 80 cars', price: 75000 }] : hot.halls;
      const byH = {}; halls.forEach(h => { byH[h.id] = h; });
      let list = b.rows.filter(r => byH[r.hallId]).map(r => ({ h: byH[r.hallId], r: r }));
      if (!list.length) list = halls.map(h => ({ h: h, r: {} }));
      const cards = list.map(x => {
        const img = c.img(x.r.imgId);
        return '<article class="ab-rm ab-hl" data-hall="' + esc(x.h.id) + '">' + (img ? '<div class="ab-rm-img"><img src="' + esc(img) + '" alt="" loading="lazy"></div>' : '') +
          '<div class="ab-rm-b"><h3>' + esc(x.h.name) + '</h3><p class="ab-rm-meta">Up to ' + Number(x.h.capacity || 0) + ' guests' + (x.h.desc ? ' · ' + esc(x.h.desc) : '') + '</p>' +
          (x.r.text ? '<p class="ab-rm-txt">' + esc(x.r.text) + '</p>' : '') +
          '<div class="ab-rm-foot">' + (Number(x.h.price) ? '<div class="ab-rm-price"><small>from</small> <b>' + RS(x.h.price) + '</b></div>' : '<span></span>') +
          '<button type="button" class="ab-btn ab-btn-solid" data-hotel="hall-open">' + esc(b.buttonLabel || 'Check free dates') + '</button></div></div>' +
          '<div class="ab-hl-cal" hidden></div></article>';
      }).join('');
      return '<section class="ab-b ab-t-banquet"' + rootAttrs(c) + ' data-cafe="' + esc((c.cafe && c.cafe.id) || '') + '"><div class="ab-in"><div class="ab-textbox">' +
        h2(b.heading) + (b.blurb ? '<p class="ab-blurb">' + esc(b.blurb) + '</p>' : '') + '<div class="ab-rm-list">' + cards + '</div>' +
        '<p class="ab-fine">' + esc(b.fine || 'Tap a hall to see which dates are free. The hotel will call you to confirm.') + '</p></div></div></section>';
    },

    visit(b, c) {
      const v = visitBits(b, c.cafe);
      const btn = (href, label, solid, ext) => '<a class="ab-btn' + (solid ? ' ab-btn-solid' : '') + '" href="' + esc(href) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
      const acts = [
        v.phone ? btn('tel:' + v.phone, 'Call', true, false) : '',
        v.dir ? btn(v.dir, 'Directions', !v.phone, true) : '',
        v.wa ? btn('https://wa.me/' + v.wa, 'WhatsApp', false, true) : '',
        v.ig ? btn('https://instagram.com/' + v.ig, 'Instagram · @' + esc(v.ig), false, true) : '',
      ].join('');
      return '<section class="ab-b ab-t-visit"' + rootAttrs(c) + '><div class="ab-in"><div class="ab-textbox ab-card">' + h2(b.heading) +
        (v.address ? '<p class="ab-address">' + esc(v.address) + '</p>' : '') +
        (acts ? '<div class="ab-actions">' + acts + '</div>' : '') + '</div></div></section>';
    },

    ribbon(b, c) {
      const list = phrases(b.text);
      const unit = list.map(s => '<span>' + esc(s) + '</span>').join('<em aria-hidden="true">✦</em>') + '<em aria-hidden="true">✦</em>';
      const plainLen = list.join(' ✦ ').length + 3;
      const rep = new Array(Math.min(14, Math.max(3, Math.ceil(90 / Math.max(1, plainLen)) + 1)) + 1).join(unit);
      const dur = { s: 44, m: 28, l: 16 }[b.speed];
      return '<section class="ab-b ab-t-ribbon"' + rootAttrs(c) + '><div class="ab-ribbon ab-rb-' + b.look + '" style="--tilt:' + b.tilt + 'deg;--dur:' + dur + 's">' +
        '<div class="ab-rib-track"><div class="ab-rib-half">' + rep + '</div><div class="ab-rib-half" aria-hidden="true">' + rep + '</div></div></div></section>';
    },
    cta(b, c) {
      const btn = goBtn(b.btnLabel, b.goto, b.link, c, 'ab-btn ab-cta-btn');
      return '<section class="ab-b ab-t-cta ab-cta-' + b.look + '"' + rootAttrs(c) + '><div class="ab-in"><div class="ab-cta">' +
        '<div class="ab-cta-txt">' + h2(b.heading) + (b.text ? '<p>' + esc(b.text) + '</p>' : '') + '</div>' +
        (btn ? '<div class="ab-cta-act">' + btn + '</div>' : '') + '</div></div></section>';
    },

    faq(b, c) {
      const items = b.rows.filter(r => r.q.trim() && r.a.trim()).map(r => '<details class="ab-faq-i"><summary>' + esc(r.q) + '</summary><div class="ab-faq-a">' + fmt(r.a) + '</div></details>').join('');
      return '<section class="ab-b ab-t-faq ab-faq-' + b.look + '"' + rootAttrs(c) + '><div class="ab-in">' + h2(b.heading) + '<div class="ab-faq">' + items + '</div></div></section>';
    },
    list(b, c) {
      const items = b.rows.filter(r => r.name.trim()).map(r => '<div class="ab-pl-r"><div class="ab-pl-t"><b>' + esc(r.name) + '</b>' + (r.text ? '<small>' + esc(r.text) + '</small>' : '') + '</div>' +
        (r.price ? '<span class="ab-pl-d" aria-hidden="true"></span><span class="ab-pl-p">' + esc(r.price) + '</span>' : '') + '</div>').join('');
      return '<section class="ab-b ab-t-list ab-pl-' + b.look + '"' + rootAttrs(c) + '><div class="ab-in">' + h2(b.heading) + (b.blurb ? '<p class="ab-blurb">' + esc(b.blurb) + '</p>' : '') +
        '<div class="ab-pl">' + items + '</div>' + (b.note ? '<p class="ab-note">' + esc(b.note) + '</p>' : '') + '</div></section>';
    },
    video(b, c) {
      const src = videoSrc(b.url);
      return '<section class="ab-b ab-t-video"' + rootAttrs(c) + '><div class="ab-in">' + h2(b.heading) +
        '<div class="ab-vid" style="aspect-ratio:' + b.ratio + '">' + (src ? '<iframe src="' + esc(src) + '" title="' + esc(b.heading || b.caption || 'Video') + '" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>' : '') + '</div>' +
        (b.caption ? '<p class="ab-note">' + esc(b.caption) + '</p>' : '') + '</div></section>';
    },
    spacer(b, c) {
      return '<section class="ab-b ab-t-spacer ab-sp-' + b.size + '"' + rootAttrs(c) + ' aria-hidden="true">' + (b.line ? '<hr class="ab-sp-line">' : '') + '</section>';
    },

    shop(b, c) {
      const list = shopList(b, c), cart = c.shop.cart, showBuy = c.preview || c.shop.canOrder;
      const cats = [];
      list.forEach(p => { if (p.cat && cats.indexOf(p.cat) < 0) cats.push(p.cat); });
      const chips = b.chips && !b.show && cats.length > 1
        ? '<div class="ab-chips" role="group" aria-label="Filter products"><button type="button" class="on" aria-pressed="true" data-shop="cat" data-cat="">All</button>' +
          cats.map(k => '<button type="button" aria-pressed="false" data-shop="cat" data-cat="' + esc(k) + '">' + esc(k) + '</button>').join('') + '</div>'
        : '';
      const sample = !!c.cur.sample;
      const del = deliveryHtml(c.shop.settings);
      const bar = list.length > 1
        ? '<div class="ab-shop-bar"><label class="ab-shop-q"><span class="ab-sr">Search products</span><input type="search" data-shop-q placeholder="Search products" autocomplete="off"></label>' +
          '<label class="ab-shop-s"><span class="ab-sr">Sort by</span><select data-shop-sort><option value="">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="off">Biggest discount</option></select></label>' +
          '<span class="ab-shop-n" aria-live="polite">' + list.length + (list.length === 1 ? ' product' : ' products') + '</span></div>' : '';
      const cards = list.map((p, ix) => {
        const pid = sample ? '' : ' data-pid="' + esc(p.id) + '"';
        const hasOpts = !sample && parseOpts(p).length > 0;
        const buy = !showBuy ? '' : p.out ? '<span class="ab-soldout">Currently unavailable</span>'
          : '<span class="ab-buy"' + pid + '>' + (hasOpts ? optCtl(p, cart) : buyCtl(p.id, cart[p.id] || 0, p.name)) + '</span>';
        return '<article class="ab-prod' + (p.out ? ' is-out' : '') + '"' + pid + ' data-cat="' + esc(p.cat) + '" data-i="' + ix + '" data-price="' + p.price + '" data-off="' + offPct(p) + '" data-q="' + esc((p.name + ' ' + p.cat + ' ' + p.tag + ' ' + p.desc).toLowerCase()) + '">' +
          '<button type="button" class="ab-prod-media" data-shop="view"' + pid + ' aria-label="' + esc(p.name) + ' — details">' +
            prodMedia(p, c, 'ab-prod-img') + (offPct(p) ? '<span class="ab-prod-off">−' + offPct(p) + '%</span>' : '') + (p.tag ? '<span class="ab-prod-tag">' + esc(p.tag) + '</span>' : '') + '</button>' +
          '<div class="ab-prod-b"><h3 class="ab-prod-name">' + esc(p.name) + '</h3>' +
            (p.desc ? '<p class="ab-prod-desc">' + esc(p.desc) + '</p>' : '') +
            (hasOpts ? '<span class="ab-pb"><b class="ab-pb-now"><small>From </small>' + RS(optLow(p)) + '</b></span>' : priceBlock(p)) + (p.stock > 0 && p.stock <= 5 && !p.out ? '<p class="ab-prod-del" style="color:#b9650a;font-weight:700">Only ' + p.stock + ' left</p>' : '') + (del && !p.out ? '<p class="ab-prod-del">' + del + '</p>' : '') +
            '<div class="ab-prod-foot">' + buy + '</div></div></article>';
      }).join('');
      return '<section class="ab-b ab-t-shop ab-shl-' + b.layout + ' ab-shc-' + b.cols + '"' + rootAttrs(c) + '><div class="ab-in">' +
        '<div class="ab-shop-h">' + h2(b.heading) + (b.blurb ? '<p class="ab-blurb">' + esc(b.blurb) + '</p>' : '') + '</div>' +
        chips + bar + '<div class="ab-prods">' + cards + '</div><p class="ab-shop-none" hidden>Nothing matches your search — try another word or clear the filter.</p></div></section>';
    },

  };

  /* ------------------------------------------------------------------ */
  /* Site chrome: header, footer, order drawer                          */
  /* ------------------------------------------------------------------ */
  const BAG_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>';

  function siteName(L, c) { return L.site.title.trim() || (c.cafe && c.cafe.name) || 'Welcome'; }

  function navHtml(L, c, items, bag) {
    const site = L.site, name = siteName(L, c);
    const logo = site.logo ? safeImg(c.cafe && c.cafe.logo_url) : '';
    const links = items.map(i => '<a href="#s-' + esc(i.id) + '" data-go="' + esc(i.id) + '">' + esc(i.label) + '</a>').join('');
    const cta = goBtn(site.ctaLabel, site.ctaGoto, site.ctaLink, c, 'ab-btn ab-btn-solid ab-btn-sm ab-nav-cta');
    const ctaInMenu = cta ? cta.replace('ab-nav-cta', 'ab-menu-cta') : '';
    const n = bag ? cartCount(c.shop.cart) : 0;
    const bagBtn = bag ? '<button type="button" class="ab-bagbtn" data-shop="open" aria-label="Your order">' + BAG_SVG +
      '<span class="ab-bag-n"' + (n ? '' : ' hidden') + '>' + n + '</span></button>' : '';
    const burger = links || cta ? '<button type="button" class="ab-burger" data-site="menu" aria-expanded="false" aria-label="Menu"><i></i><i></i><i></i></button>' : '';
    return '<header class="ab-nav ab-nav-' + site.nav + '" data-part="site"><div class="ab-nav-in">' +
      '<a class="ab-brand" href="#top" data-go="top">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : '') + '<span>' + esc(name) + '</span></a>' +
      (links || ctaInMenu ? '<nav class="ab-links" aria-label="On this page">' + links + ctaInMenu + '</nav>' : '') +
      '<div class="ab-nav-acts">' + cta + bagBtn + burger + '</div></div></header>';
  }

  function footHtml(L, c, items) {
    const site = L.site, cafe = c.cafe || {}, name = siteName(L, c);
    const addr = String(cafe.address_text || cafe.address || '').trim();
    const phone = telDigits(site.phone || cafe.phone);
    const wa = telDigits(site.whatsapp).replace(/^\+/, '');
    const ig = igHandle(site.instagram);
    const email = EMAIL.test(site.email.trim()) ? site.email.trim() : '';
    const a = (href, label, ext) => '<a href="' + esc(href) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
    const contact = [
      addr ? '<p>' + esc(addr) + '</p>' : '',
      phone ? a('tel:' + phone, esc(site.phone || cafe.phone)) : '',
      wa.length >= 6 ? a('https://wa.me/' + wa, 'WhatsApp', true) : '',
      ig ? a('https://instagram.com/' + ig, 'Instagram @' + esc(ig), true) : '',
      email ? a('mailto:' + email, esc(email)) : '',
    ].join('');
    const links = items.map(i => '<a href="#s-' + esc(i.id) + '" data-go="' + esc(i.id) + '">' + esc(i.label) + '</a>').join('');
    return '<footer class="ab-foot" data-part="site"><div class="ab-foot-in">' +
      '<div class="ab-foot-brand"><b>' + esc(name) + '</b>' + (site.footNote ? '<p>' + esc(site.footNote) + '</p>' : '') + '</div>' +
      (links ? '<div class="ab-foot-col"><h3>Explore</h3>' + links + '</div>' : '') +
      (contact ? '<div class="ab-foot-col"><h3>Get in touch</h3>' + contact + '</div>' : '') +
      '</div><div class="ab-foot-base">© ' + new Date().getFullYear() + ' ' + esc(name) + '</div></footer>';
  }

  /* The order drawer + product sheet + floating "view order" pill. Only on live pages with a shop that can take orders. */
  function layersHtml(L) {
    const st = L.shop.settings;
    return '<div class="ab-layer" data-layer="bag" hidden><div class="ab-shade" data-shop="close"></div>' +
      '<aside class="ab-drawer" role="dialog" aria-modal="true" aria-labelledby="ab-bag-t">' +
        '<div class="ab-dr-h"><b id="ab-bag-t">Shopping cart</b><span class="ab-dr-acts"><button type="button" class="ab-lnk" data-co="orders" data-in="bag" hidden>My orders</button><button type="button" class="ab-x" data-shop="close" aria-label="Close">✕</button></span></div>' +
        '<div class="ab-dr-body"><div class="ab-bag-list"></div><div class="ab-bag-sum"></div>' +
          (st.note ? '<p class="ab-fine">' + esc(st.note) + '</p>' : '') + '</div></aside></div>' +
      '<div class="ab-layer ab-co-layer" data-layer="co" hidden><div class="ab-shade" data-shop="close"></div>' +
        '<section class="ab-co" role="dialog" aria-modal="true" aria-label="Checkout"><header class="ab-co-top"><button type="button" class="ab-co-back" data-co="back" aria-label="Back">‹</button><b>Checkout</b><span class="ab-co-lock">Secure checkout</span><button type="button" class="ab-x" data-shop="close" aria-label="Close">✕</button></header>' +
        '<ol class="ab-co-steps"></ol><div class="ab-co-grid"><div class="ab-co-main"></div><aside class="ab-co-sum"></aside></div></section></div>' +
      '<div class="ab-layer" data-layer="item" hidden><div class="ab-shade" data-shop="close"></div>' +
        '<aside class="ab-drawer ab-sheet" role="dialog" aria-modal="true" aria-label="Product"><button type="button" class="ab-x ab-sheet-x" data-shop="close" aria-label="Close">✕</button><div class="ab-sheet-b"></div></aside></div>' +
      '<button type="button" class="ab-fab" data-shop="open" hidden></button>' +
      '<p class="ab-sr" aria-live="polite"></p>';
  }

  /* render(layout, cafe, { preview }) → HTML string for one page. */
  function render(layout, cafe, opts) {
    opts = opts || {};
    const L = normalize(layout), s = L.style;
    const map = {};
    L.images.forEach(im => { map[im.id] = im.src; });
    const preview = !!opts.preview;
    const products = L.shop.products.filter(p => p.name.trim());
    const byId = {}, order = [], list = [];
    products.forEach(p => {
      list.push(p.id);
      const os = parseOpts(p);
      if (!os.length) { byId[p.id] = p; order.push(p.id); return; }
      const base = Object.assign({}, p, { optIds: [], noadd: true }); byId[p.id] = base;
      os.forEach((o, i) => {
        const vid = p.id + '~' + i;
        byId[vid] = Object.assign({}, p, { id: vid, name: p.name + ' — ' + o.label, label: o.label, price: o.price == null ? p.price : o.price, mrp: o.price == null ? p.mrp : 0, parent: p.id, opts: '' });
        order.push(vid); base.optIds.push(vid);
      });
    });
    const to = orderTo(L), key = cartKey(cafe), canOrder = !!to || L.shop.settings.serverOrders;
    const ctx = { cafe: cafe || {}, img: id => map[id] || '', preview: preview, ids: {},
      shop: { products: products, settings: L.shop.settings, canOrder: canOrder, cart: preview || !canOrder ? {} : cleanCart(key, byId) } };

    const hf = headFont(s.headFont), bf = bodyFont(s.bodyFont);
    const accentInk = readableOn(s.accent), accent2Ink = readableOn(s.accent2);
    const accentText = contrast(s.accent, s.bg) >= 3 ? s.accent : s.ink;
    const vars = {
      '--ab-bg': s.bg, '--ab-ink': s.ink, '--ab-bg0': s.bg, '--ab-ink0': s.ink, '--ab-muted': mix(s.ink, s.bg, 0.38),
      '--ab-card': mix(s.bg, s.ink, 0.06), '--ab-line': mix(s.bg, s.ink, 0.18),
      '--ab-accent': s.accent, '--ab-accent-ink': accentInk, '--ab-accent-text': accentText,
      '--ab-accent2': s.accent2, '--ab-accent2-ink': accent2Ink,
      '--ab-head': hf.stack, '--ab-body': bf.stack, '--ab-head-w': hf.weight, '--ab-head-scale': hf.scale,
      '--ab-head-tt': hf.caps ? 'uppercase' : 'none', '--ab-head-ls': hf.caps ? '.03em' : '-.005em',
      '--ab-scheme': luminance(s.bg) < 0.3 ? 'dark' : 'light',
      '--ab-r': { sharp: '0px', soft: '14px', round: '26px' }[s.radius],
      '--ab-gap': { compact: '20px', cozy: '32px', airy: '48px' }[s.space],
    };
    const styleAttr = Object.keys(vars).map(k => k + ':' + vars[k]).join(';');

    // Pass 1: which blocks show (so buttons and the menu never point at a hidden section).
    const vis = [];
    L.blocks.forEach(b => {
      if (b.hidden) return;
      let blk = b, sample = false;
      if (isEmpty(b, ctx)) {
        if (!preview) return;
        if (SAMPLE_TYPES.indexOf(b.type) >= 0) { blk = Object.assign({}, b, SAMPLE[b.type]); sample = true; }
      }
      vis.push({ b: b, blk: blk, sample: sample });
      ctx.ids[b.id] = 1;
    });

    // Pass 2: draw them; consecutive half-width blocks pair up into one row.
    let hasShop = false, pending = null;
    const parts = [];
    vis.forEach((v, i) => {
      ctx.cur = { bid: v.b.id, i: i, sample: v.sample };
      if (v.b.type === 'shop') hasShop = true;
      let html = RENDER[v.blk.type](v.blk, ctx) || '';
      const xcls = (v.b.bg && v.b.bg !== 'none' ? ' ab-bg-' + v.b.bg : '') + (v.b.pad && v.b.pad !== 'm' ? ' ab-pad-' + v.b.pad : '');
      if (xcls) html = html.replace('class="ab-b ', 'class="ab-b' + xcls + ' ');
      const half = v.b.width === 'half' && HALF_OK.indexOf(v.b.type) >= 0 && !(v.b.type === 'photo' && v.b.size === 'full');
      if (half) {
        if (pending == null) { pending = html; return; }
        parts.push('<div class="ab-row">' + pending + html + '</div>'); pending = null; return;
      }
      if (pending != null) { parts.push('<div class="ab-row ab-row-1">' + pending + '</div>'); pending = null; }
      parts.push(html);
    });
    if (pending != null) parts.push('<div class="ab-row ab-row-1">' + pending + '</div>');

    const items = vis.filter(v => v.b.navLabel.trim()).map(v => ({ id: v.b.id, label: v.b.navLabel.trim() }));
    const bag = hasShop && (preview || ctx.shop.canOrder);
    const live = !preview && hasShop && ctx.shop.canOrder;
    if (live) SHOPS[key] = { byId: byId, order: order, list: list, settings: L.shop.settings, to: to, cafeId: cafe && cafe.id, cafeName: (cafe && cafe.name) || siteName(L, ctx) };

    const nav = L.site.nav !== 'off' ? navHtml(L, ctx, items, bag) : '';
    const foot = L.site.footer ? footHtml(L, ctx, items) : '';
    const body = parts.join('') || '<div class="ab-empty">Nothing here yet.</div>';
    // Free-text blocks may use extra Google fonts — pull in only the ones this page actually uses.
    const used = [];
    L.blocks.forEach(b => { if (b.type !== 'words') return; WORD_FONTS.forEach(f => { if ((b.font === f.id || b.html.indexOf(f.stack) >= 0) && used.indexOf(f) < 0) used.push(f); }); });
    const fontCss = used.length ? '<style>@import url("https://fonts.googleapis.com/css2?' + used.map(f => 'family=' + f.gf).join('&') + '&display=swap");</style>' : '';
    return fontCss + '<div class="ab ab-edge-' + s.edge + ' ab-align-' + s.align + ' ab-bx-' + s.btn + ' ab-cd-' + s.cards + ' ab-mo-' + s.motion + (preview ? ' ab-preview' : '') + '" style="' + esc(styleAttr) + '"' + (live ? ' data-cart="' + esc(key) + '"' : '') + '>' +
      '<div class="ab-site">' + announceHtml(L) + nav + '<main class="ab-main">' + body + '</main>' + foot + '</div>' + (live ? layersHtml(L) : '') + '</div>';
  }

  /* Booking form: no backend needed — it builds the request and hands it to WhatsApp / the email app. */
  function onBookSubmit(e) {
    const f = e.target;
    if (!f || !f.classList || !f.classList.contains('ab-book-form')) return;
    e.preventDefault();
    if (f.closest && f.closest('.ab-preview')) return;
    const val = n => (f.elements[n] ? String(f.elements[n].value || '').trim() : '');
    const msg = f.querySelector('.ab-book-msg');
    const say = (t, bad) => { if (msg) { msg.textContent = t; msg.className = 'ab-book-msg ' + (bad ? 'bad' : 'ok'); } };
    const name = val('name'), guests = val('guests'), date = val('date'), time = val('time'), note = val('note');
    if (!name) return say('Please tell us your name.', true);
    if (f.elements.date && !date) return say('Pick a date.', true);
    if (f.elements.date && date < localToday()) return say('That date has already passed.', true);
    if (f.elements.time && !time) return say('Pick a time.', true);

    const nice = [];
    if (date) { const p = date.split('-'); nice.push('Date: ' + new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })); }
    if (time) { const p = time.split(':'); nice.push('Time: ' + new Date(2000, 0, 1, +p[0], +p[1]).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })); }
    const text = ['Hi ' + (f.dataset.cafe || 'there') + '! I\'d like to book a table.', '', 'Name: ' + name, 'Guests: ' + guests].concat(nice, note ? ['Note: ' + note] : []).join('\n');

    const via = f.dataset.via === 'email' ? 'email' : 'whatsapp', to = String(f.dataset.to || '');
    let href;
    if (via === 'email') {
      if (!EMAIL.test(to)) return say('This cafe’s booking email isn’t set up right — please call instead.', true);
      href = 'mailto:' + to + '?subject=' + encodeURIComponent('Table booking — ' + name) + '&body=' + encodeURIComponent(text);
    } else {
      if (!/^\d{6,}$/.test(to)) return say('This cafe’s WhatsApp number isn’t set up right — please call instead.', true);
      href = 'https://wa.me/' + to + '?text=' + encodeURIComponent(text);
    }
    const a = root.document.createElement('a');       // an anchor click inside the submit gesture: never popup-blocked
    a.href = href; a.style.display = 'none';
    if (via === 'whatsapp') { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    root.document.body.appendChild(a); a.click(); a.remove();
    say(via === 'email' ? 'Opening your email app — press send to finish.' : 'Opening WhatsApp — press send there to finish your request.');
  }
  /* ------------------------------------------------------------------ */
  /* Live-page behaviour (one set of listeners for every page instance) */
  /* ------------------------------------------------------------------ */
  const reduceMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const liveAb = el => { const ab = el && el.closest ? el.closest('.ab') : null; return ab && !ab.classList.contains('ab-preview') ? ab : null; };
  const shopOf = ab => { const k = ab && ab.getAttribute('data-cart'); return k && SHOPS[k] ? { k: k, D: SHOPS[k] } : null; };

  function goTo(ab, id) {
    const t = id === 'top' ? ab : ab.querySelector('#s-' + id.replace(/[^\w-]/g, ''));
    const nav = ab.querySelector('.ab-nav.is-open');
    if (nav) { nav.classList.remove('is-open'); const b = nav.querySelector('.ab-burger'); if (b) b.setAttribute('aria-expanded', 'false'); }
    if (t) t.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  function bagLines(k, D) {
    const c = cleanCart(k, D.byId);
    return D.order.filter(id => c[id]).map(id => ({ p: D.byId[id], q: c[id] }));
  }

  function lineMedia(p) {
    const im = root.document.querySelector('.ab-prod[data-pid="' + (p.parent || p.id) + '"] .ab-prod-img');
    return im && im.tagName === 'IMG' ? '<img src="' + esc(im.getAttribute('src')) + '" alt="">' : '<span class="ab-prod-ph">' + prodInitial(p) + '</span>';
  }

  /* Re-sync every cart-dependent bit of one page after the cart changes. */
  function syncShop(ab) {
    const sh = shopOf(ab); if (!sh) return;
    const k = sh.k, D = sh.D, c = cleanCart(k, D.byId);
    ab.querySelectorAll('.ab-buy[data-pid]').forEach(n => {
      const id = n.getAttribute('data-pid'), p = D.byId[id];
      if (p) n.innerHTML = p.noadd ? optCtl(p, c) : buyCtl(id, c[id] || 0, p.name);
    });
    const t = totals(ab, k, D);
    ab.querySelectorAll('.ab-bag-n').forEach(n => { n.textContent = t.count; n.hidden = !t.count; });
    const fab = ab.querySelector('.ab-fab');
    if (fab) {
      fab.hidden = !t.count || !ab.querySelector('.ab-layer[data-layer="bag"]').hidden;
      fab.innerHTML = BAG_SVG + '<span>View cart</span><b>' + t.count + (t.count === 1 ? ' item' : ' items') + ' · ' + RS(t.sub) + '</b>';
    }
    const lines = bagLines(k, D), list = ab.querySelector('.ab-bag-list');
    if (list) {
      list.innerHTML = lines.length ? lines.map(l =>
        '<div class="ab-li"><span class="ab-li-m">' + lineMedia(l.p) + '</span><span class="ab-li-b"><b>' + esc(l.p.name) + '</b><small>' + RS(l.p.price) + ' each</small></span>' +
        '<span class="ab-buy" data-pid="' + esc(l.p.id) + '">' + buyCtl(l.p.id, l.q, l.p.name) + '</span></div>').join('')
        : '<p class="ab-bag-empty">Your cart is empty — add something from the shop.</p>';
    }
    refreshBag(ab, k, D, lines, t, coState(k, D));
    const rv = ab.querySelector('.ab-co-main .ab-bag-list');          // review step shows the same lines
    if (rv && !ab.querySelector('.ab-layer[data-layer="co"]').hidden && coState(k, D).view === 'flow') renderCo(ab);
    const sheet = ab.querySelector('.ab-sheet .ab-buy[data-pid]');
    if (sheet) { const id = sheet.getAttribute('data-pid'); if (D.byId[id]) sheet.innerHTML = buyCtl(id, c[id] || 0, D.byId[id].name); }
  }

  function openLayer(ab, name) {
    closeLayers(ab, true);
    const L = ab.querySelector('.ab-layer[data-layer="' + name + '"]'); if (!L) return;
    L.hidden = false;
    root.requestAnimationFrame(() => L.classList.add('is-on'));
    const fab = ab.querySelector('.ab-fab'); if (fab) fab.hidden = true;
    root.document.documentElement.classList.add('ab-locked');
    const f = L.querySelector('.ab-x'); if (f) f.focus({ preventScroll: true });
  }
  function closeLayers(ab, quiet) {
    ab.querySelectorAll('.ab-layer:not([hidden])').forEach(L => { L.classList.remove('is-on'); L.hidden = true; });
    root.document.documentElement.classList.remove('ab-locked');
    if (!quiet) syncShop(ab);
  }

  function openItem(ab, D, id, k, sel) {
    const base = D.byId[id]; if (!base) return;
    const vid = base.optIds ? (sel && D.byId[sel] && D.byId[sel].parent === id ? sel : base.optIds[0]) : id;
    const p = D.byId[vid] || base;
    const box = ab.querySelector('.ab-sheet-b'); if (!box) return;
    const srcOf = pid => { const im = ab.querySelector('.ab-prod[data-pid="' + pid + '"] .ab-prod-img'); return im && im.tagName === 'IMG' ? im.getAttribute('src') : ''; };
    const src = srcOf(id), qty = loadCart(k)[p.id] || 0, st = D.settings || {};
    const del = deliveryHtml(st);
    const lines = String(p.desc || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    const about = lines.length > 1 ? '<ul class="ab-about">' + lines.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : (lines.length ? '<div class="ab-body">' + fmt(p.desc) + '</div>' : '');
    const others = (D.list || D.order).map(x => D.byId[x]).filter(x => x && x.id !== id);
    const rel = others.filter(x => p.cat && x.cat === p.cat).concat(others.filter(x => !p.cat || x.cat !== p.cat)).slice(0, 4);
    const relHtml = rel.length ? '<div class="ab-rel-h">You may also like</div><div class="ab-rel">' + rel.map(x => {
      const im = srcOf(x.id);
      return '<button type="button" class="ab-rel-i" data-shop="view" data-pid="' + esc(x.id) + '">' + (im ? '<img src="' + esc(im) + '" alt="">' : '<span class="ab-prod-ph">' + prodInitial(x) + '</span>') +
        '<span class="ab-rel-n">' + esc(x.name) + '</span><b>' + RS(x.price) + '</b></button>';
    }).join('') + '</div>' : '';
    box.innerHTML = '<div class="ab-sheet-m">' + (src ? '<img src="' + esc(src) + '" alt="">' : '<span class="ab-prod-ph">' + prodInitial(p) + '</span>') + '</div>' +
      '<div class="ab-sheet-t">' + (p.cat ? '<span class="ab-crumb">' + esc(p.cat) + '</span>' : '') + (p.tag ? '<span class="ab-prod-tag">' + esc(p.tag) + '</span>' : '') +
      '<h3>' + esc(base.name) + '</h3>' +
      (base.optIds ? '<div class="ab-optrow"><span class="ab-optname">' + esc(base.optName || 'Choose') + ': <b>' + esc(p.label) + '</b></span><div class="ab-optchips">' +
        base.optIds.map(o => '<button type="button" data-shop="opt" data-pid="' + esc(id) + '" data-sel="' + esc(o) + '" aria-pressed="' + (o === p.id) + '"' + (o === p.id ? ' class="on"' : '') + '>' + esc(D.byId[o].label) + '</button>').join('') + '</div></div>' : '') +
      '<div class="ab-sheet-p">' + priceBlock(p) + '<small class="ab-tax">Inclusive of all taxes</small></div>' +
      (p.out ? '<p class="ab-stock no">Currently unavailable</p>' : p.stock > 0 && p.stock <= 5 ? '<p class="ab-stock warn">Only ' + p.stock + ' left in stock</p>' : '<p class="ab-stock ok">In stock</p>') +
      (del ? '<p class="ab-del">' + del + '</p>' : '') +
      (p.out ? '' : '<div class="ab-sheet-a"><span class="ab-buy" data-pid="' + esc(p.id) + '">' + buyCtl(p.id, qty, p.name) + '</span>' +
        '<button type="button" class="ab-btn ab-btn-solid ab-buynow" data-shop="buy" data-pid="' + esc(p.id) + '">Buy now</button></div>') +
      '<button type="button" class="ab-btn ab-viewcart" data-shop="open">View cart</button>' +
      (about ? '<div class="ab-about-h">About this item</div>' + about : '') + relHtml + '</div>';
    const lay = ab.querySelector('.ab-layer[data-layer="item"]');
    if (lay.hidden) { openLayer(ab, 'item'); box.scrollTop = 0; }
  }

  /* Category chips + search box + sort menu, all working on the same grid. */
  function applyShopFilter(sec) {
    if (!sec) return;
    const qEl = sec.querySelector('[data-shop-q]'), sEl = sec.querySelector('[data-shop-sort]'), chip = sec.querySelector('.ab-chips .on');
    const needle = (qEl ? qEl.value : '').trim().toLowerCase(), sort = sEl ? sEl.value : '', cat = chip ? chip.getAttribute('data-cat') : '';
    let shown = 0, total = 0;
    sec.querySelectorAll('.ab-prod').forEach(p => {
      total++;
      const hit = (!cat || p.getAttribute('data-cat') === cat) && (!needle || (p.getAttribute('data-q') || '').indexOf(needle) >= 0);
      p.hidden = !hit; if (hit) shown++;
      const i = Number(p.getAttribute('data-i')) || 0, pr = Number(p.getAttribute('data-price')) || 0, off = Number(p.getAttribute('data-off')) || 0;
      p.style.order = sort === 'low' ? pr : sort === 'high' ? -pr : sort === 'off' ? (-off * 1000 + i) : i;
    });
    const n = sec.querySelector('.ab-shop-n'); if (n) n.textContent = (needle || cat) ? shown + ' of ' + total + ' products' : total + (total === 1 ? ' product' : ' products');
    const none = sec.querySelector('.ab-shop-none'); if (none) none.hidden = shown > 0;
  }

  /* ------------------------------------------------------------------ */
  /* Checkout — cart drawer → delivery → payment → review → confirmation */
  /* ------------------------------------------------------------------ */
  const CO = {};        // cart key → checkout state (this tab)
  const profKey = k => k.replace(/^ab-cart-/, 'ab-prof-'), ordKey = k => k.replace(/^ab-cart-/, 'ab-ord-');
  const readJson = (key, fb) => { try { const v = JSON.parse(root.localStorage.getItem(key) || ''); return v == null ? fb : v; } catch (e) { return fb; } };
  const writeJson = (key, v) => { try { root.localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  const ordersOf = k => { const a = readJson(ordKey(k), []); return Array.isArray(a) ? a : []; };
  const apiBase = () => { try { return API_BASE; } catch (e) { return 'https://xyzzy-backend.onrender.com'; } };

  function ffOptions(st) {
    const o = [];
    if (st.pickup) o.push(['pickup', 'Pick up at the café']);
    if (st.delivery) o.push(['delivery', 'Home delivery' + (Number(st.fee) > 0 ? ' (' + RS(st.fee) + ')' : '')]);
    if (!o.length) o.push(['pickup', 'Pick up at the café']);
    return o;
  }
  function slotList(st) { return String(st.slots || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean).slice(0, 12); }
  function payOptions(D, ff) {
    const st = D.settings, o = [];
    if (st.payCash || !(UPI.test(st.upi) && st.payUpi) && !(st.serverOrders && st.payOnline)) o.push(['cash', ff === 'delivery' ? 'Pay on delivery' : 'Pay at the café', 'Cash or UPI when you ' + (ff === 'delivery' ? 'receive it' : 'collect it')]);
    if (UPI.test(st.upi) && st.payUpi) o.push(['upi', 'Pay now with UPI', 'Opens GPay, PhonePe, Paytm or any UPI app']);
    if (st.serverOrders && st.payOnline) o.push(['online', 'Card, UPI or net banking', 'Secure online payment']);
    return o;
  }
  const payLabel = (D, pay, ff) => { const o = payOptions(D, ff).filter(x => x[0] === pay)[0]; return o ? o[1] : pay === 'online' ? 'Paid online' : pay === 'upi' ? 'UPI' : 'Pay on delivery'; };

  function coState(k, D) {
    if (!CO[k]) {
      const p = readJson(profKey(k), {});
      CO[k] = { view: 'flow', step: 1, ff: '', name: String(p.name || ''), phone: String(p.phone || ''), address: String(p.address || ''), slot: '', note: '', pay: '', code: '', done: null, busy: false };
    }
    const s = CO[k], f = ffOptions(D.settings);
    if (!f.some(o => o[0] === s.ff)) s.ff = f[0][0];
    const po = payOptions(D, s.ff);
    if (!po.some(o => o[0] === s.pay)) s.pay = po[0][0];
    return s;
  }
  const couponOf = (D, code) => { code = String(code || '').trim().toUpperCase(); return code ? ((D.settings.coupons || []).filter(c => c.code === code && Number(c.value) > 0)[0] || null) : null; };

  function totals(ab, k, D) {
    const c = loadCart(k), sub = cartSub(c, D.byId), s = coState(k, D), st = D.settings, cp = couponOf(D, s.code);
    let disc = 0, cpErr = '';
    if (s.code) {
      if (!cp) cpErr = 'That code isn\'t valid.';
      else if (sub < cp.min) cpErr = 'Add ' + RS(cp.min - sub) + ' more to use ' + cp.code + '.';
      else disc = cp.kind === 'flat' ? Math.min(cp.value, sub) : Math.round(sub * Math.min(100, cp.value)) / 100;
    }
    const net = sub - disc;
    const free = s.ff === 'delivery' && st.fee > 0 && st.freeAbove > 0 && net >= st.freeAbove;
    const fee = s.ff === 'delivery' && !free ? st.fee : 0;
    return { sub: sub, disc: disc, fee: fee, free: free, total: net + fee, ff: s.ff, count: cartCount(c), cp: disc ? cp : null, cpErr: cpErr, net: net };
  }

  function sumHtml(t, D) {
    return '<div class="ab-tot"><div><span>Items (' + t.count + ')</span><span>' + RS(t.sub) + '</span></div>' +
      (t.disc ? '<div class="ab-tot-save"><span>Coupon ' + esc(t.cp.code) + '</span><span>− ' + RS(t.disc) + '</span></div>' : '') +
      (t.ff === 'delivery' ? '<div><span>Delivery</span><span>' + (t.free ? '<b class="ab-free">FREE</b>' : RS(t.fee)) + '</span></div>' : '') +
      '<div class="ab-tot-big"><span>Order total</span><span>' + RS(t.total) + '</span></div></div>' +
      (D.settings.min && t.sub < D.settings.min ? '<p class="ab-tot-min">Minimum order is ' + RS(D.settings.min) + ' — add ' + RS(D.settings.min - t.sub) + ' more.</p>' : '');
  }
  function freeBarHtml(t, D) {
    const st = D.settings;
    if (!st.delivery || !(st.fee > 0) || !(st.freeAbove > 0) || !t.count) return '';
    const left = st.freeAbove - t.net, pct = Math.max(4, Math.min(100, Math.round(t.net / st.freeAbove * 100)));
    return '<div class="ab-fd' + (left <= 0 ? ' ok' : '') + '"><p>' + (left <= 0 ? '<b>Your order qualifies for FREE delivery</b>' : 'Add <b>' + RS(left) + '</b> more for <b>FREE delivery</b>') + '</p><i><u style="width:' + pct + '%"></u></i></div>';
  }
  function couponHtml(t, D, s) {
    if (!(D.settings.coupons || []).some(c => c.code && c.value > 0)) return '';
    if (t.cp) return '<div class="ab-cp ok"><span>✓ <b>' + esc(t.cp.code) + '</b> applied — you save ' + RS(t.disc) + '</span><button type="button" class="ab-lnk" data-co="unapply">Remove</button></div>';
    return '<div class="ab-cp"><div class="ab-cp-row"><input type="text" maxlength="16" placeholder="Coupon code" autocomplete="off" autocapitalize="characters" aria-label="Coupon code" value="' + esc(s.code) + '"><button type="button" class="ab-btn" data-co="apply">Apply</button></div>' +
      (t.cpErr ? '<p class="ab-cp-err">' + esc(t.cpErr) + '</p>' : '') + '</div>';
  }

  function refreshBag(ab, k, D, lines, t, s) {
    const sum = ab.querySelector('.ab-bag-sum'); if (!sum) return;
    sum.hidden = !lines.length;
    const below = D.settings.min && t.sub < D.settings.min;
    sum.innerHTML = freeBarHtml(t, D) + couponHtml(t, D, s) + sumHtml(t, D) +
      '<button type="button" class="ab-btn ab-btn-solid ab-bag-go" data-co="start"' + (below ? ' disabled' : '') + '>Proceed to checkout · ' + RS(t.total) + '</button>' +
      '<button type="button" class="ab-btn ab-bag-more" data-shop="close">Continue shopping</button>';
    const o = ab.querySelector('[data-co="orders"][data-in="bag"]'); if (o) o.hidden = !ordersOf(k).length;
  }

  function startCheckout(ab) {
    const sh = shopOf(ab); if (!sh) return;
    const k = sh.k, D = sh.D, t = totals(ab, k, D);
    if (!t.count) return;
    if (D.settings.min && t.sub < D.settings.min) return;
    const s = coState(k, D); s.view = 'flow'; s.step = 1; s.done = null;
    closeLayers(ab, true); openLayer(ab, 'co'); renderCo(ab);
    const g = ab.querySelector('.ab-co-grid'); if (g) g.scrollTop = 0;
  }

  const STEPS = ['Delivery', 'Payment', 'Review'];
  function renderCo(ab) {
    const sh = shopOf(ab); if (!sh) return;
    const k = sh.k, D = sh.D, s = coState(k, D), st = D.settings;
    const root_ = ab.querySelector('.ab-co'); if (!root_) return;
    const stepsEl = root_.querySelector('.ab-co-steps'), main = root_.querySelector('.ab-co-main'), side = root_.querySelector('.ab-co-sum'), grid = root_.querySelector('.ab-co-grid');
    const lines = bagLines(k, D), t = totals(ab, k, D);
    const flow = s.view === 'flow';
    stepsEl.hidden = !flow; side.hidden = !flow || !lines.length;
    grid.classList.toggle('ab-co-one', !flow);
    root_.querySelector('.ab-co-back').hidden = s.view === 'done';
    if (flow && !lines.length) { s.view = 'flow'; main.innerHTML = '<div class="ab-co-box ab-co-empty"><p>Your cart is empty.</p><button type="button" class="ab-btn ab-btn-solid" data-shop="close">Continue shopping</button></div>'; stepsEl.hidden = true; side.hidden = true; return; }
    stepsEl.innerHTML = STEPS.map((n, i) => '<li class="' + (s.step === i + 1 ? 'on' : s.step > i + 1 ? 'done' : '') + '"><i>' + (s.step > i + 1 ? '✓' : i + 1) + '</i><span>' + n + '</span></li>').join('');
    side.innerHTML = '<h3 class="ab-co-h">Order summary</h3><div class="ab-co-mini">' + lines.map(l =>
      '<div><span class="ab-li-m">' + lineMedia(l.p) + '</span><span class="ab-co-mn">' + esc(l.p.name) + '<small>Qty ' + l.q + '</small></span><b>' + RS(l.p.price * l.q) + '</b></div>').join('') + '</div>' +
      (s.step === 3 ? '' : couponHtml(t, D, s)) + sumHtml(t, D) +
      (st.eta && s.ff === 'delivery' ? '<p class="ab-eta">' + esc(st.eta) + '</p>' : '');

    if (s.view === 'done') return void (main.innerHTML = doneHtml(s, D, k));
    if (s.view === 'orders') return void (main.innerHTML = ordersHtml(k, D));

    const msg = '<p class="ab-book-msg ab-co-msg" role="alert" aria-live="polite"></p>';
    if (s.step === 1) {
      const f = ffOptions(st), slots = slotList(st);
      main.innerHTML = '<div class="ab-co-box"><h2 class="ab-co-h">1 · How would you like to get it?</h2>' +
        (f.length > 1 ? '<div class="ab-co-opts">' + f.map(o => '<label class="ab-opt"><input type="radio" name="co-ff" data-co-in="ff" value="' + o[0] + '"' + (s.ff === o[0] ? ' checked' : '') + '><span><b>' + esc(o[1]) + '</b></span></label>').join('') + '</div>' : '<p class="ab-ff-one">' + esc(f[0][1]) + '</p>') +
        '<div class="ab-co-form">' +
        '<label class="ab-fld"><span>Full name</span><input data-co-in="name" type="text" maxlength="60" autocomplete="name" value="' + esc(s.name) + '"></label>' +
        '<label class="ab-fld"><span>Mobile number</span><input data-co-in="phone" type="tel" maxlength="20" autocomplete="tel" inputmode="tel" value="' + esc(s.phone) + '"></label>' +
        (s.ff === 'delivery' ? '<label class="ab-fld full"><span>Delivery address</span><textarea data-co-in="address" rows="3" maxlength="300" autocomplete="street-address" placeholder="House / flat, street, area, landmark, PIN">' + esc(s.address) + '</textarea></label>' : '') +
        (slots.length ? '<label class="ab-fld full"><span>' + (s.ff === 'delivery' ? 'Delivery time' : 'Pickup time') + '</span><select data-co-in="slot">' + ['As soon as possible'].concat(slots).map(x => '<option' + (s.slot === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' : '') +
        '<label class="ab-fld full"><span>Note for the café (optional)</span><textarea data-co-in="note" rows="2" maxlength="200" placeholder="Grind for French press, gift wrap…">' + esc(s.note) + '</textarea></label></div>' +
        msg + '<button type="button" class="ab-btn ab-btn-solid ab-co-go" data-co="next">Continue to payment</button></div>';
    } else if (s.step === 2) {
      main.innerHTML = '<div class="ab-co-box"><h2 class="ab-co-h">2 · Payment method</h2><div class="ab-co-opts">' +
        payOptions(D, s.ff).map(o => '<label class="ab-opt"><input type="radio" name="co-pay" data-co-in="pay" value="' + o[0] + '"' + (s.pay === o[0] ? ' checked' : '') + '><span><b>' + esc(o[1]) + '</b><small>' + esc(o[2]) + '</small></span></label>').join('') + '</div>' +
        '<button type="button" class="ab-btn ab-btn-solid ab-co-go" data-co="next">Review your order</button></div>';
    } else {
      main.innerHTML = '<div class="ab-co-box"><div class="ab-co-rh"><h2 class="ab-co-h">3 · Review and place order</h2></div>' +
        '<div class="ab-co-rv"><div><small>' + (s.ff === 'delivery' ? 'Delivering to' : 'Pick up at the café') + '</small><b>' + esc(s.name) + (s.phone ? ' · ' + esc(s.phone) : '') + '</b>' +
          (s.ff === 'delivery' ? '<span>' + esc(s.address) + '</span>' : '') + (s.slot && slotList(st).length ? '<span>' + esc(s.slot) + '</span>' : '') + (s.note ? '<span>“' + esc(s.note) + '”</span>' : '') + '</div><button type="button" class="ab-lnk" data-co="goto1">Change</button></div>' +
        '<div class="ab-co-rv"><div><small>Payment</small><b>' + esc(payLabel(D, s.pay, s.ff)) + '</b></div><button type="button" class="ab-lnk" data-co="goto2">Change</button></div>' +
        '<div class="ab-bag-list">' + lines.map(l => '<div class="ab-li"><span class="ab-li-m">' + lineMedia(l.p) + '</span><span class="ab-li-b"><b>' + esc(l.p.name) + '</b><small>' + RS(l.p.price) + ' each</small></span><span class="ab-buy" data-pid="' + esc(l.p.id) + '">' + buyCtl(l.p.id, l.q, l.p.name) + '</span></div>').join('') + '</div>' +
        couponHtml(t, D, s) + msg +
        '<button type="button" class="ab-btn ab-btn-solid ab-co-go" data-co="place"' + (s.busy ? ' disabled' : '') + '>' + (s.busy ? 'Placing your order…' : (s.pay === 'upi' || s.pay === 'online' ? 'Place order and pay ' : 'Place order · ') + RS(t.total)) + '</button>' +
        '<p class="ab-fine">By placing the order you agree ' + esc(D.cafeName) + ' will contact you about it.</p></div>';
    }
  }

  function waLink(D, text) { return D.to ? 'https://wa.me/' + D.to + '?text=' + encodeURIComponent(text) : ''; }
  function orderText(D, o) {
    return ['Hi ' + D.cafeName + '! New order ' + o.id + ':', '']
      .concat(o.lines.map(l => l.q + ' × ' + l.n + ' — ' + RS(l.p * l.q)))
      .concat(['', 'Items: ' + RS(o.sub), o.disc ? 'Coupon ' + o.code + ': −' + RS(o.disc) : '', o.ff === 'delivery' ? 'Delivery: ' + (o.fee ? RS(o.fee) : 'FREE') : '', 'Total: ' + RS(o.total), '',
        o.ff === 'delivery' ? 'Deliver to: ' + o.address : 'I\'ll pick it up from the café.', o.slot && o.slot !== 'As soon as possible' ? 'Time: ' + o.slot : '',
        'Name: ' + o.name, o.phone ? 'Phone: ' + o.phone : '', o.note ? 'Note: ' + o.note : '',
        'Payment: ' + (o.paid ? 'Paid online ✓' : o.pay === 'upi' ? 'Paying by UPI (will share the screenshot)' : o.ff === 'delivery' ? 'Pay on delivery' : 'Pay at the café')])
      .filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n').trim();
  }
  function upiHref(D, o) {
    return 'upi://pay?pa=' + encodeURIComponent(D.settings.upi) + '&pn=' + encodeURIComponent(D.settings.payee || D.cafeName) + '&am=' + o.total.toFixed(2) + '&cu=INR&tn=' + encodeURIComponent('Order ' + o.id);
  }

  function doneHtml(s, D, k) {
    const o = s.done; if (!o) return '';
    const wa = waLink(D, orderText(D, o));
    return '<div class="ab-co-box ab-co-ok"><div class="ab-co-tick" aria-hidden="true">✓</div><h2>Order placed' + (o.name ? ', ' + esc(o.name.split(' ')[0]) : '') + '!</h2>' +
      '<p class="ab-co-id">Order <b>#' + esc(o.id) + '</b></p>' +
      '<p class="ab-co-say">' + (o.paid ? 'Payment received — thank you. ' + esc(D.cafeName) + ' has your order.' : o.sent ? esc(D.cafeName) + ' has your order.' : o.wa ? 'WhatsApp opened with your order — <b>press send there</b> so ' + esc(D.cafeName) + ' gets it.' : 'Tap the green button below to send it to ' + esc(D.cafeName) + ' on WhatsApp.') + '</p>' +
      '<div class="ab-co-rv"><div><small>' + (o.ff === 'delivery' ? 'Delivering to' : 'Pick up at the café') + '</small><b>' + esc(o.name) + '</b>' + (o.ff === 'delivery' ? '<span>' + esc(o.address) + '</span>' : '') +
        (o.slot && o.slot !== 'As soon as possible' ? '<span>' + esc(o.slot) + '</span>' : '') + (D.settings.eta && o.ff === 'delivery' ? '<span>' + esc(D.settings.eta) + '</span>' : '') + '</div></div>' +
      '<div class="ab-co-items">' + o.lines.map(l => '<div><span>' + l.q + ' × ' + esc(l.n) + '</span><b>' + RS(l.p * l.q) + '</b></div>').join('') + '<div class="ab-tot-big"><span>Total</span><span>' + RS(o.total) + '</span></div></div>' +
      '<div class="ab-after">' +
      (o.pay === 'upi' && !o.paid ? '<a class="ab-btn ab-btn-solid" href="' + esc(upiHref(D, o)) + '">Pay ' + RS(o.total) + ' by UPI</a><p class="ab-fine">UPI ID: ' + esc(D.settings.upi) + '</p>' : '') +
      (wa ? '<a class="ab-btn ab-wa' + (o.wa || o.sent ? '' : ' ab-btn-solid') + '" href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">' + (o.wa || o.sent ? 'Send on WhatsApp again' : 'Send order on WhatsApp') + '</a>' : '') +
      '<button type="button" class="ab-btn" data-co="orders">My orders</button><button type="button" class="ab-btn" data-shop="close">Continue shopping</button></div></div>';
  }
  function ordersHtml(k, D) {
    const list = ordersOf(k);
    return '<div class="ab-co-box"><div class="ab-co-rh"><h2 class="ab-co-h">My orders</h2><button type="button" class="ab-lnk" data-co="back">Back</button></div>' +
      (list.length ? list.map(o => '<div class="ab-ord"><div class="ab-ord-h"><b>#' + esc(o.id) + '</b><span>' + esc(new Date(o.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })) + '</span><b>' + RS(o.total) + '</b></div>' +
        '<p>' + o.lines.map(l => l.q + ' × ' + esc(l.n)).join(', ') + '</p><small>' + (o.ff === 'delivery' ? 'Delivery' : 'Pickup') + ' · ' + esc(payLabel(D, o.pay, o.ff)) + '</small>' +
        '<div class="ab-ord-a"><button type="button" class="ab-btn" data-co="again" data-oid="' + esc(o.id) + '">Order again</button>' + (D.to ? '<a class="ab-btn" target="_blank" rel="noopener noreferrer" href="' + esc(waLink(D, orderText(D, o))) + '">WhatsApp</a>' : '') + '</div></div>').join('')
        : '<p class="ab-bag-empty">No orders from this phone yet.</p>') + '</div>';
  }

  /* Pay with the café's own Razorpay key (server hands us its public key id + order). */
  function loadRzp() {
    return new Promise((res, rej) => {
      if (root.Razorpay) return res();
      const s = root.document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => res(); s.onerror = () => rej(new Error('Could not load the payment window. Check your connection.'));
      root.document.head.appendChild(s);
    });
  }

  function finishOrder(ab, k, D, s, o) {
    o.ts = Date.now();
    const list = ordersOf(k); list.unshift(o); writeJson(ordKey(k), list.slice(0, 15));
    writeJson(profKey(k), { name: o.name, phone: o.phone, address: o.address });
    const c = loadCart(k); Object.keys(c).forEach(x => { delete c[x]; }); saveCart(k);
    s.done = o; s.view = 'done'; s.busy = false; s.code = ''; s.note = '';
    renderCo(ab); syncShop(ab);
    const g = ab.querySelector('.ab-co-grid'); if (g) g.scrollTop = 0;
  }

  function placeOrder(ab) {
    const sh = shopOf(ab); if (!sh || coState(sh.k, sh.D).busy) return;
    const k = sh.k, D = sh.D, s = coState(k, D), st = D.settings, lines = bagLines(k, D), t = totals(ab, k, D);
    const msg = ab.querySelector('.ab-co-msg');
    const bad = m => { if (msg) { msg.textContent = m; msg.className = 'ab-book-msg ab-co-msg bad'; } };
    if (!lines.length) return bad('Your cart is empty.');
    if (st.min && t.sub < st.min) return bad('Minimum order is ' + RS(st.min) + '.');
    const o = { id: (Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-3)).toUpperCase(), name: s.name.trim(), phone: s.phone.trim(), address: s.address.trim(), note: s.note.trim(), slot: s.slot,
      ff: s.ff, pay: s.pay, sub: t.sub, disc: t.disc, fee: t.fee, total: t.total, code: t.cp ? t.cp.code : '', lines: lines.map(l => ({ id: l.p.id, n: l.p.name, q: l.q, p: l.p.price })), paid: false, wa: false, sent: false };
    const post = !!st.serverOrders;
    if (!post) {                       // WhatsApp must open inside this tap (phones block popups otherwise)
      const link = waLink(D, orderText(D, o));
      if (link) { const a = root.document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.display = 'none'; root.document.body.appendChild(a); a.click(); a.remove(); o.wa = true; }
      return finishOrder(ab, k, D, s, o);
    }
    s.busy = true; renderCo(ab);
    const body = { ref: o.id, items: o.lines.map(l => ({ id: l.id, name: l.n, qty: l.q, price: l.p })), name: o.name, phone: o.phone, address: o.address, note: o.note, slot: o.slot, ff: o.ff, coupon: o.code, pay: o.pay, subtotal: o.sub, discount: o.disc, fee: o.fee, total: o.total };
    const cafeId = D.cafeId;
    (async () => {
      let j = {};
      try {
        const r = await fetch(apiBase() + '/order/cafe/' + encodeURIComponent(cafeId) + '/shop/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j && j.detail ? String(j.detail) : 'Could not place the order.');
        o.sent = true;
      } catch (e) {
        if (o.pay === 'online') { s.busy = false; renderCo(ab); return bad(e.message || 'Could not start the payment.'); }
        o.sent = false;                // fall back to WhatsApp (button on the confirmation page)
      }
      if (o.pay === 'online' && j.online) {
        try { await loadRzp(); } catch (e) { s.busy = false; renderCo(ab); return bad(e.message); }
        const rz = new root.Razorpay({
          key: j.online.key_id, order_id: j.online.order_id, amount: j.online.amount, currency: 'INR', name: D.cafeName, description: 'Order ' + o.id,
          prefill: { name: o.name, contact: o.phone },
          handler: async resp => {
            try {
              const r2 = await fetch(apiBase() + '/order/cafe/' + encodeURIComponent(cafeId) + '/shop/order/' + encodeURIComponent(j.ref || o.id) + '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }) });
              o.paid = r2.ok;
            } catch (e) { o.paid = false; }
            finishOrder(ab, k, D, s, o);
          },
          modal: { ondismiss: () => { s.busy = false; renderCo(ab); bad('Payment not completed — your order has not been placed.'); } },
        });
        rz.open(); return;
      }
      if (o.pay === 'online') { s.busy = false; renderCo(ab); return bad('Online payment is not available right now.'); }
      finishOrder(ab, k, D, s, o);
    })();
  }

  function onCo(e, t, ab) {
    const sh = shopOf(ab); if (!sh) return;
    const k = sh.k, D = sh.D, s = coState(k, D), act = t.getAttribute('data-co');
    const msg = () => ab.querySelector('.ab-co-msg');
    const bad = m => { const n = msg(); if (n) { n.textContent = m; n.className = 'ab-book-msg ab-co-msg bad'; } };
    const top = () => { const g = ab.querySelector('.ab-co-grid'); if (g) g.scrollTop = 0; };
    switch (act) {
      case 'start': startCheckout(ab); return;
      case 'apply': {
        const box = t.closest('.ab-cp'), inp = box && box.querySelector('input');
        s.code = inp ? inp.value.trim().toUpperCase() : '';
        syncShop(ab); if (!ab.querySelector('.ab-layer[data-layer="co"]').hidden) renderCo(ab);
        return;
      }
      case 'unapply': s.code = ''; syncShop(ab); if (!ab.querySelector('.ab-layer[data-layer="co"]').hidden) renderCo(ab); return;
      case 'back':
        if (s.view === 'orders') { s.view = s.done ? 'done' : 'flow'; renderCo(ab); top(); return; }
        if (s.view === 'flow' && s.step > 1) { s.step--; renderCo(ab); top(); return; }
        closeLayers(ab, true); openLayer(ab, 'bag'); syncShop(ab); return;
      case 'goto1': s.step = 1; renderCo(ab); top(); return;
      case 'goto2': s.step = 2; renderCo(ab); top(); return;
      case 'next': {
        if (s.step === 1) {
          if (!s.name.trim()) return bad('Please tell us your name.');
          if (telDigits(s.phone).replace(/\D/g, '').length < 6) return bad('Add a mobile number so we can reach you about the order.');
          if (s.ff === 'delivery' && s.address.trim().length < 8) return bad('Add the full delivery address.');
        }
        s.step = Math.min(3, s.step + 1); renderCo(ab); top(); return;
      }
      case 'place': placeOrder(ab); return;
      case 'orders': s.view = 'orders'; if (ab.querySelector('.ab-layer[data-layer="co"]').hidden) { closeLayers(ab, true); openLayer(ab, 'co'); } renderCo(ab); top(); return;
      case 'again': {
        const o = ordersOf(k).filter(x => x.id === t.getAttribute('data-oid'))[0]; if (!o) return;
        const c = loadCart(k); let n = 0;
        o.lines.forEach(l => { const p = D.byId[l.id]; if (p && !p.out && !p.noadd) { c[l.id] = Math.min(p.stock > 0 ? p.stock : 99, (c[l.id] || 0) + l.q); n++; } });
        saveCart(k); s.view = 'flow'; s.step = 1; s.done = null;
        if (!n) { renderCo(ab); return bad('Those items are no longer available.'); }
        closeLayers(ab, true); openLayer(ab, 'bag'); syncShop(ab); return;
      }
    }
  }
  function onCoInput(e) {
    const t = e.target; if (!t || !t.getAttribute) return;
    const key = t.getAttribute('data-co-in'); if (!key) return;
    const ab = liveAb(t), sh = shopOf(ab); if (!sh) return;
    const s = coState(sh.k, sh.D);
    s[key] = t.value;
    if (e.type === 'change' && (key === 'ff' || key === 'pay')) { renderCo(ab); syncShop(ab); }
  }

  /* One-off stylesheet for the cart + checkout (uses the page's own colour and font variables). */
  const CO_CSS = '' +
    '.ab-bag-sum{display:grid;gap:12px;margin-top:14px}.ab-bag-more{justify-content:center;width:100%}.ab-bag-go[disabled]{opacity:.5;cursor:not-allowed}' +
    '.ab-dr-acts{display:flex;align-items:center;gap:8px}.ab-lnk{border:0;background:none;color:var(--ab-accent-text);font:700 13px var(--ab-body);cursor:pointer;padding:6px 4px;text-decoration:underline}' +
    '.ab-tot-save span:last-child,.ab-free{color:#1b8a4b;font-weight:700}' +
    '.ab-fd{padding:10px 12px;border-radius:calc(var(--ab-r)*.6);background:var(--ab-card);border:1px solid var(--ab-line)}.ab-fd p{margin:0 0 7px;font-size:13px}.ab-fd i{display:block;height:6px;border-radius:9px;background:var(--ab-line);overflow:hidden}.ab-fd u{display:block;height:100%;background:var(--ab-accent);border-radius:9px;transition:width .3s}.ab-fd.ok u{background:#1b8a4b}' +
    '.ab-cp{display:grid;gap:6px}.ab-cp-row{display:flex;gap:8px}.ab-cp-row input{flex:1;min-width:0;min-height:44px;padding:0 12px;font:inherit;font-size:16px;text-transform:uppercase;color:var(--ab-ink);background:var(--ab-bg);border:1.5px dashed var(--ab-line);border-radius:calc(var(--ab-r)*.6)}.ab-cp-err{margin:0;color:#c0392b;font-size:12.5px;font-weight:600}.ab-cp.ok{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;border-radius:calc(var(--ab-r)*.6);background:rgba(27,138,75,.1);color:#1b8a4b;font-size:13px}' +
    '.ab-layer.ab-co-layer{justify-content:center;align-items:stretch}' +
    '.ab-co{position:relative;display:flex;flex-direction:column;width:100%;height:100%;background:var(--ab-card);color:var(--ab-ink);font-family:var(--ab-body);opacity:0;transform:translateY(16px);transition:opacity .2s ease,transform .2s ease}.ab-layer.is-on .ab-co{opacity:1;transform:none}' +
    '.ab-co-top{display:flex;align-items:center;gap:10px;padding:10px 12px;padding-top:calc(10px + env(safe-area-inset-top,0px));background:var(--ab-bg);border-bottom:1px solid var(--ab-line)}.ab-co-top b{flex:1;font-family:var(--ab-head);font-weight:var(--ab-head-w);font-size:calc(22px*var(--ab-head-scale));text-transform:var(--ab-head-tt)}.ab-co-lock{font-size:12px;color:var(--ab-muted);font-weight:600}' +
    '.ab-co-back{width:40px;height:40px;border:0;border-radius:50%;background:var(--ab-card);color:inherit;font-size:22px;line-height:1;cursor:pointer}' +
    '.ab-co-steps{display:flex;list-style:none;margin:0;padding:12px 16px;gap:6px;background:var(--ab-bg);border-bottom:1px solid var(--ab-line)}.ab-co-steps li{flex:1;display:flex;align-items:center;gap:8px;min-width:0;font-size:12.5px;font-weight:600;color:var(--ab-muted)}.ab-co-steps i{flex:0 0 24px;height:24px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:12px;border:1.5px solid var(--ab-line)}.ab-co-steps span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ab-co-steps .on{color:var(--ab-ink)}.ab-co-steps .on i{background:var(--ab-accent);border-color:var(--ab-accent);color:var(--ab-accent-ink)}.ab-co-steps .done i{background:var(--ab-ink);border-color:var(--ab-ink);color:var(--ab-bg)}' +
    '.ab-co-grid{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-content:start;padding:14px 14px calc(28px + env(safe-area-inset-bottom,0px))}.ab-co-grid.ab-co-one{max-width:680px;width:100%;margin:0 auto}' +
    '.ab-co-box,.ab-co-sum{background:var(--ab-bg);border:1px solid var(--ab-line);border-radius:var(--ab-r);padding:16px;display:grid;gap:12px;align-content:start;min-width:0}.ab-co-sum{gap:10px}' +
    '.ab-co-h{margin:0;font:700 17px var(--ab-body)}.ab-co-rh{display:flex;justify-content:space-between;align-items:center;gap:8px}' +
    '.ab-co-opts{display:grid;gap:8px}.ab-co-opts .ab-opt+.ab-opt{margin-top:0}.ab-opt span{display:grid;gap:2px}.ab-opt small{font-weight:500;color:var(--ab-muted);font-size:12.5px}' +
    '.ab-co-form{display:grid;grid-template-columns:1fr;gap:12px}@media(min-width:560px){.ab-co-form{grid-template-columns:1fr 1fr}}.ab-co-form .full{grid-column:1/-1}' +
    '.ab-co-go{width:100%;justify-content:center;margin-top:4px}.ab-co-go[disabled]{opacity:.6}.ab-co-msg{margin:0}' +
    '.ab-co-rv{display:flex;justify-content:space-between;gap:10px;padding:12px 14px;border:1px solid var(--ab-line);border-radius:calc(var(--ab-r)*.6)}.ab-co-rv>div{display:grid;gap:2px;min-width:0;font-size:14px;overflow-wrap:anywhere}.ab-co-rv small{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ab-muted)}.ab-co-rv span{color:var(--ab-muted);font-size:13px}' +
    '.ab-co-mini{display:grid;gap:8px}.ab-co-mini>div{display:flex;align-items:center;gap:10px;font-size:13px}.ab-co-mini .ab-li-m{flex:0 0 40px;width:40px;height:40px}.ab-co-mn{flex:1;min-width:0;display:grid;font-weight:600;overflow-wrap:anywhere}.ab-co-mn small{color:var(--ab-muted);font-weight:500}.ab-eta{margin:0;font-size:12.5px;color:var(--ab-muted)}' +
    '.ab-co-ok{text-align:center;justify-items:center}.ab-co-ok h2{margin:0;font-family:var(--ab-head);font-weight:var(--ab-head-w);font-size:calc(28px*var(--ab-head-scale));text-transform:var(--ab-head-tt)}.ab-co-tick{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;font-size:32px;background:#1b8a4b;color:#fff}.ab-co-id,.ab-co-say{margin:0}.ab-co-say{color:var(--ab-muted);font-size:14px;max-width:46ch}.ab-co-ok .ab-co-rv,.ab-co-ok .ab-co-items,.ab-co-ok .ab-after{width:100%;text-align:left}' +
    '.ab-co-items{display:grid;gap:6px;font-size:14px}.ab-co-items>div{display:flex;justify-content:space-between;gap:10px}.ab-co-items .ab-tot-big{border-top:1px solid var(--ab-line);padding-top:8px;font-weight:700;font-size:16px}.ab-wa{background:#25d366;border-color:#25d366;color:#fff}.ab-wa.ab-btn-solid{background:#25d366;border-color:#25d366;color:#fff}' +
    '.ab-ord{display:grid;gap:4px;padding:12px 0;border-top:1px solid var(--ab-line)}.ab-ord-h{display:flex;justify-content:space-between;gap:10px;font-size:14px}.ab-ord-h span{color:var(--ab-muted)}.ab-ord p{margin:0;font-size:13.5px}.ab-ord small{color:var(--ab-muted)}.ab-ord-a{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}' +
    '.ab-optrow{display:grid;gap:6px;width:100%}.ab-optname{font-size:13px;color:var(--ab-muted)}.ab-optchips{display:flex;flex-wrap:wrap;gap:8px}.ab-optchips button{min-height:38px;padding:0 14px;border-radius:calc(var(--ab-r)*.6);border:1.5px solid var(--ab-line);background:transparent;color:inherit;font:600 13.5px var(--ab-body);cursor:pointer}.ab-optchips button.on{border-color:var(--ab-accent);background:var(--ab-card);box-shadow:inset 0 0 0 1px var(--ab-accent)}' +
    '.ab-stock.warn{color:#b9650a;font-weight:700}' +
    '@media(min-width:900px){.ab-layer.ab-co-layer{align-items:center;padding:24px}.ab-co{max-width:1080px;height:min(100%,860px);border-radius:var(--ab-r);overflow:hidden}.ab-co-grid:not(.ab-co-one){grid-template-columns:minmax(0,1fr) 340px;padding:20px;gap:18px}.ab-co-sum{position:sticky;top:0;align-self:start}}' +
    '@media(max-width:560px){.ab-layer.ab-co-layer{align-items:stretch}}' +
    '.ab-ann{padding:9px 16px;text-align:center;font:600 13px/1.4 var(--ab-body);background:var(--ab-accent);color:var(--ab-accent-ink)}.ab-ann a{color:inherit;text-decoration:underline;text-underline-offset:3px}.ab-ann-ink{background:var(--ab-ink);color:var(--ab-bg)}.ab-ann-pop{background:var(--ab-accent2);color:var(--ab-accent2-ink)}' +
    '.ab-faq{display:grid;gap:10px}.ab-faq-i{border-bottom:1px solid var(--ab-line)}.ab-faq-cards .ab-faq-i{border:1px solid var(--ab-line);border-radius:calc(var(--ab-r)*.7);background:var(--ab-card)}.ab-faq-i summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 4px;font:700 15px/1.35 var(--ab-body);min-height:48px}.ab-faq-cards .ab-faq-i summary{padding:14px 16px}.ab-faq-i summary::-webkit-details-marker{display:none}.ab-faq-i summary::after{content:"+";font-size:22px;line-height:1;color:var(--ab-accent-text);flex:0 0 auto;transition:transform .2s}.ab-faq-i[open] summary::after{transform:rotate(45deg)}.ab-faq-a{padding:0 4px 16px;color:var(--ab-muted);font-size:14.5px;line-height:1.6;overflow-wrap:anywhere}.ab-faq-cards .ab-faq-a{padding:0 16px 16px}' +
    '.ab-pl{display:grid;gap:2px}.ab-pl-r{display:flex;align-items:baseline;gap:8px;padding:11px 0;border-bottom:1px solid var(--ab-line)}.ab-pl-cards .ab-pl{gap:8px}.ab-pl-cards .ab-pl-r{padding:12px 14px;border:1px solid var(--ab-line);border-radius:calc(var(--ab-r)*.7);background:var(--ab-card)}.ab-pl-t{display:grid;gap:2px;min-width:0}.ab-pl-t b{font:700 15px/1.3 var(--ab-body);overflow-wrap:anywhere}.ab-pl-t small{color:var(--ab-muted);font-size:13px}.ab-pl-d{flex:1;min-width:12px;border-bottom:1.5px dotted var(--ab-line);transform:translateY(-4px)}.ab-pl-p{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:auto}.ab-pl-d+.ab-pl-p{margin-left:0}' +
    '.ab-vid{position:relative;width:100%;border-radius:var(--ab-r);overflow:hidden;background:#000}.ab-vid iframe{position:absolute;inset:0;width:100%;height:100%;border:0}' +
    '.ab-t-spacer{margin-top:0}.ab-sp-s{height:12px}.ab-sp-m{height:32px}.ab-sp-l{height:64px}.ab-sp-xl{height:110px}.ab-sp-line{border:0;border-top:1.5px solid var(--ab-line);margin:0;position:relative;top:50%}.ab-t-spacer{position:relative}';
  function ensureCss() {
    const d = root.document; if (!d || d.getElementById('ab-co-css')) return;
    const st = d.createElement('style'); st.id = 'ab-co-css'; st.textContent = CO_CSS; d.head.appendChild(st);
  }

  function onShop(e, t, ab) {
    const sh = shopOf(ab);
    const act = t.getAttribute('data-shop'), id = t.getAttribute('data-pid') || '';
    if (act === 'cat') {             // filter chips work even without ordering
      const grp = t.parentNode;
      grp.querySelectorAll('button').forEach(b => { const on = b === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      applyShopFilter(t.closest('.ab-t-shop'));
      return;
    }
    if (!sh) return;
    const k = sh.k, D = sh.D, c = loadCart(k);
    const say = m => { const n = ab.querySelector('.ab-sr'); if (n) { n.textContent = ''; root.setTimeout(() => { n.textContent = m; }, 30); } };
    switch (act) {
      case 'inc': case 'dec': {
        const p = D.byId[id]; if (!p || p.out || p.noadd) return;
        const cap = p.stock > 0 ? p.stock : 99;
        if (act === 'inc' && (c[id] || 0) >= cap) { say(p.stock > 0 ? 'Only ' + cap + ' available.' : 'That is the most you can order at once.'); return; }
        const wasIn = root.document.activeElement && root.document.activeElement.closest && root.document.activeElement.closest('.ab-buy');
        c[id] = Math.max(0, Math.min(99, (c[id] || 0) + (act === 'inc' ? 1 : -1)));
        if (!c[id]) delete c[id];
        saveCart(k); syncShop(ab);
        const n = cartCount(c);
        say(p.name + (act === 'inc' ? ' added' : ' removed') + '. ' + n + (n === 1 ? ' item' : ' items') + ' in your order.');
        if (wasIn) {                 // keep keyboard focus on the same product's control
          const scope = wasIn.closest('.ab-sheet, .ab-bag-list, .ab-prod') || ab;
          const nb = scope.querySelector('.ab-buy[data-pid="' + id + '"] [data-shop="' + act + '"]') || scope.querySelector('.ab-buy[data-pid="' + id + '"] button');
          if (nb) nb.focus({ preventScroll: true });
        }
        return;
      }
      case 'view': if (id) openItem(ab, D, id, k); return;
      case 'opt': if (id) openItem(ab, D, id, k, t.getAttribute('data-sel')); return;
      case 'buy': {                  // Buy now: put one in the order (if none yet) and go straight to the order form
        const p = D.byId[id]; if (!p || p.out || p.noadd) return;
        c[id] = Math.max(1, c[id] || 0); saveCart(k);
        syncShop(ab); startCheckout(ab);
        return;
      }
      case 'open': openLayer(ab, 'bag'); syncShop(ab); return;
      case 'close': closeLayers(ab); return;
    }
  }

  if (root.document && !root.__abBookBound) {
    root.__abBookBound = true;
    const doc = root.document;
    doc.addEventListener('submit', onBookSubmit);
    ensureCss();
    doc.addEventListener('input', onCoInput);
    doc.addEventListener('click', e => {
      const ab = liveAb(e.target); if (!ab) return;
      const go = e.target.closest('[data-go]');
      if (go) { e.preventDefault(); goTo(ab, go.getAttribute('data-go')); return; }
      const menu = e.target.closest('[data-site="menu"]');
      if (menu) {
        const nav = menu.closest('.ab-nav'), open = !nav.classList.contains('is-open');
        nav.classList.toggle('is-open', open); menu.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      const co = e.target.closest('[data-co]');
      if (co) { onCo(e, co, ab); return; }
      const s = e.target.closest('[data-shop]');
      if (s) onShop(e, s, ab);
    });
    doc.addEventListener('change', e => {
      onCoInput(e);
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-shop-sort')) applyShopFilter(e.target.closest('.ab-t-shop'));
    });
    doc.addEventListener('input', e => {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-shop-q')) applyShopFilter(e.target.closest('.ab-t-shop'));
    });
    doc.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      doc.querySelectorAll('.ab .ab-layer:not([hidden])').forEach(L => closeLayers(L.closest('.ab')));
    });
    // Another tab (or the menu panel) changed the same cafe's cart → refresh this page's view of it.
    root.addEventListener && root.addEventListener('storage', e => {
      if (!e.key || e.key.indexOf('ab-cart-') !== 0) return;
      delete CARTS[e.key];
      doc.querySelectorAll('.ab[data-cart="' + e.key + '"]').forEach(syncShop);
    });
  }

  root.AboutPage = {
    HEAD_FONTS: HEAD_FONTS, BODY_FONTS: BODY_FONTS, WORD_FONTS: WORD_FONTS, cleanHtml: cleanHtml, cleanInline: cleanInline, richText: richText, fmt: fmt, VIBES: VIBES, BLOCK_META: BLOCK_META, TYPES: TYPES, HALF_OK: HALF_OK, HOTEL_ONLY: HOTEL_ONLY,
    STYLE_DEFAULT: STYLE_DEFAULT, MAX_IMAGES: MAX_IMAGES, MAX_SHELF: MAX_SHELF, MAX_PRODUCTS: MAX_PRODUCTS, MAX_BLOCKS: MAX_BLOCKS, ROWS: ROWS,
    normalize: normalize, newBlock: newBlock, newProduct: newProduct, resolve: resolve, resolveForEdit: resolveForEdit,
    fromLegacy: fromLegacy, TEMPLATES: TEMPLATES, fromTemplate: fromTemplate, starter: starter, hotelStarter: hotelStarter, ICON_EYE: ICON_EYE, ICON_EYE_OFF: ICON_EYE_OFF, SVG: SVG, ICONS: ICONS, hasLegacy: hasLegacy, orderTo: orderTo,
    render: render, loadFonts: loadFonts, safeImg: safeImg, esc: esc, uid: uid, clone: clone, RS: RS, UPI: UPI,
  };
})(typeof window !== 'undefined' ? window : globalThis);
