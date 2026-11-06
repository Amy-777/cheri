/* about-studio.js — the website studio (dashboard side).
 *
 * A full-screen builder for a cafe's website (the same page customers see
 * in about.html and when they swipe left on the table menu). Left: five
 * panels — Sections (the page, top to bottom), Shop (products + how orders
 * arrive), Photos, Design (vibe, colours, fonts) and Site (header, footer,
 * contact links, the shareable link). Right: a live preview drawn by the
 * SAME engine customers get (about-page.js), switchable between a phone and
 * a full computer screen. Tap anything in the preview to jump to its settings.
 *
 * Saving PATCHes /cafe/update with `about_layout` — the whole site, shop
 * included, is that one JSON document.
 *
 * Loaded by dashboard.html after about-page.js. Wire it up once:
 *   AboutStudio.init({ getCafe, setCafe, api, toast, isOwner, liveUrl })
 */
(function (root) {
  'use strict';

  const AP = root.AboutPage;
  const esc = AP.esc;
  let ctx = null;     // host hooks (see init)
  let S = null;       // studio session state
  let el = {};        // cached DOM
  const DESK_W = 1280;  // width the "Computer" preview lays the page out at, then scales to fit

  /* ------------------------------------------------------------------ */
  /* Field specs                                                         */
  /* ------------------------------------------------------------------ */
  const O = {
    s3: [['s', 'S'], ['m', 'M'], ['l', 'L']],
    shape: [['theme', 'Match vibe'], ['square', 'Square'], ['arch', 'Arch'], ['circle', 'Circle']],
    frame: [['none', 'None'], ['polaroid', 'Polaroid'], ['outline', 'Outline'], ['shadow', 'Shadow']],
  };
  const notFull = b => b.size !== 'full';
  const isForm = b => b.mode === 'form';
  /* Tell the admin when a booking block has nowhere to send requests (the customer page quietly falls back to buttons). */
  const bookProblem = b => {
    const has = { wa: String(b.whatsapp || b.phone || '').replace(/\D/g, '').length >= 6, email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email || '').trim()), phone: !!String(b.phone || '').replace(/\D/g, ''), link: /^https?:\/\//i.test(String(b.link || '').trim()) };
    if (!has.wa && !has.email && !has.phone && !has.link) return 'Nothing to send bookings to yet — add a WhatsApp number, call number, email or booking link. Until then this section stays hidden from customers.';
    if (b.mode === 'form' && b.via === 'whatsapp' && !has.wa) return 'The form sends to WhatsApp — add a WhatsApp (or call) number, or switch “Send booking requests via” to Email. Until then customers only see your buttons.';
    if (b.mode === 'form' && b.via === 'email' && !has.email) return 'The form sends by email — add an email address, or switch to WhatsApp. Until then customers only see your buttons.';
    return '';
  };
  const btnFields = (labelPh) => [
    { t: 'text', k: 'btnLabel', label: 'Button text', ph: labelPh, max: 30 },
    { t: 'go', k: 'goto', label: 'Button scrolls to', show: b => !!b.btnLabel.trim() && !b.link.trim() },
    { t: 'text', k: 'link', label: '…or opens a web link', ph: 'https:// — Zomato, Swiggy, Google Form…', max: 400, show: b => !!b.btnLabel.trim() },
  ];

  const FIELDS = {
    hero: [
      { t: 'rich', k: 'titleHtml', plain: 'title', sync: 'title', mini: true, label: 'Headline — select words to restyle them', hint: 'Leave empty to use your cafe name.' },
      { t: 'rich', k: 'tagHtml', plain: 'tagline', sync: 'tagline', mini: true, label: 'Tagline' },
      { t: 'text', k: 'badge', label: 'Little badge', ph: 'e.g. Since 1998', max: 40 },
      { t: 'photo', k: 'imgId', label: 'Cover photo' },
      { t: 'seg', k: 'look', label: 'Photo placement', opts: [['cover', 'Behind the words'], ['split', 'Beside the words']], show: b => !!b.imgId },
      { t: 'seg', k: 'height', label: 'Height', opts: [['s', 'Short'], ['m', 'Medium'], ['l', 'Tall']] },
      { t: 'range', k: 'overlay', label: 'Photo dimming', min: 0, max: 70, step: 5, unit: '%', show: b => !!b.imgId && b.look !== 'split' },
      { t: 'seg', k: 'titleSize', label: 'Headline size', opts: [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL'], ['xxl', 'XXL']] },
      { t: 'seg', k: 'align', label: 'Alignment', opts: [['left', 'Left'], ['center', 'Centre']] },
    ].concat(btnFields('e.g. See the menu')),
    text: [
      { t: 'text', k: 'eyebrow', label: 'Small label', ph: 'e.g. Our story', max: 40 },
      { t: 'text', k: 'heading', label: 'Heading', ph: 'A heading (optional)', max: 100 },
      { t: 'area', k: 'body', label: 'Words', ph: 'Write freely…', max: 3000, rows: 6, hint: 'Blank line = new paragraph · **bold** · *italic*' },
      { t: 'seg', k: 'look', label: 'Look', opts: [['plain', 'Plain'], ['card', 'Card'], ['note', 'Sticky note']] },
      { t: 'seg', k: 'size', label: 'Text size', opts: [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL'], ['xxl', 'XXL']] },
      { t: 'seg', k: 'align', label: 'Alignment', opts: [['inherit', 'Page'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['justify', 'Justify']] },
      { t: 'tool', text: 'Want your own fonts, exact sizes, colours, lists or text wrapped around a photo?', label: 'Switch to Free text', act: 'to-words' },
    ],
    words: [
      { t: 'rich', k: 'html', label: 'Your text' },
      { t: 'sub', text: 'Whole-block text settings' },
      { t: 'sel', k: 'font', label: 'Default font', opts: [['inherit', 'Page font']].concat(AP.WORD_FONTS.map(f => [f.id, f.id])) },
      { t: 'range', k: 'size', label: 'Default text size', min: 10, max: 160, step: 1, unit: 'px', hint: 'Sets the whole text. Select words in the editor to size just those.' },
      { t: 'range', k: 'lh', label: 'Line spacing', min: 100, max: 300, step: 5, unit: '%' },
      { t: 'range', k: 'ls', label: 'Letter spacing (0 = normal)', min: -5, max: 50, step: 1, unit: '' },
      { t: 'range', k: 'pgap', label: 'Space between paragraphs', min: 0, max: 80, step: 2, unit: 'px' },
      { t: 'col', k: 'color', label: 'Text colour' },
      { t: 'seg', k: 'align', label: 'Alignment', opts: [['inherit', 'Page'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['justify', 'Justify']] },
      { t: 'tog', k: 'hyph', label: 'Break long words with a hyphen (good with Justify)' },
      { t: 'seg', k: 'cols', label: 'Columns', num: true, opts: [[1, '1'], [2, '2'], [3, '3']], hint: 'Like a magazine. Phones always show one column. With 2–3 columns a photo sits above the text instead of beside it.' },
      { t: 'seg', k: 'maxw', label: 'Text width', opts: [['s', 'Narrow'], ['m', 'Normal'], ['l', 'Wide'], ['full', 'Full']] },
      { t: 'seg', k: 'look', label: 'Look', opts: [['plain', 'Plain'], ['card', 'Card'], ['note', 'Sticky note']] },
      { t: 'sub', text: 'Photo (text wraps around it)' },
      { t: 'photo', k: 'imgId', label: 'Photo' },
      { t: 'seg', k: 'imgPos', label: 'Photo goes', opts: [['right', 'Wrap right'], ['left', 'Wrap left'], ['top', 'Above text']], show: b => !!b.imgId },
      { t: 'range', k: 'imgW', label: 'Photo width', min: 15, max: 70, step: 5, unit: '%', show: b => !!b.imgId && b.imgPos !== 'top' },
      { t: 'seg', k: 'imgShape', label: 'Shape', opts: O.shape, show: b => !!b.imgId, hint: 'Circle makes the words curve round the photo.' },
      { t: 'seg', k: 'imgRatio', label: 'Crop', opts: [['auto', 'Original'], ['1/1', 'Square'], ['4/3', '4:3'], ['3/4', 'Tall']], show: b => !!b.imgId && b.imgShape !== 'circle' },
      { t: 'seg', k: 'imgFrame', label: 'Frame', opts: O.frame, show: b => !!b.imgId },
      { t: 'text', k: 'caption', label: 'Caption', ph: 'Optional', max: 100, show: b => !!b.imgId },
    ],
    photo: [
      { t: 'photo', k: 'imgId', label: 'Photo' },
      { t: 'seg', k: 'size', label: 'Size', opts: [['s', 'S'], ['m', 'M'], ['l', 'L'], ['full', 'Edge to edge']] },
      { t: 'seg', k: 'align', label: 'Position', opts: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], show: notFull },
      { t: 'seg', k: 'ratio', label: 'Crop', opts: [['auto', 'Original'], ['1/1', 'Square'], ['4/3', '4:3'], ['16/9', 'Wide'], ['3/4', 'Tall']], show: b => b.shape !== 'circle' },
      { t: 'seg', k: 'shape', label: 'Shape', opts: O.shape, show: notFull },
      { t: 'seg', k: 'frame', label: 'Frame', opts: O.frame, show: notFull },
      { t: 'range', k: 'tilt', label: 'Tilt', min: -8, max: 8, step: 1, unit: '°', show: notFull },
      { t: 'text', k: 'caption', label: 'Caption', ph: 'Optional', max: 100 },
    ],
    split: [
      { t: 'photo', k: 'imgId', label: 'Photo' },
      { t: 'seg', k: 'imgSide', label: 'Photo goes', opts: [['left', 'Left'], ['right', 'Right']] },
      { t: 'seg', k: 'imgWidth', label: 'Photo size', opts: O.s3 },
      { t: 'seg', k: 'ratio', label: 'Crop', opts: [['3/4', 'Tall'], ['1/1', 'Square'], ['4/3', 'Wide']], show: b => b.shape !== 'circle' },
      { t: 'seg', k: 'shape', label: 'Shape', opts: O.shape },
      { t: 'seg', k: 'frame', label: 'Frame', opts: O.frame },
      { t: 'range', k: 'tilt', label: 'Tilt', min: -8, max: 8, step: 1, unit: '°' },
      { t: 'text', k: 'eyebrow', label: 'Small label', ph: 'Optional', max: 40 },
      { t: 'text', k: 'heading', label: 'Heading', ph: 'e.g. The chai', max: 80 },
      { t: 'area', k: 'body', label: 'Words', ph: 'A short paragraph', max: 3000, rows: 4 },
    ],
    gallery: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'Optional — e.g. Around the cafe', max: 80 },
      { t: 'photos', k: 'imgIds', label: 'Photos' },
      { t: 'seg', k: 'layout', label: 'Layout', opts: [['grid', 'Grid'], ['strip', 'Swipe strip'], ['collage', 'Collage']] },
      { t: 'seg', k: 'cols', label: 'Columns on phones', num: true, opts: [[2, '2 across'], [3, '3 across']], show: b => b.layout === 'grid', hint: 'Computers get 2–4 columns, picked so no photo is left alone on the last row.' },
      { t: 'seg', k: 'ratio', label: 'Crop', opts: [['1/1', 'Square'], ['4/3', '4:3'], ['3/4', 'Tall'], ['auto', 'Original']] },
      { t: 'seg', k: 'gap', label: 'Spacing', opts: [['s', 'Tight'], ['m', 'Normal'], ['l', 'Roomy']] },
      { t: 'seg', k: 'shape', label: 'Shape', opts: O.shape },
    ],
    shop: [
      { t: 'jump', text: 'Products, prices and how orders reach you are set in the Shop tab.', label: 'Open Shop tab', tab: 'shop' },
      { t: 'text', k: 'heading', label: 'Heading', ph: 'e.g. Take a little home', max: 80 },
      { t: 'text', k: 'blurb', label: 'Short line', ph: 'e.g. Beans, tea and merch — packed to order', max: 300 },
      { t: 'cat', k: 'show', label: 'Which products' },
      { t: 'tog', k: 'chips', label: 'Category filter buttons', show: b => !b.show },
      { t: 'seg', k: 'layout', label: 'Look', opts: [['grid', 'Grid of cards'], ['rows', 'List']] },
      { t: 'seg', k: 'cols', label: 'Columns on computers', num: true, opts: [[2, '2'], [3, '3'], [4, '4']], show: b => b.layout === 'grid', hint: 'Phones always show 2 across.' },
    ],
    highlights: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'e.g. Why people love it', max: 80 },
      { t: 'seg', k: 'look', label: 'Look', opts: [['list', 'List'], ['cards', 'Cards'], ['chips', 'Chips']] },
      { t: 'rows', k: 'rows', label: 'Items', addLabel: '+ Add item', cols: [
        { k: 'emoji', ph: '☕', cls: 'as-em' }, { k: 'title', ph: 'Single-origin beans' }, { k: 'text', ph: 'Short line (optional)' }] },
    ],
    quote: [
      { t: 'area', k: 'text', label: 'Quote', ph: 'The line you want people to remember', max: 800, rows: 3 },
      { t: 'text', k: 'by', label: 'Who said it', ph: 'e.g. A happy regular', max: 60 },
      { t: 'seg', k: 'look', label: 'Look', opts: [['big', 'Big text'], ['boxed', 'Boxed']] },
    ],
    cta: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'e.g. Hosting a birthday?', max: 100 },
      { t: 'area', k: 'text', label: 'Short line', ph: 'e.g. The upstairs room seats 24.', max: 800, rows: 2 },
      { t: 'seg', k: 'look', label: 'Colour', opts: [['accent', 'Accent'], ['ink', 'Dark'], ['pop', 'Pop colour']] },
    ].concat(btnFields('e.g. Ask on WhatsApp')),
    hours: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'Opening hours', max: 60 },
      { t: 'rows', k: 'rows', label: 'Days', addLabel: '+ Add row', cols: [{ k: 'day', ph: 'Mon – Fri' }, { k: 'time', ph: '8am – 10pm' }] },
      { t: 'text', k: 'note', label: 'Note', ph: 'e.g. Kitchen closes 30 min early', max: 120 },
    ],
    book: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'Book a table', max: 60 },
      { t: 'text', k: 'blurb', label: 'Short line', ph: 'e.g. Birthdays, parties & big groups welcome', max: 300 },
      { t: 'seg', k: 'mode', label: 'Style', opts: [['form', 'Booking form'], ['buttons', 'Buttons only']] },
      { t: 'seg', k: 'via', label: 'Send booking requests via', opts: [['whatsapp', 'WhatsApp'], ['email', 'Email']], show: isForm },
      { t: 'hint', show: b => !!bookProblem(b), text: bookProblem },
      { t: 'text', k: 'whatsapp', label: 'WhatsApp number', ph: 'e.g. 91 98300 12345 — blank uses the call number', max: 30 },
      { t: 'text', k: 'phone', label: 'Call button', ph: 'Phone number', max: 30 },
      { t: 'text', k: 'email', label: 'Email', ph: 'bookings@yourcafe.com', max: 80 },
      { t: 'text', k: 'link', label: 'Online booking link (optional)', ph: 'Zomato / Dineout / Google Form link', max: 400 },
      { t: 'text', k: 'linkLabel', label: 'Link button label', ph: 'Book online', max: 30, show: b => !!b.link },
      { t: 'text', k: 'buttonLabel', label: 'Submit button label', ph: 'Book on WhatsApp', max: 30, show: isForm },
      { t: 'tog', k: 'askDate', label: 'Ask for a date', show: isForm },
      { t: 'tog', k: 'askTime', label: 'Ask for a time', show: isForm },
      { t: 'tog', k: 'askNote', label: 'Ask for a note (allergies, birthdays…)', show: isForm },
      { t: 'range', k: 'guestsMax', label: 'Most guests in the form', min: 2, max: 30, step: 1, unit: '', show: isForm },
      { t: 'seg', k: 'look', label: 'Look', opts: [['card', 'Card'], ['bold', 'Colour block'], ['plain', 'Plain']] },
      { t: 'text', k: 'fine', label: 'Small print', ph: 'e.g. We hold tables for 15 minutes', max: 200 },
    ],
    visit: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'Find us', max: 60 },
      { t: 'tog', k: 'showAddress', label: 'Show my cafe address' },
      { t: 'text', k: 'phone', label: 'Call button', ph: 'Phone number', max: 30 },
      { t: 'text', k: 'whatsapp', label: 'WhatsApp button', ph: 'e.g. 91 98300 12345', max: 30 },
      { t: 'text', k: 'instagram', label: 'Instagram button', ph: '@yourcafe', max: 60 },
      { t: 'tog', k: 'showDirections', label: 'Directions button' },
      { t: 'text', k: 'mapsUrl', label: 'Maps link (optional)', ph: 'Paste a Google Maps link', max: 300, show: b => b.showDirections },
    ],
    rooms: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'Rooms & rates', max: 60 },
      { t: 'text', k: 'blurb', label: 'Short line', ph: 'e.g. Breakfast included on weekdays', max: 300 },
      { t: 'hfac', label: 'Hotel facilities' },
      { t: 'hrows', k: 'rows', label: 'Your rooms', hotel: 'types', idk: 'typeId', addLabel: '+ Add a room card', hint: 'Pick a room type, add a photo and a line about it. Names, sizes, prices and availability come from your Rooms and Rates screens — leave this empty to list every room type.' },
      { t: 'text', k: 'buttonLabel', label: 'Button text', ph: 'Book', max: 30 },
      { t: 'text', k: 'fine', label: 'Small print', ph: 'Your booking is confirmed once the hotel checks it.', max: 200 },
    ],
    banquet: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'Banquet halls', max: 60 },
      { t: 'text', k: 'blurb', label: 'Short line', ph: 'e.g. Weddings, receptions, corporate events', max: 300 },
      { t: 'hrows', k: 'rows', label: 'Your halls', hotel: 'halls', idk: 'hallId', addLabel: '+ Add a hall card', hint: 'Halls are added in Hotel → Setup. Here you pick one, add a photo and a line. Leave empty to list every hall.' },
      { t: 'text', k: 'buttonLabel', label: 'Button text', ph: 'Check free dates', max: 30 },
      { t: 'text', k: 'fine', label: 'Small print', ph: 'Tap a hall to see free dates.', max: 200 },
    ],
    ribbon: [
      { t: 'area', k: 'text', label: 'Ribbon text', ph: 'Fresh brew, Good company, Live music', max: 400, rows: 2, hint: 'Separate phrases with commas or new lines' },
      { t: 'seg', k: 'look', label: 'Look', opts: [['accent', 'Accent'], ['ink', 'Ink'], ['outline', 'Outline']] },
      { t: 'seg', k: 'speed', label: 'Speed', opts: [['s', 'Chill'], ['m', 'Steady'], ['l', 'Zippy']] },
      { t: 'range', k: 'tilt', label: 'Tilt', min: -4, max: 4, step: 1, unit: '°' },
    ],
    faq: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'Questions people ask', max: 80 },
      { t: 'seg', k: 'look', label: 'Look', opts: [['lines', 'Lines'], ['cards', 'Cards']] },
      { t: 'rows', k: 'rows', label: 'Questions', addLabel: '+ Add a question', cols: [{ k: 'q', ph: 'Do you take walk-ins?' }, { k: 'a', ph: 'The answer — a sentence or two' }] },
    ],
    list: [
      { t: 'text', k: 'heading', label: 'Heading', ph: 'e.g. Menu, Services, Classes', max: 80 },
      { t: 'text', k: 'blurb', label: 'Short line', ph: 'e.g. Prices include GST', max: 300 },
      { t: 'seg', k: 'look', label: 'Look', opts: [['lines', 'Dotted lines'], ['cards', 'Cards']] },
      { t: 'rows', k: 'rows', label: 'Items', addLabel: '+ Add an item', cols: [{ k: 'name', ph: 'Filter coffee' }, { k: 'price', ph: '₹90', cls: 'as-em' }, { k: 'text', ph: 'Short line (optional)' }] },
      { t: 'text', k: 'note', label: 'Note under the list', ph: 'e.g. Ask about today’s specials', max: 120 },
    ],
    video: [
      { t: 'text', k: 'heading', label: 'Heading (optional)', ph: 'e.g. Take a tour', max: 80 },
      { t: 'text', k: 'url', label: 'YouTube or Vimeo link', ph: 'https://www.youtube.com/watch?v=…', max: 400, hint: 'Paste the link from the share button. Only YouTube and Vimeo links work.' },
      { t: 'seg', k: 'ratio', label: 'Shape', opts: [['16/9', 'Wide'], ['4/3', '4:3'], ['1/1', 'Square']] },
      { t: 'text', k: 'caption', label: 'Caption (optional)', ph: 'A line under the video', max: 160 },
    ],
    spacer: [
      { t: 'seg', k: 'size', label: 'Height', opts: [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Huge']] },
      { t: 'tog', k: 'line', label: 'Draw a thin line in the middle' },
    ],
  };
  /* Shown under every section's own settings. */
  const PLACE = [
    { t: 'text', k: 'navLabel', label: 'Name in the top menu', ph: 'Leave blank to keep it out of the menu', max: 24 },
    { t: 'seg', k: 'bg', label: 'Background', opts: [['none', 'Page'], ['soft', 'Soft'], ['dark', 'Dark'], ['accent', 'Accent']] },
    { t: 'seg', k: 'pad', label: 'Space above', opts: [['s', 'Tight'], ['m', 'Normal'], ['l', 'Roomy']] },
    { t: 'tog', k: 'hidden', label: 'Hide this section from the website' },
    { t: 'seg', k: 'width', label: 'Width on computers', opts: [['full', 'Full width'], ['half', 'Half']], show: b => AP.HALF_OK.indexOf(b.type) >= 0 && !(b.type === 'photo' && b.size === 'full'),
      hint: 'Two half-width sections in a row sit side by side. Phones always stack them.' },
  ];
  const PROD_FIELDS = [
    { t: 'pphoto', k: 'imgId', label: 'Photo' },
    { t: 'text', k: 'name', label: 'Name', ph: 'e.g. House blend beans, 250 g', max: 80 },
    { t: 'num', k: 'price', label: 'Price (₹)', ph: '0' },
    { t: 'num', k: 'mrp', label: 'Was (₹) — optional', ph: 'Shows crossed out when higher than the price' },
    { t: 'catin', k: 'cat', label: 'Category', ph: 'e.g. Coffee, Merch, Bakery', max: 30 },
    { t: 'text', k: 'tag', label: 'Badge', ph: 'e.g. Bestseller, New, Seasonal', max: 20 },
    { t: 'area', k: 'desc', label: 'Description', ph: 'Size, taste, what makes it good', max: 400, rows: 3 },
    { t: 'tog', k: 'out', label: 'Sold out (stays visible, can’t be ordered)' },
    { t: 'num', k: 'stock', label: 'Units in stock — optional', ph: '0 = don’t track. Customers can’t order more than this', int: true },
    { t: 'text', k: 'optName', label: 'Choices are called', ph: 'e.g. Size, Weight, Flavour', max: 20 },
    { t: 'area', k: 'opts', label: 'Choices — one per line', ph: '250 g | 450\n1 kg | 1600\n(price after | is optional)', max: 400, rows: 3, hint: 'Gives customers a size / flavour picker. Leave empty for a normal product.' },
  ];
  const SHOP_FIELDS = [
    { t: 'text', k: 'whatsapp', label: 'WhatsApp number for orders', ph: 'e.g. 91 98300 12345 — blank uses the site WhatsApp', max: 30 },
    { t: 'tog', k: 'pickup', label: 'Customers can pick up' },
    { t: 'tog', k: 'delivery', label: 'You deliver' },
    { t: 'num', k: 'fee', label: 'Delivery charge (₹)', ph: '0 = free delivery', show: s => s.delivery },
    { t: 'num', k: 'min', label: 'Minimum order (₹)', ph: '0 = no minimum' },
    { t: 'text', k: 'upi', label: 'UPI ID (optional)', ph: 'e.g. yourcafe@okicici — adds a “Pay by UPI” button', max: 60 },
    { t: 'text', k: 'payee', label: 'Name on UPI', ph: 'Blank uses your cafe name', max: 60, show: s => !!s.upi.trim() },
    { t: 'text', k: 'note', label: 'Note under the order form', ph: 'e.g. We confirm every order on WhatsApp before packing', max: 200 },
    { t: 'sub', text: 'Checkout' },
    { t: 'num', k: 'freeAbove', label: 'Free delivery above (₹)', ph: '0 = off. Shows a “add ₹X more” bar in the cart', show: s => s.delivery && s.fee > 0 },
    { t: 'text', k: 'eta', label: 'Delivery time promise', ph: 'e.g. Usually 30–45 min', max: 60, show: s => s.delivery },
    { t: 'text', k: 'slots', label: 'Time slots to choose from', ph: 'e.g. Morning 9–12, Afternoon 12–4, Evening 4–8', max: 240, hint: 'Separate with commas. Blank = customers just order “as soon as possible”.' },
    { t: 'tog', k: 'payCash', label: 'Offer “pay on delivery / at the café”' },
    { t: 'tog', k: 'payUpi', label: 'Offer “pay now with UPI”', show: s => !!s.upi.trim() },
    { t: 'tog', k: 'serverOrders', label: 'Also save orders in my dashboard (needs the shop-order service on your server)' },
    { t: 'tog', k: 'payOnline', label: 'Offer card / net-banking payment (Razorpay)', show: s => s.serverOrders },
    { t: 'sub', text: 'Coupon codes' },
    { t: 'coupons', k: 'coupons' },
  ];
  const SITE_FIELDS = {
    header: [
      { t: 'seg', k: 'nav', label: 'Style', opts: [['bar', 'Name left'], ['center', 'Name centred'], ['off', 'No header']] },
      { t: 'tog', k: 'logo', label: 'Show my cafe logo next to the name', show: s => s.nav !== 'off' },
      { t: 'text', k: 'title', label: 'Name shown on the site', ph: 'Blank uses your cafe name', max: 60 },
      { t: 'text', k: 'ctaLabel', label: 'Header button', ph: 'e.g. Book a table — blank for none', max: 30, show: s => s.nav !== 'off' },
      { t: 'go', k: 'ctaGoto', label: 'Button scrolls to', show: s => s.nav !== 'off' && !!s.ctaLabel.trim() && !s.ctaLink.trim() },
      { t: 'text', k: 'ctaLink', label: '…or opens a web link', ph: 'https://', max: 400, show: s => s.nav !== 'off' && !!s.ctaLabel.trim() },
    ],
    announce: [
      { t: 'text', k: 'announce', label: 'Message', ph: 'e.g. Free delivery above ₹500 this week', max: 120, hint: 'A thin bar above the header. Blank = no bar.' },
      { t: 'text', k: 'announceLink', label: 'Link (optional)', ph: 'https://', max: 400, show: s => !!s.announce.trim() },
      { t: 'seg', k: 'announceTone', label: 'Colour', opts: [['accent', 'Accent'], ['ink', 'Dark'], ['pop', 'Pop colour']], show: s => !!s.announce.trim() },
    ],
    footer: [
      { t: 'tog', k: 'footer', label: 'Show a footer at the bottom' },
      { t: 'text', k: 'footNote', label: 'One line about you', ph: 'e.g. Adda and chai in north Kolkata since 1998', max: 200, show: s => s.footer },
    ],
    contact: [
      { t: 'text', k: 'phone', label: 'Phone', ph: 'Blank uses your cafe phone', max: 30 },
      { t: 'text', k: 'whatsapp', label: 'WhatsApp', ph: 'e.g. 91 98300 12345', max: 30 },
      { t: 'text', k: 'instagram', label: 'Instagram', ph: '@yourcafe', max: 60 },
      { t: 'text', k: 'email', label: 'Email', ph: 'hello@yourcafe.com', max: 80 },
    ],
  };
  const PRESET_KEYS = ['bg', 'ink', 'accent', 'accent2', 'headFont', 'bodyFont', 'radius', 'edge', 'btn', 'cards', 'motion'];
  const TABS = [['sections', 'Sections'], ['shop', 'Shop'], ['photos', 'Photos'], ['design', 'Design'], ['site', 'Site']];

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                      */
  /* ------------------------------------------------------------------ */
  const toast = m => { try { ctx.toast(m); } catch (e) { /* host without toast */ } };
  const blockById = id => S.layout.blocks.find(b => b.id === id);
  const prodById = id => S.layout.shop.products.find(p => p.id === id);
  const imgById = id => S.layout.images.find(i => i.id === id);
  const shelf = () => S.layout.images.filter(i => i.k !== 'p');
  const bytes = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const allBytes = () => S.layout.images.reduce((n, i) => n + Math.round(i.src.length * 0.75), 0);
  const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const hasShopBlock = () => S.layout.blocks.some(b => b.type === 'shop');
  const canOrder = () => !!AP.orderTo(AP.normalize({ site: S.layout.site, shop: S.layout.shop, blocks: [] })) || !!S.layout.shop.settings.serverOrders;
  const cats = () => { const a = []; S.layout.shop.products.forEach(p => { const c = String(p.cat || '').trim(); if (c && a.indexOf(c) < 0) a.push(c); }); return a; };

  /* What owns a setting: a section, a product, the site chrome, or the shop's order settings. */
  function target(sc, id) {
    if (!S) return null;
    if (sc === 'blk') return blockById(id);
    if (sc === 'prod') return prodById(id);
    if (sc === 'site') return S.layout.site;
    if (sc === 'shop') return S.layout.shop.settings;
    return null;
  }

  function usage() {
    const u = {};
    S.layout.blocks.forEach(b => {
      if (b.imgId) u[b.imgId] = (u[b.imgId] || 0) + 1;
      (b.imgIds || []).forEach(id => { u[id] = (u[id] || 0) + 1; });
      if (b.type === 'rooms' || b.type === 'banquet') (b.rows || []).forEach(r => { if (r.imgId) u[r.imgId] = (u[r.imgId] || 0) + 1; });
    });
    S.layout.shop.products.forEach(p => { if (p.imgId) u[p.imgId] = (u[p.imgId] || 0) + 1; });
    return u;
  }

  function sectionName(b) {
    return b.navLabel.trim() || cut(b.heading || b.title, 28) || AP.BLOCK_META[b.type].name;
  }

  function summary(b) {
    switch (b.type) {
      case 'hero': return cut(b.title || b.tagline, 34) || 'Uses your cafe name';
      case 'text': return cut(b.heading || b.body, 34) || 'Empty — add some words';
      case 'words': return cut(AP.richText(b.html), 34) || 'Empty — tap to write';
      case 'photo': return b.imgId ? (cut(b.caption, 30) || 'Photo · ' + ({ s: 'small', m: 'medium', l: 'large', full: 'edge to edge' }[b.size])) : 'No photo chosen yet';
      case 'split': return cut(b.heading || b.body, 34) || (b.imgId ? 'Photo + words' : 'Empty');
      case 'gallery': return b.imgIds.length ? b.imgIds.length + ' photo' + (b.imgIds.length > 1 ? 's' : '') + ' · ' + b.layout : 'No photos yet';
      case 'shop': {
        const n = S.layout.shop.products.filter(p => p.name.trim() && (!b.show || p.cat === b.show)).length;
        return n ? n + ' product' + (n > 1 ? 's' : '') + (b.show ? ' in ' + b.show : '') : 'No products yet — add them in the Shop tab';
      }
      case 'highlights': { const n = b.rows.filter(r => r.title || r.text).length; return n ? n + ' item' + (n > 1 ? 's' : '') : 'Empty'; }
      case 'quote': return cut(b.text, 34) || 'Empty';
      case 'cta': return cut(b.heading || b.text, 34) || 'Empty';
      case 'hours': { const n = b.rows.filter(r => r.day || r.time).length; return n ? n + ' row' + (n > 1 ? 's' : '') : 'Empty'; }
      case 'book': { const p = bookProblem(b); return p ? 'Needs a contact — tap to finish' : cut(b.heading, 30) + ' · ' + (b.mode === 'form' ? 'form → ' + (b.via === 'email' ? 'email' : 'WhatsApp') : 'buttons'); }
      case 'visit': return 'Address & buttons';
      case 'rooms': return b.rows.filter(r => r.typeId).length ? b.rows.filter(r => r.typeId).length + ' room card(s)' : 'Lists every room type';
      case 'banquet': return b.rows.filter(r => r.hallId).length ? b.rows.filter(r => r.hallId).length + ' hall card(s)' : 'Lists every hall';
      case 'ribbon': return cut(b.text, 34) || 'Empty';
      case 'faq': { const n = b.rows.filter(r => r.q && r.a).length; return n ? n + ' question' + (n > 1 ? 's' : '') : 'Empty'; }
      case 'list': { const n = b.rows.filter(r => r.name).length; return n ? n + ' item' + (n > 1 ? 's' : '') : 'Empty'; }
      case 'video': return b.url ? cut(b.url.replace(/^https?:\/\/(www\.)?/, ''), 34) : 'Paste a YouTube link';
      case 'spacer': return ({ s: 'Small', m: 'Medium', l: 'Large', xl: 'Huge' }[b.size] || 'Medium') + ' gap' + (b.line ? ' with a line' : '');
    }
    return '';
  }
  function prodSummary(p) {
    const bits = [p.price ? AP.RS(p.price) : 'No price yet'];
    if (p.cat) bits.push(p.cat);
    if (p.out) bits.push('sold out');
    return bits.join(' · ');
  }

  /* Resize + re-encode so a phone photo becomes ~150–400 KB instead of 5 MB. */
  function compress(file, max, quality) {
    max = max || 1400; quality = quality || 0.82;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
        let out = c.toDataURL('image/jpeg', quality);
        if (out.length > 520000 && max > 1000) return compress(file, 1080, 0.72).then(resolve, reject);
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }

  function siteUrl() {
    const c = ctx && ctx.getCafe();
    if (!c || c.id == null) return '';
    const base = typeof root.getQrBase === 'function' ? root.getQrBase() : location.origin + location.pathname.replace(/[^/]*$/, '');
    return base + 'about.html?cafe=' + encodeURIComponent(c.id);
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                          */
  /* ------------------------------------------------------------------ */
  function init(c) {
    ctx = c;
    if (el.root) return;
    injectCss();
    build();
  }

  function open() {
    if (!ctx) return;
    if (!ctx.isOwner()) { toast('Only the cafe owner can edit the website'); return; }
    const cafe = ctx.getCafe();
    if (!cafe) { toast('Still loading — try again in a second'); return; }
    const layout = AP.resolveForEdit(cafe);
    S = { layout: layout, base: JSON.stringify(layout), dirty: false, saving: false, notStored: false,
          tab: 'sections', device: root.innerWidth >= 1200 ? 'desktop' : 'phone',
          openId: null, openPid: null, picker: null, adding: false, tune: false, target: null, timer: 0 };
    AP.loadFonts(null, true);            // every font, so the pickers can show real samples
    el.root.hidden = false;
    el.root.dataset.view = 'edit';
    document.body.style.overflow = 'hidden';
    renderEditor(); setDevice(S.device); updateChip();
    el.panel.scrollTop = 0;
  }

  function close(force) {
    if (!S) return;
    if (S.dirty && !force && !root.confirm('Discard your unsaved website changes?')) return;
    el.root.hidden = true;
    document.body.style.overflow = '';
    S = null;
  }

  function touch() { S.dirty = true; S.notStored = false; updateChip(); schedulePreview(); }
  function schedulePreview() { clearTimeout(S.timer); S.timer = setTimeout(refreshPreview, 120); }

  function updateChip() {
    const c = el.chip; if (!c || !S) return;
    let label = 'All changes saved', cls = 'ok';
    if (S.saving) { label = 'Saving…'; cls = 'busy'; }
    else if (S.notStored) { label = 'Server didn’t keep this'; cls = 'bad'; }
    else if (S.dirty) { label = 'Unsaved changes'; cls = 'warn'; }
    c.textContent = label; c.className = 'as-chip ' + cls;
  }

  /* ------------------------------------------------------------------ */
  /* Preview                                                            */
  /* ------------------------------------------------------------------ */
  function setDevice(d) {
    S.device = d;
    el.frame.dataset.device = d;
    el.root.querySelectorAll('[data-device-btn]').forEach(b => b.setAttribute('aria-pressed', b.dataset.deviceBtn === d ? 'true' : 'false'));
    const u = siteUrl();
    el.url.textContent = u ? u.replace(/^https?:\/\//, '') : 'your website';
    refreshPreview();
  }

  function fitDesktop() {
    if (!S) return;
    const vp = el.screen.firstElementChild; if (!vp) return;
    if (S.device === 'desktop') {
      vp.style.width = DESK_W + 'px';
      vp.style.zoom = Math.max(0.15, el.screen.clientWidth / DESK_W).toFixed(4);
    } else { vp.style.width = ''; vp.style.zoom = ''; }
  }

  function refreshPreview() {
    if (!S) return;
    const st = el.screen.scrollTop;
    el.screen.style.background = S.layout.style.bg;
    el.screen.innerHTML = '<div class="as-vp">' + AP.render(S.layout, Object.assign({}, ctx.getCafe(), { hotel: hotelInfo() }), { preview: true }) + '</div>';
    fitDesktop();
    el.screen.scrollTop = st;
    syncFocus(false);
  }

  function syncFocus(scroll) {
    el.screen.querySelectorAll('.ab-focus').forEach(n => n.classList.remove('ab-focus'));
    let n = null;
    if (S.tab === 'sections' && S.openId) n = el.screen.querySelector('[data-bid="' + S.openId + '"]');
    else if (S.tab === 'shop' && S.openPid) n = el.screen.querySelector('.ab-prod[data-pid="' + S.openPid + '"]');
    else if (S.tab === 'site') n = el.screen.querySelector('[data-part]');
    if (!n) return;
    n.classList.add('ab-focus');
    if (scroll) {
      const top = n.getBoundingClientRect().top - el.screen.getBoundingClientRect().top + el.screen.scrollTop - 70;
      el.screen.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Editor: tabs + panels                                              */
  /* ------------------------------------------------------------------ */
  function renderEditor() {
    if (!S) return;
    el.ptabs.innerHTML = TABS.filter(t => t[0] !== 'shop' || !isHotelSite() || hasShopBlock()).map(t => '<button type="button" role="tab" aria-selected="' + (S.tab === t[0]) + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] +
      (t[0] === 'shop' && S.layout.shop.products.length ? '<small>' + S.layout.shop.products.length + '</small>' : '') + '</button>').join('');
    const st = el.panel.scrollTop;
    const P = { sections: sectionsPanel, shop: shopPanel, photos: photosPanel, design: designPanel, site: sitePanel }[S.tab];
    el.panel.innerHTML = P() + footHtml();
    el.panel.scrollTop = st;
  }

  const group = (title, sub, body, extra) => '<section class="as-grp' + (extra ? ' ' + extra : '') + '"><div class="as-grp-h"><h3>' + title + '</h3>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>' + body + '</section>';
  const notice = (kind, text, btn) => '<div class="as-note ' + kind + '"><span>' + text + '</span>' + (btn || '') + '</div>';

  /* ---- Sections ---- */
  function sectionsPanel() {
    const L = S.layout, n = L.blocks.length;
    const cards = n ? L.blocks.map((b, i) => blockCard(b, i, n)).join('') : '<p class="as-p as-empty">No sections yet — add your first one below.</p>';
    let add = '';
    if (n >= AP.MAX_BLOCKS) add = '<p class="as-p">You’ve hit the ' + AP.MAX_BLOCKS + '-section limit.</p>';
    else if (S.adding) {
      add = '<div class="as-adds">' + AP.TYPES.filter(t => AP.HOTEL_ONLY.indexOf(t) < 0 || (ctx.getCafe() || {}).business_type === 'hotel').map(t => { const m = AP.BLOCK_META[t];
        return '<button type="button" class="as-add" data-act="add" data-type="' + t + '"><span class="as-ico t-' + t + '">' + m.emoji + '</span><b>' + m.name + '</b><small>' + m.blurb + '</small></button>'; }).join('') +
        '</div><button type="button" class="as-link" data-act="adding">Cancel</button>';
    } else add = '<button type="button" class="as-addbtn" data-act="adding">＋ Add a section</button>' + (isHotelSite() ? '<button type="button" class="as-link" data-act="hotel-template" style="margin-top:10px">Start over with the hotel layout</button>' : '');
    return group('Your page', 'Top to bottom, the way visitors scroll', '<div class="as-outline">' + cards + '</div>' + add);
  }

  function blockCard(b, i, n) {
    const m = AP.BLOCK_META[b.type], open = S.openId === b.id;
    const pills = (b.hidden ? '<i class="as-pill">Hidden</i>' : '') + (b.navLabel.trim() ? '<i class="as-pill">In menu</i>' : '') + (b.width === 'half' && AP.HALF_OK.indexOf(b.type) >= 0 ? '<i class="as-pill">Half</i>' : '');
    return '<div class="as-item' + (open ? ' open' : '') + (b.hidden ? ' as-off' : '') + '" data-blk="' + b.id + '">' +
      '<div class="as-item-h" data-act="toggle" data-id="' + b.id + '">' +
        '<span class="as-ico t-' + b.type + '">' + m.emoji + '</span>' +
        '<span class="as-item-t"><b>' + esc(b.navLabel.trim() || m.name) + pills + '</b><small>' + esc(summary(b)) + '</small></span>' +
        '<span class="as-ctl">' +
          '<button type="button" data-act="hide" data-id="' + b.id + '" aria-label="' + (b.hidden ? 'Show on website' : 'Hide from website') + '" title="' + (b.hidden ? 'Hidden — tap to show' : 'Tap to hide') + '">' + (b.hidden ? AP.ICON_EYE_OFF : AP.ICON_EYE) + '</button>' +
          '<button type="button" data-act="mv" data-id="' + b.id + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">↑</button>' +
          '<button type="button" data-act="mv" data-id="' + b.id + '" data-d="1"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Move down">↓</button>' +
          '<button type="button" data-act="dup" data-id="' + b.id + '" aria-label="Duplicate">⧉</button>' +
          '<button type="button" data-act="del" data-id="' + b.id + '" aria-label="Delete">✕</button>' +
        '</span></div>' +
      (open ? '<div class="as-item-b">' + fields('blk', b.id, b, FIELDS[b.type]) +
        '<div class="as-sub">Placement</div>' + fields('blk', b.id, b, PLACE) + '</div>' : '') +
      '</div>';
  }

  /* ---- Shop ---- */
  function shopPanel() {
    const L = S.layout, P = L.shop.products, n = P.length;
    let status = '';
    if (!hasShopBlock()) status += notice('warn', 'Your products won’t show on the website until it has a Shop section.', '<button type="button" class="as-btn sm" data-act="add-shop">Add Shop section</button>');
    if (!canOrder()) status += notice('warn', 'Add a WhatsApp number under “Taking orders” — until then the shop is a catalogue with no Add buttons.');
    else if (hasShopBlock() && P.some(p => p.name.trim())) status += notice('ok', 'Customers add to a cart, go through delivery, payment and review, and the order arrives on your WhatsApp as one message. Pay-now buttons send them to your own UPI — nothing is charged automatically.');

    const list = n ? P.map((p, i) => prodCard(p, i, n)).join('') : '<p class="as-p as-empty">No products yet. Add the things you sell over the counter — beans, tea, bakes, merch.</p>';
    const addBtn = n < AP.MAX_PRODUCTS ? '<button type="button" class="as-addbtn" data-act="padd">＋ Add a product</button>' : '<p class="as-p">You’ve hit the ' + AP.MAX_PRODUCTS + '-product limit.</p>';
    return status +
      group('Products', n + ' of ' + AP.MAX_PRODUCTS, '<div class="as-outline">' + list + '</div>' + addBtn +
        '<datalist id="as-cats">' + cats().map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>') +
      group('Taking orders', 'How an order reaches you', fields('shop', 's', L.shop.settings, SHOP_FIELDS));
  }

  function prodCard(p, i, n) {
    const open = S.openPid === p.id, im = imgById(p.imgId);
    const thumb = im ? '<img src="' + esc(im.src) + '" alt="">' : esc((p.name.trim().charAt(0) || '＋').toUpperCase());
    return '<div class="as-item' + (open ? ' open' : '') + (p.out ? ' is-out' : '') + '" data-prod="' + p.id + '">' +
      '<div class="as-item-h" data-act="ptoggle" data-id="' + p.id + '">' +
        '<span class="as-thumb">' + thumb + '</span>' +
        '<span class="as-item-t"><b>' + esc(p.name.trim() || 'New product') + (p.tag ? '<i class="as-pill">' + esc(p.tag) + '</i>' : '') + '</b><small>' + esc(prodSummary(p)) + '</small></span>' +
        '<span class="as-ctl">' +
          '<button type="button" data-act="pmv" data-id="' + p.id + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">↑</button>' +
          '<button type="button" data-act="pmv" data-id="' + p.id + '" data-d="1"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Move down">↓</button>' +
          '<button type="button" data-act="pdup" data-id="' + p.id + '" aria-label="Duplicate">⧉</button>' +
          '<button type="button" data-act="pdel" data-id="' + p.id + '" aria-label="Delete">✕</button>' +
        '</span></div>' +
      (open ? '<div class="as-item-b">' + fields('prod', p.id, p, PROD_FIELDS) + '</div>' : '') + '</div>';
  }

  /* ---- Photos ---- */
  function photosPanel() {
    const u = usage(), imgs = shelf();
    const thumbs = imgs.map(im =>
      '<div class="as-th"><img src="' + esc(im.src) + '" alt=""><span class="as-th-n">' + (u[im.id] ? 'Used ' + u[im.id] + '×' : 'Not used') + '</span>' +
      '<button type="button" class="as-th-x" data-act="img-del" data-img="' + im.id + '" aria-label="Remove photo">✕</button></div>').join('');
    const add = imgs.length < AP.MAX_SHELF ? '<button type="button" class="as-th as-th-add" data-act="upload"><b>＋</b><small>Add photos</small></button>' : '';
    return group('Photo shelf', imgs.length + ' of ' + AP.MAX_SHELF,
      '<p class="as-p">Upload once, then place a photo in any section — each spot gets its own size, crop and frame. Product photos live with their products in the Shop tab.</p>' +
      '<div class="as-shelf">' + thumbs + add + '</div>') +
      '<p class="as-p as-small">Everything together weighs about ' + bytes(allBytes()) + '. Photos are shrunk on upload; a site under ~5 MB loads quickly on mobile data.</p>';
  }

  /* ---- Design ---- */
  function designPanel() {
    const s = S.layout.style;
    const cards = AP.VIBES.map(v => {
      const f = AP.HEAD_FONTS.find(x => x.id === v.style.headFont);
      return '<button type="button" class="as-vibe' + (s.vibe === v.id ? ' on' : '') + '" data-act="vibe" data-id="' + v.id + '" style="--vb:' + v.style.bg + ';--vi:' + v.style.ink + ';--va:' + v.style.accent + ';--va2:' + v.style.accent2 + '">' +
        '<span class="as-vibe-sw"><span class="as-vibe-aa" style="font-family:' + f.stack + '">Aa</span><i></i><i></i></span>' +
        '<b>' + esc(v.name) + '</b></button>';
    }).join('');
    const color = (k, label) => '<label class="as-color"><input type="color" data-sty-color="' + k + '" value="' + s[k] + '"><span>' + label + '</span><code>' + s[k].toUpperCase() + '</code></label>';
    const fonts = AP.HEAD_FONTS.map(f => '<button type="button" class="as-font' + (s.headFont === f.id ? ' on' : '') + '" data-act="sty" data-k="headFont" data-v="' + esc(f.id) + '" style="font-family:' + f.stack + '">' + (f.caps ? 'HELLO' : 'Hello') + '<small>' + f.tag + '</small></button>').join('');
    const seg = (k, opts) => '<div class="as-seg">' + opts.map(o => '<button type="button" class="' + (s[k] === o[0] ? 'on' : '') + '" data-act="sty" data-k="' + k + '" data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>';
    const kind = isHotelSite() ? 'hotel' : 'cafe';
    const tpls = AP.TEMPLATES.filter(t => t.kind === kind).map(t => { const v = AP.VIBES.find(x => x.id === t.vibe) || AP.VIBES[0]; return '<button type="button" class="as-vibe" data-act="tpl" data-id="' + t.id + '" style="--vb:' + v.style.bg + ';--vi:' + v.style.ink + ';--va:' + v.style.accent + ';--va2:' + v.style.accent2 + '"><span class="as-vibe-sw"><span class="as-vibe-aa" style="font-family:' + AP.HEAD_FONTS.find(x => x.id === v.style.headFont).stack + '">Aa</span><i></i><i></i></span><b>' + esc(t.name) + '</b><small style="display:block;font-size:11px;opacity:.7;font-weight:400">' + esc(t.blurb) + '</small></button>'; }).join('');
    return group('Templates', 'Starts a whole new page layout', '<div class="as-vibes">' + tpls + '</div>') +
      group('Vibe', 'One tap restyles everything', '<div class="as-vibes">' + cards + '</div>') +
      group('Colours', s.vibe === 'custom' ? 'Custom' : '', '<div class="as-colors">' + color('bg', 'Background') + color('ink', 'Text') + color('accent', 'Accent') + color('accent2', 'Pop colour') + '</div>') +
      group('Type', '', '<label class="as-lab">Headings</label><div class="as-fonts">' + fonts + '</div>' +
        '<label class="as-lab">Body text</label>' + seg('bodyFont', AP.BODY_FONTS.map(f => [f.id, f.id]))) +
      group('Shape & spacing', '',
        '<label class="as-lab">Corners</label>' + seg('radius', [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']]) +
        '<label class="as-lab">Outlines</label>' + seg('edge', [['clean', 'Clean'], ['bold', 'Bold + shadow']]) +
        '<label class="as-lab">Breathing room</label>' + seg('space', [['compact', 'Snug'], ['cozy', 'Cozy'], ['airy', 'Airy']]) +
        '<label class="as-lab">Default alignment</label>' + seg('align', [['left', 'Left'], ['center', 'Centre']])) +
      group('Effects', 'Buttons, cards and motion',
        '<label class="as-lab">Buttons</label>' + seg('btn', [['solid', 'Solid'], ['glass', 'Glass'], ['outline', 'Outline'], ['gradient', 'Gradient']]) +
        '<label class="as-lab">Cards</label>' + seg('cards', [['flat', 'Flat'], ['glass', 'Frosted glass']]) +
        '<label class="as-lab">Big photo motion</label>' + seg('motion', [['none', 'Still'], ['parallax', 'Parallax'], ['zoom', 'Slow zoom']]));
  }

  /* ---- Site ---- */
  function sitePanel() {
    const s = S.layout.site, c = ctx.getCafe() || {}, u = siteUrl();
    const logoNote = s.nav !== 'off' && s.logo && !AP.safeImg(c.logo_url) ? notice('', 'No logo yet — add one from your cafe profile and it appears here automatically.') : '';
    const link = u
      ? '<div class="as-urlbox"><code>' + esc(u.replace(/^https?:\/\//, '')) + '</code><button type="button" class="as-btn sm" data-act="copy">Copy</button><button type="button" class="as-btn sm" data-act="site">Open</button></div>' +
        '<p class="as-p as-small">Put it in your Instagram bio, Google Maps listing or WhatsApp status. The same page also opens when someone swipes left on your table menu — <button type="button" class="as-inl" data-act="live">see it there</button>.</p>'
      : '<p class="as-p">Your link appears once the cafe is set up.</p>';
    return group('Your website link', '', link) +
      group('Header', 'The bar across the top', fields('site', 's', s, SITE_FIELDS.header) + logoNote) +
      group('Announcement bar', 'A thin message above the header', fields('site', 's', s, SITE_FIELDS.announce)) +
      group('Footer', '', fields('site', 's', s, SITE_FIELDS.footer)) +
      group('Contact links', 'Shown in the footer', fields('site', 's', s, SITE_FIELDS.contact));
  }

  function footHtml() {
    if (S.tab !== 'sections') return '';
    return '<div class="as-foot">' +
      (S.dirty ? '<button type="button" class="as-link warn" data-act="discard">Discard unsaved changes</button>' : '') +
      '<button type="button" class="as-link" data-act="starter">Start over with an empty layout</button></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Fields                                                             */
  /* ------------------------------------------------------------------ */
  const da = (sc, id, k, extra) => ' data-sc="' + sc + '" data-id="' + esc(id) + '" data-k="' + k + '"' + (extra || '');
  function fields(sc, id, obj, list) { return list.filter(f => !f.show || f.show(obj)).map(f => fieldHtml(sc, id, obj, f)).join(''); }

  function fieldHtml(sc, id, o, f) {
    const v = f.k ? o[f.k] : null, lab = f.label ? '<label class="as-lab">' + esc(f.label) + '</label>' : '';
    const hint = f.hint && f.t !== 'area' ? '<small class="as-hint">' + esc(f.hint) + '</small>' : '';
    switch (f.t) {
      case 'text': case 'catin':
        return '<div class="as-f">' + lab + '<input class="as-in" data-in' + da(sc, id, f.k) + ' value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '" maxlength="' + (f.max || 120) + '"' + (f.t === 'catin' ? ' list="as-cats"' : '') + '>' + hint + '</div>';
      case 'num':
        return '<div class="as-f">' + lab + '<input class="as-in" type="number" inputmode="decimal" min="0" step="any" data-in data-money="1"' + da(sc, id, f.k) + ' value="' + (v > 0 ? v : '') + '" placeholder="' + esc(f.ph || '') + '">' + hint + '</div>';
      case 'area':
        return '<div class="as-f">' + lab + '<textarea class="as-in" data-in rows="' + (f.rows || 4) + '"' + da(sc, id, f.k) + ' placeholder="' + esc(f.ph || '') + '" maxlength="' + (f.max || 800) + '">' + esc(v) + '</textarea>' + (f.hint ? '<small class="as-hint">' + esc(f.hint) + '</small>' : '') + '</div>';
      case 'seg':
        return '<div class="as-f">' + lab + '<div class="as-seg">' + f.opts.map(op =>
          '<button type="button" class="' + (String(v) === String(op[0]) ? 'on' : '') + '" data-act="set"' + da(sc, id, f.k, ' data-v="' + op[0] + '"' + (f.num ? ' data-num="1"' : '')) + '>' + op[1] + '</button>').join('') + '</div>' + hint + '</div>';
      case 'range':
        return '<div class="as-f">' + lab + '<div class="as-range"><input type="range" data-in data-num="1" data-unit="' + (f.unit || '') + '"' + da(sc, id, f.k) + ' min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + v + '"><output>' + v + (f.unit || '') + '</output></div></div>';
      case 'tog':
        return '<div class="as-f"><label class="as-tog"><input type="checkbox" data-in data-bool="1"' + da(sc, id, f.k) + (v ? ' checked' : '') + '><span class="as-tog-track"></span><span>' + esc(f.label) + '</span></label></div>';
      case 'sub': return '<div class="as-sub">' + esc(f.text) + '</div>';
      case 'tool': return '<div class="as-f">' + notice('', esc(f.text), '<button type="button" class="as-btn sm" data-act="' + f.act + '"' + da(sc, id, '') + '>' + esc(f.label) + '</button>') + '</div>';
      case 'sel':
        return '<div class="as-f">' + lab + '<select class="as-in" data-in data-pick="1"' + da(sc, id, f.k) + '>' + f.opts.map(op =>
          '<option value="' + esc(op[0]) + '"' + (String(v) === String(op[0]) ? ' selected' : '') + '>' + esc(op[1]) + '</option>').join('') + '</select></div>';
      case 'col':
        return '<div class="as-f">' + lab + '<div class="as-colr"><input type="color" data-in data-colr="1"' + da(sc, id, f.k) + ' value="' + (v || '#000000') + '"><span>' + (v ? esc(String(v).toUpperCase()) : 'Matches the page') + '</span>' +
          (v ? '<button type="button" class="as-link" data-act="set"' + da(sc, id, f.k, ' data-v=""') + '>Back to page colour</button>' : '') + '</div></div>';
      case 'rich':
        return '<div class="as-f">' + lab + richBar(f.mini) + '<div class="as-rich' + (f.mini ? ' mini' : '') + '" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" data-in data-rich="1"' + (f.sync ? ' data-sync="' + f.sync + '"' : '') + da(sc, id, f.k) + ' data-ph="Start typing…">' + (v || (f.plain ? esc(o[f.plain]) : '')) + '</div>' +
          (f.mini ? (f.hint ? '<small class="as-hint">' + esc(f.hint) + '</small>' : '') : '<small class="as-hint">Select words, then use the bar above: font, size, colour, bold, lists, links, alignment. Ctrl/⌘ + B, I, U work too. Pasting from Word or the web keeps the formatting that is safe.</small>') + '</div>';
      case 'hint': return '<div class="as-f">' + notice('warn', esc(f.text(o))) + '</div>';
      case 'jump': return '<div class="as-f">' + notice('', esc(f.text), '<button type="button" class="as-btn sm" data-act="tab" data-tab="' + f.tab + '">' + esc(f.label) + '</button>') + '</div>';
      case 'go': {
        const opts = S.layout.blocks.filter(b => b !== o).map(b => '<option value="' + b.id + '"' + (b.id === v ? ' selected' : '') + '>' + esc(sectionName(b)) + '</option>').join('');
        return '<div class="as-f">' + lab + '<select class="as-in" data-in data-pick="1"' + da(sc, id, f.k) + '><option value="">Choose a section…</option>' + opts + '</select></div>';
      }
      case 'cat': {
        const opts = cats().map(c => '<option value="' + esc(c) + '"' + (c === v ? ' selected' : '') + '>Only ' + esc(c) + '</option>').join('');
        return '<div class="as-f">' + lab + '<select class="as-in" data-in data-pick="1"' + da(sc, id, f.k) + '><option value="">All products</option>' + opts + '</select>' +
          '<small class="as-hint">Want separate sections for coffee and merch? Add two Shop sections, each showing one category.</small></div>';
      }
      case 'photo': return photoField(sc, id, o, f, lab);
      case 'pphoto': {
        const im = imgById(v);
        return '<div class="as-f">' + lab + '<div class="as-pick"><div class="as-pick-cur">' + (im ? '<img src="' + esc(im.src) + '" alt="">' : AP.SVG(AP.ICONS.photo)) + '</div>' +
          '<div class="as-pick-btns"><button type="button" class="as-btn sm" data-act="pupload"' + da(sc, id, f.k) + '>' + (im ? 'Replace photo' : 'Upload photo') + '</button>' +
          (im ? '<button type="button" class="as-btn sm ghost" data-act="pphoto-del"' + da(sc, id, f.k) + '>Remove</button>' : '') + '</div></div>' +
          '<small class="as-hint">Square photos look best. Without one, the card shows the first letter on your pop colour.</small></div>';
      }
      case 'coupons': {
        const rows = (o.coupons || []).map((c, i) => '<div class="as-row">' +
          '<input class="as-in" data-in' + da(sc, id, 'coupons', ' data-i="' + i + '" data-f="code"') + ' value="' + esc(c.code) + '" placeholder="CODE" maxlength="16" style="text-transform:uppercase;min-width:0">' +
          '<select class="as-in" data-in' + da(sc, id, 'coupons', ' data-i="' + i + '" data-f="kind"') + ' aria-label="Type" style="flex:0 0 78px"><option value="pct"' + (c.kind !== 'flat' ? ' selected' : '') + '>% off</option><option value="flat"' + (c.kind === 'flat' ? ' selected' : '') + '>₹ off</option></select>' +
          '<input class="as-in" type="number" inputmode="decimal" min="0" data-in' + da(sc, id, 'coupons', ' data-i="' + i + '" data-f="value"') + ' value="' + (Number(c.value) > 0 ? c.value : '') + '" placeholder="Amount" style="flex:0 0 74px;min-width:0">' +
          '<input class="as-in" type="number" inputmode="decimal" min="0" data-in' + da(sc, id, 'coupons', ' data-i="' + i + '" data-f="min"') + ' value="' + (Number(c.min) > 0 ? c.min : '') + '" placeholder="Min ₹" style="flex:0 0 66px;min-width:0">' +
          '<button type="button" class="as-rx" data-act="cp-del"' + da(sc, id, 'coupons', ' data-i="' + i + '"') + ' aria-label="Remove coupon">✕</button></div>').join('');
        const add = (o.coupons || []).length < 8 ? '<button type="button" class="as-link" data-act="cp-add"' + da(sc, id, 'coupons') + '>+ Add a coupon</button>' : '';
        return '<div class="as-f">' + rows + add + '<small class="as-hint">Customers type the code in their cart. “Min ₹” is the smallest order it works on.</small></div>';
      }
      case 'photos': return photosField(sc, id, o, f, lab);
      case 'rows': return rowsField(sc, id, o, f, lab);
      case 'hrows': return hrowsField(sc, id, o, f, lab);
      case 'hfac': {
        const n = ((hotelInfo() || {}).amenities || []).length;
        const types = (hotelInfo() || {}).types || [];
        const perRoom = types.length ? '<label class="as-lab" style="margin-top:12px">Amenities in each room</label>' + types.map(t => '<div class="as-row"><span class="as-in" style="border:0;background:none;flex:1;padding-left:0">' + esc(t.name) + ' <small class="as-hint">' + ((t.amenities || []).length || 'none') + ' selected</small></span><button type="button" class="as-btn sm" data-act="hotel-type" data-tid="' + esc(t.id) + '">Choose amenities</button></div>').join('') : '';
        return '<div class="as-f">' + lab + '<div class="as-row"><button type="button" class="as-btn" data-act="hotel-facilities">' + (n ? 'Edit facilities' : 'Choose facilities') + '</button><small class="as-hint">' + (n ? n + ' selected' : 'Wi-Fi, parking, restaurant, spa…') + '</small></div><small class="as-hint">Tap to switch on what your hotel has, or add your own. Shown with icons above your rooms.</small>' + perRoom + '</div>';
      }
    }
    return '';
  }

  /* ---- Word-style editor ---- */
  const RT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 120, 160, 200];
  function richBar(mini) {
    const b = (cmd, label, title, st) => '<button type="button" class="as-rt-b" data-rt="' + cmd + '" title="' + title + '" aria-label="' + title + '"' + (st ? ' style="' + st + '"' : '') + '>' + label + '</button>';
    return '<div class="as-rt">' +
      '<div class="as-rt-row">' +
        '<select data-rt-sel="block" aria-label="Paragraph style"><option value="">Style…</option><option value="p">Normal</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option><option value="blockquote">Quote</option></select>' +
        '<select data-rt-sel="font" aria-label="Font"><option value="">Font…</option><option value="inherit">Page font</option>' + AP.WORD_FONTS.map(f => '<option value="' + esc(f.id) + '" style="font-family:' + f.stack.replace(/"/g, '') + '">' + esc(f.id) + '</option>').join('') + '</select>' +
      '</div><div class="as-rt-row">' +
        b('sizedn', '−', 'Smaller') + '<input class="as-rt-size" type="number" min="8" max="200" step="1" value="16" data-rt-size aria-label="Font size in pixels">' + b('sizeup', '+', 'Bigger') +
        '<select data-rt-sel="sizepre" aria-label="Size presets"><option value="">Size…</option>' + RT_SIZES.map(n => '<option value="' + n + '">' + n + '</option>').join('') + '</select>' +
      '</div><div class="as-rt-row">' +
        b('bold', '<b>B</b>', 'Bold') + b('italic', '<i>I</i>', 'Italic') + b('underline', '<u>U</u>', 'Underline') + b('strikeThrough', '<s>S</s>', 'Strikethrough') +
        '<label class="as-rt-c" title="Text colour"><span style="border-bottom:3px solid #B96A45">A</span><input type="color" data-rt-col="foreColor" value="#B96A45" aria-label="Text colour"></label>' +
        '<label class="as-rt-c" title="Highlight"><span style="background:#FFE680;padding:0 3px">ab</span><input type="color" data-rt-col="hiliteColor" value="#FFE680" aria-label="Highlight colour"></label>' +
        b('sup', 'x²', 'Superscript') + b('sub', 'x₂', 'Subscript') +
      '</div>' + (mini ? '<div class="as-rt-row">' + b('removeFormat', 'Clear', 'Clear formatting') + b('undo', '↶', 'Undo') + b('redo', '↷', 'Redo') + '</div></div>' : '<div class="as-rt-row">' +
        b('justifyLeft', '⇤', 'Align left') + b('justifyCenter', '↔', 'Centre') + b('justifyRight', '⇥', 'Align right') + b('justifyFull', '☰', 'Justify') +
        b('insertUnorderedList', '• List', 'Bulleted list') + b('insertOrderedList', '1. List', 'Numbered list') + b('outdent', '⇠', 'Less indent') + b('indent', '⇢', 'More indent') +
      '</div><div class="as-rt-row">' +
        b('createLink', 'Link', 'Add link') + b('unlink', 'Unlink', 'Remove link') + b('insertHorizontalRule', '―', 'Divider line') + b('removeFormat', 'Clear', 'Clear formatting') + b('undo', '↶', 'Undo') + b('redo', '↷', 'Redo') +
      '</div></div>');
  }
  function rtSync(ed) {
    const o = target(ed.dataset.sc, ed.dataset.id); if (!o) return;
    o[ed.dataset.k] = ed.classList.contains('mini') ? AP.cleanInline(ed.innerHTML) : AP.cleanHtml(ed.innerHTML);
    if (ed.dataset.sync) o[ed.dataset.sync] = AP.richText(o[ed.dataset.k]);
    const card = el.panel.querySelector('[data-blk="' + o.id + '"] .as-item-t small'); if (card) card.textContent = summary(o);
    touch();
  }
  function rtRestore() {
    const ed = S && S.rich;
    if (!ed || !ed.isConnected) return null;
    ed.focus();
    const sel = root.getSelection();
    if (S.rng) { sel.removeAllRanges(); sel.addRange(S.rng); }
    return ed;
  }
  function rtExec(cmd, val) {
    const ed = rtRestore(); if (!ed) return;
    const d = root.document;
    d.execCommand('styleWithCSS', false, true);
    if (cmd === 'createLink') {
      const u = String(root.prompt('Where should the link go? (https://…, mailto:… or tel:…)', 'https://') || '').trim();
      if (!u) return; val = u;
    }
    if (cmd === 'sup' || cmd === 'sub') cmd = cmd === 'sup' ? 'superscript' : 'subscript';
    if (cmd === 'formatBlock') val = '<' + val + '>';
    d.execCommand(cmd, false, val);
    rtSync(ed);
  }
  function rtSize(n) {
    n = Math.max(8, Math.min(200, Math.round(Number(n))));
    if (!isFinite(n)) return;
    const ed = rtRestore(); if (!ed) return;
    const sel = root.getSelection();
    const d = root.document;
    if (!sel.rangeCount || sel.isCollapsed || !ed.contains(sel.anchorNode)) {
      /* nothing selected: size the whole field */
      if (!(ed.textContent || '').trim()) { toast('Type something first, then pick a size.'); return; }
      const all = d.createRange(); all.selectNodeContents(ed); sel.removeAllRanges(); sel.addRange(all);
    }
    d.execCommand('styleWithCSS', false, false);
    d.execCommand('fontSize', false, '7');
    const made = [];
    ed.querySelectorAll('font[size="7"]').forEach(f => {
      const sp = d.createElement('span'); sp.style.fontSize = n + 'px';
      while (f.firstChild) sp.appendChild(f.firstChild);
      f.replaceWith(sp); made.push(sp);
    });
    ed.querySelectorAll('span').forEach(sp => { if (sp.style.fontSize && /xxx-large|-webkit-xxx/.test(sp.style.fontSize)) { sp.style.fontSize = n + 'px'; made.push(sp); } });
    if (made.length) {
      made.forEach(sp => sp.querySelectorAll('span').forEach(i => { if (i.style.fontSize) i.style.fontSize = ''; }));
      const r = d.createRange(); r.setStartBefore(made[0]); r.setEndAfter(made[made.length - 1]);
      sel.removeAllRanges(); sel.addRange(r); S.rng = r.cloneRange();
    }
    rtSync(ed);
    rtBar();
  }
  function rtBar() {
    if (!S || !S.rich || !S.rich.isConnected) return;
    const inp = S.rich.parentNode.querySelector('[data-rt-size]'); if (!inp || root.document.activeElement === inp) return;
    const sel = root.getSelection(); if (!sel.rangeCount) return;
    let n = sel.anchorNode; if (n && n.nodeType === 3) n = n.parentNode;
    if (n && S.rich.contains(n)) inp.value = Math.round(parseFloat(root.getComputedStyle(n).fontSize)) || 16;
  }
  function richBind(r) {
    const d = root.document;
    d.addEventListener('selectionchange', () => {
      if (!S) return;
      const sel = root.getSelection(); if (!sel || !sel.rangeCount) return;
      let n = sel.getRangeAt(0).commonAncestorContainer; if (n.nodeType === 3) n = n.parentNode;
      const ed = n && n.closest ? n.closest('.as-rich') : null;
      if (ed && el.root.contains(ed)) { S.rich = ed; S.rng = sel.getRangeAt(0).cloneRange(); rtBar(); }
    });
    r.addEventListener('mousedown', e => { if (e.target.closest('.as-rt-b, .as-rt-c')) { if (!e.target.closest('input')) e.preventDefault(); } });
    r.addEventListener('click', e => {
      const b = e.target.closest('[data-rt]'); if (!b || !S) return;
      const c = b.dataset.rt;
      if (c === 'sizeup' || c === 'sizedn') {
        const inp = b.parentNode.querySelector('[data-rt-size]'), cur = Number(inp.value) || 16;
        const st = cur >= 60 ? 4 : cur >= 24 ? 2 : 1;
        inp.value = Math.max(8, Math.min(200, cur + (c === 'sizeup' ? st : -st))); rtSize(inp.value); return;
      }
      rtExec(c);
    });
    r.addEventListener('input', e => {
      const t = e.target;
      if (t.hasAttribute && t.hasAttribute('data-rt-col') && S) rtExec(t.getAttribute('data-rt-col'), t.value);
    });
    r.addEventListener('change', e => {
      const t = e.target;
      if (!S || !t.getAttribute) return;
      if (t.hasAttribute('data-rt-size')) { rtSize(t.value); return; }
      const w = t.getAttribute('data-rt-sel'); if (!w || !t.value) return;
      if (w === 'block') rtExec('formatBlock', t.value);
      else if (w === 'font') rtExec('fontName', t.value);
      else if (w === 'sizepre') { t.parentNode.querySelector('[data-rt-size]').value = t.value; rtSize(t.value); }
      t.selectedIndex = 0;
    });
    r.addEventListener('paste', e => {
      const ed = e.target.closest && e.target.closest('.as-rich'); if (!ed) return;
      e.preventDefault();
      const cd = e.clipboardData, h = cd && cd.getData('text/html'), t = cd && cd.getData('text/plain') || '';
      const clean = h ? AP.cleanHtml(h) : t.split(/\n{2,}/).map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
      root.document.execCommand('insertHTML', false, clean);
      rtSync(ed);
    });
    r.addEventListener('focusin', e => { if (e.target.classList && e.target.classList.contains('as-rich')) root.document.execCommand('defaultParagraphSeparator', false, 'p'); });
  }

  function photoField(sc, id, o, f, lab) {
    const im = imgById(o[f.k]);
    const open = S.picker && S.picker.id === id && S.picker.k === f.k;
    const strip = open ? '<div class="as-strip">' + shelf().map(i =>
      '<button type="button" class="as-sth' + (i.id === o[f.k] ? ' on' : '') + '" data-act="pick"' + da(sc, id, f.k, ' data-img="' + i.id + '"') + '><img src="' + esc(i.src) + '" alt=""></button>').join('') +
      '<button type="button" class="as-sth as-sth-add" data-act="upload"' + da(sc, id, f.k) + ' data-multi="0" aria-label="Upload a photo"><b>＋</b></button></div>' : '';
    return '<div class="as-f">' + lab + '<div class="as-pick"><div class="as-pick-cur">' + (im ? '<img src="' + esc(im.src) + '" alt="">' : AP.SVG(AP.ICONS.photo)) + '</div>' +
      '<div class="as-pick-btns"><button type="button" class="as-btn sm" data-act="pick-open"' + da(sc, id, f.k) + '>' + (open ? 'Close' : (im ? 'Change' : 'Choose photo')) + '</button>' +
      (im ? '<button type="button" class="as-btn sm ghost" data-act="pick"' + da(sc, id, f.k, ' data-img=""') + '>Remove</button>' : '') + '</div></div>' + strip + '</div>';
  }

  function photosField(sc, id, o, f, lab) {
    const sel = o[f.k];
    const tiles = shelf().map(i => {
      const at = sel.indexOf(i.id);
      return '<button type="button" class="as-sth' + (at >= 0 ? ' on' : '') + '" data-act="pick-multi"' + da(sc, id, f.k, ' data-img="' + i.id + '"') + '><img src="' + esc(i.src) + '" alt="">' + (at >= 0 ? '<span class="as-sth-n">' + (at + 1) + '</span>' : '') + '</button>';
    }).join('');
    const add = shelf().length < AP.MAX_SHELF ? '<button type="button" class="as-sth as-sth-add" data-act="upload"' + da(sc, id, f.k) + ' data-multi="1" aria-label="Upload photos"><b>＋</b></button>' : '';
    return '<div class="as-f">' + lab + '<div class="as-strip wrap">' + tiles + add + '</div><small class="as-hint">Tap to add or remove · numbers show the order</small></div>';
  }

  /* Hotel sections: one card per room type / hall — pick which, add a photo and a line. */
  const hotelInfo = () => { try { return (root.Hotel && root.Hotel.siteInfo && root.Hotel.siteInfo()) || null; } catch (e) { return null; } };
  function hrowsField(sc, id, o, f, lab) {
    const info = hotelInfo(), list = (info && info[f.hotel]) || [], spec = AP.ROWS[o.type + '.' + f.k];
    const rows = o[f.k].map((r, i) => {
      const im = imgById(r.imgId);
      return '<div class="as-row as-hrow"><select class="as-in" data-in' + da(sc, id, f.k, ' data-i="' + i + '" data-f="' + f.idk + '"') + '><option value="">Choose…</option>' +
        list.map(x => '<option value="' + esc(x.id) + '"' + (x.id === r[f.idk] ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select>' +
        '<button type="button" class="as-btn sm" data-act="hrow-photo"' + da(sc, id, f.k, ' data-i="' + i + '"') + '>' + (im ? '<img src="' + esc(im.src) + '" alt="" style="width:22px;height:22px;object-fit:cover;border-radius:4px;vertical-align:middle"> Change' : 'Add photo') + '</button>' +
        '<input class="as-in" data-in' + da(sc, id, f.k, ' data-i="' + i + '" data-f="text"') + ' value="' + esc(r.text) + '" placeholder="A line about it (optional)" maxlength="' + spec.f.text + '">' +
        (f.hotel === 'types' && r[f.idk] ? '<button type="button" class="as-btn sm" data-act="hotel-type" data-tid="' + esc(r[f.idk]) + '">Amenities</button>' : '') +
        '<button type="button" class="as-rx" data-act="row-del"' + da(sc, id, f.k, ' data-i="' + i + '"') + ' aria-label="Remove">✕</button></div>';
    }).join('');
    const none = !list.length ? '<small class="as-hint">Add ' + (f.hotel === 'halls' ? 'a hall in Hotel → Setup' : 'room types and rooms in Hotel → Setup') + ' first — they show here.</small>' : '';
    const add = o[f.k].length < spec.max && list.length ? '<button type="button" class="as-link" data-act="row-add"' + da(sc, id, f.k) + '>' + f.addLabel + '</button>' : '';
    return '<div class="as-f">' + lab + rows + add + none + (f.hint ? '<small class="as-hint">' + esc(f.hint) + '</small>' : '') + '</div>';
  }
  function rowsField(sc, id, o, f, lab) {
    const spec = AP.ROWS[o.type + '.' + f.k];
    const rows = o[f.k].map((r, i) => '<div class="as-row">' + f.cols.map(c =>
      '<input class="as-in ' + (c.cls || '') + '" data-in' + da(sc, id, f.k, ' data-i="' + i + '" data-f="' + c.k + '"') + ' value="' + esc(r[c.k]) + '" placeholder="' + esc(c.ph) + '" maxlength="' + spec.f[c.k] + '">').join('') +
      '<button type="button" class="as-rx" data-act="row-del"' + da(sc, id, f.k, ' data-i="' + i + '"') + ' aria-label="Remove row">✕</button></div>').join('');
    const add = o[f.k].length < spec.max ? '<button type="button" class="as-link" data-act="row-add"' + da(sc, id, f.k) + '>' + f.addLabel + '</button>' : '';
    return '<div class="as-f">' + lab + rows + add + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                            */
  /* ------------------------------------------------------------------ */
  function scrollToItem(sel) {
    const card = el.panel.querySelector(sel);
    if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function goTab(tab) { S.tab = tab; S.picker = null; el.panel.scrollTop = 0; renderEditor(); syncFocus(tab === 'site'); }

  function focusBlock(id, fromPreview) {
    S.tab = 'sections';
    S.openId = S.openId === id && !fromPreview ? null : id;
    S.picker = null; S.adding = false;
    renderEditor();
    if (S.openId) scrollToItem('[data-blk="' + S.openId + '"]');
    syncFocus(!fromPreview);
  }
  function focusProduct(id, fromPreview) {
    S.tab = 'shop';
    S.openPid = S.openPid === id && !fromPreview ? null : id;
    renderEditor();
    if (S.openPid) scrollToItem('[data-prod="' + S.openPid + '"]');
    syncFocus(!fromPreview);
  }

  const isHotelSite = () => ((ctx.getCafe() || {}).business_type === 'hotel');
  function fillHotelRows(b) {
    const info = hotelInfo(); if (!info || (b.type !== 'rooms' && b.type !== 'banquet')) return;
    const rooms = b.type === 'rooms', list = (rooms ? info.types : info.halls) || [], max = AP.ROWS[b.type + '.rows'].max;
    b.rows = list.slice(0, max).map(x => rooms ? { typeId: x.id, imgId: '', text: '' } : { hallId: x.id, imgId: '', text: '' });
  }
  function addBlock(type) {
    if (S.layout.blocks.length >= AP.MAX_BLOCKS) { toast('Section limit reached'); return null; }
    const b = AP.newBlock(type);
    if (b.type === 'hero' || b.type === 'photo' || b.type === 'split') {
      const u = usage(), free = shelf().find(i => !u[i.id]);   // convenience: start with an unused shelf photo
      if (free) b.imgId = free.id;
    }
    if (type === 'shop' && !S.layout.blocks.some(x => x.type === 'shop')) b.navLabel = 'Shop';
    fillHotelRows(b);
    S.layout.blocks.push(b);
    return b;
  }

  /* Drops a product photo nobody uses any more (shelf photos are only removed on purpose). */
  function pruneProductImage(id) {
    if (!id) return;
    const im = imgById(id);
    if (im && im.k === 'p' && !usage()[id]) S.layout.images = S.layout.images.filter(i => i.id !== id);
  }

  function onClick(e) {
    // studio chrome (Edit / Preview on small screens, device toggle)
    const view = e.target.closest('[data-view]');
    if (view && view !== el.root) { el.root.dataset.view = view.dataset.view; if (view.dataset.view === 'preview') root.requestAnimationFrame(fitDesktop); return; }
    const dev = e.target.closest('[data-device-btn]');
    if (dev && S) { setDevice(dev.dataset.deviceBtn); return; }

    if (S && el.screen.contains(e.target)) {          // tap-to-edit in the preview
      e.preventDefault();
      const toEdit = () => { if (el.root.dataset.view === 'preview') el.root.dataset.view = 'edit'; };
      const prod = e.target.closest('.ab-prod[data-pid]');
      if (prod) { toEdit(); focusProduct(prod.dataset.pid, true); return; }
      const part = e.target.closest('[data-part]');
      if (part) { toEdit(); goTab('site'); return; }
      const n = e.target.closest('[data-bid]');
      if (n) { toEdit(); focusBlock(n.dataset.bid, true); }
      return;
    }

    const t = e.target.closest('[data-act]');
    if (!t || !S) return;
    const d = t.dataset, act = d.act, o = target(d.sc, d.id);

    switch (act) {
      case 'close': close(); break;
      case 'save': save(); break;
      case 'site': openSite(); break;
      case 'live': openLive(); break;
      case 'copy': {
        const u = siteUrl();
        if (navigator.clipboard && u) navigator.clipboard.writeText(u).then(() => toast('Link copied'), () => toast(u));
        else toast(u);
        break;
      }
      case 'tab': goTab(d.tab); break;
      case 'vibe': {
        const v = AP.VIBES.find(x => x.id === d.id);
        if (v) { Object.assign(S.layout.style, v.style, { vibe: v.id }); touch(); renderEditor(); }
        break;
      }
      case 'sty':
        S.layout.style[d.k] = d.v;
        if (PRESET_KEYS.indexOf(d.k) >= 0) S.layout.style.vibe = 'custom';
        touch(); renderEditor(); break;

      /* sections */
      case 'toggle': focusBlock(d.id, false); break;
      case 'adding': S.adding = !S.adding; renderEditor(); if (S.adding) scrollToItem('.as-adds'); break;
      case 'mv': {
        const a = S.layout.blocks, i = a.findIndex(b => b.id === d.id), j = i + Number(d.d);
        if (i >= 0 && j >= 0 && j < a.length) { const x = a[i]; a[i] = a[j]; a[j] = x; touch(); renderEditor(); syncFocus(true); }
        break;
      }
      case 'dup': {
        const a = S.layout.blocks, i = a.findIndex(b => b.id === d.id);
        if (i < 0) break;
        if (a.length >= AP.MAX_BLOCKS) { toast('Section limit reached'); break; }
        const c = AP.clone(a[i]); c.id = AP.uid(); c.navLabel = ''; a.splice(i + 1, 0, c); S.openId = c.id; touch(); renderEditor(); break;
      }
      case 'del': {
        if (!root.confirm('Delete this section?')) break;
        S.layout.blocks = S.layout.blocks.filter(b => b.id !== d.id);
        if (S.openId === d.id) S.openId = null;
        touch(); renderEditor(); break;
      }
      case 'add': {
        const b = addBlock(d.type); if (!b) break;
        S.openId = b.id; S.picker = null; S.adding = false;
        touch(); renderEditor(); refreshPreview();
        scrollToItem('[data-blk="' + b.id + '"]');
        syncFocus(true); break;
      }
      case 'add-shop': {
        const b = addBlock('shop'); if (!b) break;
        touch(); renderEditor(); refreshPreview();
        toast('Shop section added at the bottom of your page — move it in Sections');
        break;
      }

      /* products */
      case 'ptoggle': focusProduct(d.id, false); break;
      case 'padd': {
        if (S.layout.shop.products.length >= AP.MAX_PRODUCTS) { toast('Product limit reached'); break; }
        const p = AP.newProduct();
        S.layout.shop.products.push(p); S.openPid = p.id;
        touch(); renderEditor();
        scrollToItem('[data-prod="' + p.id + '"]');
        const nameIn = el.panel.querySelector('[data-prod="' + p.id + '"] input[data-k="name"]'); if (nameIn) nameIn.focus({ preventScroll: true });
        break;
      }
      case 'pmv': {
        const a = S.layout.shop.products, i = a.findIndex(p => p.id === d.id), j = i + Number(d.d);
        if (i >= 0 && j >= 0 && j < a.length) { const x = a[i]; a[i] = a[j]; a[j] = x; touch(); renderEditor(); }
        break;
      }
      case 'pdup': {
        const a = S.layout.shop.products, i = a.findIndex(p => p.id === d.id);
        if (i < 0) break;
        if (a.length >= AP.MAX_PRODUCTS) { toast('Product limit reached'); break; }
        const c = AP.clone(a[i]); c.id = AP.uid(); c.name = c.name ? c.name + ' (copy)' : ''; a.splice(i + 1, 0, c); S.openPid = c.id; touch(); renderEditor(); break;
      }
      case 'pdel': {
        const p = prodById(d.id); if (!p) break;
        if (!root.confirm('Delete “' + (p.name || 'this product') + '”?')) break;
        S.layout.shop.products = S.layout.shop.products.filter(x => x.id !== d.id);
        pruneProductImage(p.imgId);
        if (S.openPid === d.id) S.openPid = null;
        touch(); renderEditor(); break;
      }
      case 'pupload': pickFiles({ sc: d.sc, id: d.id, k: d.k, product: true }, false); break;
      case 'pphoto-del': { if (!o) break; const old = o[d.k]; o[d.k] = ''; pruneProductImage(old); touch(); renderEditor(); break; }

      case 'to-words': {
        if (!o || o.type !== 'text') break;
        const w = AP.newBlock('words');
        w.id = o.id; w.navLabel = o.navLabel; w.width = o.width; w.look = o.look; w.align = o.align;
        w.size = { s: 14, m: 16, l: 19, xl: 22, xxl: 28 }[o.size] || 16;
        w.html = AP.cleanHtml((o.eyebrow ? '<p><strong>' + esc(o.eyebrow) + '</strong></p>' : '') + (o.heading ? '<h2>' + esc(o.heading) + '</h2>' : '') + AP.fmt(o.body));
        S.layout.blocks[S.layout.blocks.indexOf(o)] = w;
        touch(); renderEditor(); toast('Switched to Free text'); break;
      }
      /* generic setters */
      case 'set': {
        if (!o) break;
        o[d.k] = d.num ? Number(d.v) : d.v;
        touch(); renderEditor(); break;
      }
      case 'pick-open': {
        const same = S.picker && S.picker.id === d.id && S.picker.k === d.k;
        S.picker = same ? null : { id: d.id, k: d.k }; renderEditor(); break;
      }
      case 'pick': { if (!o) break; o[d.k] = d.img || ''; S.picker = null; touch(); renderEditor(); break; }
      case 'pick-multi': {
        if (!o) break;
        const at = o[d.k].indexOf(d.img);
        if (at >= 0) o[d.k].splice(at, 1); else o[d.k].push(d.img);
        touch(); renderEditor(); break;
      }
      case 'upload': pickFiles(d.id ? { sc: d.sc, id: d.id, k: d.k, multi: d.multi === '1' } : null, true); break;
      case 'img-del': removeImage(d.img); break;
      case 'hide': { if (!o) break; o.hidden = !o.hidden; touch(); renderEditor(); refreshPreview(); break; }
      case 'hotel-template': {
        if (!root.confirm('Replace your sections with the hotel layout (welcome, rooms, banquets, gallery, find us)? Your photos and colours are kept.')) break;
        const tpl = AP.hotelStarter(); tpl.blocks.forEach(fillHotelRows);
        S.layout.blocks = tpl.blocks; S.openId = null; touch(); renderEditor(); refreshPreview(); break;
      }
      case 'hotel-facilities': if (root.Hotel && root.Hotel.editFacilities) root.Hotel.editFacilities(); break;
      case 'hotel-type': if (root.Hotel && root.Hotel.editType && d.tid) root.Hotel.editType(d.tid); break;
      case 'hrow-photo': pickFiles({ sc: d.sc, id: d.id, k: d.k, product: true, row: Number(d.i), f: d.f || 'imgId' }, false); break;
      case 'cp-add': { if (o && o.coupons && o.coupons.length < 8) { o.coupons.push({ code: '', kind: 'pct', value: 0, min: 0 }); touch(); renderEditor(); } break; }
      case 'cp-del': { if (o && o.coupons) { o.coupons.splice(Number(d.i), 1); touch(); renderEditor(); } break; }
      case 'row-add': {
        if (!o) break;
        const spec = AP.ROWS[o.type + '.' + d.k];
        if (o[d.k].length < spec.max) { const r = {}; Object.keys(spec.f).forEach(k => { r[k] = ''; }); o[d.k].push(r); touch(); renderEditor(); }
        break;
      }
      case 'row-del': {
        if (!o) break;
        o[d.k].splice(Number(d.i), 1);
        if (!o[d.k].length) { const spec = AP.ROWS[o.type + '.' + d.k], r = {}; Object.keys(spec.f).forEach(k => { r[k] = ''; }); o[d.k].push(r); }
        touch(); renderEditor(); break;
      }
      case 'discard':
        if (root.confirm('Throw away everything since your last save?')) {
          S.layout = AP.normalize(JSON.parse(S.base)); S.dirty = false; S.openId = null; S.openPid = null;
          renderEditor(); refreshPreview(); updateChip();
        }
        break;
      case 'tpl': {
        const t = AP.fromTemplate(d.id); if (!t) break;
        if (!root.confirm('Switch to this template? Your sections are replaced; photos, products and site settings stay.')) break;
        t.blocks.forEach(fillHotelRows); S.layout.blocks = t.blocks; Object.assign(S.layout.style, t.style); S.openId = null; touch(); renderEditor(); refreshPreview(); break;
      }
      case 'starter':
        if (root.confirm('Replace every section with an empty layout? Your photos, products and site settings stay.')) {
          const s = AP.starter(); S.layout.blocks = s.blocks; S.openId = null; touch(); renderEditor();
        }
        break;
    }
  }

  function onInput(e) {
    const t = e.target;
    if (!S) return;
    if (t.hasAttribute('data-sty-color')) {                 // colour pickers
      const k = t.getAttribute('data-sty-color');
      S.layout.style[k] = t.value; S.layout.style.vibe = 'custom';
      const code = t.parentNode.querySelector('code'); if (code) code.textContent = t.value.toUpperCase();
      el.panel.querySelectorAll('.as-vibe.on').forEach(n => n.classList.remove('on'));
      touch(); return;
    }
    if (!t.hasAttribute('data-in')) return;
    const o = target(t.dataset.sc, t.dataset.id); if (!o) return;
    const k = t.dataset.k;
    if (t.dataset.i !== undefined) {                        // rows
      o[k][Number(t.dataset.i)][t.dataset.f] = t.value;
    } else if (t.dataset.rich) {
      o[k] = t.classList.contains('mini') ? AP.cleanInline(t.innerHTML) : AP.cleanHtml(t.innerHTML);
      if (t.dataset.sync) o[t.dataset.sync] = AP.richText(o[k]);
    } else if (t.dataset.colr) {
      o[k] = t.value;
    } else if (t.dataset.bool) {
      o[k] = t.checked;
      touch(); renderEditor(); return;                      // may reveal / hide dependent fields
    } else if (t.dataset.pick) {
      o[k] = t.value;
      touch(); renderEditor(); return;
    } else if (t.dataset.money) {
      const n = Number(t.value);
      o[k] = t.value === '' || !isFinite(n) ? 0 : Math.max(0, n);
    } else if (t.dataset.num) {
      o[k] = Number(t.value);
      const out = t.parentNode.querySelector('output');
      if (out) out.textContent = t.value + (t.dataset.unit || '');
    } else {
      o[k] = t.value;
    }
    // keep the collapsed-card summary line in step without re-rendering the field being typed in
    if (t.dataset.sc === 'blk') {
      const card = el.panel.querySelector('[data-blk="' + o.id + '"]');
      if (card) { card.querySelector('.as-item-t small').textContent = summary(o); }
    } else if (t.dataset.sc === 'prod') {
      const card = el.panel.querySelector('[data-prod="' + o.id + '"]');
      if (card) {
        card.querySelector('.as-item-t small').textContent = prodSummary(o);
        if (k === 'name') card.querySelector('.as-item-t b').firstChild.textContent = o.name.trim() || 'New product';
      }
    }
    touch();
  }

  /* A new category becomes a suggestion for the other products once the field is left. Updated in
     place — re-rendering here would swallow the click that moved focus away. */
  function onChange(e) {
    const t = e.target;
    if (!S || !t.dataset || t.dataset.sc !== 'prod' || t.dataset.k !== 'cat') return;
    const dl = el.panel.querySelector('#as-cats');
    if (dl) dl.innerHTML = cats().map(c => '<option value="' + esc(c) + '">').join('');
  }

  /* ------------------------------------------------------------------ */
  /* Photos                                                             */
  /* ------------------------------------------------------------------ */
  function pickFiles(t, multi) { S.target = t; el.file.multiple = !!multi; el.file.value = ''; el.file.click(); }

  function addImage(src, kind) {
    const id = 'i' + AP.uid();
    S.layout.images.push(kind === 'p' ? { id: id, src: src, k: 'p' } : { id: id, src: src });
    return id;
  }

  async function ingest(files) {
    if (!S) return;
    const t = S.target;
    if (t && t.product) {                                   // one photo for one product, kept small
      S.target = null;
      const f = files[0], o = target(t.sc, t.id);
      if (!f || !o) return;
      try {
        if (!/^image\//.test(f.type)) throw new Error('not an image');
        const src = await compress(f, 760, 0.8);
        if (!S) return;
        const row = t.row != null ? o[t.k][t.row] : null;
        if (t.row != null && !row) return;
        const old = row ? row[t.f] : o[t.k];
        if (row) row[t.f] = addImage(src, 'p'); else o[t.k] = addImage(src, 'p');
        pruneProductImage(old);
        touch(); renderEditor(); refreshPreview();
      } catch (e) { toast('Couldn’t read “' + f.name + '” — try a JPG or PNG'); }
      return;
    }
    const room = AP.MAX_SHELF - shelf().length;
    if (room <= 0) { toast('Photo shelf is full — remove one first'); return; }
    if (files.length > room) toast('Room for ' + room + ' more — adding the first ' + room);
    const added = [];
    for (const f of files.slice(0, room)) {
      try {
        if (!/^image\//.test(f.type)) throw new Error('not an image');
        added.push(addImage(await compress(f)));
      } catch (e) { toast('Couldn’t read “' + f.name + '”'); }
    }
    if (!S || !added.length) return;
    applyUploaded(added);
  }

  function applyUploaded(ids) {
    const t = S.target; S.target = null;
    const o = t && target(t.sc, t.id);
    if (o) {
      if (t.multi) ids.forEach(id => { if (o[t.k].indexOf(id) < 0) o[t.k].push(id); });
      else o[t.k] = ids[0];
    }
    S.picker = null;
    touch(); renderEditor(); refreshPreview();
  }

  function removeImage(id) {
    const n = usage()[id] || 0;
    if (n && !root.confirm('This photo is used in ' + n + ' place' + (n > 1 ? 's' : '') + '. Remove it from all of them?')) return;
    S.layout.images = S.layout.images.filter(i => i.id !== id);
    S.layout.blocks.forEach(b => {
      if (b.imgId === id) b.imgId = '';
      if (b.imgIds) b.imgIds = b.imgIds.filter(x => x !== id);
    });
    S.layout.shop.products.forEach(p => { if (p.imgId === id) p.imgId = ''; });
    touch(); renderEditor();
  }

  /* ------------------------------------------------------------------ */
  /* Save + open live                                                   */
  /* ------------------------------------------------------------------ */
  async function save() {
    if (!S || S.saving) return false;
    const clean = AP.normalize(S.layout);
    const size = JSON.stringify(clean).length;
    if (size > 7 * 1024 * 1024) { toast('That’s a lot of photos (' + bytes(size) + '). Remove a few and try again.'); return false; }
    const c = ctx.getCafe();
    S.saving = true; updateChip();
    try {
      // Same fields the profile editor sends, so the server never sees a half-empty update.
      const payload = {
        name: c.name, latitude: c.latitude, longitude: c.longitude,
        address_text: c.address_text == null ? null : c.address_text,
        logo_url: c.logo_url == null ? null : c.logo_url,
        about_text: c.about_text == null ? null : c.about_text,
        about_photos: Array.isArray(c.about_photos) ? c.about_photos : [],
        about_layout: clean,
      };
      const res = await ctx.api('PATCH', '/cafe/update', payload);
      ctx.setCafe(res);
      S.saving = false;
      const back = res && res.about_layout != null ? AP.normalize(res.about_layout) : null;
      // The server must hand back what it was given — if a backend schema only knows the old
      // v1 fields, products and site settings would silently vanish; catch that here.
      const kept = back && back.blocks.length === clean.blocks.length && back.shop.products.length === clean.shop.products.length;
      if (kept) {
        S.layout = back; S.base = JSON.stringify(back); S.dirty = false; S.notStored = false;
        S.openPid = S.openPid && prodById(S.openPid) ? S.openPid : null;
      } else S.notStored = true;
      updateChip(); renderEditor(); refreshPreview();
      toast(kept ? 'Website saved' : back
        ? 'Saved, but the server dropped your products or sections — about_layout needs to be stored as-is'
        : 'Saved, but the server didn’t keep the website design — it needs the about_layout field');
      return kept;
    } catch (err) {
      S.saving = false; updateChip();
      toast((err && err.message) || 'Could not save — try again');
      return false;
    }
  }

  /* Opens a tab right away (inside the click, so it isn't blocked), saves if needed, then points it at the page. */
  async function openUrl(url, missing) {
    if (!url) { toast(missing); return; }
    const w = root.open('', '_blank');
    if (S.dirty && !(await save())) { if (w) w.close(); return; }
    if (w) w.location.href = url; else root.open(url, '_blank');
  }
  function openSite() { openUrl(siteUrl(), 'Your website link isn’t ready yet'); }
  function openLive() { openUrl(ctx.liveUrl && ctx.liveUrl(), 'Add a table first — the menu view needs a real table link'); }

  /* ------------------------------------------------------------------ */
  /* DOM + CSS                                                          */
  /* ------------------------------------------------------------------ */
  function build() {
    const r = document.createElement('div');
    r.id = 'about-studio'; r.className = 'as-root'; r.hidden = true; r.dataset.view = 'edit';
    r.setAttribute('role', 'dialog'); r.setAttribute('aria-modal', 'true'); r.setAttribute('aria-label', 'Website studio');
    r.innerHTML =
      '<header class="as-top">' +
        '<button type="button" class="as-iconbtn" data-act="close" aria-label="Close studio">✕</button>' +
        '<div class="as-title"><b>Website studio</b><span class="as-chip ok" id="as-chip">All changes saved</span></div>' +
        '<div class="as-top-actions"><button type="button" class="as-btn ghost light" data-act="site">View site ↗</button>' +
        '<button type="button" class="as-btn primary" data-act="save">Save</button></div>' +
      '</header>' +
      '<div class="as-vtabs"><button type="button" data-view="edit">Edit</button><button type="button" data-view="preview">Preview</button></div>' +
      '<div class="as-body">' +
        '<aside class="as-side"><div class="as-ptabs" role="tablist" aria-label="Studio sections"></div><div class="as-panel" id="as-panel"></div></aside>' +
        '<div class="as-canvas">' +
          '<div class="as-cbar"><div class="as-dev" role="group" aria-label="Preview size">' +
            '<button type="button" data-device-btn="phone" aria-pressed="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>Phone</button>' +
            '<button type="button" data-device-btn="desktop" aria-pressed="false"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>Computer</button>' +
          '</div><span class="as-cbar-hint">Tap anything to edit it</span></div>' +
          '<div class="as-frame" data-device="phone">' +
            '<div class="as-bbar" aria-hidden="true"><i></i><i></i><i></i><span class="as-url"></span></div>' +
            '<div class="as-notch" aria-hidden="true"></div>' +
            '<div class="as-screen" id="as-screen"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<input type="file" id="as-file" accept="image/*" hidden>';
    document.body.appendChild(r);
    el = { root: r, panel: r.querySelector('#as-panel'), ptabs: r.querySelector('.as-ptabs'), screen: r.querySelector('#as-screen'),
           frame: r.querySelector('.as-frame'), url: r.querySelector('.as-url'), chip: r.querySelector('#as-chip'), file: r.querySelector('#as-file') };
    r.addEventListener('click', onClick);
    r.addEventListener('input', onInput);
    r.addEventListener('change', onChange);
    richBind(r);
    el.file.addEventListener('change', () => { const f = Array.prototype.slice.call(el.file.files); if (f.length) ingest(f); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && S && !el.root.hidden) close(); });
    document.addEventListener('hotel:changed', () => { if (S && !el.root.hidden) { refreshPreview(); renderEditor(); } });   // amenities or room details changed in the pop-up
    if (root.ResizeObserver) new ResizeObserver(fitDesktop).observe(el.screen);
    else root.addEventListener('resize', fitDesktop);
  }

  function injectCss() {
    if (document.getElementById('as-css')) return;
    const st = document.createElement('style'); st.id = 'as-css';
    st.textContent = `
.as-root{--ink:#171A21;--ink2:#2A2E38;--rose:#E63976;--rose-soft:#FDE8EF;--bg:#F3F4F6;--line:#E3E5E9;--mut:#6B7280;--warn:#8A4B00;--warn-bg:#FFF4DB;--ok:#145C3A;--ok-bg:#E3F5EA;
  position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;background:var(--bg);color:#1A1D24;font-family:'Inter',system-ui,sans-serif;font-size:14px}
.as-root[hidden]{display:none}
.as-root *{box-sizing:border-box}
.as-root button{font-family:inherit;cursor:pointer}
.as-root :focus-visible{outline:2px solid var(--rose);outline-offset:2px}

/* top bar */
.as-top{display:flex;align-items:center;gap:10px;padding:10px 14px;padding-top:calc(10px + env(safe-area-inset-top,0px));background:var(--ink);color:#fff}
.as-iconbtn{all:unset;cursor:pointer;width:38px;height:38px;display:grid;place-items:center;border-radius:10px;font-size:15px;color:#cfd3dc}
.as-iconbtn:hover{background:rgba(255,255,255,.1);color:#fff}
.as-title{flex:1;min-width:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.as-title b{font-family:'Space Grotesk',sans-serif;font-size:16px}
.as-chip{font-size:11px;font-weight:600;padding:3px 9px;border-radius:99px}
.as-chip.ok{background:rgba(255,255,255,.08);color:#9aa3b2}.as-chip.warn{background:#4a3a14;color:#ffd166}.as-chip.busy{background:#2a3350;color:#a9bcff}.as-chip.bad{background:#4d1f1f;color:#ff9a9a}
.as-top-actions{display:flex;gap:8px}
.as-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;border-radius:9px;font-weight:600;font-size:13px;background:#fff;color:var(--ink);border:1px solid var(--line);white-space:nowrap}
.as-btn.primary{background:var(--rose);border-color:var(--rose);color:#fff;padding:9px 20px}
.as-btn.ghost{background:transparent}.as-btn.light{color:#fff;border-color:rgba(255,255,255,.25)}
.as-btn.sm{padding:7px 12px;font-size:12.5px}
.as-btn:hover{filter:brightness(.97)}.as-btn.primary:hover{filter:brightness(1.06)}

/* layout */
.as-vtabs{display:none}
.as-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr)}
.as-side{display:flex;flex-direction:column;min-height:0;background:#fff;border-right:1px solid var(--line)}
.as-ptabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none;flex:0 0 auto}
.as-ptabs::-webkit-scrollbar{display:none}
.as-ptabs button{all:unset;cursor:pointer;position:relative;padding:14px 12px 13px;font-weight:600;font-size:13.5px;color:var(--mut);white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.as-ptabs button small{font-size:10.5px;font-weight:700;background:var(--bg);color:var(--mut);border-radius:99px;padding:1px 6px}
.as-ptabs button:hover{color:var(--ink)}
.as-ptabs button[aria-selected=true]{color:var(--ink)}
.as-ptabs button[aria-selected=true]::after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px;background:var(--rose)}
.as-panel{flex:1;min-height:0;overflow-y:auto;padding:16px 16px 60px;-webkit-overflow-scrolling:touch;background:#FAFAFB}
.as-canvas{display:flex;flex-direction:column;min-height:0;padding:14px 22px 22px;gap:12px;
  background-color:#E7E9ED;background-image:radial-gradient(#cdd1d8 1px,transparent 1px);background-size:18px 18px}
.as-cbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:0 0 auto}
.as-dev{display:inline-flex;background:#fff;border:1px solid var(--line);border-radius:10px;padding:3px;gap:2px}
.as-dev button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:7px;font-weight:600;font-size:12.5px;color:var(--mut)}
.as-dev button[aria-pressed=true]{background:var(--ink);color:#fff}
.as-cbar-hint{font-size:12px;color:var(--mut)}

/* preview frames */
.as-frame{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;align-self:center;overflow:hidden;background:#fff}
.as-frame[data-device=phone]{width:min(392px,100%);max-height:820px;border:10px solid var(--ink);border-radius:44px;box-shadow:0 30px 60px -24px rgba(23,26,33,.5)}
.as-frame[data-device=desktop]{width:100%;max-width:1180px;border-radius:12px;border:1px solid #C9CDD5;box-shadow:0 30px 60px -30px rgba(23,26,33,.45)}
.as-bbar{display:none;align-items:center;gap:7px;padding:9px 14px;background:#F1F2F4;border-bottom:1px solid #DDE0E5;flex:0 0 auto}
.as-frame[data-device=desktop] .as-bbar{display:flex}
.as-bbar i{width:11px;height:11px;border-radius:50%;background:#D3D6DC}
.as-url{margin-left:10px;flex:1;max-width:520px;background:#fff;border:1px solid #DDE0E5;border-radius:7px;padding:4px 12px;font-size:12px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.as-notch{display:none;position:absolute;z-index:6;top:0;left:50%;transform:translateX(-50%);width:96px;height:20px;background:var(--ink);border-radius:0 0 14px 14px;pointer-events:none}
.as-frame[data-device=phone] .as-notch{display:block}
.as-screen{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch}
.as-vp{min-height:100%}
.as-screen .ab{min-height:100%}

@media (min-width:960px){.as-body{grid-template-columns:420px minmax(0,1fr)}}
@media (max-width:959px){
  .as-vtabs{display:flex;gap:4px;padding:6px 10px;background:#fff;border-bottom:1px solid var(--line)}
  .as-vtabs button{all:unset;cursor:pointer;flex:1;text-align:center;padding:9px;border-radius:9px;font-weight:600;font-size:13px;color:var(--mut)}
  .as-root[data-view=edit] .as-vtabs [data-view=edit],.as-root[data-view=preview] .as-vtabs [data-view=preview]{background:var(--ink);color:#fff}
  .as-root[data-view=edit] .as-canvas{display:none}
  .as-root[data-view=preview] .as-side{display:none}
  .as-side{border-right:0}
  .as-canvas{padding:10px}
  .as-cbar-hint{display:none}
  .as-frame[data-device=phone]{border-width:7px;border-radius:30px;max-height:none}
  .as-top{gap:6px;padding-left:8px;padding-right:10px}.as-top-actions{gap:6px}.as-top .as-btn{padding:8px 11px;font-size:12.5px}
  .as-chip{display:none}
}

/* panel content */
.as-grp{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
.as-grp-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.as-grp-h h3{margin:0;font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600}
.as-grp-h small{color:var(--mut);font-size:12px}
.as-p{margin:0 0 12px;color:var(--mut);font-size:13px;line-height:1.5}.as-p.as-small{font-size:12px}.as-empty{text-align:center;padding:14px 4px;margin:0}
.as-inl{all:unset;cursor:pointer;color:var(--rose);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.as-hint{color:var(--mut);font-size:11.5px;display:block;margin-top:6px;line-height:1.45}
.as-note{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;border-radius:12px;padding:11px 13px;font-size:12.5px;line-height:1.45;margin-bottom:12px;background:var(--bg);color:#3a3f4a}
.as-note.warn{background:var(--warn-bg);color:var(--warn)}.as-note.ok{background:var(--ok-bg);color:var(--ok)}
.as-note span{flex:1 1 200px}
.as-grp .as-note{margin:12px 0 0}.as-f .as-note{margin:0}
.as-link{all:unset;cursor:pointer;color:var(--rose);font-weight:600;font-size:12.5px;padding:8px 2px;display:inline-block}.as-link.warn{color:#b3432e}
.as-foot{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0 20px}
.as-sub{margin:18px 0 0;padding-top:14px;border-top:1px solid var(--line);font-size:12px;font-weight:700;color:var(--ink)}

/* outline items (sections + products) */
.as-outline{display:grid;gap:6px}
.as-item{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden}
.as-item.open{border-color:var(--ink);box-shadow:0 10px 24px -18px rgba(23,26,33,.6)}
.as-item.is-out .as-thumb{opacity:.45}
.as-item-h{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 9px;cursor:pointer}
.as-item-h:hover{background:#FAFAFB}
.as-ico{flex:0 0 auto;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-size:16px;background:var(--bg)}
.as-thumb{flex:0 0 auto;width:38px;height:38px;border-radius:9px;overflow:hidden;display:grid;place-items:center;background:var(--bg);font-weight:700;color:var(--mut);font-family:'Space Grotesk',sans-serif}
.as-thumb img{width:100%;height:100%;object-fit:cover}
.as-item-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.as-item-t b{font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.as-item-t small{color:var(--mut);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.as-pill{font-style:normal;font-size:10.5px;font-weight:600;color:var(--mut);background:var(--bg);border-radius:99px;padding:1px 7px;flex:0 0 auto}
.as-ctl{display:flex;gap:1px;flex:0 0 auto}.as-item.as-off .as-item-h{opacity:.55}.as-ctl svg{width:16px;height:16px}.as-ico svg{width:18px;height:18px}
.as-ctl button{all:unset;cursor:pointer;width:28px;height:28px;border-radius:7px;display:grid;place-items:center;font-size:13px;color:#5a6070}
.as-ctl button:hover:not(:disabled){background:var(--bg);color:var(--ink)}.as-ctl button:disabled{opacity:.25;cursor:default}
.as-ctl button[data-act$=del]:hover{background:#fbeae6;color:#b3432e}
.as-item-b{padding:0 14px 16px;border-top:1px solid var(--line)}
.as-addbtn{all:unset;box-sizing:border-box;cursor:pointer;display:block;width:100%;text-align:center;margin-top:10px;padding:12px;border:1.5px dashed #CDD1D8;border-radius:12px;font-weight:600;font-size:13px;color:var(--ink)}
.as-addbtn:hover{border-color:var(--ink);background:#FAFAFB}
.as-adds{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
.as-add{all:unset;box-sizing:border-box;cursor:pointer;border:1px solid var(--line);border-radius:11px;padding:10px;display:grid;grid-template-columns:34px 1fr;grid-template-rows:auto auto;column-gap:10px;align-items:center;background:#fff}
.as-add .as-ico{grid-row:1 / span 2}.as-add b{font-size:13px;font-weight:600;align-self:end}.as-add small{color:var(--mut);font-size:11px;line-height:1.3;align-self:start}
.as-add:hover{border-color:var(--ink)}

/* fields */
.as-f{margin-top:14px}
.as-lab{display:block;font-size:12px;font-weight:600;color:#3a3f4a;margin:14px 0 6px}
.as-f .as-lab{margin-top:0}
.as-in{width:100%;font-family:'Inter',sans-serif;font-size:14px;padding:10px 12px;border-radius:9px;border:1px solid #D9DCE1;background:#fff;color:#1A1D24}
.as-in:focus{outline:2px solid var(--rose);outline-offset:0;border-color:transparent}
select.as-in{appearance:none;-webkit-appearance:none;padding-right:34px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%236B7280' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
textarea.as-in{resize:vertical;line-height:1.5}
.as-in.as-em{width:54px;flex:0 0 54px;text-align:center;padding:10px 4px}
.as-row{display:flex;gap:6px;margin-bottom:6px;align-items:center}
.as-rx{all:unset;cursor:pointer;width:30px;height:30px;flex:0 0 30px;display:grid;place-items:center;color:#b3432e;border-radius:8px;font-size:12px}
.as-rx:hover{background:#fbeae6}
.as-range{display:flex;align-items:center;gap:12px}.as-range input{flex:1;accent-color:var(--ink)}
.as-range output{width:42px;text-align:right;font-weight:600;font-size:12.5px;font-variant-numeric:tabular-nums}
.as-tog{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13.5px;font-weight:500}
.as-tog input{position:absolute;opacity:0;width:1px;height:1px}
.as-tog-track{width:38px;height:22px;border-radius:99px;background:#D3D6DC;position:relative;flex:0 0 auto;transition:background .15s}
.as-tog-track::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.as-tog input:checked+.as-tog-track{background:var(--ink)}.as-tog input:checked+.as-tog-track::after{transform:translateX(16px)}
.as-tog input:focus-visible+.as-tog-track{outline:2px solid var(--rose);outline-offset:2px}
.as-seg{display:flex;flex-wrap:wrap;gap:4px;background:var(--bg);border-radius:10px;padding:3px;width:fit-content;max-width:100%}
.as-seg button{all:unset;box-sizing:border-box;cursor:pointer;padding:7px 12px;border-radius:7px;font-size:12.5px;font-weight:600;color:#4b5160}
.as-seg button:hover{color:var(--ink)}
.as-seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(23,26,33,.14)}
.as-urlbox{display:flex;align-items:center;gap:6px;background:var(--bg);border-radius:10px;padding:6px 6px 6px 12px;margin-bottom:10px}
.as-urlbox code{flex:1;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}

/* design */
.as-vibes{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.as-vibe{all:unset;box-sizing:border-box;cursor:pointer;border:1.5px solid var(--line);border-radius:12px;padding:6px;background:#fff;display:flex;flex-direction:column;gap:7px}
.as-vibe.on{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
.as-vibe b{font-size:12px;font-weight:600;line-height:1.25;padding:0 2px 2px}
.as-vibe-sw{height:56px;border-radius:8px;background:var(--vb);display:flex;align-items:center;gap:5px;padding:0 9px;color:var(--vi)}
.as-vibe-aa{font-size:26px;line-height:1;margin-right:auto}
.as-vibe-sw i{width:14px;height:14px;border-radius:50%;background:var(--va)}.as-vibe-sw i+i{background:var(--va2);margin-left:-4px}
.as-colors{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.as-color{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:6px 8px;cursor:pointer;background:#fff}
.as-color input{width:28px;height:28px;border:0;padding:0;background:none;cursor:pointer;flex:0 0 auto}
.as-color span{font-size:12px;font-weight:600;flex:1}.as-color code{font-size:10.5px;color:var(--mut)}
.as-grp .as-lab:first-of-type{margin-top:0}
.as-fonts{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:6px}
.as-font{all:unset;box-sizing:border-box;cursor:pointer;border:1.5px solid var(--line);border-radius:10px;padding:8px 10px;font-size:19px;display:flex;flex-direction:column;background:#fff}
.as-font small{font-family:'Inter',sans-serif;font-size:10.5px;color:var(--mut);margin-top:2px}
.as-font.on{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}

/* photos */
.as-shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px}
.as-th{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:var(--bg)}
.as-th img{width:100%;height:100%;object-fit:cover;display:block}
.as-th-n{position:absolute;left:5px;bottom:5px;font-size:10px;font-weight:600;padding:2px 6px;border-radius:99px;background:rgba(23,26,33,.72);color:#fff}
.as-th-x{all:unset;cursor:pointer;position:absolute;top:5px;right:5px;width:22px;height:22px;border-radius:50%;background:rgba(23,26,33,.72);color:#fff;font-size:11px;display:grid;place-items:center}
.as-th-x:hover{background:#b3432e}
.as-th-add{all:unset;box-sizing:border-box;cursor:pointer;aspect-ratio:1;border-radius:10px;border:1.5px dashed #CDD1D8;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--ink);gap:2px}
.as-th-add:hover{border-color:var(--ink)}
.as-th-add b{font-size:22px;line-height:1}.as-th-add small{font-size:11px;font-weight:600}
.as-pick{display:flex;align-items:center;gap:12px}
.as-pick-cur{width:64px;height:64px;border-radius:10px;overflow:hidden;background:var(--bg);border:1px solid var(--line);display:grid;place-items:center;font-size:22px;flex:0 0 auto}
.as-pick-cur img{width:100%;height:100%;object-fit:cover}
.as-pick-btns{display:flex;gap:6px;flex-wrap:wrap}
.as-strip{display:flex;gap:8px;overflow-x:auto;padding:10px 2px 4px}.as-strip.wrap{flex-wrap:wrap;overflow:visible;padding-top:0}
.as-sth{all:unset;box-sizing:border-box;cursor:pointer;position:relative;flex:0 0 60px;width:60px;height:60px;border-radius:9px;overflow:hidden;border:2px solid transparent;background:var(--bg)}
.as-sth img{width:100%;height:100%;object-fit:cover;display:block}
.as-sth.on{border-color:var(--rose)}
.as-sth-n{position:absolute;top:3px;right:3px;min-width:18px;height:18px;border-radius:99px;background:var(--rose);color:#fff;font-size:10.5px;font-weight:700;display:grid;place-items:center;padding:0 4px}
.as-sth-add{border:1.5px dashed #CDD1D8;display:grid;place-items:center;color:var(--ink);font-size:20px}

.as-rt{border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;background:#F7F8FA;padding:6px;display:flex;flex-direction:column;gap:5px;position:sticky;top:-1px;z-index:3}
.as-rt-row{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.as-rt select,.as-rt-size{height:32px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit;font-size:12.5px;padding:0 6px;max-width:150px}
.as-rt-size{width:58px;text-align:center}
.as-rt-b,.as-rt-c{min-width:32px;height:32px;padding:0 8px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);font-size:13px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative}
.as-rt-b:hover,.as-rt-c:hover{border-color:var(--rose);color:var(--rose)}
.as-rt-c input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;border:0;padding:0}
.as-rich{min-height:150px;max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:0 0 10px 10px;background:#fff;padding:12px 14px;font-size:15px;line-height:1.55;outline:none;overflow-wrap:anywhere}
.as-rich.mini{min-height:48px;max-height:140px}
.as-rich:focus{border-color:var(--rose);box-shadow:0 0 0 3px var(--rose-soft)}
.as-rich:empty:before{content:attr(data-ph);color:#9AA0AB}
.as-rich p{margin:0 0 .7em}.as-rich h1{font-size:1.9em;margin:.2em 0 .4em}.as-rich h2{font-size:1.5em;margin:.2em 0 .4em}.as-rich h3{font-size:1.25em;margin:.2em 0 .4em}.as-rich h4{font-size:1.05em;margin:.2em 0 .4em}
.as-rich ul,.as-rich ol{margin:0 0 .7em;padding-left:1.4em}.as-rich blockquote{margin:0 0 .7em;padding-left:.9em;border-left:3px solid var(--rose);color:#555;font-style:italic}.as-rich a{color:var(--rose)}
.as-colr{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.as-colr input{width:44px;height:34px;border:1px solid var(--line);border-radius:8px;padding:2px;background:#fff}.as-colr span{font-size:12.5px;color:var(--mut)}
`;
    document.head.appendChild(st);
  }

  root.AboutStudio = {
    init: init, open: open, close: close,
    __debug: { state: () => S, ingestData: src => { const id = 'i' + AP.uid(); S.layout.images.push({ id: id, src: src }); applyUploaded([id]); return id; } },
  };
})(typeof window !== 'undefined' ? window : globalThis);
