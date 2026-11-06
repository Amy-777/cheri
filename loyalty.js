/* Loyalty — a points wallet for regulars (Advance plan).
 *
 * Two halves in one file:
 *   1) "Customers & loyalty" page (owner): switch it on/off, set the earn + redeem rules, see who has points.
 *      GET/PUT /loyalty/settings · GET /loyalty/customers · PATCH /loyalty/customers/:id · POST /loyalty/export-link
 *   2) The customer step at the bottom of the Settle-bill screen (anyone who can bill):
 *      enter name + 10-digit mobile → Check (POST /loyalty/check, saves nothing) → see points → Proceed.
 *      Saving the bill then carries customer_name / customer_phone / marketing_consent / redeem_points.
 *
 * The server owns every number and every rule. This file only shows what it is told, mirrors the
 * name/phone rules so a typo is caught before the request, and sets the bill's discount to the value
 * of the points being spent so the total on screen is the total the server checks.
 *
 * Uses the dashboard's helpers: apiGet, apiSend, escapeHtml, showToast, openPage, closePage, recalcBill, getBillMath.
 */
(function (root) {
  'use strict';

  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s));
  const toast = m => { try { showToast(m); } catch (e) { /* no toast helper */ } };
  const inr = n => '₹' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN');
  const num = n => Number(n || 0).toLocaleString('en-IN');
  const fmtPhone = p => (p && p.length === 10) ? p.slice(0, 5) + ' ' + p.slice(5) : (p || '');
  const $ = id => document.getElementById(id);

  const DEFAULTS = { enabled: false, earn_type: 'spend', earn_points: 1, earn_per: 10, redeem_points: 100, redeem_value: 50 };
  let settings = Object.assign({ plan_ok: true, switch_on: false, payback_percent: null }, DEFAULTS);
  const isOn = () => !!settings.enabled;

  /* ---- the same rules the server enforces ---- */
  function cleanPhoneInput(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d.slice(0, 10);
  }
  const cleanNameInput = raw => String(raw || '').replace(/[^\p{L}\p{M} .'-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, 60);
  const phoneOk = p => /^[6-9]\d{9}$/.test(p || '');
  const nameOk = n => { const t = String(n || '').trim(); return t.length >= 2 && (t.match(/\p{L}/gu) || []).length >= 2; };

  /* ---- plain-words descriptions of the rules ---- */
  function earnText(s) {
    s = s || settings;
    return s.earn_type === 'visit'
      ? `${num(s.earn_points)} point${s.earn_points === 1 ? '' : 's'} on every visit`
      : `${num(s.earn_points)} point${s.earn_points === 1 ? '' : 's'} for every ${inr(s.earn_per)} spent`;
  }
  const redeemText = s => { s = s || settings; return `${num(s.redeem_points)} points = ${inr(s.redeem_value)} off`; };
  function pointsForBill(total, s) {
    s = s || settings;
    if (s.earn_type === 'visit') return Number(s.earn_points) || 0;
    return Math.floor((Number(total) || 0) / (Number(s.earn_per) || 1) + 1e-9) * (Number(s.earn_points) || 0);
  }
  function paybackOf(d) {
    if (d.earn_type !== 'spend' || !(d.earn_per > 0) || !(d.redeem_points > 0)) return null;
    return Math.round((d.earn_points / d.earn_per) * (d.redeem_value / d.redeem_points) * 1000) / 10;
  }

  let loaded = false;
  async function init() {
    try { settings = await apiGet('/loyalty/settings'); loaded = true; } catch (e) { /* older server or offline — loyalty stays hidden */ }
  }

  /* ====================================================== 1) the owner's page */
  let draft = null, list = null, summary = null, sort = 'recent', q = '', loadErr = null, searchTimer = null, saving = false;

  function newDraft() {
    return {
      enabled: !!settings.switch_on && !!settings.plan_ok,
      earn_type: settings.earn_type || DEFAULTS.earn_type,
      earn_points: settings.earn_points || DEFAULTS.earn_points,
      earn_per: settings.earn_per || DEFAULTS.earn_per,
      redeem_points: settings.redeem_points || DEFAULTS.redeem_points,
      redeem_value: settings.redeem_value || DEFAULTS.redeem_value,
    };
  }

  async function open() {
    draft = newDraft(); list = null; summary = null; loadErr = null;
    renderPage();
    openPage('loyalty-page');
    const body = $('loyalty-page-body');
    if (body) body.scrollTop = 0;
    init().then(() => { draft = newDraft(); renderSettings(); });     // fresh plan/switch state each time the page opens
    loadCustomers();
  }

  function renderPage() {
    const rootEl = $('loyalty-page-body');
    if (!rootEl) return;
    rootEl.innerHTML = `
      <p class="app-page-sub">Reward your regulars with points. At the final bill, staff add the customer's name and mobile number — points are added and spent automatically.</p>
      <section class="ly-card" id="ly-settings"></section>
      <section class="ly-card">
        <div class="ly-head"><h3>Your customers</h3>
          <button class="btn btn-ghost btn-sm" id="ly-dl" type="button">Download list</button></div>
        <div id="ly-summary"></div>
        <div class="ly-toolbar">
          <input id="ly-search" type="search" placeholder="Search name or number" value="${esc(q)}" aria-label="Search customers">
          <div class="oh-seg" role="group" aria-label="Sort" id="ly-sort">
            ${[['recent', 'Recent'], ['points', 'Points'], ['visits', 'Visits'], ['spend', 'Spend']]
              .map(([v, l]) => `<button type="button" aria-pressed="${sort === v}" data-sort="${v}">${l}</button>`).join('')}
          </div>
        </div>
        <div id="ly-list"></div>
      </section>`;
    renderSettings();
    renderList();
    $('ly-dl').onclick = download;
    $('ly-search').oninput = e => { q = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(loadCustomers, 300); };
    $('ly-sort').onclick = e => {
      const b = e.target.closest('[data-sort]'); if (!b) return;
      sort = b.dataset.sort;
      document.querySelectorAll('#ly-sort button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.sort === sort)));
      loadCustomers();
    };
  }

  function renderSettings() {
    const el = $('ly-settings');
    if (!el) return;
    const d = draft, locked = !settings.plan_ok;
    const seg = (name, val, label, cur) => `<button type="button" aria-pressed="${cur === val}" data-${name}="${val}">${label}</button>`;
    el.innerHTML = `
      <div class="ly-head">
        <div><h3>Points programme</h3><div class="ly-sub">${d.enabled ? 'On — asked for at the final bill' : 'Off — nothing is asked at billing'}</div></div>
        <button type="button" class="ly-switch" role="switch" aria-checked="${d.enabled}" aria-label="Enable customer loyalty" id="ly-enable" ${locked ? 'disabled' : ''}><i></i></button>
      </div>
      ${locked ? `<p class="ly-lock">🔒 Customer loyalty is part of the <b>Advance</b> plan. Upgrade to turn it on.</p>` : ''}
      ${(!d.enabled || locked) ? '<p class="ly-hint">When it is on, the bill screen asks for the customer’s name and mobile number. Their points build up with every bill and can be spent as a discount.</p>' : `
      <label class="ly-label">1 · How customers earn points</label>
      <div class="oh-seg" role="group" aria-label="Earn by">${seg('et', 'spend', 'By money spent', d.earn_type)}${seg('et', 'visit', 'By visit', d.earn_type)}</div>
      <div class="ly-sentence">
        <input id="ly-ep" type="number" inputmode="numeric" min="1" step="1" value="${esc(d.earn_points)}" aria-label="Points earned">
        <span>point${Number(d.earn_points) === 1 ? '' : 's'}</span>
        ${d.earn_type === 'spend' ? `<span>for every ₹</span><input id="ly-epr" type="number" inputmode="decimal" min="1" step="any" value="${esc(d.earn_per)}" aria-label="Rupees spent">` : '<span>on every visit</span>'}
      </div>
      <label class="ly-label">2 · What points are worth</label>
      <div class="ly-sentence">
        <input id="ly-rp" type="number" inputmode="numeric" min="1" step="1" value="${esc(d.redeem_points)}" aria-label="Points to redeem">
        <span>points = ₹</span>
        <input id="ly-rv" type="number" inputmode="decimal" min="1" step="any" value="${esc(d.redeem_value)}" aria-label="Rupees off">
        <span>off</span>
      </div>
      <p class="ly-preview" id="ly-preview"></p>
      <p class="ly-hint">Points are spent in blocks (e.g. 100, 200, 300 points). A bill that spends points earns none itself. Deleting a bill takes its points back automatically.</p>`}
      <p class="ly-err" id="ly-err" hidden></p>
      ${locked ? '' : `<button class="btn btn-primary" id="ly-save" type="button">Save</button>`}`;

    const sw = $('ly-enable');
    if (sw && !locked) sw.onclick = () => { draft.enabled = !draft.enabled; renderSettings(); };
    el.querySelectorAll('[data-et]').forEach(b => b.onclick = () => { draft.earn_type = b.dataset.et; renderSettings(); });
    const bind = (id, key) => { const i = el.querySelector(id); if (i) i.oninput = () => { draft[key] = i.value; preview(); }; };
    bind('#ly-ep', 'earn_points'); bind('#ly-epr', 'earn_per'); bind('#ly-rp', 'redeem_points'); bind('#ly-rv', 'redeem_value');
    const sv = $('ly-save'); if (sv) sv.onclick = saveSettings;
    preview();
  }

  function draftNums() {
    return { earn_type: draft.earn_type, earn_points: Number(draft.earn_points), earn_per: Number(draft.earn_per),
             redeem_points: Number(draft.redeem_points), redeem_value: Number(draft.redeem_value) };
  }
  function draftProblem() {
    const d = draftNums();
    if (!Number.isInteger(d.earn_points) || d.earn_points < 1) return 'Points earned must be a whole number, 1 or more';
    if (d.earn_type === 'spend' && !(d.earn_per >= 1)) return 'Enter how many rupees earn those points (₹1 or more)';
    if (!Number.isInteger(d.redeem_points) || d.redeem_points < 1) return 'Points to redeem must be a whole number, 1 or more';
    if (!(d.redeem_value > 0)) return 'Enter how many rupees the points are worth';
    return '';
  }
  function preview() {
    const p = $('ly-preview'); if (!p) return;
    const bad = draftProblem();
    if (bad) { p.textContent = bad; p.classList.add('bad'); return; }
    p.classList.remove('bad');
    const d = draftNums(), pb = paybackOf(d);
    const ex = d.earn_type === 'spend' ? `A ₹500 bill earns ${num(pointsForBill(500, d))} points. ` : '';
    p.textContent = `${ex}${redeemText(d)}.` + (pb != null ? ` Customers get back about ${pb}% of what they spend.` : '');
  }
  async function saveSettings() {
    if (saving) return;
    const err = $('ly-err'), btn = $('ly-save');
    err.hidden = true;
    if (draft.enabled) { const bad = draftProblem(); if (bad) { err.textContent = bad; err.hidden = false; return; } }
    const d = draftNums();
    const body = { enabled: !!draft.enabled, earn_type: d.earn_type, earn_points: d.earn_points || 1, earn_per: d.earn_per || 10,
                   redeem_points: d.redeem_points || 100, redeem_value: d.redeem_value || 50 };
    saving = true; btn.disabled = true; const label = btn.textContent; btn.textContent = 'Saving…';
    try {
      settings = await apiSend('PUT', '/loyalty/settings', body);
      toast(settings.enabled ? 'Loyalty saved — it is on' : 'Loyalty is off');
      draft = newDraft(); renderSettings(); loadCustomers();
    } catch (e) {
      err.textContent = e.message || 'Could not save — try again'; err.hidden = false;
      btn.disabled = false; btn.textContent = label;
    } finally { saving = false; }
  }

  async function loadCustomers() {
    try {
      const r = await apiGet('/loyalty/customers?sort=' + encodeURIComponent(sort) + '&q=' + encodeURIComponent(q.trim()));
      list = r.customers || []; summary = r.summary || null; loadErr = null;
      if (r.settings) settings = r.settings;
    } catch (e) {
      loadErr = (e.status === 404 || /not found/i.test(e.message || '')) ? 'Loyalty needs a server update first.' : (e.message || 'Could not load customers');
    }
    renderList();
  }

  function renderList() {
    const sum = $('ly-summary'), el = $('ly-list');
    if (!sum || !el) return;
    if (loadErr) { sum.innerHTML = ''; el.innerHTML = `<div class="ly-empty">${esc(loadErr)}</div>`; return; }
    if (!list) { sum.innerHTML = ''; el.innerHTML = '<div class="ly-empty">Loading customers…</div>'; return; }
    const s = summary || { total: 0, returning: 0, rewards_ready: 0, points_outstanding: 0 };
    sum.innerHTML = `<div class="ly-chips">
        <div><b>${s.total}</b><span>customers</span></div>
        <div><b>${s.total ? Math.round((s.returning / s.total) * 100) : 0}%</b><span>came back</span></div>
        <div><b>${s.rewards_ready}</b><span>can redeem</span></div>
        <div><b>${num(s.points_outstanding || 0)}</b><span>points held</span></div></div>`;
    if (!list.length) {
      el.innerHTML = `<div class="ly-empty">${q.trim() ? 'No one matches that.' : 'No customers yet. When staff add a name and number at the final bill, they appear here.'}</div>`;
      return;
    }
    const lastSeen = iso => {
      if (!iso) return '—';
      const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
      return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? days + ' days ago' : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };
    el.innerHTML = list.map(c => {
      const ready = c.redeemable_blocks > 0;
      const pct = ready ? 100 : Math.min(100, Math.round((c.points / c.redeem_points) * 100));
      const prog = ready ? `${inr(c.redeemable_value)} off available` : `${num(c.points)} of ${num(c.redeem_points)} points to ${inr(c.redeem_value)} off`;
      return `<div class="ly-cust">
        <div class="ly-top">
          <div class="ly-who"><b>${esc(c.name || 'No name')}</b><span>${esc(fmtPhone(c.phone))}</span></div>
          <span class="ly-tag ${ready ? 'gift' : ''}">${num(c.points)} pts</span>
        </div>
        <div class="ly-meta">${c.visits} visit${c.visits === 1 ? '' : 's'} · ${inr(c.lifetime_spent)} spent · last ${lastSeen(c.last_visit_at)}</div>
        <div class="ly-bar" role="img" aria-label="${esc(prog)}"><i style="width:${pct}%"></i></div><div class="ly-prog">${ready ? '🎁 ' : ''}${esc(prog)}</div>
        <button type="button" class="ly-consent ${c.marketing_consent ? 'yes' : ''}" data-consent="${c.id}" aria-pressed="${c.marketing_consent}">${c.marketing_consent ? '✓ OK to send offers' : 'No offers consent'}</button>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-consent]').forEach(b => b.onclick = async () => {
      const c = list.find(x => String(x.id) === b.dataset.consent); if (!c) return;
      const next = !c.marketing_consent; c.marketing_consent = next; renderList();
      try { await apiSend('PATCH', '/loyalty/customers/' + c.id, { marketing_consent: next }); }
      catch (e) { c.marketing_consent = !next; renderList(); toast(e.message || 'Could not change that'); }
    });
  }

  async function download() {
    const btn = $('ly-dl'); if (!btn || btn.disabled) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing…';
    try {
      const r = await apiSend('POST', '/loyalty/export-link');
      if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins && Capacitor.Plugins.Browser) {
        await Capacitor.Plugins.Browser.open({ url: r.url });
      } else {
        const a = document.createElement('a'); a.href = r.url; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      }
      toast('Your customer list is downloading');
    } catch (e) { toast(e.message || 'Could not prepare the download'); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  /* ====================================================== 2) the final-bill step */
  // phase: 'entry' (type name + number) → 'result' (points shown, choose to spend some) → 'done' (confirmed)
  let bill = null;

  function billReset() {
    bill = { phase: 'entry', name: '', phone: '', info: null, blocks: 0, prev: null, total: 0, consent: false, busy: false, err: '', token: 0 };
    const box = $('bm-loyalty'); if (!box) return;
    box.hidden = !isOn();
    if (!loaded) init().then(() => { if (bill && box) { box.hidden = !isOn(); render(); } });
    setDiscountLocked(false);
    render();
  }
  function setDiscountLocked(on) {
    const t = $('bm-discount-type'), v = $('bm-discount-value');
    if (t) t.disabled = on; if (v) v.disabled = on;
  }
  function subtotal() { try { return getBillMath().subtotal; } catch (e) { return 0; } }
  function curTotal() { try { return getBillMath().total; } catch (e) { return bill ? bill.total : 0; } }
  function maxBlocks() {
    const i = bill.info; if (!i) return 0;
    return Math.max(0, Math.min(i.redeemable_blocks, Math.floor(subtotal() / i.redeem_value + 1e-9)));
  }

  function render() {
    const box = $('bm-loyalty'); if (!box || !bill) return;
    if (!isOn()) { box.hidden = true; return; }
    box.hidden = false;
    const b = bill;
    let html = `<div class="ly-bill-head"><b>Customer rewards</b><span>optional</span></div>`;

    if (b.phase === 'entry') {
      const nOk = nameOk(b.name), pOk = phoneOk(b.phone), any = b.name || b.phone;
      html += `
        <p class="ly-soft ly-lead">Add the customer to give points. Leave empty to bill without.</p>
        <div class="ly-fields">
          <div><input id="bm-cust-name" type="text" autocomplete="off" maxlength="60" placeholder="Customer name" value="${esc(b.name)}" aria-label="Customer name" aria-invalid="${!!b.name && !nOk}">
            <small class="ly-fe" id="bm-name-err" ${b.name && !nOk ? '' : 'hidden'}>Letters only, at least 2</small></div>
          <div><input id="bm-cust-phone" type="tel" inputmode="numeric" autocomplete="off" maxlength="16" placeholder="10-digit mobile" value="${esc(b.phone)}" aria-label="Customer mobile number" aria-invalid="${!!b.phone && !pOk}">
            <small class="ly-fe" id="bm-phone-err" ${b.phone && !pOk ? '' : 'hidden'}>Enter 10 digits starting 6–9</small></div>
        </div>
        ${b.err ? `<p class="ly-fe">${esc(b.err)}</p>` : ''}
        <div class="ly-actions">
          <button type="button" class="btn ly-clear" id="bm-cust-clear" ${any ? '' : 'hidden'}>Clear</button>
          <button type="button" class="btn btn-primary" id="bm-cust-check" ${nOk && pOk && !b.busy ? '' : 'disabled'}>${b.busy ? 'Checking…' : 'Check'}</button>
        </div>`;
    } else if (b.phase === 'result') {
      const i = b.info, max = maxBlocks(), isNew = !i.found;
      const pct = i.redeemable_blocks > 0 ? 100 : Math.min(100, Math.round((i.points / i.redeem_points) * 100));
      html += `<div class="ly-card2">
          <div class="ly-who2"><b>${esc(i.name || b.name)}</b><span>${esc(fmtPhone(i.phone))}</span>${isNew ? '<em>New customer</em>' : `<em>${i.visits} visit${i.visits === 1 ? '' : 's'}</em>`}</div>
          <div class="ly-pts"><big>${num(i.points)}</big><span>points</span></div>
          <div class="ly-bar"><i style="width:${pct}%"></i></div>
          <div class="ly-prog">${i.redeemable_blocks > 0
            ? `🎁 ${inr(i.redeemable_value)} off available`
            : `${num(i.to_next_reward)} more points for ${inr(i.redeem_value)} off`}</div>`;
      if (max > 0) {
        html += `<div class="ly-spend" role="group" aria-label="Spend points">
            <span>Spend points on this bill</span>
            <div class="ly-step"><button type="button" id="bm-pt-minus" aria-label="Fewer points" ${b.blocks <= 0 ? 'disabled' : ''}>−</button>
              <b id="bm-pt-val">${b.blocks ? num(b.blocks * i.redeem_points) + ' pts' : 'None'}</b>
              <button type="button" id="bm-pt-plus" aria-label="More points" ${b.blocks >= max ? 'disabled' : ''}>+</button></div>
            <small>${b.blocks ? `−${inr(b.blocks * i.redeem_value)} off the bill` : `${redeemText(i)}`}</small>
          </div>`;
      } else if (i.redeemable_blocks > 0) {
        html += `<p class="ly-soft ly-lead">This bill is too small to spend points on.</p>`;
      }
      if (!i.marketing_consent) {
        html += `<label class="ly-consent-row"><input type="checkbox" id="bm-cust-consent" ${b.consent ? 'checked' : ''}> They agree to receive offers on WhatsApp</label>`;
      }
      html += `</div>
        <div class="ly-actions">
          <button type="button" class="btn ly-clear" id="bm-cust-change">Change</button>
          <button type="button" class="btn btn-primary" id="bm-cust-proceed">Proceed</button>
        </div>`;
    } else {   // done
      const i = b.info, spent = b.blocks * i.redeem_points;
      const earn = spent ? 0 : pointsForBill(curTotal(), i.settings || settings);
      html += `<div class="ly-done">
          <div class="ly-done-top"><span class="ly-tick" aria-hidden="true">✓</span>
            <div><b>${esc(i.name || b.name)}</b><span>${esc(fmtPhone(i.phone))}</span></div>
            <button type="button" class="ly-link" id="bm-cust-change">Change</button></div>
          <div class="ly-done-line">${spent ? `Using <b>${num(spent)} points</b> · −${inr(b.blocks * i.redeem_value)}` : `Has <b>${num(i.points)} points</b>`}</div>
          <div class="ly-done-line" id="bm-earn-line">${spent ? 'No points earned on a bill that spends points' : `Earns <b>+${num(earn)} points</b> on this bill`}</div>
        </div>`;
    }
    box.innerHTML = html;
    wire();
  }

  function wire() {
    const b = bill, g = id => $(id);
    if (g('bm-cust-name')) g('bm-cust-name').oninput = e => {
      const v = cleanNameInput(e.target.value); if (v !== e.target.value) e.target.value = v;   // digits and symbols never get in
      b.name = v; b.err = ''; softValidate();
    };
    if (g('bm-cust-phone')) g('bm-cust-phone').oninput = e => {
      const v = cleanPhoneInput(e.target.value); if (v !== e.target.value) e.target.value = v;
      b.phone = v; b.err = ''; softValidate();
    };
    if (g('bm-cust-check')) g('bm-cust-check').onclick = check;
    if (g('bm-cust-clear')) g('bm-cust-clear').onclick = () => { b.name = ''; b.phone = ''; b.err = ''; render(); };
    if (g('bm-cust-change')) g('bm-cust-change').onclick = () => { releasePoints(); b.phase = 'entry'; b.info = null; b.err = ''; render(); };
    if (g('bm-cust-proceed')) g('bm-cust-proceed').onclick = proceed;
    if (g('bm-pt-minus')) g('bm-pt-minus').onclick = () => { b.blocks = Math.max(0, b.blocks - 1); render(); };
    if (g('bm-pt-plus')) g('bm-pt-plus').onclick = () => { b.blocks = Math.min(maxBlocks(), b.blocks + 1); render(); };
    if (g('bm-cust-consent')) g('bm-cust-consent').onchange = e => { b.consent = e.target.checked; };
  }
  // Typing must not rebuild the inputs (that would drop focus) — only flip the error text and the Check button.
  function softValidate() {
    const b = bill, nOk = nameOk(b.name), pOk = phoneOk(b.phone);
    const ne = $('bm-name-err'), pe = $('bm-phone-err'), btn = $('bm-cust-check');
    if (ne) ne.hidden = !(b.name && !nOk);
    if (pe) pe.hidden = !(b.phone && !pOk);
    const ni = $('bm-cust-name'), pi = $('bm-cust-phone');
    if (ni) ni.setAttribute('aria-invalid', String(!!b.name && !nOk));
    if (pi) pi.setAttribute('aria-invalid', String(!!b.phone && !pOk));
    if (btn) btn.disabled = !(nOk && pOk);
    const clear = $('bm-cust-clear');
    if (clear) clear.hidden = !(b.name || b.phone);
  }

  async function check() {
    const b = bill; if (!b || b.busy || !(nameOk(b.name) && phoneOk(b.phone))) return;
    b.busy = true; b.err = ''; const my = ++b.token; render();
    try {
      const r = await apiSend('POST', '/loyalty/check', { name: b.name.trim(), phone: b.phone });
      if (!bill || my !== b.token) return;
      b.info = r; b.blocks = 0; b.busy = false; b.phase = 'result'; render();
    } catch (e) {
      if (!bill || my !== b.token) return;
      b.busy = false; b.err = e.message || 'Could not check just now — try again'; render();
    }
  }
  function proceed() {
    const b = bill; if (!b || !b.info) return;
    if (b.blocks > 0) {
      b.prev = { type: $('bm-discount-type').value, value: $('bm-discount-value').value };
      $('bm-discount-type').value = 'amount';
      $('bm-discount-value').value = String(Math.round(b.blocks * b.info.redeem_value * 100) / 100);
      setDiscountLocked(true);
    }
    b.phase = 'done';
    recalcBill();           // totals change → onTotals() below refreshes the "earns" line
    render();
  }
  function releasePoints() {
    const b = bill; if (!b || !b.blocks) { setDiscountLocked(false); return; }
    const p = b.prev || { type: '', value: 0 };
    $('bm-discount-type').value = p.type; $('bm-discount-value').value = p.value;
    setDiscountLocked(false); b.blocks = 0; b.prev = null;
    try { recalcBill(); } catch (e) { /* modal closed */ }
  }
  // recalcBill() calls this so the "earns +N points" line follows the live total.
  function onTotals(total) {
    if (!bill) return;
    bill.total = total;
    if (bill.phase === 'done' && bill.info && !bill.blocks) {
      const l = $('bm-earn-line');
      if (l) l.innerHTML = `Earns <b>+${num(pointsForBill(total, bill.info.settings || settings))} points</b> on this bill`;
    }
  }

  // What saveBill adds to the POST. Throws a plain Error (shown in the bill's red line) if the step is half-finished.
  function billPayload() {
    const out = {};
    if (!bill || !isOn()) return out;
    if (bill.phase === 'entry' && !bill.name && !bill.phone) return out;          // skipped on purpose
    if (bill.phase !== 'done') throw new Error('Finish the customer step (Check, then Proceed) — or tap Clear to bill without a customer.');
    out.customer_name = (bill.info.name || bill.name).trim();
    out.customer_phone = bill.info.phone;
    out.marketing_consent = !!bill.consent;
    out.redeem_points = bill.blocks * bill.info.redeem_points;
    return out;
  }
  // After a successful save, tell the waiter what to say to the customer.
  function billDone(payload, saved) {
    bill = null;
    if (!payload || !payload.customer_phone || !saved) return;
    const who = payload.customer_name || 'Customer', bal = saved.loyalty_points_balance;
    if (payload.redeem_points) toast(`${who} used ${num(payload.redeem_points)} points 🎉${bal != null ? ' · ' + num(bal) + ' left' : ''}`);
    else if (saved.loyalty_points_earned != null) toast(`${who} earned +${num(saved.loyalty_points_earned)} points${bal != null ? ' · total ' + num(bal) : ''}`);
  }

  root.Loyalty = {
    init, open, isOn, settings: () => settings, earnText, redeemText, pointsForBill,
    billReset, billPayload, billDone, onTotals,
  };
})(window);
