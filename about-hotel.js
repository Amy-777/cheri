/* about-hotel.js — the live behaviour of a hotel website's "Rooms & booking" and "Banquet halls" sections.
 *
 * about-page.js draws the sections (cards, a date form, an empty calendar); this file makes them work on the public page:
 *   rooms   — pick dates → asks the server which room types are free (and the average nightly price) → "Request this room".
 *   banquet — tap a hall → month calendar of free / part-booked / booked days → pick a day and a slot → send a request.
 * Requests go to POST /order/cafe/{id}/hotel/enquiry and land on the hotel's Bookings screen. Nothing is charged online.
 * One set of document listeners serves every page; the studio's preview is inert (.ab-preview).
 */
(function (root) {
  'use strict';
  const doc = root.document; if (!doc || root.__abHotelBound) return; root.__abHotelBound = true;
  const base = () => { try { return API_BASE; } catch (e) { return 'https://xyzzy-backend.onrender.com'; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const addD = (s, n) => { const p = s.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2] + n); return iso(d); };
  const parse = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const today = () => iso(new Date());
  const RS = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const live = el => el && !el.closest('.ab-preview');
  const say = (el, t, cls) => { if (el) { el.textContent = t || ''; el.className = el.className.replace(/\s(ok|bad)\b/g, '') + (t && cls ? ' ' + cls : ''); } };
  async function api(path, opt) {
    const r = await fetch(base() + path, opt);
    let d = null; try { d = await r.json(); } catch (e) { /* */ }
    if (!r.ok) { const m = d && d.detail; const err = new Error(typeof m === 'string' ? m : 'Something went wrong — please try again'); err.status = r.status; throw err; }
    return d;
  }
  const ENQ = id => '/order/cafe/' + id + '/hotel/enquiry';

  /* ---------------------------------------------------------------- rooms */
  function roomsInit(sec) {
    if (sec.__init || !live(sec)) return; sec.__init = true;
    const f = sec.querySelector('.ab-rm-search'); if (!f) return;
    f.elements.ci.value = addD(today(), 1); f.elements.co.value = addD(today(), 2);
    check(sec);
  }
  async function check(sec) {
    const f = sec.querySelector('.ab-rm-search'), msg = sec.querySelector('.ab-rm-msg');
    const ci = f.elements.ci.value, co = f.elements.co.value;
    if (!ci || !co) return say(msg, 'Pick your check-in and check-out dates.', 'bad');
    if (co <= ci) return say(msg, 'Check-out must be after check-in.', 'bad');
    say(msg, 'Checking…');
    try {
      const d = await api('/order/cafe/' + sec.dataset.cafe + '/hotel/availability?ci=' + ci + '&co=' + co);
      sec.__q = { ci: ci, co: co, adults: Number(f.elements.adults.value) || 2, nights: d.nights, pay: d.pay || {} };
      const by = {}; d.types.forEach(t => { by[t.id] = t; });
      sec.querySelectorAll('.ab-rm').forEach(card => {
        const t = by[card.dataset.type], st = card.querySelector('.ab-rm-st'), go = card.querySelector('.ab-rm-go'), pr = card.querySelector('.ab-rm-price b');
        if (!t) { st.textContent = 'Not available'; st.className = 'ab-rm-st no'; go.disabled = true; go.textContent = 'Not available'; return; }
        pr.textContent = RS(t.rate);
        const rk = card.querySelector('.ab-rm-rack'), tt = card.querySelector('.ab-rm-tot');
        if (rk) { const rr = Math.round(t.rack / Math.max(1, d.nights)); if (rr > t.rate) { rk.hidden = false; rk.textContent = RS(rr); } else rk.hidden = true; }
        if (tt) tt.textContent = d.nights + ' night' + (d.nights > 1 ? 's' : '') + ': ' + RS(t.total) + ' incl. ' + t.gst_pct + '% GST';
        if (t.available) {
          st.textContent = t.left <= 3 ? 'Only ' + t.left + ' left' : 'Available'; st.className = 'ab-rm-st ' + (t.left <= 3 ? 'low' : 'ok');
          go.disabled = false; go.textContent = go.dataset.label;
        } else {
          st.textContent = t.note || 'Sold out for these dates'; st.className = 'ab-rm-st no'; go.disabled = true; go.textContent = 'Not available';
        }
        card.__t = t;
      });
      say(msg, d.nights + ' night' + (d.nights > 1 ? 's' : '') + ' · ' + parse(ci).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' → ' + parse(co).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), 'ok');
    } catch (e) { say(msg, e.message || 'Couldn’t check right now — please call us.', 'bad'); }
  }
  /* ---------------------------------------------------------------- booking sheet: Your stay → Guest → Payment */
  const PAD = n => String(n).padStart(2, '0');
  const fmt = s => parse(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const COUNTRIES = [['+91', 'India'], ['+977', 'Nepal'], ['+975', 'Bhutan'], ['+880', 'Bangladesh'], ['+94', 'Sri Lanka'], ['+971', 'United Arab Emirates'], ['+1', 'United States'], ['+44', 'United Kingdom'], ['', 'Other']];
  function roomAsk(btn) {
    const sec = btn.closest('.ab-t-rooms'), card = btn.closest('.ab-rm'), q = sec.__q, t = card.__t; if (!q || !t) return;
    const img = card.querySelector('.ab-rm-img img');
    openSheet(sec, { t: t, q: q, img: img ? img.src : '', step: 1, rooms: 1, guest: {}, reqs: {}, pay: { mode: '' }, cafe: sec.dataset.cafe });
  }
  function totals(S) {
    const n = S.rooms, t = S.t, sub = t.subtotal * n, rack = Math.max(t.rack * n, sub), tax = t.tax * n;
    const total = sub + tax, ps = S.q.pay || {};
    return { sub: sub, rack: rack, off: rack - sub, tax: tax, total: total, due: ps.upi && ps.advance_pct ? Math.round(total * ps.advance_pct / 100) : 0, dueOnline: ps.online ? Math.max(1, Math.round(total * (ps.online_pct || 100) / 100)) : 0 };
  }
  function openSheet(sec, S) {
    const ab = sec.closest('.ab') || doc.body; closeSheet(ab);
    const el = doc.createElement('div'); el.className = 'ab-sx'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.__S = S; el.__sec = sec;
    ab.appendChild(el); doc.documentElement.classList.add('ab-sx-open'); drawSheet(el);
    const f = el.querySelector('input'); if (f && S.step === 2) f.focus();
  }
  function closeSheet(ab) { (ab || doc).querySelectorAll('.ab-sx').forEach(x => x.remove()); if (!doc.querySelector('.ab-sx')) doc.documentElement.classList.remove('ab-sx-open'); }
  function cancelLine(S) {
    const ps = S.q.pay || {}, dd = Number(ps.cancel_days);
    if (!(dd >= 0) || ps.cancel_days == null) return '';
    const last = addD(S.q.ci, -dd);
    return last >= today() ? '<p class="ab-sx-ok">Free cancellation until ' + esc(fmt(last)) + '.</p>' : '<p class="ab-sx-warn">Free cancellation is no longer available for these dates.</p>';
  }
  function stepsBar(n) { return '<ol class="ab-sx-steps">' + ['Your stay', 'Guest details', 'Payment'].map((x, i) => '<li class="' + (i + 1 === n ? 'on' : i + 1 < n ? 'done' : '') + '"><b>' + (i + 1) + '</b><span>' + x + '</span></li>').join('') + '</ol>'; }
  function drawSheet(el) {
    const S = el.__S, T = totals(S), t = S.t, q = S.q, ps = q.pay || {};
    const head = '<header class="ab-sx-h"><button type="button" class="ab-sx-x" data-sx="back" aria-label="' + (S.step === 1 || S.done ? 'Close' : 'Back') + '">' + (S.step === 1 || S.done ? '&#10005;' : '&#8592;') + '</button><b>' + (S.done ? (S.pay.mode === 'online' && S.paid ? 'Booking paid' : 'Request sent') : 'Book ' + esc(t.name)) + '</b></header>';
    let body = '', foot = '';
    if (S.done) {
      body = '<div class="ab-sx-done"><h2>Thank you, ' + esc(S.guest.first) + '.</h2><p>Your request <b>' + esc(S.ref) + '</b> is with the hotel.</p>' +
        '<p>' + (S.pay.mode === 'online' ? (S.paid ? 'Your payment of <b>' + RS(T.dueOnline) + '</b> went through. The hotel will confirm your room by call or message.' : 'Your request is saved, but the payment of <b>' + RS(T.dueOnline) + '</b> was not completed. <button type="button" class="ab-btn ab-btn-solid" data-sx="payagain">Pay now</button> — or the hotel will call you.') : S.pay.mode === 'upi' ? 'The hotel will check your payment of <b>' + RS(T.due) + '</b> and confirm your room by call or message.' : 'The hotel will confirm your room by call or message. You pay at the hotel.') + '</p>' +
        '<div class="ab-sx-card"><b>' + esc(t.name) + '</b><span>' + esc(fmt(q.ci)) + ' → ' + esc(fmt(q.co)) + ' · ' + q.nights + ' night' + (q.nights > 1 ? 's' : '') + '</span><span>Total ' + RS(T.total) + ' incl. taxes</span></div></div>';
      foot = '<button type="button" class="ab-btn ab-btn-solid ab-sx-go" data-sx="close">Done</button>';
    } else if (S.step === 1) {
      const lft = Math.min(t.left, 5), rooms = []; for (let i = 1; i <= lft; i++) rooms.push('<option value="' + i + '"' + (i === S.rooms ? ' selected' : '') + '>' + i + (i > 1 ? ' rooms' : ' room') + '</option>');
      body = stepsBar(1) + '<div class="ab-sx-card"><div class="ab-sx-hot">' + (S.img ? '<img src="' + esc(S.img) + '" alt="">' : '') + '<div><b>' + esc(t.name) + '</b><span>' + [t.size ? t.size + ' m²' : '', 'Sleeps ' + t.capacity, t.bed].filter(Boolean).map(esc).join(' · ') + '</span></div></div>' +
        '<div class="ab-sx-dates"><div><small>Check-in</small><b>' + esc(fmt(q.ci)) + '</b></div><div><small>Check-out</small><b>' + esc(fmt(q.co)) + '</b></div><div><small>Stay</small><b>' + q.nights + ' night' + (q.nights > 1 ? 's' : '') + '</b></div></div>' +
        (t.amenities && t.amenities.length ? '<ul class="ab-rm-am">' + t.amenities.map(a => '<li><i class="ab-am-i" aria-hidden="true">' + (root.Amenities ? root.Amenities.svg(a, 16) : '') + '</i>' + esc(a) + '</li>').join('') + '</ul>' : '') + cancelLine(S) + '</div>' +
        '<label class="ab-sx-row"><span>Rooms</span><select data-sx-rooms>' + rooms.join('') + '</select></label>' +
        '<div class="ab-sx-card ab-sx-price"><h3>Price details</h3>' +
        (T.off > 0 ? '<div><span>Original price (' + S.rooms + ' room × ' + q.nights + ' night' + (q.nights > 1 ? 's' : '') + ')</span><s>' + RS(T.rack) + '</s></div><div class="g"><span>Hotel offer</span><span>−' + RS(T.off) + '</span></div>' : '') +
        '<div><span>Room price' + (T.off > 0 ? ' after offer' : ' (' + S.rooms + ' room × ' + q.nights + ' night' + (q.nights > 1 ? 's' : '') + ')') + '</span><span>' + RS(T.sub) + '</span></div>' +
        '<div><span>Taxes and fees (GST ' + t.gst_pct + '%)</span><span>' + RS(T.tax) + '</span></div><div class="tot"><span>Total</span><span>' + RS(T.total) + '</span></div></div>';
      foot = '<div class="ab-sx-sum"><small>Total</small><b>' + RS(T.total) + '</b></div><button type="button" class="ab-btn ab-btn-solid ab-sx-go" data-sx="next">Next: guest details</button>';
    } else if (S.step === 2) {
      const g = S.guest, rq = S.reqs, ph = g.phone || '';
      body = stepsBar(2) + '<form class="ab-sx-form" novalidate><h3>Who’s the lead guest?</h3><p class="ab-sx-req">* Required</p>' +
        '<label class="ab-fld"><span>First name *</span><input name="first" maxlength="40" autocomplete="given-name" value="' + esc(g.first || '') + '"></label>' +
        '<label class="ab-fld"><span>Last name *</span><input name="last" maxlength="40" autocomplete="family-name" value="' + esc(g.last || '') + '"></label>' +
        '<label class="ab-fld full"><span>Email</span><input name="email" type="email" maxlength="120" autocomplete="email" value="' + esc(g.email || '') + '"></label>' +
        '<label class="ab-fld full"><span>Country or region</span><select name="cc">' + COUNTRIES.map(c => '<option value="' + c[0] + '|' + c[1] + '"' + ((g.cc || '+91|India') === c[0] + '|' + c[1] ? ' selected' : '') + '>' + c[1] + (c[0] ? ' (' + c[0] + ')' : '') + '</option>').join('') + '</select></label>' +
        '<label class="ab-fld full"><span>Mobile number *</span><input name="phone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel-national" value="' + esc(ph) + '"></label>' +
        '<p class="ab-sx-help full">We use this to send your booking details and to call you if the hotel needs to check anything.</p>' +
        '<h3 class="full">Requests for the hotel</h3><p class="ab-sx-help full">Passed on to the hotel. They try their best but can’t promise.</p>' +
        '<fieldset class="full"><legend>Room type</legend><label><input type="radio" name="smoke" value="Non-smoking room"' + (rq.smoke === 'Non-smoking room' ? ' checked' : '') + '> Non-smoking room</label><label><input type="radio" name="smoke" value="Smoking room"' + (rq.smoke === 'Smoking room' ? ' checked' : '') + '> Smoking room</label></fieldset>' +
        '<fieldset class="full"><legend>Bed setup</legend><label><input type="radio" name="bed" value="Large bed"' + (rq.bed === 'Large bed' ? ' checked' : '') + '> Large bed</label><label><input type="radio" name="bed" value="Twin beds"' + (rq.bed === 'Twin beds' ? ' checked' : '') + '> Twin beds</label></fieldset>' +
        '<label class="ab-fld full"><span>Anything else</span><textarea name="note" rows="2" maxlength="300" placeholder="Late arrival, extra bed…">' + esc(rq.note || '') + '</textarea></label></form><p class="ab-book-msg ab-sx-msg" role="alert"></p>';
      foot = '<div class="ab-sx-sum"><small>Total</small><b>' + RS(T.total) + '</b></div><button type="button" class="ab-btn ab-btn-solid ab-sx-go" data-sx="next">Next: payment</button>';
    } else {
      const online = !!(ps.upi && ps.advance_pct), card = !!ps.online, mode = S.pay.mode || (card ? 'online' : online ? 'upi' : 'hotel'); S.pay.mode = mode;
      const upiLink = 'upi://pay?pa=' + encodeURIComponent(ps.upi || '') + '&pn=' + encodeURIComponent(ps.payee || '') + '&am=' + T.due + '&cu=INR&tn=' + encodeURIComponent('Room booking');
      body = stepsBar(3) + '<div class="ab-sx-pay">' +
        (card ? '<label class="ab-sx-opt' + (mode === 'online' ? ' on' : '') + '"><input type="radio" name="pm" value="online"' + (mode === 'online' ? ' checked' : '') + '><span><b>Pay ' + (ps.online_pct >= 100 ? 'in full' : (ps.online_pct + '%')) + ' now — UPI, card or net banking</b><small>' + RS(T.dueOnline) + ' now' + (ps.online_pct >= 100 ? '' : ', the rest at the hotel') + '. Confirmed the moment it goes through.</small></span></label>' : '') +
        (online ? '<label class="ab-sx-opt' + (mode === 'upi' ? ' on' : '') + '"><input type="radio" name="pm" value="upi"' + (mode === 'upi' ? ' checked' : '') + '><span><b>Pay ' + ps.advance_pct + '% now by UPI</b><small>' + RS(T.due) + ' now, the rest at the hotel</small></span></label>' : '') +
        (((!online && !card) || ps.at_hotel) ? '<label class="ab-sx-opt' + (mode === 'hotel' ? ' on' : '') + '"><input type="radio" name="pm" value="hotel"' + (mode === 'hotel' ? ' checked' : '') + '><span><b>Pay at the hotel</b><small>Nothing to pay now. The hotel confirms by call.</small></span></label>' : '') +
        (mode === 'upi' ? '<div class="ab-sx-card"><ol class="ab-sx-how"><li>Pay <b>' + RS(T.due) + '</b> to <b class="ab-sx-upi">' + esc(ps.upi) + '</b>' + (ps.payee ? ' (' + esc(ps.payee) + ')' : '') + ' <button type="button" class="ab-sx-copy" data-sx="copy" data-v="' + esc(ps.upi) + '">Copy</button></li><li>Come back here and enter the UPI reference number, or attach a screenshot of the payment.</li></ol>' +
          '<a class="ab-btn ab-sx-app" href="' + esc(upiLink) + '">Open my UPI app</a>' +
          '<label class="ab-fld full"><span>UPI reference (UTR) number</span><input name="utr" inputmode="numeric" maxlength="30" placeholder="12-digit number from your UPI app" value="' + esc(S.pay.utr || '') + '"></label>' +
          '<div class="ab-sx-file"><button type="button" class="ab-btn" data-sx="file">' + (S.pay.proofId ? 'Replace screenshot' : 'Attach payment screenshot') + '</button><input type="file" accept="image/*" hidden data-sx-file>' + (S.pay.proofId ? '<span class="ab-sx-ok">Screenshot attached</span>' : '') + '</div>' +
          '<p class="ab-sx-help">The hotel checks your payment before confirming. If it can’t find it, they’ll call you.</p></div>' : '') +
        '<div class="ab-sx-card ab-sx-price"><div><span>' + esc(t.name) + ' · ' + q.nights + ' night' + (q.nights > 1 ? 's' : '') + '</span><span>' + RS(T.sub) + '</span></div><div><span>GST ' + t.gst_pct + '%</span><span>' + RS(T.tax) + '</span></div><div class="tot"><span>Total</span><span>' + RS(T.total) + '</span></div></div>' + cancelLine(S) + '</div><p class="ab-book-msg ab-sx-msg" role="alert"></p>';
      foot = '<div class="ab-sx-sum"><small>' + (mode === 'upi' || mode === 'online' ? 'Paying now' : 'Pay at hotel') + '</small><b>' + RS(mode === 'upi' ? T.due : mode === 'online' ? T.dueOnline : 0) + '</b></div><button type="button" class="ab-btn ab-btn-solid ab-sx-go" data-sx="send">' + (mode === 'online' ? 'Pay ' + RS(T.dueOnline) + ' &amp; book' : 'Send booking request') + '</button>';
    }
    el.innerHTML = head + '<div class="ab-sx-b">' + body + '</div><footer class="ab-sx-f">' + foot + '</footer>';
    const b = el.querySelector('.ab-sx-b'); if (b) b.scrollTop = 0;
  }
  function readStep(el) {
    const S = el.__S, f = el.querySelector('.ab-sx-form'), msg = el.querySelector('.ab-sx-msg');
    if (S.step === 2 && f) {
      const v = n => String(f.elements[n] && f.elements[n].value || '').trim(), r = n => { const x = f.querySelector('[name=' + n + ']:checked'); return x ? x.value : ''; };
      S.guest = { first: v('first'), last: v('last'), email: v('email'), cc: v('cc'), phone: v('phone') };
      S.reqs = { smoke: r('smoke'), bed: r('bed'), note: v('note') };
      if (!S.guest.first || !S.guest.last) { say(msg, 'Please enter the lead guest’s first and last name.', 'bad'); return false; }
      if (S.guest.phone.replace(/\D/g, '').length < 7) { say(msg, 'Please enter a mobile number we can reach you on.', 'bad'); return false; }
      if (S.guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.guest.email)) { say(msg, 'That email doesn’t look right.', 'bad'); return false; }
    }
    return true;
  }
  async function sendBooking(el) {
    const S = el.__S, sec = el.__sec, msg = el.querySelector('.ab-sx-msg'), btn = el.querySelector('[data-sx=send]');
    const u = el.querySelector('input[name=utr]'); if (u) S.pay.utr = u.value.trim();
    const utr = String(S.pay.utr || '').replace(/[^A-Za-z0-9]/g, '');
    if (S.pay.mode === 'upi' && utr.length < 8 && !S.pay.proofId) return say(msg, 'Add the UPI reference number or attach a screenshot of your payment.', 'bad');
    const g = S.guest, cc = String(g.cc || '+91|India').split('|'), q = S.q;
    const body = { kind: 'room', name: (g.first + ' ' + g.last).trim(), phone: (cc[0] ? cc[0] + ' ' : '') + g.phone, email: g.email || null, country: cc[1] || null,
      note: S.reqs.note || null, requests: [S.reqs.smoke, S.reqs.bed].filter(Boolean),
      room: { type_id: S.t.id, ci: q.ci, co: q.co, adults: q.adults, rooms: S.rooms },
      pay: S.pay.mode === 'upi' ? { mode: 'upi', utr: utr || null, proof_id: S.pay.proofId || null } : S.pay.mode === 'online' ? { mode: 'online' } : { mode: 'hotel' } };
    btn.disabled = true; say(msg, 'Sending…');
    try {
      const r = await api(ENQ(S.cafe), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      S.ref = r.ref; S.done = true; if (sec.__cache) sec.__cache = {};
      if (r.online) { S.order = r.online; drawSheet(el); return void payOnline(el); }
      drawSheet(el);
    } catch (e) { btn.disabled = false; say(msg, e.message || 'Couldn’t send — please call the hotel.', 'bad'); }
  }
  /* Razorpay Checkout, using the HOTEL's own key (the server hands us its public Key ID and the order). The secret never reaches this page. */
  function loadRzp() {
    return new Promise((res, rej) => {
      if (root.Razorpay) return res();
      const sc = doc.createElement('script'); sc.src = 'https://checkout.razorpay.com/v1/checkout.js'; sc.onload = () => res(); sc.onerror = () => rej(new Error('Couldn’t load the payment window — check your connection.'));
      doc.head.appendChild(sc);
    });
  }
  async function payOnline(el) {
    const S = el.__S, o = S.order; if (!o) return;
    try { await loadRzp(); } catch (e) { return void say(el.querySelector('.ab-sx-msg'), e.message, 'bad'); }
    const g = S.guest || {};
    const rz = new root.Razorpay({
      key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency || 'INR', name: o.name || 'Hotel', description: 'Room booking ' + S.ref,
      prefill: { name: ((g.first || '') + ' ' + (g.last || '')).trim(), email: g.email || '', contact: g.phone || '' },
      handler: async resp => {
        try {
          await api('/order/cafe/' + S.cafe + '/hotel/enquiry/' + encodeURIComponent(S.ref) + '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }) });
          S.paid = true;
        } catch (e) { S.paid = false; S.verifyErr = e.message; }
        drawSheet(el);
      },
      modal: { ondismiss: () => { if (!S.paid) drawSheet(el); } },
      theme: { color: '#12905A' },
    });
    rz.open();
  }
  function shrink(file) {
    return new Promise((res, rej) => {
      const fr = new root.FileReader(); fr.onerror = rej;
      fr.onload = () => { const im = new root.Image(); im.onerror = rej; im.onload = () => {
        const sc = Math.min(1, 1000 / Math.max(im.width, im.height)), cv = doc.createElement('canvas'); cv.width = Math.max(1, Math.round(im.width * sc)); cv.height = Math.max(1, Math.round(im.height * sc));
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        let qq = .7, out = cv.toDataURL('image/jpeg', qq); while (out.length * .75 > 400000 && qq > .3) { qq -= .1; out = cv.toDataURL('image/jpeg', qq); } res(out);
      }; im.src = fr.result; };
      fr.readAsDataURL(file);
    });
  }
  doc.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-sx]'); if (!t) { if (e.target.classList && e.target.classList.contains('ab-sx')) closeSheet(e.target.parentNode); return; }
    const el = t.closest('.ab-sx'); if (!el) return; const S = el.__S, a = t.dataset.sx;
    if (a === 'close' || (a === 'back' && (S.step === 1 || S.done))) return closeSheet(el.parentNode);
    if (a === 'back') { readStep(el); S.step--; return drawSheet(el); }
    if (a === 'next') { if (!readStep(el)) return; S.step++; return drawSheet(el); }
    if (a === 'send') return void sendBooking(el);
    if (a === 'payagain') return void payOnline(el);
    if (a === 'copy') { try { root.navigator.clipboard.writeText(t.dataset.v); t.textContent = 'Copied'; } catch (x) { /* */ } return; }
    if (a === 'file') { const fi = el.querySelector('[data-sx-file]'); if (fi) fi.click(); }
  });
  doc.addEventListener('change', async e => {
    const el = e.target.closest && e.target.closest('.ab-sx'); if (!el) return; const S = el.__S;
    if (e.target.hasAttribute('data-sx-rooms')) { S.rooms = Number(e.target.value) || 1; return drawSheet(el); }
    if (e.target.name === 'pm') { const u = el.querySelector('input[name=utr]'); if (u) S.pay.utr = u.value; S.pay.mode = e.target.value; return drawSheet(el); }
    if (e.target.hasAttribute('data-sx-file') && e.target.files && e.target.files[0]) {
      const msg = el.querySelector('.ab-sx-msg'), file = e.target.files[0]; const u = el.querySelector('input[name=utr]'); if (u) S.pay.utr = u.value;
      say(msg, 'Uploading screenshot…');
      try { const data = await shrink(file); const r = await api('/order/cafe/' + S.cafe + '/hotel/proof', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: data }) }); S.pay.proofId = r.id; drawSheet(el); }
      catch (x) { say(msg, x.message || 'Couldn’t upload that image — enter the reference number instead.', 'bad'); }
    }
  });
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') { const el = doc.querySelector('.ab-sx'); if (el) closeSheet(el.parentNode); } });

  /* ---------------------------------------------------------------- banquet */
  const SL = { morning: 'Morning', evening: 'Evening', full: 'Full day' };
  async function hallOpen(btn) {
    const card = btn.closest('.ab-hl'), cal = card.querySelector('.ab-hl-cal');
    if (!cal.hidden) { cal.hidden = true; return; }
    cal.hidden = false;
    if (!cal.__m) { cal.__m = today().slice(0, 7); cal.__sel = null; cal.__slot = null; }
    await drawCal(card);
  }
  async function monthData(sec, m) {
    sec.__cache = sec.__cache || {};
    if (sec.__cache[m]) return sec.__cache[m];
    const first = m + '-01', t = today(), start = first < t ? t : first;
    const p = m.split('-').map(Number), dim = new Date(p[0], p[1], 0).getDate();
    const days = dim - (parse(start).getDate() - 1);
    const d = await api('/order/cafe/' + sec.dataset.cafe + '/hotel/banquet?start=' + start + '&days=' + Math.max(1, Math.min(92, days)));
    sec.__cache[m] = d; return d;
  }
  async function drawCal(card) {
    const sec = card.closest('.ab-t-banquet'), cal = card.querySelector('.ab-hl-cal'), m = cal.__m;
    cal.innerHTML = '<p class="ab-fine">Loading dates…</p>';
    let data; try { data = await monthData(sec, m); } catch (e) { cal.innerHTML = '<p class="ab-book-msg bad">' + esc(e.message || 'Couldn’t load the calendar — please call us.') + '</p>'; return; }
    const hall = (data.halls || []).filter(h => h.id === card.dataset.hall)[0]; if (!hall) { cal.innerHTML = '<p class="ab-fine">Not available online — please call us.</p>'; return; }
    const p = m.split('-').map(Number), first = new Date(p[0], p[1] - 1, 1), dim = new Date(p[0], p[1], 0).getDate(), lead = (first.getDay() + 6) % 7, t = today();
    let g = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => '<span class="ab-cal-w">' + x + '</span>').join('');
    for (let i = 0; i < lead; i++) g += '<span></span>';
    for (let d = 1; d <= dim; d++) {
      const day = m + '-' + p2(d), busy = hall.busy[day] || [], past = day < t, fullDay = busy.length >= 2;
      g += '<button type="button" class="ab-cal-d' + (past ? ' past' : '') + (fullDay ? ' full' : '') + (cal.__sel === day ? ' sel' : '') + '" data-hotel="cal-day" data-day="' + day + '"' + (past || fullDay ? ' disabled' : '') + ' aria-label="' + day + (fullDay ? ' fully booked' : busy.length ? ' partly booked' : ' free') + '"><span>' + d + '</span><i class="' + (busy.indexOf('morning') >= 0 ? 'on' : '') + '"></i><i class="' + (busy.indexOf('evening') >= 0 ? 'on' : '') + '"></i></button>';
    }
    const busyNow = cal.__sel ? (hall.busy[cal.__sel] || []) : [];
    const slotBtn = sl => { const dis = sl === 'full' ? busyNow.length > 0 : busyNow.indexOf(sl) >= 0; return '<button type="button" data-hotel="slot" data-slot="' + sl + '"' + (dis ? ' disabled' : '') + (cal.__slot === sl ? ' class="sel"' : '') + '>' + SL[sl] + '</button>'; };
    cal.innerHTML = '<div class="ab-cal-h"><button type="button" data-hotel="cal-move" data-v="-1" ' + (m <= today().slice(0, 7) ? 'disabled' : '') + '>‹</button><b>' + first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) + '</b><button type="button" data-hotel="cal-move" data-v="1">›</button></div>' +
      '<div class="ab-cal-g">' + g + '</div><div class="ab-cal-k"><span>Free</span><span class="b">Taken</span><em style="font-style:normal">left bar = morning · right bar = evening</em></div>' +
      (cal.__sel ? '<b>' + parse(cal.__sel).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) + '</b><div class="ab-slots">' + slotBtn('morning') + slotBtn('evening') + slotBtn('full') + '</div>' : '<p class="ab-fine">Tap a free day to choose a slot.</p>') +
      (cal.__sel && cal.__slot ? '<form class="ab-ask" data-kind="banquet" style="margin-top:8px"><b class="ab-ask-t">' + esc(hall.name) + ' · ' + SL[cal.__slot] + '</b>' +
        '<label class="ab-fld"><span>Your name</span><input name="name" maxlength="60" autocomplete="name" required></label><label class="ab-fld"><span>Phone</span><input name="phone" type="tel" maxlength="20" autocomplete="tel" inputmode="tel" required></label>' +
        '<label class="ab-fld"><span>Guests</span><input name="guests" type="number" min="1" max="' + (hall.capacity || 5000) + '" value="100"></label>' +
        '<label class="ab-fld"><span>Event</span><select name="event"><option>Wedding</option><option>Reception</option><option>Engagement</option><option>Birthday</option><option>Corporate</option><option>Other</option></select></label>' +
        '<label class="ab-fld full"><span>Anything we should know?</span><textarea name="note" rows="2" maxlength="300"></textarea></label>' +
        '<button type="submit" class="ab-btn ab-btn-solid">Send request</button><p class="ab-book-msg ab-ask-msg" role="status" aria-live="polite"></p></form>' : '');
  }

  /* ---------------------------------------------------------------- send */
  async function sendAsk(form) {
    const sec = form.closest('.ab-t-rooms, .ab-t-banquet'), cal = form.closest('.ab-hl-cal'), msg = form.querySelector('.ab-ask-msg'), btn = form.querySelector('button[type=submit]');
    const v = n => (form.elements[n] ? String(form.elements[n].value || '').trim() : '');
    if (!v('name')) return say(msg, 'Please tell us your name.', 'bad');
    if (v('phone').replace(/\D/g, '').length < 8) return say(msg, 'Please enter a phone number we can reach you on.', 'bad');
    const body = { kind: form.dataset.kind, name: v('name'), phone: v('phone'), email: v('email') || null, note: v('note') || null };
    { const card = form.closest('.ab-hl'); body.banquet = { hall_id: card.dataset.hall, date: cal.__sel, slot: cal.__slot, guests: Number(v('guests')) || 50, event: v('event') }; }
    btn.disabled = true; say(msg, 'Sending…');
    try {
      const r = await api(ENQ(sec.dataset.cafe), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      say(msg, 'Request sent ✓  Ref ' + r.ref + '. The hotel will call you soon to confirm.', 'ok');
      if (sec.__cache) sec.__cache = {};
    } catch (e) { btn.disabled = false; say(msg, e.message || 'Couldn’t send — please call us.', 'bad'); if (e.status === 409 && cal) { sec.__cache = {}; cal.__slot = null; } }
  }

  /* ---------------------------------------------------------------- details sheet: room / facilities, with a side-scroll row of other rooms */
  const AMI = (a, px) => '<i class="ab-am-i" aria-hidden="true">' + (root.Amenities ? root.Amenities.svg(a, px || 18) : '') + '</i>';
  function closeDetail() { doc.querySelectorAll('.ab-dt').forEach(x => x.remove()); if (!doc.querySelector('.ab-sx,.ab-dt')) doc.documentElement.classList.remove('ab-sx-open'); }
  function openDetail(btn, tab) {
    const sec = btn.closest('.ab-t-rooms'); if (!sec) return;
    let det; try { det = JSON.parse(sec.dataset.det || '{}'); } catch (e) { return; }
    const card = btn.closest('.ab-rm'), ab = sec.closest('.ab') || doc.body; closeDetail();
    const d = doc.createElement('div'); d.className = 'ab-dt'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.__det = det; d.__sec = sec; d.__tab = tab; d.__tid = card ? card.dataset.type : ((det.types[0] || {}).id);
    ab.appendChild(d); doc.documentElement.classList.add('ab-sx-open'); drawDetail(d);
    const x = d.querySelector('.ab-dt-x'); if (x) x.focus();
  }
  function amGroups(list, kind) {
    const g = root.Amenities ? root.Amenities.group(list, kind) : [['Amenities', list]];
    return g.map(r => '<section class="ab-dt-g"><h4>' + esc(r[0]) + '</h4><ul>' + r[1].map(a => '<li>' + AMI(a, 20) + esc(a) + '</li>').join('') + '</ul></section>').join('');
  }
  function drawDetail(d) {
    const det = d.__det, types = det.types || [], t = types.find(x => x.id === d.__tid) || types[0] || {}, tab = d.__tab === 'fac' && det.fac.length ? 'fac' : 'room';
    const tabs = '<nav class="ab-dt-tabs" role="tablist"><button type="button" role="tab" data-hotel="det-tab" data-v="room" aria-selected="' + (tab === 'room') + '">Room</button>' +
      (det.fac.length ? '<button type="button" role="tab" data-hotel="det-tab" data-v="fac" aria-selected="' + (tab === 'fac') + '">Hotel facilities</button>' : '') + '</nav>';
    let body;
    if (tab === 'fac') body = '<h3 class="ab-dt-t">Hotel facilities</h3>' + amGroups(det.fac, 'property');
    else {
      const facts = [t.size ? t.size + ' m²' : '', 'Sleeps ' + (t.cap || 2), t.bed || ''].filter(Boolean).map(f => '<span>' + esc(f) + '</span>').join('');
      body = (t.img ? '<img class="ab-dt-img" src="' + esc(t.img) + '" alt="">' : '') + '<h3 class="ab-dt-t">' + esc(t.name) + '</h3><p class="ab-rm-facts">' + facts + '</p>' +
        (t.desc ? '<p class="ab-rm-meta">' + esc(t.desc) + '</p>' : '') + (t.text ? '<p class="ab-rm-txt">' + esc(t.text) + '</p>' : '') +
        (t.am.length ? '<h4 class="ab-dt-h">Room amenities</h4>' + amGroups(t.am, 'room') : '<p class="ab-rm-meta">The hotel hasn’t listed amenities for this room yet.</p>');
      const others = types.filter(x => x.id !== t.id);
      if (others.length) body += '<h4 class="ab-dt-h">Other rooms</h4><div class="ab-dt-rail" tabindex="0">' + others.map(o => '<button type="button" class="ab-dt-rc" data-hotel="det-pick" data-id="' + esc(o.id) + '">' + (o.img ? '<img src="' + esc(o.img) + '" alt="" loading="lazy">' : '<span class="ab-dt-ph"></span>') + '<b>' + esc(o.name) + '</b><span>' + RS(o.rate) + ' <small>/ night</small></span></button>').join('') + '</div>';
    }
    d.innerHTML = '<header class="ab-sx-h"><button type="button" class="ab-sx-x ab-dt-x" data-hotel="det-x" aria-label="Close">&#10005;</button><b>' + esc(tab === 'fac' ? 'Hotel facilities' : t.name || 'Room') + '</b></header>' + tabs +
      '<div class="ab-dt-b">' + body + '</div>' +
      (tab === 'room' ? '<footer class="ab-sx-f"><div class="ab-sx-sum"><small>from</small><b>' + RS(t.rate) + '</b><small>per night</small></div><button type="button" class="ab-btn ab-btn-solid ab-sx-go" data-hotel="det-book">Choose dates &amp; book</button></footer>' : '');
  }
  function detBook(btn) {
    const d = btn.closest('.ab-dt'), sec = d.__sec, id = d.__tid; closeDetail();
    const go = sec.querySelector('.ab-rm[data-type="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] .ab-rm-go');
    if (go && !go.disabled) { go.click(); return; }
    const f = sec.querySelector('.ab-rm-search input'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.focus({ preventScroll: true }); }
  }
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && doc.querySelector('.ab-dt')) closeDetail(); });

  /* ---------------------------------------------------------------- wiring */
  doc.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-hotel]'); if (!t || !live(t)) return;
    const a = t.dataset.hotel;
    if (a === 'det-room' || a === 'det-fac') return void openDetail(t, a === 'det-fac' ? 'fac' : 'room');
    if (a === 'det-x') return closeDetail();
    if (a === 'det-tab') { const d = t.closest('.ab-dt'); d.__tab = t.dataset.v; return drawDetail(d); }
    if (a === 'det-pick') { const d = t.closest('.ab-dt'); d.__tid = t.dataset.id; d.__tab = 'room'; drawDetail(d); const b = d.querySelector('.ab-dt-b'); if (b) b.scrollTop = 0; return; }
    if (a === 'det-book') return void detBook(t);
    if (a === 'am-more') { const ul = t.closest('ul'), rest = ul && ul.nextElementSibling; if (rest && rest.classList.contains('ab-am-rest')) { rest.hidden = !rest.hidden; t.textContent = rest.hidden ? '+' + rest.children.length + ' more' : 'Show less'; } return; }
    if (a === 'room-ask') return roomAsk(t);
    if (a === 'hall-open') return void hallOpen(t);
    const card = t.closest('.ab-hl'), cal = t.closest('.ab-hl-cal');
    if (!card || !cal) return;
    if (a === 'cal-move') { const p = cal.__m.split('-').map(Number), d = new Date(p[0], p[1] - 1 + Number(t.dataset.v), 1); cal.__m = d.getFullYear() + '-' + p2(d.getMonth() + 1); cal.__sel = cal.__slot = null; drawCal(card); }
    else if (a === 'cal-day') { cal.__sel = t.dataset.day; cal.__slot = null; drawCal(card); }
    else if (a === 'slot') { cal.__slot = t.dataset.slot; drawCal(card); }
  });
  doc.addEventListener('submit', e => {
    const f = e.target; if (!f || !f.classList || !live(f)) return;
    if (f.classList.contains('ab-rm-search')) { e.preventDefault(); check(f.closest('.ab-t-rooms')); }
    else if (f.classList.contains('ab-ask')) { e.preventDefault(); sendAsk(f); }
  });
  function scan() { doc.querySelectorAll('.ab-t-rooms').forEach(roomsInit); }
  new root.MutationObserver(() => scan()).observe(doc.documentElement, { childList: true, subtree: true });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', scan); else scan();
})(typeof window !== 'undefined' ? window : globalThis);
