/* bill-design.js — the bill, built once, printed anywhere.
 *
 * Plain <script>, no build step. Attaches window.BillDesign.
 *
 * One function (model) turns a bill + the owner's saved design into a list of blocks
 * (text, rule, row, item columns, QR). Four things then draw those same blocks, so what the owner
 * sees in the designer is exactly what comes out of the printer:
 *   toText    - monospace preview
 *   toHtml    - the on-screen preview and the browser print page
 *   toEscpos  - bytes for the thermal printer (58 mm = 2 inch, 80 mm = 3 inch)
 *
 * Every line on the bill is optional. A detail the owner leaves blank, or switches off, is simply not printed.
 * The UPI QR carries the exact amount, so the customer's PhonePe / GPay opens with it already filled in.
 */
(function (root) {
  'use strict';

  /* ---------- the design the owner can edit ---------- */
  const SHOW_DEFAULT = {
    bill_no: true, date: true, created_on: true, customer: true, table: true,
    item_count: true, qty_total: true, sub_total: true, discounts: true,
    tax_split: true,        // CGST + SGST lines (off: one "GST" line)
    tax_note: false,        // "Total includes GST of ..."
    pay_mode: true, received: false, loyalty: false,
    big_total: true, upi_qr: false, qr_hide_paid: false, feedback_qr: false, powered_by: false,
  };
  const TEXT_LIMITS = {
    legal_name: 60, address: 160, state_code: 30, gst_no: 20, fssai: 20, license_no: 30, cin: 30, phone: 30,
    service_line: 60, doc_title: 30, footer: 80, terms: 400,
    feedback_url: 120, feedback_caption: 40, upi_id: 60, upi_name: 40, qr_caption: 50,
  };
  const SHOW_KEYS = Object.keys(SHOW_DEFAULT);

  const clean1 = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

  /** Any saved profile (old or new) -> a complete, safe design. */
  function normalize(p) {
    p = p && typeof p === 'object' ? p : {};
    const out = { v: 2, layout: 'tax', paper: p.paper === '80' ? '80' : '58', show: {} };
    Object.keys(TEXT_LIMITS).forEach(k => {
      // terms keeps its line breaks; every other field is one line
      out[k] = k === 'terms'
        ? String(p[k] == null ? '' : p[k]).replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, TEXT_LIMITS[k])
        : clean1(p[k], TEXT_LIMITS[k]);
    });
    const s = p.show && typeof p.show === 'object' ? p.show : {};
    SHOW_KEYS.forEach(k => { out.show[k] = s[k] === undefined ? SHOW_DEFAULT[k] : !!s[k]; });
    return out;
  }

  /* ---------- small helpers ---------- */
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const m2 = n => r2(n).toFixed(2);
  const pad2 = n => String(n).padStart(2, '0');
  function fmtDate(d) { d = new Date(d); return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2); }
  function fmtTime(d) { d = new Date(d); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return pad2(h) + ':' + pad2(d.getMinutes()) + ' ' + ap; }
  const pctText = p => (Math.round(p * 100) / 100) + '%';
  const payName = m => ({ cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other', online: 'Online' }[m] || (m ? String(m).charAt(0).toUpperCase() + String(m).slice(1) : 'Payment'));

  /** Thermal printer fonts are plain ASCII: drop accents and swap the symbols they do not have. */
  function ascii(s) {
    return String(s == null ? '' : s).replace(/₹/g, 'Rs ').replace(/[·•–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
  }
  function wrap(t, w) {
    const out = []; let cur = '';
    String(t || '').split(/\s+/).filter(Boolean).forEach(word => {
      while (word.length > w) { if (cur) { out.push(cur); cur = ''; } out.push(word.slice(0, w)); word = word.slice(w); }
      if (!cur) cur = word; else if ((cur + ' ' + word).length <= w) cur += ' ' + word; else { out.push(cur); cur = word; }
    });
    if (cur) out.push(cur);
    return out;
  }

  /* ---------- the numbers ---------- */
  /* When the bill has only GST (no discount, service charge, packaging or points) each line's Total includes its
     GST - exactly like the eZo / restaurant bills - and the lines add up to the bill total. Otherwise lines stay
     plain rate x qty and add up to the Sub Total. */
  function taxModel(bill) {
    const g = Number(bill.gst_percent) || 0, gst = Number(bill.gst_amount) || 0;
    const plain = !(Number(bill.discount_amount) || Number(bill.service_charge_amount) || Number(bill.packaging_fee_amount) || Number(bill.loyalty_points_used));
    const lines = (bill.items || []).map(i => ({ name: ascii(String(i.name || '').replace(/\s*·\s*/g, ' - ')), qty: Number(i.quantity) || 1, rate: Number(i.price_at_order) || 0 }));
    lines.forEach(l => { l.plain = r2(l.rate * l.qty); l.total = l.plain; });
    if (g > 0 && plain && lines.length) {
      const inc = lines.map(l => r2(l.plain * (1 + g / 100)));
      const diff = r2(Number(bill.total) - inc.reduce((a, b) => a + b, 0));
      if (Math.abs(diff) < 0.05) { inc[inc.length - 1] = r2(inc[inc.length - 1] + diff); lines.forEach((l, k) => { l.total = inc[k]; }); }
    }
    const cgst = r2(gst / 2), sgst = r2(gst - cgst);
    return { lines, g, half: g / 2, gst, cgst, sgst, hasGst: gst > 0 || g > 0,
      qtyTotal: lines.reduce((a, l) => a + l.qty, 0), itemCount: lines.length };
  }
  const paidSum = bill => (bill.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  /** What the customer still has to pay; the full total when nothing is recorded yet or it is already settled. */
  function amountDue(bill) {
    const total = r2(bill.total), due = r2(total - paidSum(bill));
    return due > 0.004 ? due : total;
  }

  /* ---------- UPI ---------- */
  const VPA_RE = /^[A-Za-z0-9._\-]{2,64}@[A-Za-z][A-Za-z0-9.\-]{1,30}$/;
  const validUpiId = v => VPA_RE.test(String(v || '').trim());
  /** upi://pay link. am= makes the payer's app show the amount already filled in. */
  function upiLink(prof, bill, amount) {
    const P = normalize(prof);
    if (!validUpiId(P.upi_id)) return '';
    const q = ['pa=' + encodeURIComponent(P.upi_id).replace(/%40/g, '@')];   // UPI apps expect the @ as it is
    if (P.upi_name) q.push('pn=' + encodeURIComponent(ascii(P.upi_name)));
    q.push('am=' + m2(amount), 'cu=INR');
    q.push('tn=' + encodeURIComponent(bill.bill_no ? 'Bill ' + bill.bill_no : 'Bill payment'));
    return 'upi://pay?' + q.join('&');
  }

  /* ---------- QR matrix ---------- */
  function qrLib() { return root.QRCode && root.document ? root.QRCode : null; }
  /** Rows of booleans (true = dark), or null when the QR library is not loaded. */
  function qrMatrix(text) {
    const Q = qrLib(); if (!Q || !text) return null;
    try {
      const host = root.document.createElement('div');
      const q = new Q(host, { text: String(text), width: 64, height: 64, correctLevel: Q.CorrectLevel ? Q.CorrectLevel.M : undefined });
      const m = q._oQRCode, n = m.getModuleCount(), rows = [];
      for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(!!m.isDark(r, c)); rows.push(row); }
      return rows;
    } catch (e) { return null; }
  }
  function qrSvg(text, px) {
    const mx = qrMatrix(text); if (!mx) return '';
    const n = mx.length, quiet = 2, size = n + quiet * 2;
    let d = '';
    mx.forEach((row, r) => { let c = 0; while (c < n) { if (row[c]) { let e = c; while (e < n && row[e]) e++; d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h' + (e - c) + 'v1h-' + (e - c) + 'z'; c = e; } else c++; } });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  /* ---------- the model: bill + design -> blocks ---------- */
  function model(bill, cafeName, prof) {
    const P = normalize(prof), S = P.show, W = P.paper === '80' ? 48 : 32;
    const t = taxModel(bill), B = [];
    const text = (s, o) => { if (s !== undefined && s !== null && s !== '') B.push(Object.assign({ k: 'text', s: ascii(s), align: 'left' }, o || {})); };
    const rule = () => B.push({ k: 'rule' });
    const row = (l, r, o) => B.push(Object.assign({ k: 'row', l: ascii(l), r: ascii(r) }, o || {}));

    // header
    if (cafeName) text(cafeName, { align: 'center', bold: true, big: 'h' });
    if (P.legal_name) text(P.legal_name, { align: 'center' });
    wrap(ascii(P.address), W).forEach(l => text(l, { align: 'center' }));
    if (P.state_code) text('State Code - ' + P.state_code, { align: 'center' });
    if (P.gst_no) text('GST Number: ' + P.gst_no, { align: 'center' });
    if (P.fssai) text('FSSAI Number: ' + P.fssai, { align: 'center' });
    if (P.license_no) text('License Number: ' + P.license_no, { align: 'center' });
    if (P.cin) text('CIN No.: ' + P.cin, { align: 'center' });
    if (P.phone) text('Phone: ' + P.phone, { align: 'center' });
    wrap(ascii(P.service_line), W).forEach(l => text(l, { align: 'center' }));
    if (P.doc_title) text(P.doc_title, { align: 'center', bold: true });
    rule();

    // who / when
    let meta = 0;
    if (S.bill_no && bill.bill_no) { text('Bill No: ' + bill.bill_no); meta++; }
    if (S.date && bill.paid_at) { text('Bill Date: ' + fmtDate(bill.paid_at)); meta++; }
    if (S.created_on && bill.first_order_at) { text('Created On: ' + fmtDate(bill.first_order_at) + ' ' + fmtTime(bill.first_order_at)); meta++; }
    if (S.customer && bill.customer_name) { wrap('Bill To: ' + ascii(bill.customer_name), W).forEach(l => text(l)); meta++; }
    if (S.table) { text(bill.table_label ? bill.table_label : (bill.table_number ? 'Table: ' + bill.table_number : 'Walk-in')); meta++; }
    if (meta) rule();

    // items
    B.push({ k: 'cols', head: true, c: ['Item Name', 'Qty', 'Rate', 'Total'] });
    t.lines.forEach(l => B.push({ k: 'cols', name: l.name, c: [l.name, String(l.qty), m2(l.rate), m2(l.total)] }));
    rule();

    // totals
    if (S.item_count) text('Total Items: ' + t.itemCount);
    if (S.qty_total) text('Total Quantity: ' + t.qtyTotal);
    if (S.sub_total) row('Sub Total', m2(bill.subtotal));
    if (S.discounts) {
      if (Number(bill.discount_amount)) row('Discount', '-' + m2(bill.discount_amount));
      if (Number(bill.service_charge_amount)) row('Service charge', m2(bill.service_charge_amount));
      if (Number(bill.packaging_fee_amount)) row('Packaging fee', m2(bill.packaging_fee_amount));
    }
    if (t.hasGst) {
      if (S.tax_split) { row('CGST (' + pctText(t.half) + ')', m2(t.cgst)); row('SGST (' + pctText(t.half) + ')', m2(t.sgst)); }
      else row('GST (' + pctText(t.g) + ')', m2(t.gst));
    }
    rule();
    if (S.big_total) B.push({ k: 'text', s: 'Total ' + m2(bill.total), align: 'center', bold: true, big: 'hw' });
    else row('Total', m2(bill.total), { bold: true });
    if (S.tax_note && t.hasGst) text('Total includes GST of ' + m2(t.gst), { align: 'center' });
    rule();

    // how it was paid
    if (S.pay_mode) (bill.payments || []).forEach(p => row(payName(p.method), m2(p.amount)));
    if (S.received && (bill.payments || []).length) row('Received', m2(paidSum(bill)));
    if (bill.credit && Number(bill.credit.amount)) { row('On credit', m2(bill.credit.amount)); text('(' + (bill.credit.name || 'pay later') + ')'); }
    if (S.loyalty && bill.customer_name && bill.loyalty_points_balance != null) {
      row(bill.loyalty_points_used ? 'Points used' : 'Points earned', bill.loyalty_points_used ? '-' + bill.loyalty_points_used : '+' + (bill.loyalty_points_earned || 0));
      row('Points balance', String(bill.loyalty_points_balance));
    }

    // footer: thank-you, terms, powered by
    const tail = [];
    if (P.footer) wrap(ascii(P.footer), W).forEach(l => tail.push({ k: 'text', s: l, align: 'center' }));
    if (P.terms) P.terms.split('\n').forEach(line => wrap(ascii(line), W).forEach(l => tail.push({ k: 'text', s: l, align: 'center', small: true })));
    if (S.powered_by) tail.push({ k: 'text', s: 'Powered by cheri', align: 'center', small: true });
    if (tail.length) { rule(); tail.forEach(x => B.push(x)); }

    // QR codes
    if (S.upi_qr && validUpiId(P.upi_id)) {
      const due = amountDue(bill), settled = paidSum(bill) >= r2(bill.total) - 0.004 && (bill.payments || []).length;
      if (due > 0 && !(S.qr_hide_paid && settled)) {
        B.push({ k: 'gap' });
        B.push({ k: 'qr', data: upiLink(P, bill, due) });
        text((P.qr_caption || 'Scan To Pay Rs. {amount} /-').replace(/\{amount\}/g, String(Math.round(due * 100) % 100 ? m2(due) : Math.round(due))), { align: 'center', bold: true });
      }
    }
    if (S.feedback_qr && /^https?:\/\//i.test(P.feedback_url)) {
      B.push({ k: 'gap' });
      if (P.feedback_caption) text(P.feedback_caption, { align: 'center' });
      B.push({ k: 'qr', data: P.feedback_url });
    }
    // never two rules in a row, and none at the very start or end
    const tidy = [];
    B.forEach(x => { if (x.k === 'rule' && (!tidy.length || tidy[tidy.length - 1].k === 'rule')) return; tidy.push(x); });
    while (tidy.length && tidy[tidy.length - 1].k === 'rule') tidy.pop();
    return { blocks: tidy, width: W, paper: P.paper };
  }

  /* ---------- drawing 1: plain text ---------- */
  const NAME_W = W => W - 18 - 3;   // Qty 3, Rate 7, Total 8, three spaces
  const colsLine = (W, a, b, c, d) => a.padEnd(NAME_W(W)).slice(0, NAME_W(W)) + ' ' + String(b).padStart(3) + ' ' + String(c).padStart(7) + ' ' + String(d).padStart(8);
  const rowLine = (W, l, r) => l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r;
  function pad(s, W, align) { const n = Math.max(0, W - s.length); return align === 'center' ? ' '.repeat(Math.floor(n / 2)) + s : s; }

  function toText(bill, cafeName, prof) {
    const M = model(bill, cafeName, prof), W = M.width, out = [];
    M.blocks.forEach(b => {
      if (b.k === 'rule') out.push('-'.repeat(W));
      else if (b.k === 'gap') out.push('');
      else if (b.k === 'text') {
        const w = b.big ? Math.floor(W / 2) : W;
        wrap(b.s, w).forEach(l => out.push(pad(b.big ? l : l, W, b.align)));
      }
      else if (b.k === 'row') out.push(rowLine(W, b.l, b.r));
      else if (b.k === 'cols') {
        if (b.head) { out.push(colsLine(W, b.c[0], b.c[1], b.c[2], b.c[3])); return; }
        const nm = wrap(b.name, NAME_W(W));
        out.push(colsLine(W, nm[0] || '', b.c[1], b.c[2], b.c[3]));
        nm.slice(1).forEach(x => out.push(x));
      }
      else if (b.k === 'qr') out.push(pad('[ QR code ]', W, 'center'));
    });
    return out.join('\n');
  }

  /* ---------- drawing 2: HTML (preview + browser print) ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PAPER_CSS = { '58': { mm: 58, ch: 32 }, '80': { mm: 80, ch: 48 } };

  function bodyHtml(bill, cafeName, prof) {
    const M = model(bill, cafeName, prof), parts = [];
    M.blocks.forEach(b => {
      if (b.k === 'rule') parts.push('<hr>');
      else if (b.k === 'gap') parts.push('<div class="gap"></div>');
      else if (b.k === 'text') parts.push('<div class="t ' + (b.align === 'center' ? 'c ' : '') + (b.bold ? 'b ' : '') + (b.big === 'hw' ? 'big ' : b.big === 'h' ? 'big1 ' : '') + (b.small ? 'sm' : '') + '">' + esc(b.s) + '</div>');
      else if (b.k === 'row') parts.push('<div class="r' + (b.bold ? ' b' : '') + '"><span>' + esc(b.l) + '</span><span>' + esc(b.r) + '</span></div>');
      else if (b.k === 'cols') parts.push('<div class="g' + (b.head ? ' b' : '') + '"><span class="nm">' + esc(b.c[0]) + '</span><span class="n">' + esc(b.c[1]) + '</span><span class="n">' + esc(b.c[2]) + '</span><span class="n">' + esc(b.c[3]) + '</span></div>');
      else if (b.k === 'qr') { const svg = qrSvg(b.data, 150); parts.push('<div class="qr">' + (svg || '<div class="sm c">[ QR code ]</div>') + '</div>'); }
    });
    return parts.join('');
  }
  /* The receipt is laid out in characters (32 on 2 inch paper, 48 on 3 inch) - the same grid the thermal printer
     uses - so what is on screen wraps exactly where the printed bill will. */
  const PAGE_CSS = paper => {
    const p = PAPER_CSS[paper] || PAPER_CSS['58'];
    return '.bd{font-family:ui-monospace,Menlo,Consolas,"Courier New",monospace;font-size:9.4px;line-height:1.4;color:#000;box-sizing:content-box;width:' + p.ch + 'ch;margin:0 auto}' +
      '.bd hr{border:none;border-top:1px dashed #000;margin:4px 0}.bd .t{white-space:pre-wrap;word-break:break-word}.bd .c{text-align:center}.bd .b{font-weight:700}' +
      '.bd .big{font-size:1.6em;line-height:1.25}.bd .big1{font-size:1.25em}.bd .sm{font-size:.9em}.bd .gap{height:6px}' +
      '.bd .r{display:flex;justify-content:space-between;gap:1ch}' +
      '.bd .g{display:grid;grid-template-columns:minmax(0,1fr) 3ch 7ch 8ch;column-gap:1ch}.bd .g .n{text-align:right;white-space:nowrap}.bd .g .nm{word-break:break-word}' +
      '.bd .qr{display:flex;justify-content:center;margin:4px 0}.bd .qr svg{width:' + (p.ch === 48 ? 190 : 150) + 'px;height:auto}';
  };
  /** The receipt as an HTML fragment plus its css - used by the designer's live preview. */
  function toHtml(bill, cafeName, prof) {
    const P = normalize(prof);
    return '<style>' + PAGE_CSS(P.paper) + '</style><div class="bd">' + bodyHtml(bill, cafeName, prof) + '</div>';
  }
  /** A complete page for the browser print dialog. */
  function printHtml(bill, cafeName, prof) {
    const P = normalize(prof), mm = (PAPER_CSS[P.paper] || PAPER_CSS['58']).mm;
    return '<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>@page{size:' + mm + 'mm auto;margin:0}html{width:' + mm + 'mm}body{margin:0;padding:2mm 0}' +
      PAGE_CSS(P.paper) + '</style></head><body><div class="bd">' + bodyHtml(bill, cafeName, prof) + '</div></body></html>';
  }

  /* ---------- drawing 3: thermal printer bytes ---------- */
  const ESC = 0x1b, GS = 0x1d;
  function bytesOf(str) { const o = []; for (let i = 0; i < str.length; i++) o.push(str.charCodeAt(i) & 0x7f); return o; }

  /** GS v 0 raster of the QR, centred in a full-width canvas so it prints centred on every printer. */
  function qrRaster(mx, dots) {
    const n = mx.length, quiet = 2, size = n + quiet * 2;
    const scale = Math.max(2, Math.min(6, Math.floor(Math.min(dots, 300) / size)));
    const px = size * scale, w = Math.ceil(dots / 8) * 8, left = Math.floor((w - px) / 2), wb = w / 8;
    const out = new Uint8Array(wb * px);
    for (let y = 0; y < px; y++) {
      const mr = Math.floor(y / scale) - quiet;
      if (mr < 0 || mr >= n) continue;
      for (let x = 0; x < px; x++) {
        const mc = Math.floor(x / scale) - quiet;
        if (mc < 0 || mc >= n || !mx[mr][mc]) continue;
        const gx = left + x; out[y * wb + (gx >> 3)] |= 0x80 >> (gx & 7);
      }
    }
    return { bytes: out, wb, h: px };
  }
  /** Printer's own QR command (GS ( k) - used only when the QR library could not load. */
  function nativeQr(data) {
    const d = bytesOf(data), len = d.length + 3;
    return [].concat([GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0], [GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6], [GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31],
      [GS, 0x28, 0x6b, len & 255, len >> 8, 0x31, 0x50, 0x30], d, [GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]);
  }

  function toEscpos(bill, cafeName, prof) {
    const M = model(bill, cafeName, prof), W = M.width, dots = M.paper === '80' ? 576 : 384, c = [];
    const put = a => { for (let i = 0; i < a.length; i++) c.push(a[i]); };
    const line = s => { put(bytesOf(s)); c.push(0x0a); };
    const align = a => put([ESC, 0x61, a === 'center' ? 1 : 0]);
    const bold = on => put([ESC, 0x45, on ? 1 : 0]);
    const size = n => put([GS, 0x21, n]);   // 0x00 normal, 0x01 tall, 0x11 tall+wide
    put([ESC, 0x40]);
    M.blocks.forEach(b => {
      if (b.k === 'rule') { align('left'); line('-'.repeat(W)); }
      else if (b.k === 'gap') c.push(0x0a);
      else if (b.k === 'text') {
        align(b.align); bold(b.bold);
        const w = b.big === 'hw' ? Math.floor(W / 2) : W;
        if (b.big === 'hw') size(0x11); else if (b.big === 'h') size(0x01);
        wrap(b.s, w).forEach(line);
        size(0); bold(false);
      }
      else if (b.k === 'row') { align('left'); bold(b.bold); line(rowLine(W, b.l, b.r)); bold(false); }
      else if (b.k === 'cols') {
        align('left');
        if (b.head) { bold(true); line(colsLine(W, b.c[0], b.c[1], b.c[2], b.c[3])); bold(false); return; }
        const nm = wrap(b.name, NAME_W(W));
        line(colsLine(W, nm[0] || '', b.c[1], b.c[2], b.c[3])); nm.slice(1).forEach(line);
      }
      else if (b.k === 'qr') {
        const mx = qrMatrix(b.data);
        if (mx) {
          const r = qrRaster(mx, dots);
          put([GS, 0x76, 0x30, 0, r.wb & 255, r.wb >> 8, r.h & 255, r.h >> 8]);
          for (let i = 0; i < r.bytes.length; i++) c.push(r.bytes[i]);
          c.push(0x0a);
        } else { align('center'); put(nativeQr(b.data)); c.push(0x0a); align('left'); }
      }
    });
    put([ESC, 0x64, 3]); put([GS, 0x56, 1]);
    return new Uint8Array(c);
  }

  /** A sample bill for the designer's preview and test print. */
  function sampleBill() {
    const now = new Date().toISOString();
    return { bill_no: 1373, table_number: '4', table_label: 'Table 4', customer_name: 'Satyam', subtotal: 650, discount_amount: 0, service_charge_amount: 0,
      packaging_fee_amount: 0, gst_percent: 5, gst_amount: 32.5, total: 682.5, loyalty_points_used: 0, paid_at: now, first_order_at: now,
      payments: [], items: [{ name: 'Budweiser Magnum', quantity: 1, price_at_order: 310 }, { name: 'Mint Mojito', quantity: 1, price_at_order: 170 }, { name: 'Peri-Peri Fries', quantity: 1, price_at_order: 170 }] };
  }

  root.BillDesign = { SHOW_DEFAULT, TEXT_LIMITS, normalize, model, toText, toHtml, printHtml, toEscpos, taxModel, amountDue, upiLink, validUpiId, qrMatrix, qrSvg, sampleBill, fmtDate, fmtTime };
})(typeof window !== 'undefined' ? window : globalThis);
