/* inventory.js — the Inventory tab: stock, recipes, expenses and a plain overview.
 *
 * Four tabs inside #view-inventory:
 *   Stock     — ingredients/supplies with how much is left; tap one to add stock, take some out, log waste, or count it.
 *               Also: count everything at once, a shopping list, and suppliers.
 *   Recipes   — what each dish uses (start from a built-in default, then edit); cost and margin per dish; the auto-deduct switch.
 *   Expenses  — rent, salaries, power … plus every stock purchase (those add themselves).
 *   Overview  — stock value, what is running low, spending by category, and (owner / analytics access) what is left.
 *
 * Needs from dashboard.html: apiGet(), apiSend(), escapeHtml(), showToast(), cafe, role.
 * Stock changes show instantly and are confirmed with the server in the background (a failed one is put back).
 */
const Inventory = (() => {
  const root = () => document.getElementById('inv-root');
  const PLANS_OK = ['pro', 'advance', 'initial'];
  const UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'pack', 'dozen', 'box', 'bottle', 'bag', 'tray'];
  const CATS = ['Rent', 'Salaries', 'Electricity', 'Gas', 'Water', 'Internet', 'Repairs', 'Marketing', 'Transport', 'Cleaning', 'Packaging', 'Licences & fees'];
  const METHODS = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['other', 'Other']];
  const esc = s => escapeHtml(String(s == null ? '' : s));
  const rs = n => '₹' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const qn = n => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const rid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  let tab = 'stock', period = 'month', q = '';
  let items = [], lowCount = 0, stockValue = 0, itemsLoaded = false, itemsErr = null;
  let exp = null, expErr = null, sum = null, sumErr = null, expCats = [];
  let showArchived = false;
  let rec = null, recErr = null, tpls = null, rd = null, supNames = [];

  const planOk = () => PLANS_OK.includes(String((cafe && cafe.current_plan) || '').toLowerCase());
  const isOwner = () => typeof role !== 'undefined' && role === 'owner';

  /* ---------- dates for the period chips ---------- */
  function range() {
    const t = new Date(), today = ymd(t);
    if (period === 'today') return [today, today];
    if (period === 'week') { const a = new Date(t); a.setDate(a.getDate() - 6); return [ymd(a), today]; }
    if (period === 'last') { const a = new Date(t.getFullYear(), t.getMonth() - 1, 1), b = new Date(t.getFullYear(), t.getMonth(), 0); return [ymd(a), ymd(b)]; }
    return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), today];
  }
  const periodLabel = () => ({ today: 'today', week: 'the last 7 days', month: 'this month', last: 'last month' }[period]);

  /* ---------- loading ---------- */
  async function loadItems() {
    try {
      const put = d => { items = d.items || []; lowCount = d.low_count || 0; stockValue = d.stock_value || 0; itemsLoaded = true; itemsErr = null; };
      const path = '/inventory/items' + (showArchived ? '?include_archived=true' : '');
      if (typeof apiGetSWR === 'function') await apiGetSWR(path, (d, stale) => { put(d); if (stale) paint(); }); else put(await apiGet(path));
    } catch (e) { itemsErr = (e && e.message) || 'Couldn’t load stock'; }
    paint();
  }
  async function loadExpenses() {
    const [a, b] = range();
    try {
      const p = '/inventory/expenses?start=' + a + '&end=' + b, put = d => { exp = d; expCats = exp.categories || []; expErr = null; };
      if (typeof apiGetSWR === 'function') await apiGetSWR(p, (d, stale) => { put(d); if (stale) paint(); }); else put(await apiGet(p));
    }
    catch (e) { expErr = (e && e.message) || 'Couldn’t load expenses'; }
    paint();
  }
  async function loadSummary() {
    const [a, b] = range();
    try {
      const p = '/inventory/summary?start=' + a + '&end=' + b, put = d => { sum = d; sumErr = null; };
      if (typeof apiGetSWR === 'function') await apiGetSWR(p, (d, stale) => { put(d); if (stale) paint(); }); else put(await apiGet(p));
    }
    catch (e) { sumErr = (e && e.message) || 'Couldn’t load the overview'; }
    paint();
  }
  function load() {                         // called whenever the tab is opened
    ensureStyle();
    if (!root()) return;
    if (!planOk()) { paint(); return; }
    paint();
    if (tab === 'stock') { loadItems(); loadSupNames(); } else if (tab === 'recipes') { if (!itemsLoaded) loadItems(); loadRecipes(); } else if (tab === 'expenses') loadExpenses(); else loadSummary();
  }
  /* Low-stock alert: checked quietly in the background (owner / stock access, Pro plans). Puts a red count on the Inventory
     button in the bottom bar and, once a day, a short heads-up. Tapping the button opens Stock, which lists what is low. */
  let alertTimer = null;
  function setBadge(n) {
    const btn = document.querySelector('nav.bottom-nav button[data-view="inventory"]'); if (!btn) return;
    let b = btn.querySelector('.nav-badge.low-badge');
    if (!b) { b = document.createElement('span'); b.className = 'nav-badge low-badge'; b.style.cssText = 'background:var(--danger,#c0392b);color:#fff'; btn.appendChild(b); }
    b.textContent = n > 9 ? '9+' : String(n); b.style.display = n ? '' : 'none';
  }
  async function checkLow() {
    try {
      if (!planOk() || !root() || (typeof role !== 'undefined' && role !== 'owner' && !(typeof can === 'function' && can('analytics')))) return;
      const d = await apiGet('/inventory/items');
      const n = d && d.low_count != null ? d.low_count : (d.items || []).filter(i => i.low && i.is_active).length;
      lowCount = n;
      setBadge(n);
      const day = ymd(new Date()), k = 'xyzzy-lowstock-told';
      let told = ''; try { told = localStorage.getItem(k) || ''; } catch (e) { /* */ }
      if (n && told !== day + ':' + n) {
        try { localStorage.setItem(k, day + ':' + n); } catch (e) { /* */ }
        if (typeof showToast === 'function') showToast(n + (n === 1 ? ' item is' : ' items are') + ' running low — see Inventory → Stock');
      }
    } catch (e) { /* optional — never disturb the dashboard */ }
  }
  function watchLow() { if (alertTimer) return; setTimeout(checkLow, 6000); alertTimer = setInterval(checkLow, 10 * 60000); }
  function setTab(t) { tab = t; load(); }
  function setPeriod(p) { period = p; exp = null; sum = null; load(); }

  /* ---------- painting ---------- */
  function paint() {
    const r = root(); if (!r) return;
    if (!planOk()) {
      r.innerHTML = `<div class="inv-card inv-upsell"><b>Inventory is on the Pro plan</b><p>Track stock, spot what is running low, and see where the money goes — included from Pro (₹499/month).</p>
        <button type="button" class="btn btn-primary" onclick="openMenuView('subscription')">See plans</button></div>`;
      return;
    }
    const seg = (k, l) => `<button type="button" aria-pressed="${tab === k}" onclick="Inventory.setTab('${k}')">${l}</button>`;
    r.innerHTML = `<div class="inv-seg" role="tablist">${seg('stock', 'Stock' + (lowCount ? ` <i class="inv-dot">${lowCount}</i>` : ''))}${seg('recipes', 'Recipes')}${seg('expenses', 'Expenses')}${seg('overview', 'Overview')}</div>` +
      (tab === 'stock' ? stockHtml() : tab === 'recipes' ? recipesHtml() : tab === 'expenses' ? expensesHtml() : overviewHtml());
  }
  const err = m => `<div class="inv-card"><p class="inv-muted">${esc(m)}</p><button type="button" class="btn btn-ghost btn-sm" onclick="Inventory.load()">Try again</button></div>`;
  const periodBar = () => `<div class="inv-chips">${[['today', 'Today'], ['week', '7 days'], ['month', 'This month'], ['last', 'Last month']].map(([k, l]) => `<button type="button" aria-pressed="${period === k}" onclick="Inventory.setPeriod('${k}')">${l}</button>`).join('')}</div>`;

  /* ----- Stock ----- */
  function stockHtml() {
    if (itemsErr && !itemsLoaded) return err(itemsErr);
    if (!itemsLoaded) return '<p class="inv-muted" style="padding:14px 2px;">Loading…</p>';
    const needle = q.trim().toLowerCase();
    const list = items.filter(i => !needle || i.name.toLowerCase().includes(needle) || (i.category || '').toLowerCase().includes(needle));
    const low = list.filter(i => i.low && i.is_active);
    const row = i => `<button type="button" class="inv-row${i.low ? ' low' : ''}${i.is_active ? '' : ' off'}" onclick="Inventory.openItem(${i.id})">
        <span class="inv-main"><b>${esc(i.name)}</b><small>${i.last_unit_cost ? 'avg ' + rs(i.last_unit_cost) + ' / ' + esc(i.unit) : 'no cost yet'}${i.price_up_pct ? ` · <span class="inv-up">price up ${i.price_up_pct}%</span>` : ''}${i.category ? ' · ' + esc(i.category) : ''}${i.is_active ? '' : ' · archived'}</small></span>
        <span class="inv-qty"><b>${qn(i.stock)}</b> ${esc(i.unit)}${i.low ? '<em>Low</em>' : ''}</span></button>`;
    return `<div class="inv-bar"><input class="be-in" type="search" placeholder="Search stock" value="${esc(q)}" oninput="Inventory.search(this.value)" id="inv-search" autocomplete="off">
        <button type="button" class="btn btn-primary" onclick="Inventory.newItem()">+ Item</button></div>
      ${stockValue ? `<p class="inv-note">${items.filter(i => i.is_active).length} items · worth about <b>${rs(stockValue)}</b> at your average purchase prices</p>` : ''}
      <div class="inv-chips"><button type="button" aria-pressed="false" onclick="Inventory.countForm()">Count all</button><button type="button" aria-pressed="false" onclick="Inventory.shopping()">Shopping list${lowCount ? ' (' + lowCount + ')' : ''}</button><button type="button" aria-pressed="false" onclick="Inventory.suppliers()">Suppliers</button></div>
      ${low.length ? `<div class="inv-lowbox"><b>Running low</b><span>${low.map(i => esc(i.name)).join(', ')}</span></div>` : ''}
      <div class="inv-list">${list.length ? list.map(row).join('') : `<div class="inv-card"><p class="inv-muted">${items.length ? 'Nothing matches.' : 'No items yet. Add your first ingredient — milk, coffee, sugar — and its opening stock.'}</p></div>`}</div>
      ${isOwner() ? `<button type="button" class="inv-link" onclick="Inventory.toggleArchived()">${showArchived ? 'Hide' : 'Show'} archived items</button>` : ''}`;
  }
  function search(v) { q = v; const r = root(); paint(); const s = document.getElementById('inv-search'); if (s) { s.focus(); s.setSelectionRange(v.length, v.length); } }
  function toggleArchived() { showArchived = !showArchived; loadItems(); }

  /* ----- Expenses ----- */
  function expensesHtml() {
    if (expErr && !exp) return periodBar() + err(expErr);
    if (!exp) return periodBar() + '<p class="inv-muted" style="padding:14px 2px;">Loading…</p>';
    const byCat = {}; exp.expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const day = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const rows = exp.expenses.map(e => `<button type="button" class="inv-erow" onclick="Inventory.openExpense(${e.id})"><span class="inv-main"><b>${esc(e.category)}</b><small>${day(e.spent_on)}${e.vendor ? ' · ' + esc(e.vendor) : ''}${e.note ? ' · ' + esc(e.note) : ''}${e.method ? ' · ' + esc(e.method.toUpperCase()) : ''}${e.by ? ' · ' + esc(e.by) : ''}</small></span>
        <span class="inv-eamt">${e.photos && e.photos.length ? `<i class="inv-clip">📎 ${e.photos.length}</i>` : ''}<b>${rs(e.amount)}</b></span></button>`).join('');
    return `${periodBar()}<div class="inv-bar"><div class="inv-total"><small>Spent ${periodLabel()}</small><b>${rs(exp.total)}</b></div><button type="button" class="btn btn-primary" onclick="Inventory.newExpense()">+ Expense</button></div>
      ${cats.length > 1 ? `<div class="inv-card">${cats.map(([c, v]) => `<div class="inv-bar-row"><span>${esc(c)}</span><span class="inv-track"><i style="width:${Math.max(3, Math.round(v / exp.total * 100))}%"></i></span><b>${rs(v)}</b></div>`).join('')}</div>` : ''}
      <div class="inv-list">${rows || '<div class="inv-card"><p class="inv-muted">No expenses in this period.</p></div>'}</div>`;
  }

  /* ----- Overview ----- */
  function overviewHtml() {
    if (sumErr && !sum) return periodBar() + err(sumErr);
    if (!sum) return periodBar() + '<p class="inv-muted" style="padding:14px 2px;">Loading…</p>';
    const p = sum.profit;
    const kpi = (l, v, sub, cls) => `<div class="inv-kpi ${cls || ''}"><small>${l}</small><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    return `${periodBar()}<div class="inv-kpis">
        ${kpi('Stock worth', rs(sum.stock_value), sum.item_count + ' items')}
        ${kpi('Running low', sum.low_count, sum.low_count ? 'needs buying' : 'all good', sum.low_count ? 'warn' : '')}
        ${kpi('Spent ' + periodLabel(), rs(sum.expenses_total), sum.purchases_total ? rs(sum.purchases_total) + ' on stock' : '')}
        ${sum.waste_value ? kpi('Wasted', rs(sum.waste_value), 'at last prices') : ''}
        ${p ? kpi('Money in', rs(p.money_in), 'sales you collected') : ''}
        ${p ? kpi('Left after spending', rs(p.left), 'rough — before salaries you did not log', p.left < 0 ? 'warn' : 'good') : ''}</div>
      ${sum.low.length ? `<div class="inv-card"><h4>Running low</h4>${sum.low.map(i => `<div class="inv-bar-row"><span>${esc(i.name)}</span><span></span><b>${qn(i.stock)} ${esc(i.unit)}</b></div>`).join('')}</div>` : ''}
      ${sum.by_category.length ? `<div class="inv-card"><h4>Where the money went</h4>${sum.by_category.map(c => `<div class="inv-bar-row"><span>${esc(c.category)}</span><span class="inv-track"><i style="width:${Math.max(3, c.pct)}%"></i></span><b>${rs(c.amount)}</b></div>`).join('')}</div>` : '<div class="inv-card"><p class="inv-muted">No spending logged in this period yet.</p></div>'}`;
  }

  /* ---------- bottom sheet ---------- */
  let sheetEl = null;
  function sheet(html, onWire) {
    closeSheet();
    sheetEl = document.createElement('div'); sheetEl.className = 'inv-ov';
    sheetEl.innerHTML = `<div class="inv-sheet" role="dialog" aria-modal="true">${html}</div>`;
    sheetEl.addEventListener('click', e => { if (e.target === sheetEl) closeSheet(); });
    document.body.appendChild(sheetEl);
    if (onWire) onWire(sheetEl.firstChild);
  }
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const num = id => Number(val(id)) || 0;
  const field = (label, inner) => `<label class="inv-f"><span>${label}</span>${inner}</label>`;

  /* ---------- photos kept with an entry (bills, receipts, recipe cards) ---------- */
  const blobs = {};
  async function photoUrl(id) {
    if (blobs[id]) return blobs[id];
    const r = await fetch(API_BASE + '/inventory/photos/' + id, { headers: authHeaders() });
    if (!r.ok) throw new Error('photo');
    return (blobs[id] = URL.createObjectURL(await r.blob()));
  }
  function shrinkFile(file) {                       // phone photos are huge; send ~1600 px JPEGs
    return new Promise((res, rej) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Couldn’t read that photo')); };
      img.src = u;
    });
  }
  let pending = [];                                  // photos chosen in the open form, sent after Save
  const pickerHtml = () => `<div class="inv-f"><span>Photos (optional) — a bill, receipt or recipe card</span><div class="inv-thumbs" id="ph-box"></div>
      <label class="btn btn-ghost btn-sm inv-addph">＋ Add photo<input id="ph-in" type="file" accept="image/*" multiple hidden></label></div>`;
  function wirePicker() {
    pending = [];
    const inp = document.getElementById('ph-in'), box = document.getElementById('ph-box'); if (!inp) return;
    const draw = () => { box.innerHTML = pending.map((u, i) => `<span class="inv-th"><img src="${u}" alt=""><button type="button" data-i="${i}" aria-label="Remove photo">✕</button></span>`).join(''); };
    inp.addEventListener('change', async () => {
      for (const f of Array.from(inp.files || [])) { if (pending.length >= 8) break; try { pending.push(await shrinkFile(f)); } catch (e) { showToast(e.message); } }
      inp.value = ''; draw();
    });
    box.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { pending.splice(Number(b.dataset.i), 1); draw(); } });
  }
  async function sendPhotos(target, list, quiet) {          // in the background, after the entry itself is saved
    let bad = 0;
    for (const image of list) { try { await apiSend('POST', '/inventory/photos', Object.assign({ image }, target)); } catch (e) { bad++; } }
    if (bad) showToast(bad + ' photo' + (bad > 1 ? 's' : '') + ' couldn’t be saved — open the entry and add again');
    else if (list.length) showToast(list.length > 1 ? 'Photos saved' : 'Photo saved');
    if (quiet) return;
    exp = null; if (tab === 'expenses') loadExpenses();
  }
  /* a small gallery for one entry: tap to enlarge, add more, remove. `ctx` = { kind: 'expense'|'movement', id, itemId, back } */
  function photosOf(ctx) {
    if (ctx.kind === 'expense') { const e = exp && exp.expenses.find(x => x.id === ctx.id); return e ? e.photos : []; }
    const m = (movesCache[ctx.itemId] || []).find(x => x.id === ctx.id); return m ? m.photos : [];
  }
  async function reload(ctx) {
    if (ctx.kind === 'expense') { await loadExpenses(); }
    else { try { const d = await apiGet('/inventory/items/' + ctx.itemId + '/movements'); movesCache[ctx.itemId] = d.movements; } catch (e) {} }
  }
  async function openPhotos(ctx) {
    const ids = photosOf(ctx);
    const urls = await Promise.all(ids.map(id => photoUrl(id).catch(() => '')));
    sheet(`<div class="inv-sh-head"><h3>Photos</h3><button type="button" class="inv-x" onclick="${ctx.back}" aria-label="Back">‹</button></div>
      <div class="inv-grid">${ids.map((id, i) => `<span class="inv-gi"><img src="${urls[i]}" alt="" data-open="${i}"><button type="button" class="inv-x" data-del="${id}" aria-label="Remove">✕</button></span>`).join('') || '<small class="inv-muted">No photos yet.</small>'}</div>
      <label class="btn btn-ghost" style="display:block;text-align:center;margin-top:12px;">＋ Add photo<input id="gal-in" type="file" accept="image/*" multiple hidden></label>`,
      el => {
        el.addEventListener('click', async e => {
          const o = e.target.closest('[data-open]'); if (o) { window.open(urls[Number(o.dataset.open)], '_blank'); return; }
          const d = e.target.closest('[data-del]'); if (!d) return;
          if (!confirm('Remove this photo?')) return;
          try { await apiSend('DELETE', '/inventory/photos/' + d.dataset.del); await reload(ctx); openPhotos(ctx); } catch (er) { showToast((er && er.message) || 'Couldn’t remove it'); }
        });
        el.querySelector('#gal-in').addEventListener('change', async ev => {
          const got = []; for (const f of Array.from(ev.target.files || [])) { try { got.push(await shrinkFile(f)); } catch (er) { showToast(er.message); } }
          const target = ctx.kind === 'expense' ? { expense_id: ctx.id } : { movement_id: ctx.id };
          await sendPhotos(target, got, true); await reload(ctx); openPhotos(ctx);
        });
      });
  }

  /* ----- item sheet ----- */
  let movesCache = {};
  async function openItem(id) {
    const it = items.find(x => x.id === id); if (!it) return;
    drawItem(it, movesCache[id]);
    try { const d = await apiGet('/inventory/items/' + id + '/movements'); movesCache[id] = d.movements; applyItem(d.item); if (sheetEl && sheetEl.dataset.item == id) drawItem(items.find(x => x.id === id), d.movements); }
    catch (e) { /* the buttons still work; history just isn't shown */ }
  }
  const KIND = { in: 'Added', out: 'Used', waste: 'Wasted', count: 'Counted' };
  function drawItem(it, moves) {
    const when = d => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const hist = (moves || []).slice(0, 12).map(m => `<div class="inv-hrow"><span>${m.sale ? 'Sold' : (KIND[m.kind] || m.kind)} <b>${m.qty > 0 ? '+' : ''}${qn(m.qty)} ${esc(it.unit)}</b>${m.total_cost ? ' · ' + rs(m.total_cost) : ''}<small>${when(m.created_at)}${m.by ? ' · ' + esc(m.by) : ''}${m.supplier ? ' · ' + esc(m.supplier) : ''}${m.note ? ' · ' + esc(m.note) : ''}</small></span><span class="inv-hact">${m.sale ? '' : `<button type="button" class="inv-x" aria-label="Photos" onclick="Inventory.moveSheet(${m.id}, ${it.id}, 'photos')">${m.photos && m.photos.length ? '📎 ' + m.photos.length : '📎'}</button>${isOwner() ? `<button type="button" class="inv-x" aria-label="Edit entry" onclick="Inventory.moveSheet(${m.id}, ${it.id}, 'edit')">✎</button><button type="button" class="inv-x" aria-label="Remove entry" onclick="Inventory.delMove(${m.id}, ${it.id})">✕</button>` : ''}`}</span></div>`).join('');
    sheet(`<div class="inv-sh-head"><div><h3>${esc(it.name)}</h3><small>${it.low ? '<em class="inv-lowtag">Low</em> ' : ''}runs low at ${qn(it.reorder_level)} ${esc(it.unit)}</small></div><button type="button" class="inv-x" onclick="Inventory.closeSheet()" aria-label="Close">✕</button></div>
      <div class="inv-big"><b>${qn(it.stock)}</b> ${esc(it.unit)} <small>${it.last_unit_cost ? '· avg ' + rs(it.last_unit_cost) + ' / ' + esc(it.unit) + (it.last_price && it.last_price !== it.last_unit_cost ? ' · last bought ' + rs(it.last_price) : '') : ''}</small>${it.last_unit_cost ? ` <button type="button" class="inv-link" style="display:inline;margin:0 0 0 6px;" onclick="Inventory.priceHistory(${it.id})">Price history</button>` : ''}</div>
      <div class="inv-acts"><button type="button" class="btn btn-primary" onclick="Inventory.moveForm(${it.id}, 'in')">+ Add stock</button>
        <button type="button" class="btn btn-ghost" onclick="Inventory.moveForm(${it.id}, 'out')">Used</button>
        <button type="button" class="btn btn-ghost" onclick="Inventory.moveForm(${it.id}, 'waste')">Waste</button>
        <button type="button" class="btn btn-ghost" onclick="Inventory.moveForm(${it.id}, 'count')">Count</button></div>
      <div class="inv-h">Recent</div>${hist || '<small class="inv-muted">Nothing yet.</small>'}
      <div class="inv-acts" style="margin-top:14px;">${isOwner() ? `<button type="button" class="btn btn-ghost btn-sm" onclick="Inventory.editItem(${it.id})">Edit item</button><button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="Inventory.archive(${it.id})">${it.is_active ? 'Archive' : 'Restore'}</button>` : ''}</div>`,
      el => { el.parentNode.dataset.item = it.id; });
  }
  function applyItem(row) {
    const k = items.findIndex(x => x.id === row.id);
    if (k >= 0) items[k] = Object.assign({}, items[k], row); else items.push(row);
    lowCount = items.filter(i => i.low && i.is_active).length; stockValue = Math.round(items.filter(i => i.is_active).reduce((s, i) => s + i.value, 0) * 100) / 100; try { setBadge(lowCount); } catch (e) { /* */ }
  }

  /* ----- stock move form ----- */
  function moveForm(id, kind) {
    const it = items.find(x => x.id === id); if (!it) return;
    const T = { in: ['Add stock', 'How much came in?'], out: ['Take out (used)', 'How much was used?'], waste: ['Log waste', 'How much was thrown away?'], count: ['Count the shelf', 'How much is there now?'] }[kind];
    const rq = rid();
    sheet(`<div class="inv-sh-head"><div><h3>${T[0]} · ${esc(it.name)}</h3><small>Now ${qn(it.stock)} ${esc(it.unit)}</small></div><button type="button" class="inv-x" onclick="Inventory.openItem(${id})" aria-label="Back">‹</button></div>
      ${field(T[1] + ' (' + esc(it.unit) + ')', '<input id="mv-qty" class="be-in" type="number" inputmode="decimal" min="0" step="any" autofocus>')}
      ${kind === 'in' ? field('What it cost in total (optional)', '<input id="mv-cost" class="be-in" type="number" inputmode="decimal" min="0" step="any" placeholder="₹">') +
        field('Supplier (optional)', '<input id="mv-sup" class="be-in" type="text" maxlength="60" list="inv-sups" autocomplete="off">' + supList()) +
        field('Paid by', `<select id="mv-method" class="be-in"><option value="">—</option>${METHODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`) +
        '<p class="inv-note" style="margin:6px 0 0;">A cost is also written to Expenses as “Stock purchase”.</p>' : ''}
      ${kind === 'out' || kind === 'waste' ? field('Note (optional)', '<input id="mv-note" class="be-in" type="text" maxlength="200">') : ''}
      ${kind === 'in' ? pickerHtml() : ''}
      <p id="mv-err" class="inv-err" hidden></p>
      <button type="button" class="btn btn-primary" style="width:100%;text-align:center;margin-top:12px;" onclick="Inventory.saveMove(${id}, '${kind}', '${rq}')">Save</button>`,
      () => { wirePicker(); setTimeout(() => { const f = document.getElementById('mv-qty'); if (f) f.focus(); }, 30); });
  }
  async function saveMove(id, kind, rq) {
    const it = items.find(x => x.id === id); if (!it) return;
    const qty = val('mv-qty') === '' ? NaN : num('mv-qty'), er = document.getElementById('mv-err');
    const bad = m => { er.textContent = m; er.hidden = false; };
    if (!(qty >= 0) || (kind !== 'count' && qty <= 0)) return bad('Enter a quantity.');
    if ((kind === 'out' || kind === 'waste') && qty > it.stock + 1e-6) return bad('Only ' + qn(it.stock) + ' ' + it.unit + ' in stock — use Count if the shelf says otherwise.');
    const cost = kind === 'in' ? num('mv-cost') : 0;
    const body = { kind, qty, request_id: rq };
    if (kind === 'in') { if (cost > 0) body.total_cost = cost; if (val('mv-sup')) body.supplier = val('mv-sup'); if (val('mv-method')) body.method = val('mv-method'); }
    else if (val('mv-note')) body.note = val('mv-note');
    // instant: show the new stock now, confirm in the background
    const before = Object.assign({}, it), delta = kind === 'in' ? qty : kind === 'count' ? qty - it.stock : -qty;
    const nextStock = Math.round((it.stock + delta) * 1000) / 1000;
    applyItem(Object.assign({}, it, { stock: nextStock, low: it.reorder_level > 0 && nextStock <= it.reorder_level + 1e-6, last_unit_cost: it.last_unit_cost || (kind === 'in' && cost > 0 ? Math.round(cost / qty * 100) / 100 : it.last_unit_cost) }));
    delete movesCache[id]; exp = null; sum = null;
    closeSheet(); paint(); showToast(kind === 'in' ? 'Stock added' : kind === 'count' ? 'Stock counted' : kind === 'waste' ? 'Waste logged' : 'Stock updated');
    const photos = pending.slice();
    try { const r = await apiSend('POST', '/inventory/items/' + id + '/movements', body); applyItem(r); paint(); if (photos.length && r.movement_id) sendPhotos({ movement_id: r.movement_id }, photos); }
    catch (e) { applyItem(before); paint(); showToast((e && e.message) || 'Couldn’t save that — nothing changed'); }
  }
  async function delMove(mid, itemId) {
    if (!confirm('Remove this entry? The stock goes back, and its Stock purchase expense (if any) is removed.')) return;
    try { applyItem(await apiSend('DELETE', '/inventory/movements/' + mid)); delete movesCache[itemId]; exp = null; sum = null; showToast('Entry removed'); paint(); openItem(itemId); }
    catch (e) { showToast((e && e.message) || 'Couldn’t remove it'); }
  }

  /* ----- add / edit item ----- */
  const groups = () => Array.from(new Set(items.map(i => (i.category || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  function itemForm(it) {
    const unitOpts = (u) => UNITS.concat(UNITS.includes(u) || !u ? [] : [u]).map(x => `<option value="${esc(x)}"${x === (u || 'pcs') ? ' selected' : ''}>${esc(x)}</option>`).join('');
    const gs = groups();
    sheet(`<div class="inv-sh-head"><h3>${it ? 'Edit item' : 'New item'}</h3><button type="button" class="inv-x" onclick="${it ? 'Inventory.openItem(' + it.id + ')' : 'Inventory.closeSheet()'}" aria-label="Close">${it ? '‹' : '✕'}</button></div>
      ${field('Name', `<input id="it-name" class="be-in" type="text" maxlength="60" value="${esc(it ? it.name : '')}" placeholder="e.g. Milk">`)}
      <div class="inv-two">${field('Unit', `<select id="it-unit" class="be-in">${unitOpts(it && it.unit)}</select>`)}
        ${field('Runs low at', `<input id="it-low" class="be-in" type="number" inputmode="decimal" min="0" step="any" value="${it ? it.reorder_level : ''}" placeholder="0">`)}</div>
      <div class="inv-f"><span>Group (optional)</span>
        <input id="it-cat" class="be-in" type="text" maxlength="40" list="it-groups" autocomplete="off" value="${esc(it && it.category || '')}" placeholder="${gs.length ? 'pick below or type a new one' : 'Dairy, Dry goods, Packaging…'}">
        <datalist id="it-groups">${gs.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
        ${gs.length ? `<div class="inv-chips wrap" id="it-gchips">${gs.map(g => `<button type="button" aria-pressed="${it && it.category === g}" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div>` : ''}</div>
      ${it ? '' : field('Stock right now', '<input id="it-open" class="be-in" type="number" inputmode="decimal" min="0" step="any" placeholder="0">')}
      ${it ? '' : `<div class="inv-two">${field('What it cost in total (₹)', '<input id="it-cost" class="be-in" type="number" inputmode="decimal" min="0" step="any" placeholder="optional">')}
        ${field('Paid by', `<select id="it-method" class="be-in"><option value="">—</option>${METHODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`)}</div>
        ${field('Bought from (optional)', '<input id="it-sup" class="be-in" type="text" maxlength="60" list="inv-sups" autocomplete="off">' + supList())}
        <p class="inv-note" style="margin:6px 0 0;">A cost is also written to Expenses as “Stock purchase”.</p>${pickerHtml()}`}
      <p id="it-err" class="inv-err" hidden></p>
      <button type="button" class="btn btn-primary" style="width:100%;text-align:center;margin-top:12px;" onclick="Inventory.saveItem(${it ? it.id : 'null'})">Save</button>`,
      el => {
        if (!it) wirePicker();
        const ch = el.querySelector('#it-gchips');
        if (ch) ch.addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; document.getElementById('it-cat').value = b.dataset.g; ch.querySelectorAll('[data-g]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
        setTimeout(() => { const f = document.getElementById('it-name'); if (f && !it) f.focus(); }, 30);
      });
  }
  const newItem = () => itemForm(null);
  const editItem = id => itemForm(items.find(x => x.id === id));
  async function saveItem(id) {
    const name = val('it-name'), er = document.getElementById('it-err');
    if (!name) { er.textContent = 'Give it a name.'; er.hidden = false; return; }
    const body = { name, unit: val('it-unit') || 'pcs', reorder_level: num('it-low'), category: val('it-cat') || null };
    try {
      if (id == null) {
        body.opening_stock = num('it-open');
        if (body.opening_stock > 0 && num('it-cost') > 0) { body.opening_cost = num('it-cost'); if (val('it-method')) body.method = val('it-method'); if (val('it-sup')) body.supplier = val('it-sup'); }
        const photos = pending.slice(), r = await apiSend('POST', '/inventory/items', body); applyItem(r); showToast('Item added');
        if (photos.length && r.movement_id) sendPhotos({ movement_id: r.movement_id }, photos);
      }
      else { applyItem(await apiSend('PATCH', '/inventory/items/' + id, body)); showToast('Item updated'); }
      closeSheet(); paint(); loadItems();
    } catch (e) { er.textContent = (e && e.message) || 'Couldn’t save'; er.hidden = false; }
  }
  async function archive(id) {
    const it = items.find(x => x.id === id); if (!it) return;
    try {
      if (it.is_active) { if (!confirm('Archive “' + it.name + '”? It leaves the list; its history stays.')) return; await apiSend('DELETE', '/inventory/items/' + id); }
      else await apiSend('PATCH', '/inventory/items/' + id, { is_active: true });
      closeSheet(); showToast(it.is_active ? 'Archived' : 'Restored'); loadItems();
    } catch (e) { showToast((e && e.message) || 'Couldn’t do that'); }
  }

  /* ----- expense: details, add / edit ----- */
  const mineToday = e => isOwner() || (e.by && typeof myProfile !== 'undefined' && myProfile && e.by === myProfile.name && e.created_at && ymd(new Date(e.created_at)) === ymd(new Date()));
  function openExpense(id) {
    const e = exp && exp.expenses.find(x => x.id === id); if (!e) return;
    const day = new Date(e.spent_on + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const can = mineToday(e);
    sheet(`<div class="inv-sh-head"><div><h3>${esc(e.category)}</h3><small>${day}${e.by ? ' · added by ' + esc(e.by) : ''}</small></div><button type="button" class="inv-x" onclick="Inventory.closeSheet()" aria-label="Close">✕</button></div>
      <div class="inv-big"><b>${rs(e.amount)}</b></div>
      ${[['Paid by', e.method && e.method.toUpperCase()], ['Paid to', e.vendor], ['Note', e.note]].filter(r => r[1]).map(([l, v]) => `<div class="inv-hrow"><span>${l}</span><b>${esc(v)}</b></div>`).join('')}
      ${e.from_stock ? '<p class="inv-note" style="margin-top:10px;">This came from a stock purchase. Change its quantity or remove it from the item’s history.</p>' : ''}
      <div class="inv-acts" style="margin-top:14px;"><button type="button" class="btn btn-ghost" onclick="Inventory.openPhotos({ kind: 'expense', id: ${e.id}, back: 'Inventory.openExpense(${e.id})' })">📎 Photos${e.photos && e.photos.length ? ' (' + e.photos.length + ')' : ''}</button>
        ${can ? `<button type="button" class="btn btn-ghost" onclick="Inventory.expenseForm(${e.id})">Edit</button>` : ''}
        ${can && !e.from_stock ? `<button type="button" class="btn btn-ghost" style="color:var(--danger);" onclick="Inventory.delExpense(${e.id})">Delete</button>` : ''}</div>
      ${can ? '' : '<p class="inv-note" style="margin-top:10px;">Only the owner can change an older expense.</p>'}`);
  }
  function expenseForm(editId) {
    const e = editId != null ? exp && exp.expenses.find(x => x.id === editId) : null;
    const rq = rid(), all = Array.from(new Set(CATS.concat(expCats.filter(c => c !== 'Stock purchase'))));
    const cat = e ? e.category : '', locked = e && e.from_stock;
    sheet(`<div class="inv-sh-head"><h3>${e ? 'Edit expense' : 'New expense'}</h3><button type="button" class="inv-x" onclick="${e ? 'Inventory.openExpense(' + e.id + ')' : 'Inventory.closeSheet()'}" aria-label="Close">${e ? '‹' : '✕'}</button></div>
      ${field('Amount', `<input id="ex-amt" class="be-in" type="number" inputmode="decimal" min="0" step="any" placeholder="₹" value="${e ? e.amount : ''}">`)}
      ${locked ? '' : `<div class="inv-f"><span>What for</span><div class="inv-chips wrap" id="ex-cats">${all.map(c => `<button type="button" aria-pressed="${c === cat}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <input id="ex-cat" class="be-in" type="text" maxlength="40" placeholder="or type your own" style="margin-top:6px;" value="${esc(cat)}"></div>`}
      <div class="inv-two">${field('Date', `<input id="ex-date" class="be-in" type="date" value="${e ? e.spent_on : ymd(new Date())}" max="${ymd(new Date())}">`)}
        ${field('Paid by', `<select id="ex-method" class="be-in"><option value="">—</option>${METHODS.map(([v, l]) => `<option value="${v}"${e && e.method === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}</div>
      ${field('Paid to (optional)', `<input id="ex-vendor" class="be-in" type="text" maxlength="60" value="${esc(e && e.vendor || '')}">`)}
      ${field('Note (optional)', `<input id="ex-note" class="be-in" type="text" maxlength="200" value="${esc(e && e.note || '')}">`)}
      ${e ? '' : pickerHtml()}
      <p id="ex-err" class="inv-err" hidden></p>
      <button type="button" class="btn btn-primary" style="width:100%;text-align:center;margin-top:12px;" onclick="Inventory.saveExpense('${rq}', ${e ? e.id : 'null'})">Save</button>`,
      el => {
        if (!e) wirePicker();
        const box = el.querySelector('#ex-cats');
        if (box) box.addEventListener('click', ev => {
          const b = ev.target.closest('[data-c]'); if (!b) return;
          box.querySelectorAll('[data-c]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          document.getElementById('ex-cat').value = b.dataset.c;
        });
        setTimeout(() => { const f = document.getElementById('ex-amt'); if (f && !e) f.focus(); }, 30);
      });
  }
  const newExpense = () => expenseForm(null);
  async function saveExpense(rq, editId) {
    const er = document.getElementById('ex-err'), bad = m => { er.textContent = m; er.hidden = false; };
    const amount = num('ex-amt'), cEl = document.getElementById('ex-cat'), category = cEl ? val('ex-cat') : '';
    if (!(amount > 0)) return bad('Enter the amount.');
    if (cEl && !category) return bad('Pick what it was for.');
    const body = { amount, spent_on: val('ex-date') || undefined, method: val('ex-method') || null, vendor: val('ex-vendor') || null, note: val('ex-note') || null };
    if (cEl) body.category = category;
    try {
      if (editId != null) { await apiSend('PATCH', '/inventory/expenses/' + editId, body); showToast('Expense updated'); }
      else { body.request_id = rq; const photos = pending.slice(), r = await apiSend('POST', '/inventory/expenses', body); showToast('Expense saved'); if (photos.length) sendPhotos({ expense_id: r.id }, photos); }
      closeSheet(); sum = null; await loadExpenses();
    } catch (e) { bad((e && e.message) || 'Couldn’t save'); }
  }
  async function delExpense(id) {
    if (!confirm('Remove this expense?')) return;
    closeSheet();
    const keep = exp && exp.expenses.slice();
    if (exp) { const gone = exp.expenses.find(e => e.id === id); exp.expenses = exp.expenses.filter(e => e.id !== id); if (gone) exp.total = Math.round((exp.total - gone.amount) * 100) / 100; paint(); }
    try { await apiSend('DELETE', '/inventory/expenses/' + id); sum = null; showToast('Removed'); }
    catch (e) { if (exp && keep) { exp.expenses = keep; } showToast((e && e.message) || 'Couldn’t remove it'); loadExpenses(); }
  }

  /* ----- one stock entry: photos, or (owner) fix the numbers ----- */
  function moveSheet(mid, itemId, what) {
    const it = items.find(x => x.id === itemId), m = (movesCache[itemId] || []).find(x => x.id === mid); if (!it || !m) return;
    const back = `Inventory.openItem(${itemId})`;
    if (what === 'photos') return openPhotos({ kind: 'movement', id: mid, itemId, back });
    sheet(`<div class="inv-sh-head"><div><h3>Edit entry</h3><small>${esc(it.name)} · ${KIND[m.kind] || m.kind}</small></div><button type="button" class="inv-x" onclick="${back}" aria-label="Back">‹</button></div>
      ${m.kind === 'count' ? '<p class="inv-note">A count can’t be changed — remove it and count again.</p>' : field('Quantity (' + esc(it.unit) + ')', `<input id="me-qty" class="be-in" type="number" inputmode="decimal" min="0" step="any" value="${Math.abs(m.qty)}">`)}
      ${m.kind === 'in' ? field('What it cost in total (₹)', `<input id="me-cost" class="be-in" type="number" inputmode="decimal" min="0" step="any" value="${m.total_cost || ''}">`) + field('Supplier', `<input id="me-sup" class="be-in" type="text" maxlength="60" value="${esc(m.supplier || '')}">`) : ''}
      ${field('Note', `<input id="me-note" class="be-in" type="text" maxlength="200" value="${esc(m.note || '')}">`)}
      <p id="me-err" class="inv-err" hidden></p>
      <button type="button" class="btn btn-primary" style="width:100%;text-align:center;margin-top:12px;" onclick="Inventory.saveMove2(${mid}, ${itemId})">Save</button>`);
  }
  async function saveMove2(mid, itemId) {
    const er = document.getElementById('me-err'), m = (movesCache[itemId] || []).find(x => x.id === mid); if (!m) return;
    const body = { note: val('me-note') || null };
    if (document.getElementById('me-qty')) { const q = num('me-qty'); if (!(q > 0)) { er.textContent = 'Enter a quantity.'; er.hidden = false; return; } body.qty = q; }
    if (m.kind === 'in') { body.total_cost = num('me-cost'); body.supplier = val('me-sup') || null; }
    try { applyItem(await apiSend('PATCH', '/inventory/movements/' + mid, body)); delete movesCache[itemId]; exp = null; sum = null; showToast('Entry updated'); paint(); openItem(itemId); }
    catch (e) { er.textContent = (e && e.message) || 'Couldn’t save'; er.hidden = false; }
  }


  /* =====================================================================================================
     v2 — recipes, count all, shopping list, suppliers
     ===================================================================================================== */
  const FAM = { g: ['m', 1], kg: ['m', 1000], ml: ['v', 1], l: ['v', 1000], pcs: ['c', 1], dozen: ['c', 12] };
  const conv = (q, a, b) => { if (a === b) return q; const x = FAM[a], y = FAM[b]; return x && y && x[0] === y[0] ? q * x[1] / y[1] : null; };
  const unitsFor = u => ({ kg: ['g', 'kg'], l: ['ml', 'l'], dozen: ['pcs', 'dozen'] }[u] || [u]);
  const supList = () => `<datalist id="inv-sups">${supNames.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
  async function loadSupNames() { try { supNames = ((await apiGet('/inventory/suppliers')).suppliers || []).map(x => x.name); } catch (e) {} }
  const loadingP = '<p class="inv-muted" style="padding:14px 2px;">Loading…</p>';

  /* ----- Recipes tab ----- */
  async function loadRecipes() {
    try {
      const put = d => { rec = d; recErr = null; };
      if (typeof apiGetSWR === 'function') await apiGetSWR('/inventory/recipes', (d, stale) => { put(d); if (stale) paint(); }); else put(await apiGet('/inventory/recipes'));
    } catch (e) { recErr = (e && e.message) || 'Couldn’t load recipes'; }
    paint();
  }
  function recipesHtml() {
    if (recErr && !rec) return err(recErr);
    if (!rec) return loadingP;
    const own = isOwner();
    const todo = rec.dishes.filter(d => !d.has_recipe && d.suggestion).length;
    let cat = null;
    const rows = rec.dishes.map(d => {
      const head = d.category !== cat ? `<div class="inv-h">${esc((cat = d.category) || 'Other')}</div>` : '';
      const sub = d.has_recipe ? `${d.lines} ingredient${d.lines > 1 ? 's' : ''} · costs ${rs(d.cost)}${d.cost_partial ? '+' : ''}` : d.suggestion ? `Default available · ${esc(d.suggestion.name)}` : 'No recipe yet';
      const right = d.has_recipe && d.margin_pct != null ? `<b>${d.margin_pct}%</b> margin` : (own && !d.has_recipe ? '<em class="inv-addtag">Add</em>' : '');
      return head + `<button type="button" class="inv-row" onclick="Inventory.openRecipe(${d.menu_item_id})"><span class="inv-main"><b>${esc(d.name)}</b><small>${sub}</small></span><span class="inv-qty">${right}</span></button>`;
    }).join('');
    return `<div class="inv-card">
        ${own ? `<label class="inv-switch"><input type="checkbox" ${rec.autodeduct ? 'checked' : ''} onchange="Inventory.setAuto(this.checked)"><span><b>Take stock off when a bill is paid</b><small>Uses the recipes below; dishes without one are skipped. Editing or deleting a bill puts it back.</small></span></label>`
          : `<p class="inv-muted" style="margin:0;">Auto-deduct is <b>${rec.autodeduct ? 'on' : 'off'}</b>. Only the owner can change it.</p>`}</div>
      <p class="inv-note">${rec.with_recipe} of ${rec.total} dishes have a recipe${rec.autodeduct && rec.with_recipe < rec.total ? ' — the rest don’t touch stock' : ''}.</p>
      ${own && todo ? `<button type="button" class="btn btn-ghost" style="width:100%;margin-bottom:10px;" onclick="Inventory.fillAll()">Add default recipes to ${todo} dish${todo > 1 ? 'es' : ''}</button>` : ''}
      <div class="inv-list">${rows || '<div class="inv-card"><p class="inv-muted">Add dishes to your menu first, then give them recipes here.</p></div>'}</div>`;
  }
  async function setAuto(on) {
    const prev = rec.autodeduct; rec.autodeduct = on;
    try { await apiSend('PUT', '/inventory/settings', { autodeduct: on }); showToast(on ? 'Auto-deduct is on — new bills take stock off' : 'Auto-deduct is off'); }
    catch (e) { rec.autodeduct = prev; showToast((e && e.message) || 'Couldn’t change it'); }
    paint();
  }
  async function fillAll() {
    const todo = rec.dishes.filter(d => !d.has_recipe && d.suggestion);
    if (!todo.length) return;
    if (!confirm(`Give ${todo.length} dish${todo.length > 1 ? 'es' : ''} a starting recipe? Ingredients you don’t have yet are added to your stock list at zero. You can edit every recipe after.`)) return;
    let ok = 0; const made = new Set();
    for (const d of todo) {
      try { const r = await apiSend('POST', '/inventory/recipes/' + d.menu_item_id + '/from-template', { create_missing: true }); ok++; (r.created_items || []).forEach(n => made.add(n)); } catch (e) {}
      showToast(`Adding recipes… ${ok}/${todo.length}`);
    }
    await loadItems(); await loadRecipes();
    showToast(`${ok} recipe${ok === 1 ? '' : 's'} added${made.size ? ' · ' + made.size + ' new stock item' + (made.size > 1 ? 's' : '') : ''}`);
  }

  /* ----- one dish's recipe ----- */
  function startDraft(d) {
    rd = { mid: d.menu_item_id, name: d.name, price: d.price, has: d.has_recipe, suggestion: d.suggestion, tkey: d.template_key,
           lines: d.lines.map(l => ({ item_id: l.item_id, name: l.name, unit: l.unit, qty: l.show_qty, u: l.show_unit })) };
  }
  async function openRecipe(mid) {
    sheet(loadingP);
    try {
      if (!itemsLoaded) await loadItems();
      startDraft(await apiGet('/inventory/recipes/' + mid)); drawRecipe();
    } catch (e) { closeSheet(); showToast((e && e.message) || 'Couldn’t open the recipe'); }
  }
  const itemById = id => items.find(x => x.id === id);
  function lineCost(l) {
    const it = itemById(l.item_id), q = conv(Number(l.qty) || 0, l.u, l.unit);
    return it && it.last_unit_cost && q != null ? q * it.last_unit_cost : null;
  }
  function totalsHtml() {
    let tot = 0, partial = false;
    rd.lines.forEach(l => { const c = lineCost(l); if (c == null) partial = true; else tot += c; });
    if (!rd.lines.length) return '';
    const m = rd.price ? Math.round((rd.price - tot) / rd.price * 100) : null;
    return `<div class="inv-hrow"><span>Costs you</span><b>${rs(tot)}${partial ? ' +' : ''}</b></div><div class="inv-hrow"><span>Sells for</span><b>${rs(rd.price)}</b></div>` +
      (m != null ? `<div class="inv-hrow"><span>You keep</span><b>${rs(rd.price - tot)} · ${m}%</b></div>` : '') +
      (partial ? '<p class="inv-note" style="margin-top:6px;">Some ingredients have no purchase price yet, so the cost is not complete. Add stock with its cost and it fills in.</p>' : '');
  }
  function drawRecipe(focusLast) {
    const own = isOwner(), d = rd;
    const used = new Set(d.lines.map(l => l.item_id));
    const avail = items.filter(i => i.is_active && !used.has(i.id));
    const lines = d.lines.map((l, i) => own
      ? `<div class="inv-rl"><span class="inv-rn">${esc(l.name)}<small id="rlc-${i}">${lineCost(l) != null ? rs(lineCost(l)) : 'no price yet'}</small></span>
          <input class="be-in" id="rlq-${i}" type="number" inputmode="decimal" min="0" step="any" value="${l.qty}" oninput="Inventory.rlQty(${i}, this.value)">
          <select class="be-in" onchange="Inventory.rlUnit(${i}, this.value)">${unitsFor(l.unit).map(u => `<option${u === l.u ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
          <button type="button" class="inv-x" aria-label="Remove ingredient" onclick="Inventory.rlDel(${i})">✕</button></div>`
      : `<div class="inv-hrow"><span>${esc(l.name)}</span><b>${qn(l.qty)} ${esc(l.u)}</b></div>`).join('');
    const sugg = d.suggestion;
    sheet(`<div class="inv-sh-head"><div><h3>${esc(d.name)}</h3><small>What one portion uses${d.tkey ? ' · started from a default' : ''}</small></div><button type="button" class="inv-x" onclick="Inventory.closeSheet()" aria-label="Close">✕</button></div>
      ${lines || '<p class="inv-muted">No ingredients yet.</p>'}
      ${own ? `<select class="be-in" id="rl-add" onchange="Inventory.rlAdd(this.value)" style="margin-top:8px;"><option value="">＋ Add an ingredient…</option>${avail.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select>
        ${items.length ? '' : '<p class="inv-note">Your stock list is empty — use a default below and the ingredients get created for you.</p>'}` : ''}
      <div id="rl-tot" style="margin-top:10px;">${totalsHtml()}</div>
      ${own ? `<div class="inv-h">Start from a default</div>
        <div class="inv-tpl">${sugg ? `<button type="button" class="btn btn-ghost btn-sm" onclick="Inventory.useDefault('${sugg.key}')">Use “${esc(sugg.name)}” default</button>` : ''}
          <select class="be-in" id="rl-tpl" onfocus="Inventory.loadTpls()" onchange="Inventory.useDefault(this.value)"><option value="">Pick another default…</option>${(tpls || []).map(t => `<option value="${t.key}">${esc(t.name)}</option>`).join('')}</select></div>
        <p class="inv-note">Defaults are rough per-portion amounts. Change them to match how you make it.</p>
        <p id="rl-err" class="inv-err" hidden></p>
        <button type="button" class="btn btn-primary" style="width:100%;text-align:center;margin-top:8px;" onclick="Inventory.saveRecipe()">Save recipe</button>
        ${d.has ? '<button type="button" class="inv-link" style="color:var(--danger);" onclick="Inventory.delRecipe()">Remove this recipe</button>' : ''}` : '<p class="inv-note" style="margin-top:12px;">Only the owner can change recipes.</p>'}`,
      () => { if (focusLast) { const f = document.getElementById('rlq-' + (d.lines.length - 1)); if (f) f.focus(); } });
  }
  function retotal() {
    rd.lines.forEach((l, i) => { const c = lineCost(l), e = document.getElementById('rlc-' + i); if (e) e.textContent = c != null ? rs(c) : 'no price yet'; });
    const t = document.getElementById('rl-tot'); if (t) t.innerHTML = totalsHtml();
  }
  const rlQty = (i, v) => { rd.lines[i].qty = v; retotal(); };
  const rlUnit = (i, u) => { const l = rd.lines[i], q = conv(Number(l.qty) || 0, l.u, u); if (q != null && l.qty !== '') { l.qty = Math.round(q * 10000) / 10000; const f = document.getElementById('rlq-' + i); if (f) f.value = l.qty; } l.u = u; retotal(); };
  const rlDel = i => { rd.lines.splice(i, 1); drawRecipe(); };
  function rlAdd(id) {
    const it = itemById(Number(id)); if (!it) return;
    rd.lines.push({ item_id: it.id, name: it.name, unit: it.unit, qty: '', u: unitsFor(it.unit)[0] }); drawRecipe(true);
  }
  async function loadTpls() { if (tpls) return; try { tpls = await apiGet('/inventory/recipe-templates'); const s = document.getElementById('rl-tpl'); if (s) s.insertAdjacentHTML('beforeend', tpls.map(t => `<option value="${t.key}">${esc(t.name)}</option>`).join('')); } catch (e) {} }
  async function useDefault(key) {
    if (!key) return;
    if (rd.lines.length && !confirm('This replaces the ingredients listed here with the default. Continue?')) { const s = document.getElementById('rl-tpl'); if (s) s.value = ''; return; }
    try {
      const r = await apiSend('POST', '/inventory/recipes/' + rd.mid + '/from-template', { template_key: key, create_missing: true });
      if (r.created_items && r.created_items.length) { await loadItems(); showToast('Added to your stock list: ' + r.created_items.join(', ')); }
      else if (r.skipped && r.skipped.length) showToast('Skipped: ' + r.skipped.join(', '));
      startDraft(r); rd.has = true; loadRecipes(); drawRecipe();
    } catch (e) { showToast((e && e.message) || 'Couldn’t use that default'); }
  }
  async function saveRecipe() {
    const er = document.getElementById('rl-err');
    const lines = rd.lines.filter(l => Number(l.qty) > 0).map(l => ({ item_id: l.item_id, qty: Number(l.qty), unit: l.u }));
    if (rd.lines.length && !lines.length) { er.textContent = 'Fill in how much of each ingredient one portion uses.'; er.hidden = false; return; }
    try { await apiSend('PUT', '/inventory/recipes/' + rd.mid, { lines }); closeSheet(); showToast(lines.length ? 'Recipe saved' : 'Recipe removed'); loadRecipes(); }
    catch (e) { er.textContent = (e && e.message) || 'Couldn’t save'; er.hidden = false; }
  }
  async function delRecipe() {
    if (!confirm('Remove the recipe for ' + rd.name + '? Bills will stop taking stock off for it.')) return;
    try { await apiSend('DELETE', '/inventory/recipes/' + rd.mid); closeSheet(); showToast('Recipe removed'); loadRecipes(); }
    catch (e) { showToast((e && e.message) || 'Couldn’t remove it'); }
  }


  /* ----- what an item has cost over time ----- */
  async function priceHistory(id) {
    const it = items.find(x => x.id === id); if (!it) return;
    sheet(loadingP);
    try {
      const d = await apiGet('/inventory/items/' + id + '/prices');
      const day = t => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      sheet(`<div class="inv-sh-head"><div><h3>${esc(it.name)} · price history</h3><small>Average now ${rs(d.average)} / ${esc(it.unit)}</small></div><button type="button" class="inv-x" onclick="Inventory.openItem(${id})" aria-label="Back">‹</button></div>
        ${d.purchases.length ? d.purchases.map((p, i) => { const prev = d.purchases[i + 1], ch = prev ? Math.round((p.unit_cost / prev.unit_cost - 1) * 100) : 0;
          return `<div class="inv-hrow"><span>${day(p.date)} · ${qn(p.qty)} ${esc(it.unit)} for ${rs(p.total)}<small>${p.supplier ? esc(p.supplier) : ''}${prev && ch ? (p.supplier ? ' · ' : '') + (ch > 0 ? '▲ ' : '▼ ') + Math.abs(ch) + '% vs before' : ''}</small></span><b>${rs(p.unit_cost)} / ${esc(it.unit)}</b></div>`; }).join('')
          : '<p class="inv-muted">No priced purchases yet.</p>'}
        <p class="inv-note" style="margin-top:10px;">The average blends every priced purchase with what was on the shelf at the time. Using stock never changes it.</p>`);
    } catch (e) { openItem(id); showToast((e && e.message) || 'Couldn’t load the history'); }
  }

  /* ----- count everything at once ----- */
  function countForm() {
    const act = items.filter(i => i.is_active);
    if (!act.length) { showToast('Add some stock items first'); return; }
    const rq = rid();
    sheet(`<div class="inv-sh-head"><div><h3>Count the shelf</h3><small>Type what is really there. Leave blank what you didn’t count.</small></div><button type="button" class="inv-x" onclick="Inventory.closeSheet()" aria-label="Close">✕</button></div>
      <div class="inv-crs">${act.map(i => `<label class="inv-cr"><span class="inv-main"><b>${esc(i.name)}</b><small>system says ${qn(i.stock)} ${esc(i.unit)}</small></span><input class="be-in" id="cn-${i.id}" type="number" inputmode="decimal" min="0" step="any" placeholder="${esc(i.unit)}"></label>`).join('')}</div>
      <p id="cn-err" class="inv-err" hidden></p>
      <button type="button" class="btn btn-primary" style="width:100%;text-align:center;margin-top:12px;" onclick="Inventory.saveCount('${rq}')">Save count</button>`);
  }
  async function saveCount(rq) {
    const counts = items.filter(i => i.is_active && val('cn-' + i.id) !== '').map(i => ({ item_id: i.id, qty: num('cn-' + i.id) }));
    const er = document.getElementById('cn-err');
    if (!counts.length) { er.textContent = 'Enter at least one count.'; er.hidden = false; return; }
    try {
      const r = await apiSend('POST', '/inventory/count', { counts, request_id: rq });
      await loadItems(); exp = null; sum = null;
      sheet(`<div class="inv-sh-head"><h3>Count saved</h3><button type="button" class="inv-x" onclick="Inventory.closeSheet()" aria-label="Close">✕</button></div>
        ${r.changed.length ? r.changed.map(c => `<div class="inv-hrow"><span>${esc(c.name)}<small>${qn(c.was)} → ${qn(c.now)} ${esc(c.unit)}</small></span><b style="color:${c.diff < 0 ? 'var(--danger)' : 'inherit'}">${c.diff > 0 ? '+' : ''}${qn(c.diff)}</b></div>`).join('') : '<p class="inv-muted">Everything matched. Nice.</p>'}
        ${r.loss_value ? `<div class="inv-lowbox" style="margin-top:12px;"><b>Missing stock worth about ${rs(r.loss_value)}</b><span>at your average purchase prices</span></div>` : ''}`);
    } catch (e) { er.textContent = (e && e.message) || 'Couldn’t save the count'; er.hidden = false; }
  }

  /* ----- shopping list ----- */
  async function shopping() {
    sheet(loadingP);
    try {
      const d = await apiGet('/inventory/shopping-list');
      if (!d.items.length) { sheet(`<div class="inv-sh-head"><h3>Shopping list</h3><button type="button" class="inv-x" onclick="Inventory.closeSheet()" aria-label="Close">✕</button></div><p class="inv-muted">Nothing is running low. Set a “runs low at” level on an item and it shows up here.</p>`); return; }
      const by = {}; d.items.forEach(i => { (by[i.supplier || 'No supplier yet'] = by[i.supplier || 'No supplier yet'] || []).push(i); });
      const text = 'Shopping list\n' + Object.entries(by).map(([s, a]) => '\n' + s + '\n' + a.map(i => '• ' + i.name + ' — ' + qn(i.buy) + ' ' + i.unit).join('\n')).join('\n');
      window.__invShop = text;
      sheet(`<div class="inv-sh-head"><div><h3>Shopping list</h3><small>${d.items.length} item${d.items.length > 1 ? 's' : ''}${d.est_total ? ' · about ' + rs(d.est_total) : ''}</small></div><button type="button" class="inv-x" onclick="Inventory.closeSheet()" aria-label="Close">✕</button></div>
        ${Object.entries(by).map(([s, a]) => `<div class="inv-h">${esc(s)}</div>${a.map(i => `<div class="inv-hrow"><span>${esc(i.name)}<small>have ${qn(i.stock)} ${esc(i.unit)}${i.est_cost ? ' · about ' + rs(i.est_cost) : ''}</small></span><b>${qn(i.buy)} ${esc(i.unit)}</b></div>`).join('')}`).join('')}
        <div class="inv-acts" style="margin-top:14px;"><a class="btn btn-primary" style="text-align:center;" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Send on WhatsApp</a>
          <button type="button" class="btn btn-ghost" onclick="Inventory.copyShop()">Copy</button></div>`);
    } catch (e) { closeSheet(); showToast((e && e.message) || 'Couldn’t load the list'); }
  }
  function copyShop() {
    try { navigator.clipboard.writeText(window.__invShop || '').then(() => showToast('Copied'), () => showToast('Couldn’t copy')); } catch (e) { showToast('Couldn’t copy'); }
  }

  /* ----- suppliers ----- */
  async function suppliers() {
    sheet(loadingP);
    try {
      const d = await apiGet('/inventory/suppliers'); supNames = d.suppliers.map(x => x.name);
      const day = t => t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
      sheet(`<div class="inv-sh-head"><h3>Suppliers</h3><button type="button" class="inv-x" onclick="Inventory.closeSheet()" aria-label="Close">✕</button></div>
        ${d.suppliers.length ? d.suppliers.map(s => `<div class="inv-hrow"><span><b>${esc(s.name)}</b><small>${s.purchases ? s.purchases + ' purchase' + (s.purchases > 1 ? 's' : '') + ' · last ' + day(s.last) : 'no purchases yet'}${s.items.length ? ' · ' + esc(s.items.join(', ')) : ''}</small>
            ${s.phone ? `<small><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></small>` : ''}${s.note ? `<small>${esc(s.note)}</small>` : ''}</span>
            <span class="inv-hact"><b>${rs(s.spent)}</b>${isOwner() ? `<button type="button" class="inv-x" aria-label="Edit supplier" data-s="${esc(s.name)}" data-p="${esc(s.phone || '')}" data-n="${esc(s.note || '')}" onclick="Inventory.supplierForm(this.dataset.s, this.dataset.p, this.dataset.n)">✎</button>` : ''}</span></div>`).join('')
          : '<p class="inv-muted">Suppliers appear here as you add stock with a “Supplier” name.</p>'}
        ${isOwner() ? '<button type="button" class="btn btn-ghost" style="width:100%;margin-top:12px;" onclick="Inventory.supplierForm()">＋ Add a supplier</button>' : ''}`);
    } catch (e) { closeSheet(); showToast((e && e.message) || 'Couldn’t load suppliers'); }
  }
  function supplierForm(name, phone, note) {
    const edit = !!name;
    sheet(`<div class="inv-sh-head"><h3>${edit ? 'Edit supplier' : 'New supplier'}</h3><button type="button" class="inv-x" onclick="Inventory.suppliers()" aria-label="Back">‹</button></div>
      ${field('Name', `<input id="sp-name" class="be-in" type="text" maxlength="60" value="${esc(name || '')}"${edit ? ' readonly' : ''}>`)}
      ${field('Phone (optional)', `<input id="sp-phone" class="be-in" type="tel" maxlength="20" value="${esc(phone || '')}">`)}
      ${field('Note (optional)', `<input id="sp-note" class="be-in" type="text" maxlength="200" value="${esc(note || '')}" placeholder="e.g. delivers before 8 am">`)}
      <p id="sp-err" class="inv-err" hidden></p>
      <button type="button" class="btn btn-primary" style="width:100%;text-align:center;margin-top:12px;" onclick="Inventory.saveSupplier()">Save</button>
      ${edit ? '<button type="button" class="inv-link" style="color:var(--danger);" onclick="Inventory.delSupplier()">Remove phone &amp; note</button>' : ''}`);
  }
  async function saveSupplier() {
    const er = document.getElementById('sp-err');
    if (!val('sp-name')) { er.textContent = 'Enter a name.'; er.hidden = false; return; }
    try { await apiSend('POST', '/inventory/suppliers', { name: val('sp-name'), phone: val('sp-phone') || null, note: val('sp-note') || null }); showToast('Saved'); suppliers(); }
    catch (e) { er.textContent = (e && e.message) || 'Couldn’t save'; er.hidden = false; }
  }
  async function delSupplier() {
    try { await apiSend('DELETE', '/inventory/suppliers/' + encodeURIComponent(val('sp-name'))); showToast('Removed'); suppliers(); }
    catch (e) { showToast((e && e.message) || 'Couldn’t remove it'); }
  }

  /* ---------- styles (kept here so this one file is all the tab needs) ---------- */
  function ensureStyle() {
    if (document.getElementById('inv-style')) return;
    const s = document.createElement('style'); s.id = 'inv-style';
    s.textContent = `
      .inv-seg, .inv-chips { display: flex; gap: 6px; margin: 0 0 12px; } .inv-chips.wrap { flex-wrap: wrap; margin: 6px 0 0; }
      .inv-seg button { all: unset; flex: 1; text-align: center; font-size: 13px; font-weight: 600; padding: 9px 0; border-radius: 999px; background: var(--paper); border: 1px solid var(--border); color: var(--text-secondary); cursor: pointer; }
      .inv-seg button[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: #fff; }
      .inv-chips button { all: unset; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 999px; background: var(--paper); border: 1px solid var(--border); color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
      .inv-chips button[aria-pressed="true"] { background: var(--teal); border-color: var(--teal); color: #fff; }
      .inv-dot { font-style: normal; background: var(--danger); color: #fff; border-radius: 999px; font-size: 10.5px; padding: 1px 6px; margin-left: 4px; }
      .inv-bar { display: flex; gap: 10px; align-items: center; margin: 0 0 12px; } .inv-bar .be-in { flex: 1; } .inv-bar .btn { flex: 0 0 auto; }
      .inv-note { font-size: 12.5px; color: var(--text-secondary); margin: 0 2px 10px; } .inv-muted { color: var(--text-secondary); font-size: 13.5px; margin: 6px 0; }
      .inv-list { display: flex; flex-direction: column; gap: 8px; }
      .inv-row { all: unset; box-sizing: border-box; width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; background: var(--paper); border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
      .inv-row.low { border-color: #E9B8AB; background: #FFF8F6; } .inv-row.off { opacity: .55; }
      .inv-main { display: flex; flex-direction: column; min-width: 0; } .inv-main b { font-size: 14px; } .inv-main small { color: var(--text-secondary); font-size: 12px; margin-top: 2px; }
      .inv-qty { text-align: right; font-size: 13px; color: var(--text-secondary); white-space: nowrap; } .inv-qty b { font-size: 17px; color: var(--text); }
      .inv-qty em, .inv-lowtag { display: block; font-style: normal; font-size: 10.5px; font-weight: 700; color: var(--danger); text-transform: uppercase; letter-spacing: .04em; } .inv-lowtag { display: inline; }
      .inv-lowbox { background: var(--danger-soft); color: var(--danger); border-radius: 10px; padding: 9px 12px; font-size: 12.5px; margin: 0 0 10px; display: flex; flex-direction: column; gap: 2px; }
      .inv-link { all: unset; cursor: pointer; color: var(--teal); font-size: 12.5px; font-weight: 700; padding: 14px 2px; display: block; }
      .inv-card { background: var(--paper); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin: 0 0 12px; } .inv-card h4 { margin: 0 0 10px; font-size: 13.5px; }
      .inv-upsell { text-align: center; padding: 26px 18px; } .inv-upsell p { color: var(--text-secondary); font-size: 13.5px; margin: 8px 0 16px; }
      .inv-total { flex: 1; } .inv-total small { display: block; color: var(--text-secondary); font-size: 12px; } .inv-total b { font-size: 24px; }
      .inv-bar-row { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 4px 0; } .inv-bar-row > span:first-child { flex: 0 0 38%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .inv-bar-row b { margin-left: auto; white-space: nowrap; } .inv-track { flex: 1; height: 8px; background: var(--canvas); border-radius: 99px; overflow: hidden; } .inv-track i { display: block; height: 100%; background: var(--teal); border-radius: 99px; }
      .inv-erow { display: flex; justify-content: space-between; gap: 10px; align-items: center; padding: 11px 14px; background: var(--paper); border: 1px solid var(--border); border-radius: 12px; }
      .inv-eamt { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
      .inv-x { all: unset; cursor: pointer; color: var(--text-secondary); font-size: 15px; padding: 4px 8px; border-radius: 6px; } .inv-x:hover { background: var(--canvas); }
      .inv-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0 0 12px; }
      .inv-kpi { background: var(--paper); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; } .inv-kpi small { display: block; color: var(--text-secondary); font-size: 12px; } .inv-kpi b { font-size: 21px; display: block; margin: 2px 0; }
      .inv-kpi em { font-style: normal; color: var(--text-secondary); font-size: 11.5px; } .inv-kpi.warn b { color: var(--danger); } .inv-kpi.good b { color: #1E8E5A; }
      .inv-ov { position: fixed; inset: 0; background: rgba(15,17,22,.45); z-index: 300; display: flex; align-items: flex-end; justify-content: center; }
      .inv-sheet { background: var(--paper); width: 100%; max-width: 520px; max-height: 88vh; overflow-y: auto; border-radius: 18px 18px 0 0; padding: 16px 18px 24px; box-sizing: border-box; }
      @media (min-width: 700px) { .inv-ov { align-items: center; } .inv-sheet { border-radius: 18px; } }
      .inv-sh-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; } .inv-sh-head h3 { margin: 0; font-size: 17px; } .inv-sh-head small { color: var(--text-secondary); font-size: 12.5px; }
      .inv-big { font-size: 15px; margin: 4px 0 12px; color: var(--text-secondary); } .inv-big b { font-size: 34px; color: var(--text); } .inv-big small { font-size: 12.5px; }
      .inv-acts { display: flex; gap: 8px; flex-wrap: wrap; } .inv-acts .btn { flex: 1; text-align: center; }
      .inv-h { font-size: 11.5px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .05em; margin: 16px 0 6px; }
      .inv-hrow { display: flex; justify-content: space-between; gap: 10px; align-items: center; font-size: 13px; padding: 7px 0; border-top: 1px solid var(--border); } .inv-hrow small { display: block; color: var(--text-secondary); font-size: 11.5px; margin-top: 1px; }
      .inv-f { display: block; margin: 10px 0 0; } .inv-f > span { display: block; font-size: 11.5px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
      .inv-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      button.inv-erow { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: flex; justify-content: space-between; gap: 10px; align-items: center; padding: 11px 14px; background: var(--paper); border: 1px solid var(--border); border-radius: 12px; }
      .inv-clip { font-style: normal; font-size: 12px; color: var(--text-secondary); }
      .inv-hact { display: flex; align-items: center; white-space: nowrap; }
      .inv-thumbs, .inv-grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; } .inv-addph { cursor: pointer; text-align: center; }
      .inv-th, .inv-gi { position: relative; display: inline-block; } .inv-th img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); }
      .inv-th button { all: unset; position: absolute; top: -6px; right: -6px; background: var(--ink); color: #fff; width: 20px; height: 20px; border-radius: 50%; text-align: center; line-height: 20px; font-size: 11px; cursor: pointer; }
      .inv-gi img { width: 110px; height: 110px; object-fit: cover; border-radius: 10px; border: 1px solid var(--border); cursor: zoom-in; } .inv-gi .inv-x { position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,.55); color: #fff; }
      .inv-switch { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; } .inv-switch input { margin-top: 3px; width: 20px; height: 20px; flex: 0 0 auto; accent-color: var(--teal); }
      .inv-switch span { display: flex; flex-direction: column; } .inv-switch small { color: var(--text-secondary); font-size: 12px; margin-top: 2px; }
      .inv-addtag { font-style: normal; font-size: 11px; font-weight: 700; color: var(--teal); text-transform: uppercase; letter-spacing: .04em; }
      .inv-rl { display: grid; grid-template-columns: 1fr 78px 64px 28px; gap: 6px; align-items: center; margin: 6px 0; } .inv-rl .be-in { padding: 8px 6px; min-width: 0; }
      .inv-rn { display: flex; flex-direction: column; font-size: 13.5px; font-weight: 600; min-width: 0; } .inv-rn small { color: var(--text-secondary); font-weight: 400; font-size: 11.5px; }
      .inv-tpl { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; } .inv-tpl .be-in { flex: 1; min-width: 150px; }
      .inv-crs { display: flex; flex-direction: column; gap: 6px; max-height: 52vh; overflow: auto; } .inv-cr { display: flex; justify-content: space-between; align-items: center; gap: 10px; } .inv-cr .be-in { width: 100px; flex: 0 0 auto; }
      .inv-up { color: var(--danger); font-weight: 600; }
      .inv-err { color: var(--danger); font-size: 12.5px; margin: 10px 0 0; }`;
    document.head.appendChild(s);
  }

  return { watchLow, checkLow, load, setTab, setPeriod, search, toggleArchived, openItem, closeSheet, moveForm, saveMove, delMove, moveSheet, saveMove2, priceHistory, countForm, saveCount, shopping, copyShop, suppliers, supplierForm, saveSupplier, delSupplier, openRecipe, setAuto, fillAll, rlQty, rlUnit, rlDel, rlAdd, loadTpls, useDefault, saveRecipe, delRecipe, newItem, editItem, saveItem, archive, newExpense, expenseForm, openExpense, saveExpense, delExpense, openPhotos };
})();
window.Inventory = Inventory;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Inventory.watchLow()); else Inventory.watchLow();
