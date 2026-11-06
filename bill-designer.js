/* bill-designer.js — the screen where the owner designs the printed bill.
 *
 * Plain <script>, no build step. Needs bill-design.js (loaded first). Attaches window.BillDesigner.
 *   BillDesigner.open({ profile, cafeName, onSave(profile) -> Promise, onTestPrint(profile) -> Promise })
 *
 * Left: every part of the bill as a field or a switch. Right: the receipt as it will print, updating as you type.
 * On a phone the two are tabs (Edit / Preview).
 */
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc) return;

  const CSS = `
  .bdz{position:fixed;inset:0;z-index:300;background:var(--canvas,#f5f6f8);color:var(--text,#1a1d24);display:flex;flex-direction:column;font-family:inherit}
  .bdz *{box-sizing:border-box}
  .bdz-top{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;background:var(--paper,#fff);border-bottom:1px solid var(--border,#e4e6ea)}
  .bdz-top h2{margin:0;font-size:17px;flex:1}
  .bdz-x{border:0;background:transparent;font-size:26px;line-height:1;padding:4px 8px;cursor:pointer;color:inherit}
  .bdz-tabs{display:none;gap:6px;padding:8px 14px;background:var(--paper,#fff);border-bottom:1px solid var(--border,#e4e6ea)}
  .bdz-tabs button{flex:1;padding:8px;border:1px solid var(--border,#e4e6ea);background:transparent;color:inherit;border-radius:8px;font-weight:600;cursor:pointer}
  .bdz-tabs button.on{background:var(--ink,#171a21);color:#fff;border-color:var(--ink,#171a21)}
  .bdz-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,440px)}
  .bdz-form{overflow:auto;padding:12px 14px 90px}
  .bdz-prev{overflow:auto;padding:14px;background:var(--canvas,#f5f6f8);border-left:1px solid var(--border,#e4e6ea);display:flex;flex-direction:column;align-items:center;gap:10px}
  .bdz-sheet{background:#fff;color:#000;box-shadow:0 2px 16px rgba(0,0,0,.18);padding:12px 10px 18px;zoom:1.8}
  .bdz-sheet[data-paper="80"]{zoom:1.4}
  .bdz-note{font-size:11.5px;color:var(--text-secondary,#6b7280);margin:0}
  .bdz details{background:var(--paper,#fff);border:1px solid var(--border,#e4e6ea);border-radius:10px;margin-bottom:10px;padding:0 12px}
  .bdz summary{cursor:pointer;font-weight:600;font-size:14px;padding:12px 0}
  .bdz .grp{padding:0 0 12px}
  .bdz label.f{display:block;font-size:12px;color:var(--text-secondary,#6b7280);margin:8px 0 3px}
  .bdz input[type=text],.bdz textarea{width:100%;padding:9px 10px;border:1px solid var(--border,#e4e6ea);border-radius:8px;background:var(--canvas,#f5f6f8);color:inherit;font:inherit;font-size:14px}
  .bdz textarea{min-height:76px;resize:vertical}
  .bdz .bad{border-color:var(--danger,#b3432e)!important}
  .bdz .msg{font-size:12px;color:var(--danger,#b3432e);margin:4px 0 0;min-height:0}
  .bdz .sw{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--border,#e4e6ea);font-size:14px;cursor:pointer}
  .bdz .sw:first-of-type{border-top:0}
  .bdz .sw small{display:block;font-size:11.5px;color:var(--text-secondary,#6b7280);margin-top:1px}
  .bdz .sw input{appearance:none;-webkit-appearance:none;flex:none;width:34px;height:20px;border-radius:20px;background:#c9ccd3;position:relative;transition:background .15s;cursor:pointer}
  .bdz .sw input::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
  .bdz .sw input:checked{background:var(--teal,#e63976)}
  .bdz .sw input:checked::after{transform:translateX(14px)}
  .bdz .sub{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-secondary,#6b7280);margin:12px 0 2px}
  .bdz .seg{display:flex;gap:8px}
  .bdz .seg label{flex:1;border:1px solid var(--border,#e4e6ea);border-radius:10px;padding:10px;cursor:pointer;font-size:13px;display:flex;gap:8px;align-items:flex-start}
  .bdz .seg label.on{border-color:var(--teal,#e63976);background:var(--teal-soft,#ffecd1)}
  .bdz .seg b{display:block;font-size:14px}
  .bdz-bar{position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));background:var(--paper,#fff);border-top:1px solid var(--border,#e4e6ea)}
  .bdz-bar button{padding:11px 14px;border-radius:10px;border:1px solid var(--border,#e4e6ea);background:transparent;color:inherit;font-weight:600;cursor:pointer;font-size:14px}
  .bdz-bar .pri{background:var(--teal,#e63976);border-color:var(--teal,#e63976);color:#fff;flex:1}
  .bdz-bar button[disabled]{opacity:.55}
  @media (max-width:820px){
    .bdz-tabs{display:flex}.bdz-main{grid-template-columns:1fr}
    .bdz[data-tab=edit] .bdz-prev{display:none}.bdz[data-tab=preview] .bdz-form{display:none}
    .bdz-sheet{zoom:1.7}.bdz-sheet[data-paper="80"]{zoom:1.1}
  }
  html[data-theme="dark"] .bdz .sw input{background:#4a4f5a}`;

  const FIELDS_TOP = [
    ['legal_name', 'Business / legal name (a second line under the name)', 'e.g. Connaught Plaza Restaurants Pvt. Ltd.'],
    ['address', 'Address', 'Street, area, city, PIN'],
    ['state_code', 'State code', 'e.g. 19'],
    ['gst_no', 'GST number', '15 letters and digits'],
    ['fssai', 'FSSAI number', ''],
    ['license_no', 'License number', ''],
    ['cin', 'CIN number', ''],
    ['phone', 'Phone', ''],
    ['service_line', 'Service line', 'e.g. Service: RESTAURANT SERVICES (SAC-996331)'],
    ['doc_title', 'Title of the bill', 'e.g. Tax Invoice'],
  ];
  const SWITCHES = [
    ['On the bill', [
      ['bill_no', 'Bill number'], ['date', 'Bill date'], ['created_on', 'Order date and time', 'when the first order was placed'],
      ['customer', 'Customer name', 'only when one is attached'], ['table', 'Table / room']]],
    ['Items', [['item_count', 'Total items'], ['qty_total', 'Total quantity']]],
    ['Amounts', [
      ['sub_total', 'Sub total'], ['discounts', 'Discount, service charge, packaging', 'only when the bill has them'],
      ['tax_split', 'CGST and SGST as two lines', 'off = one GST line'], ['tax_note', '"Total includes GST of …" line'],
      ['big_total', 'Big total']]],
    ['Payment', [
      ['pay_mode', 'How it was paid', 'Cash / UPI / Card'], ['received', 'Amount received'],
      ['loyalty', 'Loyalty points', 'only for customers with points']]],
  ];

  let injected = false;
  function injectCss() { if (injected) return; injected = true; const s = doc.createElement('style'); s.textContent = CSS; doc.head.appendChild(s); }
  function ensureQr(cb) {
    if (root.QRCode) return cb();
    const s = doc.createElement('script'); s.src = 'qrcode.min.js'; s.onload = cb; s.onerror = cb; doc.head.appendChild(s);
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function open(opts) {
    const BD = root.BillDesign;
    if (!BD) { alert('The bill designer files did not load. Refresh the page and try again.'); return; }
    injectCss();
    const initial = BD.normalize(opts.profile), P = BD.normalize(opts.profile);
    let asPaid = false, saving = false;

    const el = doc.createElement('div');
    el.className = 'bdz'; el.dataset.tab = 'edit'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Bill designer');
    const sw = (k, label, hint) => `<label class="sw"><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span><input type="checkbox" data-show="${k}"></label>`;
    el.innerHTML = `
      <div class="bdz-top"><h2>Design your bill</h2><button class="bdz-x" data-x aria-label="Close">×</button></div>
      <div class="bdz-tabs"><button data-tab="edit" class="on">Edit</button><button data-tab="preview">Preview</button></div>
      <div class="bdz-main">
        <div class="bdz-form">
          <details open><summary>Paper</summary><div class="grp"><div class="seg">
            <label data-paper="58"><input type="radio" name="bdz-paper" value="58" hidden><span><b>2 inch</b>58 mm paper roll</span></label>
            <label data-paper="80"><input type="radio" name="bdz-paper" value="80" hidden><span><b>3 inch</b>80 mm paper roll</span></label>
          </div><p class="bdz-note" style="margin-top:8px">The bill fits the paper by itself: lines wrap and columns resize for the roll you pick.</p></div></details>

          <details open><summary>Top of the bill</summary><div class="grp">
            <p class="bdz-note">Anything you leave empty is not printed. Your café name is printed when "Print cafe name on bills" is on in Profile.</p>
            ${FIELDS_TOP.map(([k, l, ph]) => `<label class="f" for="bdz-${k}">${esc(l)}</label><input type="text" id="bdz-${k}" data-f="${k}" maxlength="${BD.TEXT_LIMITS[k]}" placeholder="${esc(ph)}" autocomplete="off">`).join('')}
            <p class="msg" id="bdz-gstmsg"></p>
          </div></details>

          <details open><summary>What to show</summary><div class="grp">
            ${SWITCHES.map(([h, rows]) => `<div class="sub">${esc(h)}</div>` + rows.map(r => sw(r[0], r[1], r[2])).join('')).join('')}
          </div></details>

          <details open><summary>Pay by QR (UPI)</summary><div class="grp">
            ${sw('upi_qr', 'Print a payment QR on the bill', 'the customer scans it and their app opens with the amount already filled in')}
            <label class="f" for="bdz-upi_id">Your UPI ID</label><input type="text" id="bdz-upi_id" data-f="upi_id" maxlength="60" placeholder="e.g. yourcafe@okhdfcbank" autocomplete="off" autocapitalize="off" spellcheck="false">
            <p class="msg" id="bdz-upimsg"></p>
            <label class="f" for="bdz-upi_name">Name shown in the customer's app</label><input type="text" id="bdz-upi_name" data-f="upi_name" maxlength="40" placeholder="Your café name">
            <label class="f" for="bdz-qr_caption">Line under the QR</label><input type="text" id="bdz-qr_caption" data-f="qr_caption" maxlength="50" placeholder="Scan To Pay Rs. {amount} /-">
            ${sw('qr_hide_paid', 'Hide the QR once the bill is fully paid')}
            <p class="bdz-note" style="margin-top:6px">The QR carries the exact amount still to pay. It does not tell this app when someone has paid: check the payment in your UPI app or soundbox, then mark the bill as paid.</p>
          </div></details>

          <details open><summary>Bottom of the bill</summary><div class="grp">
            <label class="f" for="bdz-footer">Thank-you line</label><input type="text" id="bdz-footer" data-f="footer" maxlength="80" placeholder="Thank You! Visit Again!">
            <label class="f" for="bdz-terms">Terms &amp; conditions (one per line)</label><textarea id="bdz-terms" data-f="terms" maxlength="400" placeholder="No cash refunds&#10;Prices inclusive of all taxes"></textarea>
            ${sw('powered_by', 'Print "Powered by cheri"')}
            ${sw('feedback_qr', 'Print a second QR (feedback / Google review)')}
            <label class="f" for="bdz-feedback_url">Link for that QR</label><input type="text" id="bdz-feedback_url" data-f="feedback_url" maxlength="120" placeholder="https://…" inputmode="url" autocapitalize="off">
            <p class="msg" id="bdz-fbmsg"></p>
            <label class="f" for="bdz-feedback_caption">Line above that QR</label><input type="text" id="bdz-feedback_caption" data-f="feedback_caption" maxlength="40" placeholder="Tell us how we did">
          </div></details>
        </div>
        <div class="bdz-prev">
          <label class="sw" style="border:0;padding:0;width:100%;max-width:330px"><span>Preview this bill as already paid</span><input type="checkbox" id="bdz-aspaid"></label>
          <div class="bdz-sheet" id="bdz-sheet"></div>
          <p class="bdz-note" style="text-align:center">Sample bill. Your real bills use the same design.</p>
        </div>
      </div>
      <div class="bdz-bar">
        <button data-reset>Reset</button>
        ${opts.onTestPrint ? '<button data-test>Test print</button>' : ''}
        <button class="pri" data-save>Save bill design</button>
      </div>`;
    doc.body.appendChild(el);
    const prevOverflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden';

    const q = (s) => el.querySelector(s), qa = (s) => Array.from(el.querySelectorAll(s));
    function fillForm() {
      qa('[data-f]').forEach(i => { i.value = P[i.dataset.f] || ''; });
      qa('[data-show]').forEach(i => { i.checked = !!P.show[i.dataset.show]; });
      qa('label[data-paper]').forEach(l => { l.classList.toggle('on', l.dataset.paper === P.paper); });
    }
    function sampleFor() {
      const b = BD.sampleBill();
      if (asPaid) b.payments = [{ method: 'upi', amount: b.total }];
      return b;
    }
    function validate(strict) {
      let ok = true;
      const gst = P.gst_no, gm = q('#bdz-gstmsg');
      const gstBad = gst && !/^[0-9A-Za-z]{15}$/.test(gst);
      gm.textContent = gstBad ? 'A GST number is normally 15 letters and digits.' : ''; q('#bdz-gst_no').classList.toggle('bad', !!gstBad);
      const um = q('#bdz-upimsg'), upiBad = (P.upi_id && !BD.validUpiId(P.upi_id)) || (P.show.upi_qr && strict && !P.upi_id);
      um.textContent = upiBad ? (P.upi_id ? 'That does not look like a UPI ID. It looks like name@bank.' : 'Enter your UPI ID to print the QR.') : '';
      q('#bdz-upi_id').classList.toggle('bad', !!upiBad); if (upiBad && P.show.upi_qr) ok = false;
      const fm = q('#bdz-fbmsg'), fbBad = P.feedback_url && !/^https?:\/\//i.test(P.feedback_url);
      fm.textContent = fbBad ? 'The link should start with https://' : ''; q('#bdz-feedback_url').classList.toggle('bad', !!fbBad); if (fbBad && P.show.feedback_qr) ok = false;
      return { ok, gstBad };
    }
    let t = null;
    function render() {
      const sheet = q('#bdz-sheet');
      sheet.dataset.paper = P.paper;
      sheet.innerHTML = BD.toHtml(sampleFor(), opts.cafeName || '', P);
      validate(false);
    }
    function schedule() { clearTimeout(t); t = setTimeout(render, 60); }

    fillForm();
    ensureQr(render);

    el.addEventListener('input', e => {
      const f = e.target.dataset && e.target.dataset.f, s = e.target.dataset && e.target.dataset.show;
      if (f) P[f] = e.target.value;
      if (s) P.show[s] = e.target.checked;
      if (e.target.id === 'bdz-aspaid') asPaid = e.target.checked;
      schedule();
    });
    el.addEventListener('click', async e => {
      const b = e.target.closest('button,label[data-paper]'); if (!b) return;
      if (b.dataset.paper) { P.paper = b.dataset.paper; fillForm(); render(); return; }
      if (b.dataset.tab) { el.dataset.tab = b.dataset.tab; qa('.bdz-tabs button').forEach(x => x.classList.toggle('on', x === b)); return; }
      if (b.hasAttribute('data-x')) return close();
      if (b.hasAttribute('data-reset')) {
        if (!confirm('Put every setting back to the default bill? Your saved design stays until you press Save.')) return;
        Object.assign(P, BD.normalize({})); P.show = Object.assign({}, BD.SHOW_DEFAULT); fillForm(); render(); return;
      }
      if (b.hasAttribute('data-test')) {
        const cleanP = BD.normalize(P); b.disabled = true;
        try { await opts.onTestPrint(cleanP, sampleFor()); } finally { b.disabled = false; }
        return;
      }
      if (b.hasAttribute('data-save')) {
        if (saving) return;
        const v = validate(true);
        if (!v.ok) { el.dataset.tab = 'edit'; return; }
        if (v.gstBad && !confirm('A GST number is normally 15 letters and digits. Save "' + P.gst_no + '" anyway?')) return;
        saving = true; b.disabled = true; const old = b.textContent; b.textContent = 'Saving…';
        try { await opts.onSave(BD.normalize(P)); close(true); }
        catch (err) { b.textContent = old; b.disabled = false; saving = false; alert('Could not save the bill design. ' + ((err && err.message) || '')); }
      }
    });
    function onKey(e) { if (e.key === 'Escape') close(); }
    doc.addEventListener('keydown', onKey);
    function close(saved) {
      if (!saved && JSON.stringify(BD.normalize(P)) !== JSON.stringify(initial) && !confirm('Close without saving your changes?')) return;
      doc.removeEventListener('keydown', onKey); doc.body.style.overflow = prevOverflow; el.remove();
    }
    return { close };
  }

  root.BillDesigner = { open };
})(typeof window !== 'undefined' ? window : globalThis);
