/* table-cards.js — the Orders tab as table cards.
 *
 * One card per table (plus a "Walk-in / counter" card when there are orders
 * without a table). Tapping a card opens a sheet with:
 *   • a QR button beside the table number — tap it to show the table's QR
 *     plus Download / Edit / Remove pills (they stay grey until the QR renders)
 *   • Open orders — at the top of the sheet, whatever the history filter says
 *   • kitchen staff: "Ready to serve" + a printable KOT (kitchen order ticket) on each open order
 *   • History — completed orders, filtered by range + sorted newest/oldest
 *   • per order: placed-at time, edit items, remove, and "club" (merge) orders
 *   • "Unclub" on an open clubbed order splits it back into the orders it came from
 *
 * Loaded by dashboard.html after the main script. Wire it up once:
 *   TableCards.init({ getOrders, setOrders, getTables, setTables, getMenu, getCafe,
 *                     role, api, get, toast, orderUrl, changed })
 *
 * Backend it expects (the first two already exist):
 *   PATCH  /orders/{id}/status?new_status=…     PATCH /orders/{id}/table {table_id}
 *   PATCH  /tables/{id} {table_number}          DELETE /tables/{id}
 *   PATCH  /orders/{id}   {items:[{id?,menu_item_id?,quantity,size?,temperature?}], note}  → full order   (new)
 *   DELETE /orders/{id}                                                                (new)
 *   POST   /orders/merge  {order_ids:[…]}  → the merged order                          (new)
 *   (ctx.canSettle() — optional — hides "Settle & Print" for staff without billing access)
 *   (ctx.printKot(order) / ctx.kotPrintedAt(order) — optional — the kitchen's "Print KOT" button)
 *   (ctx.placedBy(order) — optional — {kind:'customer'} or {kind:'staff', name} for the "QR menu" / waiter chip)
 *   (ctx.canManage() — optional — hides Edit / Remove / Club / Unclub / Move for staff without billing access)
 *   (ctx.canTrim() — optional — staff without billing may still Move an OPEN order and take items off it)
 *   (ctx.isKitchen() — optional — chefs get a "Ready to serve" box instead of Completed)
 *   PATCH  /orders/{id}/cooked {cooked: bool}   → the staff-only "ready to serve" flag (kitchen only)
 *   POST   /orders/{id}/unmerge            → [the original orders, restored]           (new)
 */
(function (root) {
  'use strict';

  let ctx = null;
  let el = {};
  let S = null;                                   // the open sheet's session state
  const G = { filter: 'all', zone: 'all', range: '7d', sort: 'new' };   // view prefs that stick between opens

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const money = v => '₹' + num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  // What the customer actually paid: the bill's final total once billed (after discount / loyalty points /
  // service charge / GST), otherwise the items total.
  const finalOf = o => (o.bill_total != null ? num(o.bill_total) : num(o.total_amount));
  // The lines of the bill's working, for History: Subtotal → discount or loyalty → service charge → GST → Total.
  // Empty when the bill had no extras (then the items already add up to the total) or isn't billed yet.
  function billLines(o) {
    if (!o || o.bill_total == null) return [];
    const pk = num(o.bill_packaging);                                                  // packaging fee, its own line
    const disc = num(o.bill_discount), sc = num(o.bill_service_charge), gst = num(o.bill_gst), pts = num(o.bill_points_used);
    if (!disc && !sc && !gst && !pk) return [];
    const pct = (t, v) => (t === 'percent' && num(v) ? ' (' + num(v) + '%)' : '');
    const rows = [{ label: 'Subtotal', amount: num(o.bill_subtotal) }];
    if (disc) rows.push({ label: pts > 0 ? 'Loyalty points · ' + pts + ' pts' : 'Discount' + pct(o.bill_discount_type, o.bill_discount_value), amount: -disc });
    if (sc) rows.push({ label: 'Service charge' + pct(o.bill_service_charge_type, o.bill_service_charge_value), amount: sc });
    if (pk) rows.push({ label: 'Packaging fee', amount: pk });
    if (gst) rows.push({ label: 'GST (' + num(o.bill_gst_percent) + '%)', amount: gst });
    rows.push({ label: 'Total', amount: num(o.bill_total), strong: true });
    return rows;
  }
  let dupBillOrders = new Set();   // completed orders whose bill is already counted on an earlier card (one bill over several orders)
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isOpen = o => o.status !== 'paid';
  const hasBill = o => !!o.bill_requested_at;   // the guest tapped "Ask for the bill" on the QR menu
  const statusLabel = s => (s === 'paid' ? 'completed' : s);
  const isClubbed = o => Number(o.clubbed_count) > 0;   // the server says how many orders were folded into this one — still true after a page reload
  const toast = m => { try { ctx.toast(m); } catch (e) { /* no toast host */ } };
  const tsOf = o => { const t = new Date(o.created_at).getTime(); return isFinite(t) ? t : 0; };

  const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['1y', '1 year'], ['all', 'All time']];
  function rangeStart(key) {
    const now = new Date();
    if (key === 'today') { now.setHours(0, 0, 0, 0); return now; }
    const days = { '7d': 7, '30d': 30, '1y': 365 }[key];
    return days ? new Date(Date.now() - days * 864e5) : null;
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const now = new Date(), y = new Date(); y.setDate(now.getDate() - 1);
    const t = fmtTime(iso);
    if (d.toDateString() === now.toDateString()) return 'Today, ' + t;
    if (d.toDateString() === y.toDateString()) return 'Yesterday, ' + t;
    const o = d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
    return d.toLocaleDateString([], o) + ', ' + t;
  }

  const allOrders = () => ctx.getOrders() || [];
  const ordersFor = tid => allOrders().filter(o => (tid === 'walkin' ? o.table_id == null : o.table_id === tid));
  const olderList = () => (ctx.getOlder ? (ctx.getOlder() || []) : []);
  const RANGE_DAYS = { '7d': 7, '30d': 30, '1y': 365, all: 3650 };
  // Completed orders for one table: the live list plus any older ones fetched on demand.
  function doneFor(tid) {
    const live = ordersFor(tid).filter(o => !isOpen(o));
    const ids = new Set(live.map(o => o.id));
    const older = olderList().filter(o => (tid === 'walkin' ? o.table_id == null : o.table_id === tid) && !ids.has(o.id) && !isOpen(o));
    return live.concat(older);
  }
  // A longer History period than the live list carries → fetch once, then repaint.
  function ensureOlder() {
    const days = RANGE_DAYS[G.range];
    if (!S || !days || !ctx.loadOlder) return;
    const key = S.walk ? 'walkin' : String(S.tid);
    if (ctx.olderCovered && ctx.olderCovered(days, key)) return;
    S.tried = S.tried || {};
    if (S.tried[G.range] || S.loadingOlder) return;
    S.tried[G.range] = true; S.loadingOlder = true;
    const mine = S;
    Promise.resolve(ctx.loadOlder(days, key)).then(() => { mine.loadingOlder = false; if (ctx.olderCovered && ctx.olderCovered(days, key)) delete mine.tried[G.range];   // only a FAILED fetch stays marked, so it isn't retried in a loop
       if (S === mine) { el.bodyHtml = ''; renderBody(false); } }, () => { mine.loadingOlder = false; });
  }
  /* Each area (Indoor / Outdoor / Rooftop) is numbered 1 - 50, 50 tables in total. A table reads as its own name when
     the café gave it one ("Cabin 1"), else "Table 5 · Rooftop"; once any table is outdoors, indoor ones say "· Indoor" too. */
  const ZONES = { rooftop: 'Rooftop', outdoor: 'Outdoor' };
  const ZRANK = { '': 0, outdoor: 1, rooftop: 2 };
  const multi = () => (ctx.getTables() || []).some(t => ZONES[t.zone]);
  const zoneName = t => ZONES[t && t.zone] || (multi() ? 'Indoor' : '');
  const isNumName = n => /^\d+[A-Za-z]?$/.test(String(n == null ? '' : n).trim());
  const tl = t => {
    if (!t) return 'Table';
    if (t.name) return t.name;
    const n = String(t.table_number == null ? '' : t.table_number).trim();
    return (isNumName(n) ? 'Table ' + n : (n || 'Table')) + (zoneName(t) ? ' · ' + zoneName(t) : '');
  };
  const tableById = id => (ctx.getTables() || []).find(t => t.id === id);
  const isOwner = () => ctx.role() === 'owner';
  // Edit / remove / club / unclub / move-table are billing-tier on the server, so
  // only offer them to people who can actually do them (otherwise they tap, it
  // looks like it worked, then it's refused). The owner can always.
  const canManage = () => isOwner() || !ctx.canManage || ctx.canManage();
  // Staff who handle calls (but don't have billing) may still fix an OPEN order on the floor:
  // move it to the right table, and take items off it. Nothing else.
  const canTrim = () => !canManage() && !!ctx.canTrim && ctx.canTrim();
  // Kitchen staff signal "Ready to serve" — they don't complete, bill or edit orders.
  const isKitchen = () => !isOwner() && !!ctx.isKitchen && ctx.isKitchen();
  const isReady = o => !!o.kitchen_marked_ready;
  const itemsOf = o => o.items || [];
  const doneCount = o => itemsOf(o).filter(i => i.done).length;

  async function reloadOrders() { ctx.setOrders(applyOverlays(await ctx.get('/orders'))); }
  function replaceOrder(updated) {
    const list = allOrders(), i = list.findIndex(o => o.id === updated.id);
    if (i >= 0) { const next = list.slice(); next[i] = updated; ctx.setOrders(applyOverlays(next)); } else ctx.setOrders(applyOverlays([updated].concat(list)));
  }

  /* ------------------------------------------------------------------ */
  /* Instant buttons                                                    */
  /* ------------------------------------------------------------------ */
  /* A tap changes the screen at once; the server call follows in the background.
       overlay  = "this change, as an absolute rule" (set quantity to 3, put it on table 5 …). It is laid over
                  every fresh list from the server until that change is confirmed, so a poll that was already
                  on its way can't flip the screen back.
       queue    = changes to the same order go to the server one after another, in the order they were made.
       retry    = if the connection drops, the SAME request is sent again (every change is safe to repeat:
                  values are absolute, edits carry a request id, deleting twice is fine). Only if it still
                  fails after ~30 s is the change rolled back and the screen shows what the server holds. */
  const ovs = new Map();
  let ovSeq = 0;
  function applyOverlays(list) {
    const now = Date.now();
    ovs.forEach((ov, k) => { if (ov.until && now > ov.until) ovs.delete(k); });
    ovs.forEach(ov => { list = ov.fn(list); });
    return list;
  }
  const tails = new Map();            // order id → promise of its last queued change
  function enqueue(ids, job) {
    const waits = ids.map(id => tails.get(id)).filter(Boolean);
    const run = Promise.all(waits).catch(() => {}).then(job);
    ids.forEach(id => tails.set(id, run));
    run.then(() => { ids.forEach(id => { if (tails.get(id) === run) tails.delete(id); }); }, () => {});
    return run;
  }
  const RETRY_DELAYS = [1000, 2000, 4000, 8000, 12000];
  async function send(method, path, body, okStatuses) {
    for (let i = 0; ; i++) {
      try { return await ctx.api(method, path, body, { timeoutMs: 20000 }); }
      catch (e) {
        const st = e && e.status;
        if (st && okStatuses && okStatuses.indexOf(st) >= 0) return null;   // e.g. deleting something already deleted
        const transient = !st || st >= 500;                                   // no answer at all, or the server was waking up
        if (!transient || i >= RETRY_DELAYS.length) { if (e) e.transient = transient; throw e; }
        if (i === 0) toast('Connection is slow — still trying…');
        await sleep(RETRY_DELAYS[i]);
      }
    }
  }
  function commitView() { ctx.setOrders(applyOverlays(allOrders())); ctx.changed(); render(); }

  /* spec: { ids, apply(list)→list, method, path, body, okStatuses, what, success, onOk(res) } */
  function opt(spec) {
    const before = allOrders().filter(o => spec.ids.indexOf(o.id) >= 0);          // for the rollback if the network never recovers
    const key = ++ovSeq;
    ovs.set(key, { fn: spec.apply, until: 0 });
    commitView();
    return enqueue(spec.ids, async () => {
      try {
        const res = await send(spec.method, spec.path, spec.body, spec.okStatuses);
        const ov = ovs.get(key); if (ov) ov.until = Date.now() + 5000;           // keep covering for a few seconds, then let the server's own data take over
        if (spec.onOk && res) spec.onOk(res);
        commitView();
        if (spec.success) toast(spec.success);
        return true;
      } catch (e) {
        ovs.delete(key);
        const back = new Map(before.map(o => [o.id, o]));
        const cur = allOrders().filter(o => !(spec.ids.indexOf(o.id) >= 0 && !back.has(o.id)));
        const have = new Set(cur.map(o => o.id));
        before.forEach(o => { if (!have.has(o.id)) cur.push(o); });
        ctx.setOrders(applyOverlays(cur.map(o => back.get(o.id) || o)));
        ctx.changed(); render();
        toast(e && e.transient ? 'No connection — couldn’t ' + (spec.what || 'save that') + '. Nothing was changed.' : ((e && e.message) || 'Couldn’t ' + (spec.what || 'save that')));
        try { await reloadOrders(); ctx.changed(); render(); } catch (_) { /* offline: the restored copy stays */ }
        return false;
      }
    });
  }
  const rid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sumTotal = items => items.reduce((t, i) => t + num(i.price_at_order) * num(i.quantity), 0);
  const allDone = items => items.length > 0 && items.every(i => i.done);
  const withItems = (o, items) => Object.assign({}, o, { items: items, kitchen_marked_ready: allDone(items) });

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                          */
  /* ------------------------------------------------------------------ */
  function init(c) {
    ctx = c;
    if (el.sheet) return;
    injectCss();
    build();
    render();
  }

  function render() {
    if (!ctx || !el.host) return;
    renderGrid();
    if (LST && LST.open) paintLst();                 // keep the ready / not-ready list live on every poll
    if (S) refreshSheet();
  }

  /* ------------------------------------------------------------------ */
  /* Card grid                                                          */
  /* ------------------------------------------------------------------ */
  function cardData() {
    const orders = allOrders();
    const stamp = o => { const t = new Date(o.created_at).getTime(); return isNaN(t) ? 0 : t; };
    const newestOf = list => list.reduce((m, o) => Math.max(m, stamp(o)), 0);
    const byNumber = (a, b) => ((ZRANK[a.zk] || 0) - (ZRANK[b.zk] || 0)) || String(a.num).localeCompare(String(b.num), undefined, { numeric: true });
    const rows = (ctx.getTables() || []).map(t => {
      const open = orders.filter(o => o.table_id === t.id && isOpen(o));
      const part = open.filter(o => !isReady(o) && doneCount(o) > 0).length, nItems = open.reduce((n, o) => n + itemsOf(o).length, 0), nDone = open.reduce((n, o) => n + doneCount(o), 0);
      return { id: t.id, label: t.name || String(t.table_number), num: String(t.table_number), zk: t.zone || '', partial: part, items: nItems, itemsDone: nDone, open: open.length, ready: open.filter(isReady).length, total: open.reduce((s, o) => s + num(o.total_amount), 0), occupied: open.length > 0, bill: open.some(hasBill), zone: zoneName(t), newest: newestOf(open) };
    });
    const walk = orders.filter(o => o.table_id == null);
    const wopen = walk.filter(isOpen);
    const wPart = wopen.filter(o => !isReady(o) && doneCount(o) > 0).length;
    const walkRow = walk.length ? { partial: wPart, items: wopen.reduce((n, o) => n + itemsOf(o).length, 0), itemsDone: wopen.reduce((n, o) => n + doneCount(o), 0), open: wopen.length, ready: wopen.filter(isReady).length, total: wopen.reduce((s, o) => s + num(o.total_amount), 0), newest: newestOf(wopen) } : null;
    rows.sort((a, b) => ((b.bill ? 1 : 0) - (a.bill ? 1 : 0)) || (b.newest - a.newest) || byNumber(a, b));   // tables asking for the bill lead; then the latest order; empty tables by number
    const allOpen = orders.filter(isOpen), allReady = allOpen.filter(isReady).length;
    return { rows: rows, walk: walkRow,
             sum: { open: allOpen.length, ready: allReady, notReady: allOpen.length - allReady, bill: rows.filter(r => r.bill).length } };
  }

  // Who placed it: the customer from the QR menu, or a named waiter (from ctx.placedBy — optional).
  function byChip(o) {
    const pb = ctx.placedBy ? ctx.placedBy(o) : null;
    if (!pb) return '';
    return pb.kind === 'customer'
      ? '<span class="tc-by qr" title="Placed by the customer from the QR menu">QR menu</span>'
      : '<span class="tc-by staff" title="Placed by staff">' + esc(pb.name) + '</span>';
  }

  // Top-right of each table card: the number of active (open) orders, or the green "free" dot.
  function activeCount(n) {
    return n ? '<span class="tc-active" aria-label="' + n + ' active order' + (n === 1 ? '' : 's') + '">' + n + '<small>active</small></span>'
             : '<span class="tc-dot" aria-hidden="true"></span>';
  }

  function renderGrid() {
    const d = cardData();
    const sig = JSON.stringify([G.filter, G.zone, d]);
    if (sig === el.sig) return;                       // nothing changed → don't flicker every 4s poll
    el.sig = sig;

    if (!d.rows.length && !d.walk) { el.host.innerHTML = '<div class="empty-note">No tables yet — add your first one from the Tables tab.</div>'; return; }

    const occ = d.rows.filter(r => r.occupied).length;
    const chip = (v, label, n) => '<button type="button" class="tc-chip' + (G.filter === v ? ' on' : '') + '" data-act="filter" data-v="' + v + '">' + label + ' <b>' + n + '</b></button>';
    const zmode = multi();
    if (!zmode) G.zone = 'all';
    const zchip = (v, label) => '<button type="button" class="tc-chip tc-zf' + ((G.zone || 'all') === v ? ' on' : '') + '" data-act="zfilter" data-v="' + v + '">' + label + ' <b>' + (v === 'all' ? d.rows.length : d.rows.filter(r => r.zk === v).length) + '</b></button>';
    const zrow = zmode ? '<div class="tc-chips top tc-zrow">' + zchip('all', 'All areas') + zchip('', 'Indoor') + zchip('outdoor', 'Outdoor') + zchip('rooftop', 'Rooftop') + '</div>' : '';
    const inArea = r => !zmode || (G.zone || 'all') === 'all' || r.zk === G.zone;
    const shown = d.rows.filter(r => inArea(r) && (G.filter === 'all' || (G.filter === 'bill' ? r.bill : (G.filter === 'occ' ? r.occupied : !r.occupied))));

    const card = r => '<button type="button" class="tc-card ' + (r.occupied ? 'occ' : 'emp') + (r.bill ? ' bill' : '') + '" data-act="open" data-tid="' + r.id + '">' +
      '<span class="tc-card-top"><span class="tc-lab">' + ('TABLE' + (r.zone ? ' · ' + r.zone.toUpperCase() : '')) + '</span>' + activeCount(r.open) + '</span>' +
      '<span class="tc-num' + (r.label.length > 4 ? ' long' : '') + '">' + esc(r.label) + '</span>' +
      (r.bill ? '<span class="tc-badge bill">Bill requested</span>' : '<span class="tc-badge ' + (r.ready ? 'ready' : (r.partial ? 'part' : (r.occupied ? 'occ' : 'emp'))) + '">' + (r.ready ? 'Ready to serve' : (r.partial ? 'Partly ready' : (r.occupied ? 'Occupied' : 'Empty'))) + '</span>') +
      '<span class="tc-meta">' + (r.occupied ? r.open + ' active order' + (r.open === 1 ? '' : 's') + ' · ' + money(r.total) + (r.ready ? ' · ' + r.ready + ' ready' : '') + (r.itemsDone && r.itemsDone < r.items ? ' · ' + r.itemsDone + '/' + r.items + ' items done' : '') : 'No active orders') + '</span></button>';

    const walk = d.walk ? '<button type="button" class="tc-card walk' + (d.walk.open ? ' occ' : ' emp') + '" data-act="open" data-tid="walkin">' +
      '<span class="tc-card-top"><span class="tc-lab">COUNTER</span>' + activeCount(d.walk.open) + '</span>' +
      '<span class="tc-num long">Walk-in</span>' +
      '<span class="tc-badge ' + (d.walk.ready ? 'ready' : (d.walk.partial ? 'part' : (d.walk.open ? 'occ' : 'emp'))) + '">' + (d.walk.ready ? 'Ready to serve' : (d.walk.partial ? 'Partly ready' : (d.walk.open ? d.walk.open + ' open' : 'All done'))) + '</span>' +
      '<span class="tc-meta">' + (d.walk.open ? d.walk.open + ' active order' + (d.walk.open === 1 ? '' : 's') + ' · ' + money(d.walk.total) : 'No active orders') + '</span></button>' : '';

    const sm = d.sum;
    const summary = '<div class="tc-sum' + (sm.bill ? ' four' : '') + '" role="status">' +
      (sm.bill ? '<button type="button" class="tc-sum-i bill' + (G.filter === 'bill' ? ' on' : '') + '" data-act="sum" data-v="bill"><b>' + sm.bill + '</b><span>Bill requested</span></button>' : '') +
      '<button type="button" class="tc-sum-i open' + (G.filter === 'occ' ? ' on' : '') + '" data-act="sum" data-v="open"><b>' + sm.open + '</b><span>Open orders</span></button>' +
      '<button type="button" class="tc-sum-i ready" data-act="sum" data-v="ready"><b>' + sm.ready + '</b><span>Ready to serve</span></button>' +
      '<button type="button" class="tc-sum-i prep" data-act="sum" data-v="prep"><b>' + sm.notReady + '</b><span>Not ready</span></button></div>';
    // A busy walk-in counter takes its place among the tables by time; a quiet one sits at the end.
    let gridHtml;
    if (d.walk && d.walk.open && G.filter !== 'emp') {
      const at = shown.findIndex(r => r.newest < d.walk.newest);
      const parts = shown.map(card);
      parts.splice(at < 0 ? parts.length : at, 0, walk);
      gridHtml = parts.join('');
    } else gridHtml = shown.map(card).join('') + walk;
    el.host.innerHTML = summary +
      zrow + '<div class="tc-chips top">' + chip('all', 'All', d.rows.length) + chip('occ', 'Occupied', occ) + chip('emp', 'Empty', d.rows.length - occ) + '</div>' +
      '<div class="tc-grid">' + gridHtml + '</div>' +
      (shown.length ? '' : '<div class="empty-note">No ' + (G.filter === 'occ' ? 'occupied' : (G.filter === 'bill' ? 'bill-requested' : 'empty')) + ' tables right now.</div>');
  }

  /* ------------------------------------------------------------------ */
  /* Sheet: open / close / paint                                        */
  /* ------------------------------------------------------------------ */
  function openSheet(tid) {
    const isWalk = tid === 'walkin';
    if (!isWalk && !tableById(tid)) return;
    S = { tid: tid, walk: isWalk, qrReady: false, qrDone: false, busy: null, done: null, armed: null, armTimer: 0,
          renaming: false, renameVal: '', editing: null, selecting: false, picked: new Set(), qrOpen: false };
    el.bodyHtml = '';
    el.back.hidden = false; el.sheet.hidden = false;
    requestAnimationFrame(() => { el.back.classList.add('show'); el.sheet.classList.add('show'); });
    document.body.style.overflow = 'hidden';
    el.scroll.scrollTop = 0;
    setQrPanel(false);                                  // QR starts folded away — open orders come first
    if (!isWalk) mountQr(S, tableById(tid));           // still drawn now, so it's ready the moment it's opened
    paint();
  }

  function closeSheet() {
    if (!S) return;
    clearTimeout(S.armTimer);
    S = null;
    el.back.classList.remove('show'); el.sheet.classList.remove('show');
    el.back.hidden = true; el.sheet.hidden = true;
    document.body.style.overflow = '';
  }

  function setQrPanel(open) {
    if (S) S.qrOpen = open && !S.walk;
    const show = !!(S && S.qrOpen);
    el.qrwrap.hidden = !show; el.actions.hidden = !show;
  }
  function toggleQr() {
    setQrPanel(!S.qrOpen);
    if (S.qrOpen) el.scroll.scrollTop = 0;
    renderHead();
  }

  function paint() { renderHead(); renderActions(); renderBody(true); }

  function refreshSheet() {                              // called on every poll
    if (!S) return;
    if (!S.walk && !tableById(S.tid)) { toast('That table was removed'); closeSheet(); return; }
    renderHead();
    renderBody(false);
  }

  function arm(key) {
    clearTimeout(S.armTimer);
    S.armed = key;
    S.armTimer = setTimeout(() => { if (S) { S.armed = null; paint(); } }, 3500);
    paint();
  }
  function disarm() { if (S) { clearTimeout(S.armTimer); S.armed = null; } }

  /* One action at a time: everything else greys out until it finishes (no double-taps, no spam). */
  async function run(key, fn) {
    if (!S || S.busy) return;
    const mine = S;
    disarm();
    mine.busy = key; paint();
    let ok = false;
    try { await fn(); ok = true; }
    catch (e) { toast((e && e.message) || 'Something went wrong — try again'); }
    if (S === mine) { mine.busy = null; if (ok && (key === 'download')) flash('download'); paint(); }
    return ok;
  }
  function flash(key) {
    const mine = S; mine.done = key; paint();
    setTimeout(() => { if (S === mine && mine.done === key) { mine.done = null; paint(); } }, 1100);
  }

  /* ------------------------------------------------------------------ */
  /* Sheet: header + QR + actions                                       */
  /* ------------------------------------------------------------------ */
  function renderHead() {
    if (!S) return;
    if (!S.walk && !tableById(S.tid)) return;                      // table just got deleted — sheet is about to close
    if (S.renaming && !S.busy && !el.headBusy && el.head.querySelector('#tc-rn')) return;   // don't disturb typing (polls repaint every 4s)
    const open = ordersFor(S.tid).filter(isOpen).length;
    let title;
    if (S.walk) title = '<div class="tc-title"><div class="tc-h-num">Walk-in / counter</div></div>';
    else if (S.renaming) {
      const zv = S.zoneVal || '';
      const zbtn = (v, lab) => '<button type="button" class="tc-zchip' + (zv === v ? ' on' : '') + '" data-act="zone" data-v="' + v + '" aria-pressed="' + (zv === v) + '">' + lab + '</button>';
      title = '<div class="tc-rename"><label>Table number (1 - 50)</label><div class="tc-rn-row">' +
        '<input id="tc-rn" class="tc-rn" maxlength="20" placeholder="5" value="' + esc(S.renameVal) + '" autocomplete="off" inputmode="numeric">' + '</div>' +
        '<label class="tc-rv-lab">Where is it?</label><div class="tc-rn-row">' + zbtn('', 'Indoor') + zbtn('outdoor', 'Outdoor') + zbtn('rooftop', 'Rooftop') + '</div>' +
        '<label class="tc-rv-lab">Your own name for it <span style="text-transform:none;letter-spacing:0;font-weight:500">(optional)</span></label><div class="tc-rn-row">' +
        '<input id="tc-rn-name" class="tc-rn" maxlength="30" placeholder="e.g. Cabin 1 — blank keeps “Table ' + esc(S.renameVal || '5') + '”" value="' + esc(S.nameVal || '') + '" autocomplete="off">' +
        pill('rn-reset', 'Use default', 'ink sm', 'rn-reset') + '</div>' +
        '<p class="tc-rn-note">The alarm then says “' + esc((S.zoneVal === 'outdoor' ? 'Outdoor' : S.zoneVal === 'rooftop' ? 'Rooftop' : (multi() ? 'Indoor' : 'Table'))) + ' table is calling” — a name can’t be spoken, the number can.</p>' +
        '<div class="tc-rn-row" style="margin-top:12px">' + pill('rn-save', 'Save', 'rose sm', 'rename') + pill('rn-cancel', 'Cancel', 'ink sm', 'rn-cancel') + '</div></div>';
    } else {
      const t = tableById(S.tid);
      title = '<div class="tc-title"><div class="tc-h-num">' + esc(tl(t)) + '</div>' + qrButton() +
        '<span class="tc-badge ' + (open ? 'occ' : 'emp') + '">' + (open ? 'Occupied · ' + open + ' open' : 'Empty') + '</span>' +
        (ordersFor(S.tid).some(o => isOpen(o) && hasBill(o)) ? '<span class="tc-badge bill">Bill requested</span>' : '') + '</div>';
    }
    const html = title + '<button type="button" class="tc-x" data-act="close" aria-label="Close">✕</button>';
    if (html !== el.headHtml) {
      el.headHtml = html; el.head.innerHTML = html; el.headBusy = !!S.busy;
      if (S.renaming && !S.busy) { const i = el.head.querySelector('#tc-rn'); if (i) { i.focus(); i.select(); } }
    }
  }

  /* Small QR-code glyph button that folds the QR panel open / closed. */
  function qrButton() {
    const on = S.qrOpen;
    return '<button type="button" class="tc-qrbtn' + (on ? ' on' : '') + '" data-act="qr-toggle" aria-expanded="' + on + '" aria-label="' + (on ? 'Hide' : 'Show') + ' QR code">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>' +
      '<path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17 20h3v-3"/><path d="M6.5 6.5h.01M17.5 6.5h.01M6.5 17.5h.01"/></svg></button>';
  }

  /* A pill button. `key` is the busy-key this button owns (so it can show its own spinner). */
  function pill(act, label, cls, key, extra) {
    const busyMe = S && S.busy && S.busy === key;
    const locked = !S || !!S.busy || (extra && extra.locked);
    const done = S && S.done === key;
    const c = 'tc-pill ' + cls + (busyMe ? ' is-busy' : '') + (!busyMe && locked ? ' is-locked' : '') + (done ? ' is-done' : '') + ((extra && extra.armed) ? ' armed' : '');
    const inner = busyMe ? '<span class="tc-dots"><i></i><i></i><i></i></span>' + esc((extra && extra.busyLabel) || 'Working') : (done ? '✓ Done' : label);
    return '<button type="button" class="' + c + '" data-act="' + act + '"' + (locked || busyMe ? ' disabled' : '') + '>' + inner + '</button>';
  }

  function renderActions() {
    if (!S || S.walk) return;
    const notReady = !S.qrReady || S.renaming;
    const armed = S.armed === 'remove';
    const html =
      pill('download', '⬇ Download', 'rose', 'download', { locked: notReady, busyLabel: 'Preparing' }) +
      (isOwner() ? pill('edit', 'Edit', 'ink', 'edit', { locked: notReady }) : '') +
      (isOwner() ? pill('remove', armed ? 'Tap again to remove' : 'Remove', 'danger', 'remove', { locked: notReady, armed: armed, busyLabel: 'Removing' }) : '') +
      (!S.qrReady ? '<span class="tc-hint">Getting the QR ready…</span>' : '');
    if (html !== el.actionsHtml) { el.actionsHtml = html; el.actions.innerHTML = html; }
  }

  function mountQr(mine, T) {
    el.qrwrap.innerHTML = '<div class="tc-qr" id="tc-qr"><div class="tc-qr-in"></div></div><div class="tc-qr-cap">Scan to open the menu for this table</div>';
    const frame = el.qrwrap.firstChild, inner = frame.firstChild;
    const ready = () => {
      if (S !== mine || mine.qrDone) return;
      mine.qrDone = true; mine.qrReady = true; frame.classList.add('ready'); renderActions();
    };
    if (!root.QRCode) { inner.textContent = 'QR library didn’t load — refresh the page'; frame.classList.add('err'); return; }
    try {
      new root.QRCode(inner, { text: ctx.orderUrl(T.qr_token), width: 220, height: 220, colorDark: '#171A21', colorLight: '#ffffff' });
    } catch (e) { inner.textContent = 'Couldn’t draw the QR'; frame.classList.add('err'); return; }
    // qrcodejs paints a canvas, then swaps in an <img>; "loaded" = that image finished loading.
    const img = inner.querySelector('img');
    if (img && !(img.complete && img.getAttribute('src'))) img.addEventListener('load', ready, { once: true });
    else setTimeout(ready, 0);
    setTimeout(() => { if (S === mine && !mine.qrReady && inner.querySelector('canvas')) ready(); }, 2500);   // safety net
  }

  function fitText(g, text, maxW, size, weight, family) {
    let s = size;
    do { g.font = weight + ' ' + s + 'px ' + family; s -= 2; } while (g.measureText(text).width > maxW && s > 18);
  }

  /* Print-ready PNG: big QR + cafe name + table number (the old download was a 100px thumbnail). */
  function downloadPoster(T) {
    return new Promise((resolve, reject) => {
      if (!root.QRCode) return reject(new Error('QR library didn’t load'));
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
      document.body.appendChild(host);
      try { new root.QRCode(host, { text: ctx.orderUrl(T.qr_token), width: 600, height: 600, colorDark: '#171A21', colorLight: '#ffffff' }); }
      catch (e) { host.remove(); return reject(new Error('Couldn’t draw the QR')); }
      const qc = host.querySelector('canvas');
      if (!qc) { host.remove(); return reject(new Error('Couldn’t draw the QR')); }

      const W = 760, H = 980, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'), F = '"Space Grotesk", Inter, system-ui, sans-serif';
      const cafe = ((ctx.getCafe() || {}).name || '').trim();
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      const bar = g.createLinearGradient(0, 0, W, 0); bar.addColorStop(0, '#E63976'); bar.addColorStop(1, '#FF9770');
      g.fillStyle = bar; g.fillRect(0, 0, W, 14);
      g.textAlign = 'center'; g.fillStyle = '#171A21';
      if (cafe) { fitText(g, cafe, W - 120, 38, 600, F); g.fillText(cafe, W / 2, 90); }
      g.drawImage(qc, 80, 130, 600, 600);
      fitText(g, tl(T), W - 120, 72, 700, F); g.fillText(tl(T), W / 2, 828);
      g.fillStyle = '#6B7280'; g.font = '500 26px Inter, system-ui, sans-serif'; g.fillText('Scan to view the menu & order', W / 2, 890);

      c.toBlob(blob => {
        host.remove();
        if (!blob) return reject(new Error('Couldn’t create the image'));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'table-' + String(T.name || (T.zone ? T.zone + '-' : '') + T.table_number).replace(/[^\w-]+/g, '_') + '-qr.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        resolve();
      }, 'image/png');
    });
  }

  /* ---- table actions ---- */
  /* Instant: the sheet closes and the card changes at once; the server is told in the background and the old value
     comes back (with a message) only if that fails. */
  function saveRename() {
    const T = tableById(S.tid), v = String(S.renameVal || '').trim(), z = S.zoneVal || '', nm = String(S.nameVal || '').replace(/\s+/g, ' ').trim();
    if (!v) { toast('Table number can’t be empty'); return; }
    if (v === String(T.table_number) && z === (T.zone || '') && nm === (T.name || '')) { S.renaming = false; paint(); return; }
    const before = Object.assign({}, T);
    ctx.setTables(ctx.getTables().map(t => (t.id === T.id ? Object.assign({}, t, { table_number: v, zone: z || null, name: nm || null }) : t)));
    S.renaming = false; ctx.changed(); paint(); render();
    ctx.api('PATCH', '/tables/' + T.id, { table_number: v, zone: z || null, name: nm || null })
      .then(updated => { ctx.setTables(ctx.getTables().map(t => (t.id === T.id ? updated : t))); ctx.changed(); render(); })
      .catch(e => { ctx.setTables(ctx.getTables().map(t => (t.id === T.id ? before : t))); ctx.changed(); render(); toast((e && e.message) || 'Couldn’t save the table — it was put back'); });
  }

  async function removeTable() {
    const T = tableById(S.tid);
    if (ordersFor(S.tid).some(isOpen)) { toast('This table still has open orders — complete or move them first'); return; }
    if (S.armed !== 'remove') { arm('remove'); return; }
    const mine = S;
    const ok = await run('remove', async () => {
      await ctx.api('DELETE', '/tables/' + T.id);
      ctx.setTables(ctx.getTables().filter(t => t.id !== T.id));
      ctx.changed();
      toast(tl(T) + ' removed');
    });
    if (ok && S === mine) closeSheet();
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Sheet body: open orders + history                                  */
  /* ------------------------------------------------------------------ */
  function renderBody(force) {
    if (!S) return;
    if (!force && (S.editing || S.selecting)) return;          // don't yank the UI while someone is mid-edit
    const html = bodyHtml();
    if (html === el.bodyHtml) return;
    el.bodyHtml = html;
    const st = el.scroll.scrollTop;
    el.body.innerHTML = html;
    el.scroll.scrollTop = st;
  }

  function bodyHtml() {
    ensureOlder();
    const open = ordersFor(S.tid).filter(isOpen).sort((a, b) => tsOf(b) - tsOf(a));
    const start = rangeStart(G.range);
    const done = doneFor(S.tid).filter(o => !start || tsOf(o) >= start.getTime())
      .sort((a, b) => (G.sort === 'old' ? tsOf(a) - tsOf(b) : tsOf(b) - tsOf(a)));

    /* open orders */
    let openSec = '<section class="tc-sec tc-sec--open"><div class="tc-sec-h"><h4>Open orders <span class="tc-count">' + open.length + '</span></h4>';
    if (open.length >= 2 && !S.editing && !S.selecting && canManage()) openSec += pill('club-start', 'Club orders', 'ink sm', 'club-start');
    openSec += '</div>';
    if (S.selecting) {
      const n = S.picked.size, sum = open.filter(o => S.picked.has(o.id)).reduce((s, o) => s + num(o.total_amount), 0);
      const armed = S.armed === 'club';
      openSec += '<div class="tc-clubbar"><p>Tick two or more orders to combine them into one. The earliest placed time is kept, and you can unclub it later.</p><div class="tc-row">' +
        pill('club-go', armed ? 'Tap again · club ' + n + ' orders' : 'Club ' + n + ' selected' + (n >= 2 ? ' · ' + money(sum) : ''), 'rose sm', 'club', { locked: n < 2, armed: false, busyLabel: 'Clubbing' }) +
        pill('club-cancel', 'Cancel', 'ink sm', 'club-cancel') + '</div></div>';
    }
    const billAt = open.filter(hasBill).reduce((m, o) => Math.max(m, new Date(o.bill_requested_at).getTime() || 0), 0);
    if (billAt) openSec += '<div class="tc-billreq"><b>Bill requested</b><span>The guest asked for the bill at ' + esc(fmtTime(new Date(billAt).toISOString())) + ' · total ' + money(open.reduce((s, o) => s + num(o.total_amount), 0)) + '</span></div>';
    openSec += open.length ? open.map(o => orderCard(o, 'open')).join('') : '<div class="tc-empty">' + (S.walk ? 'Nothing open at the counter.' : 'Nothing open — this table is free.') + '</div>';
    openSec += '</section>';

    /* history */
    // Each bill counts once: if one bill covers several orders, only its first card carries the amount.
    dupBillOrders = new Set();
    const counted = new Set();
    done.forEach(o => { if (o.bill_id != null) { if (counted.has(o.bill_id)) dupBillOrders.add(o.id); else counted.add(o.bill_id); } });
    const sum = done.reduce((s, o) => s + (dupBillOrders.has(o.id) ? 0 : finalOf(o)), 0);
    const chips = RANGES.map(r => '<button type="button" class="tc-chip' + (G.range === r[0] ? ' on' : '') + '" data-act="range" data-v="' + r[0] + '">' + r[1] + '</button>').join('');
    let histSec = '<section class="tc-sec tc-sec--hist"><div class="tc-sec-h"><h4>History</h4>' +
      '<button type="button" class="tc-sort" data-act="sort">' + (G.sort === 'old' ? 'Oldest first ↑' : 'Newest first ↓') + '</button></div>' +
      '<div class="tc-chips">' + chips + '</div>' +
      '<div class="tc-sum"><b>' + done.length + '</b> completed order' + (done.length === 1 ? '' : 's') + ' · <b>' + money(sum) + '</b></div>';
    if (done.length) histSec += done.map(o => orderCard(o, 'done')).join('');
    else if (S.loadingOlder) histSec += '<div class="tc-empty">Loading older orders…</div>';
    else histSec += '<div class="tc-empty">No completed orders in this range.' + (G.range !== 'all' ? ' <button type="button" class="tc-linkbtn" data-act="range" data-v="all">Show all time</button>' : '') + '</div>';
    histSec += '</section>';

    return openSec + histSec;
  }

  // What the latest edit changed, ready to paint: {byId: Map(itemId → change), removed: [change…]}
  function highlights(o) {
    const le = o.last_edit;
    if (!le || !Array.isArray(le.changes) || !le.changes.length) return null;
    const byId = new Map(), removed = [];
    le.changes.forEach(c => { if (c.removed || c.item_id == null) removed.push(c); else byId.set(c.item_id, c); });
    return { byId: byId, removed: removed };
  }

  function mergedHtml(o) {
    const mf = Array.isArray(o.merged_from) ? o.merged_from : null;
    if (!mf && !o.merged && !o.is_merged) return '';
    const times = mf ? mf.map(x => (x && x.created_at ? fmtTime(x.created_at) : null)).filter(Boolean) : [];
    return '<div class="tc-merged">Clubbed order' + (times.length ? ' · placed as ' + esc(times.join(' + ')) : '') + '</div>';
  }

  function orderCard(o, mode) {
    const editing = S.editing && S.editing.id === o.id;
    const selectable = S.selecting && mode === 'open';
    const picked = S.picked.has(o.id);
    const head =
      '<div class="tc-ord-h">' +
        (selectable ? '<label class="tc-check"><input type="checkbox" data-act="pick" data-oid="' + o.id + '"' + (picked ? ' checked' : '') + '><i></i></label>' : '') +
        '<span class="tc-ono" title="Order number">#' + esc(String(o.order_number != null ? o.order_number : o.id)) + '</span>' +
        '<span class="status-pill status-' + esc(o.status) + '">' + esc(statusLabel(o.status)) + '</span>' +
        byChip(o) +
        (mode === 'open' && isReady(o) ? '<span class="tc-ready">Ready to serve</span>' : '') +
        (mode === 'open' && !isReady(o) && doneCount(o) > 0 ? '<span class="tc-prog">' + doneCount(o) + ' of ' + itemsOf(o).length + ' ready</span>' : '') +
        '<span class="tc-when">🕒 Placed ' + esc(fmtWhen(o.created_at)) + '</span>' +
        (mode === 'done' && dupBillOrders.has(o.id)
          ? '<span class="tc-amt tc-amt--in" title="This order was billed together with another">in same bill</span>'
          : '<span class="tc-amt">' + money(mode === 'done' ? finalOf(o) : o.total_amount) + '</span>') +
      '</div>';
    let inner;
    if (editing) inner = editHtml(o);
    else {
      const hl = mode === 'open' ? highlights(o) : null;       // green/red marks from the latest edit — they stay until the next one
      const canTick = mode === 'open' && !S.selecting && (isOwner() || isKitchen());
      const tick = i => mode !== 'open' ? '' : (canTick
        ? '<button type="button" class="tc-tick' + (i.done ? ' on' : '') + '" data-act="i-tick" data-iid="' + i.id + '" role="checkbox" aria-checked="' + !!i.done + '" aria-label="' + esc(i.name) + (i.done ? ' — ready, tap to undo' : ' — tap when ready') + '"></button>'
        : '<span class="tc-tick ro' + (i.done ? ' on' : '') + '" role="img" aria-label="' + (i.done ? 'Ready' : 'Not ready yet') + '"></span>');
      const mark = i => { const d = hl && hl.byId.get(i.id); return d ? '<span class="tc-delta ' + (d.delta > 0 ? 'pos' : 'neg') + '">' + (d.delta > 0 ? '+' : '−') + Math.abs(d.delta) + (d.added ? ' new' : '') + '</span>' : ''; };
      const gone = hl ? hl.removed.map(c => '<li class="tc-gone"><span><s>' + esc(c.name) + '</s><span class="tc-delta neg">−' + Math.abs(c.delta) + ' removed</span></span><span></span></li>').join('') : '';
      const items = ((o.items && o.items.length) || gone)
        ? '<ul class="tc-items">' + (o.items || []).map(i => { const d = hl && hl.byId.get(i.id); return '<li' + (d ? ' class="tc-hl ' + (d.delta > 0 ? 'pos' : 'neg') + '"' : '') + '><span class="tc-itn">' + tick(i) + '<span>' + esc(iname(i)) + ' × ' + num(i.quantity) + mark(i) + '</span></span><span>' + money(num(i.price_at_order) * num(i.quantity)) + '</span></li>'; }).join('') + gone + '</ul>'
        : '<div class="tc-empty sm">No items on this order.</div>';
      const editedBy = o.last_edit && o.last_edit.by
        ? '<div class="tc-edited">Edited by <b>' + esc(o.last_edit.by) + '</b>' + (mode === 'open' && o.last_edit.at ? ' · ' + esc(fmtTime(o.last_edit.at)) : '') + '</div>' : '';
      const note = o.note ? '<div class="tc-note-view">Note: ' + esc(o.note) + '</div>' : '';
      const lines = mode === 'done' && !dupBillOrders.has(o.id) ? billLines(o) : [];
      const working = lines.length
        ? '<div class="tc-bill">' + lines.map(r => '<div class="tc-bill-row' + (r.strong ? ' strong' : '') + (r.amount < 0 ? ' neg' : '') + '"><span>' + esc(r.label) + '</span><span>' + (r.amount < 0 ? '−' : '') + money(Math.abs(r.amount)) + '</span></div>').join('') + '</div>'
        : '';
      inner = items + working + editedBy + note + (S.selecting ? '' : orderActions(o, mode));
    }
    return '<article class="tc-ord tc-ord--' + mode + (picked ? ' picked' : '') + (editing ? ' editing' : '') + '" data-oid="' + o.id + '">' + head + mergedHtml(o) + inner + '</article>';
  }

  function orderActions(o, mode) {
    const delKey = 'o:' + o.id + ':del', armed = S.armed === delKey;
    const lock = S.busy ? ' disabled' : '';
    // Kitchen staff only signal "Ready to serve" — nothing else on an order is theirs to touch.
    if (isKitchen()) return mode === 'open' ? readyBox(o) + kotRow(o) : '';
    // A COMPLETED order belongs to a saved BILL, so changes happen to the bill — reprint it, and
    // (owner) edit or delete it. The order on its own can't be edited or removed once billed (the
    // server refuses), so Edit / Remove / Move are not offered here — they were dead ends.
    if (mode === 'done' && o.bill_id != null && ctx.billAction && (canManage() || isOwner())) {
      const b = (act, label, cls) => '<button type="button" class="tc-pill ' + cls + '" data-act="' + act + '">' + label + '</button>';
      const mayReprint = isOwner() || !ctx.canPrintBills || ctx.canPrintBills();      // waiters can't print bills unless the owner allows it
      const btns = (mayReprint ? b('b-reprint', 'Reprint', 'ink sm') : '') +
        (isOwner() ? b('b-edit', 'Edit bill', 'ink sm') + b('b-del', 'Delete bill', 'danger sm') : '');
      return btns ? '<div class="tc-ord-actions">' + btns + '</div>' : '';
    }
    const manage = canManage();
    const trim = canTrim() && mode === 'open';
    const moves = (manage || trim)
      ? '<select class="tc-sel" data-act="o-move" data-oid="' + o.id + '" aria-label="Move to another table"' + lock + '>' +
        '<option value="">Move to…</option><option value="walkin">Walk-in / counter</option>' +
        (ctx.getTables() || []).filter(t => t.id !== o.table_id).map(t => '<option value="' + t.id + '">' + esc(tl(t)) + '</option>').join('') +
        '</select>'
      : '';
    // A completed (billed) order can't actually be edited or removed by anyone but the
    // owner — the backend already locks it — so those buttons are hidden, not left as a dead end.
    const canEditRemove = manage && (mode === 'open' || isOwner());
    // Unclub only while the order is still open — once it's billed, splitting it would change a settled bill.
    const unKey = 'o:' + o.id + ':unclub', unArmed = S.armed === unKey;
    const unclub = manage && mode === 'open' && isClubbed(o)
      ? pill('o-unclub', unArmed ? 'Tap again to unclub' : 'Unclub', 'ink sm', unKey, { armed: unArmed, busyLabel: 'Unclubbing' })
      : '';
    const buttons =
      (canEditRemove ? pill('o-edit', 'Edit', 'ink sm', 'o:' + o.id + ':edit') : '') +
      (trim ? pill('o-trim', 'Remove items', 'ink sm', 'o:' + o.id + ':trim') : '') +
      unclub +
      (mode === 'open' && mayKot() ? kotPill(o) : '') +
      (mode === 'open' && ctx.settle && (!ctx.canSettle || ctx.canSettle()) ? pill('o-settle', 'Settle bill', 'rose sm', 'o:' + o.id + ':settle') : '') +
      (canEditRemove ? pill('o-del', armed ? 'Tap again to remove' : 'Remove', 'danger sm', delKey, { armed: armed, busyLabel: 'Removing' }) : '') +
      moves;
    return buttons ? '<div class="tc-ord-actions">' + buttons + '</div>' : '';
  }

  /* KOT — kitchen order ticket. Kitchen staff print it for the cooks: table, order number,
     time, items and quantities, the note — no prices. Shows when it was last printed. */
  const mayKot = () => !!ctx.printKot && (isOwner() || !ctx.canKot || ctx.canKot());
  function kotPill(o) {
    const printed = ctx.kotPrintedAt ? ctx.kotPrintedAt(o) : null;
    return pill('o-kot', printed ? 'Reprint KOT' : 'Print KOT', 'ink sm', 'o:' + o.id + ':kot');
  }
  function kotRow(o) {
    if (!ctx.printKot) return '';
    const printed = ctx.kotPrintedAt ? ctx.kotPrintedAt(o) : null;
    return '<div class="tc-ord-actions">' +
      pill('o-kot', printed ? 'Reprint KOT' : 'Print KOT', printed ? 'ink sm' : 'rose sm', 'o:' + o.id + ':kot') +
      (printed ? '<span class="tc-kot-note">KOT printed ' + esc(printed) + '</span>' : '') + '</div>';
  }

  /* The chef's box: "Ready to serve". Visible to the chef and the waiters, never the customer,
     and it does NOT complete the order or move it to History — it just tells the floor. */
  function readyBox(o) {
    const on = isReady(o);
    return '<button type="button" class="tc-done tc-ready-btn' + (on ? ' is-on' : '') + '" data-act="o-ready"' +
      ' role="checkbox" aria-checked="' + on + '"' + (S.busy ? ' disabled' : '') + '>' +
      '<span class="tc-done-box" aria-hidden="true"></span><span class="tc-done-lab">' + (on ? 'Ready to serve · tap to undo' : 'Tap when ready to serve') + '</span></button>';
  }

  /* size / hot-cold chosen on the menu ("Cold Coffee · Large · Cold") */
  function choiceLabel(i) { return [i.kind, i.size, i.temperature === 'hot' ? 'Hot' : i.temperature === 'cold' ? 'Cold' : null].filter(Boolean).join(' · '); }
  const addonNamesOf = i => (Array.isArray(i.addons) ? i.addons : (typeof i.addons === 'string' && i.addons ? i.addons.split(',') : [])).map(a => (a && a.name) || a).map(x => String(x).trim()).filter(Boolean);
  function iname(i) { const c = choiceLabel(i), n = String(i.name || ''); const base = c && n.indexOf(' · ' + c) === -1 ? n + ' · ' + c : n; const ad = addonNamesOf(i), t = ad.length ? ' + ' + ad.join(', ') : ''; return t && base.indexOf(t) === -1 ? base + t : base; }

  /* ---- editing an order ---- */
  function startEdit(o) {
    const menu = ctx.getMenu() || [];
    const lines = (o.items || []).map(i => {
      let mid = i.menu_item_id != null ? i.menu_item_id : (i.menu_item && i.menu_item.id != null ? i.menu_item.id : null);
      if (mid == null) { const m = menu.find(x => x.name === i.name); if (m) mid = m.id; }
      return { id: i.id != null ? i.id : null, menu_item_id: mid, name: iname(i), kind: i.kind || null, size: i.size || null, temperature: i.temperature || null, addons: addonNamesOf(i), price: num(i.price_at_order), quantity: Math.max(1, num(i.quantity)) };
    });
    lines.forEach(l => { l.maxQty = l.quantity; });   // trim-only edits can go back up to the original amount, never above
    S.editing = { id: o.id, lines: lines, note: o.note || '', completed: !isOpen(o) };
    disarm(); paint();
  }

  function editHtml(o) {
    const E = S.editing;
    const total = E.lines.reduce((s, l) => s + l.price * l.quantity, 0);
    const lines = E.lines.map((l, i) =>
      '<li><span class="tc-ln">' + esc(l.name) + '<small>' + money(l.price) + ' each</small></span>' +
      '<span class="tc-step"><button type="button" data-act="l-dec" data-i="' + i + '" aria-label="Less"' + (l.quantity <= 1 ? ' disabled' : '') + '>−</button><b>' + l.quantity + '</b>' +
        (E.trimOnly && l.quantity >= (l.maxQty || l.quantity) ? '' : '<button type="button" data-act="l-inc" data-i="' + i + '" aria-label="More">+</button>') + '</span>' +
      '<button type="button" class="tc-rx" data-act="l-del" data-i="' + i + '" aria-label="Remove ' + esc(l.name) + '">✕</button></li>').join('');
    const menu = (ctx.getMenu() || []).filter(m => m.is_available !== false);
    const add = E.trimOnly ? '<div class="tc-warn">You can take items off or lower quantities. Adding items needs billing access.</div>'
      : '<input type="search" class="tc-find" data-act="e-find" placeholder="Search menu to add an item…" autocomplete="off" aria-label="Search menu">' +
      '<select class="tc-sel wide" data-act="e-add"><option value="">＋ Add an item…</option>' +
      menu.map(m => '<option value="' + m.id + '">' + esc(m.name) + ' — ' + money(m.price) + '</option>').join('') + '</select>';
    const saveKey = 'o:' + o.id + ':save';
    return (E.completed ? '<div class="tc-warn">This order is completed — changes will update your history.</div>' : '') +
      '<ul class="tc-lines">' + (lines || '<li class="tc-empty sm">No items left — add one, or remove the whole order.</li>') + '</ul>' +
      add +
      '<textarea class="tc-note" data-act="e-note" rows="2" maxlength="300" placeholder="Note for the kitchen (optional)">' + esc(E.note) + '</textarea>' +
      '<div class="tc-edit-total"><span>New total</span><b>' + money(total) + '</b></div>' +
      '<div class="tc-ord-actions">' + pill('e-save', 'Save changes', 'rose sm', saveKey, { busyLabel: 'Saving' }) + pill('e-cancel', 'Cancel', 'ink sm', 'e-cancel') + '</div>';
  }

  function saveEdit() {
    const E = S.editing, o = allOrders().find(x => x.id === E.id);
    if (!o) { S.editing = null; paint(); return; }
    if (!E.lines.length) { toast('Add at least one item — or remove the whole order instead'); return; }
    const lines = E.lines.map(l => Object.assign({}, l)), note = E.note.trim() || null, orig = itemsOf(o).map(i => Object.assign({}, i));
    const payload = {
      items: lines.map(l => { const r = { quantity: l.quantity }; if (l.id != null) r.id = l.id; if (l.menu_item_id != null) r.menu_item_id = l.menu_item_id; if (l.kind) r.kind = l.kind; if (l.size) r.size = l.size; if (l.temperature) r.temperature = l.temperature; if (l.addons && l.addons.length) r.addons = l.addons.map(a => (a && a.name) || a); return r; }),
      note: note, request_id: rid(),
    };
    const tmp = -(Date.now() % 100000000) - 1000;
    const origById = new Map(orig.map(i => [i.id, i]));
    const changes = [];                                   // what this edit changes — painted green / red straight away, like the server will
    orig.forEach(i => { if (!lines.some(l => l.id === i.id)) changes.push({ item_id: null, name: i.name, delta: -num(i.quantity), removed: true, added: false }); });
    lines.forEach((l, idx) => {
      if (l.id != null) { const b = origById.get(l.id), d = b ? l.quantity - num(b.quantity) : 0; if (d) changes.push({ item_id: l.id, name: b.name, delta: d, removed: false, added: false }); }
      else changes.push({ item_id: tmp - idx, name: l.name, delta: l.quantity, removed: false, added: true });
    });
    const by = ctx.meName ? ctx.meName() : 'You', at = new Date().toISOString();
    const apply = list => list.map(x => {
      if (x.id !== o.id) return x;
      const cur = new Map(itemsOf(x).map(i => [i.id, i]));
      const items = lines.map((l, idx) => {
        if (l.id != null) {
          const base = cur.get(l.id) || origById.get(l.id) || {};
          const was = origById.has(l.id) ? num(origById.get(l.id).quantity) : l.quantity;
          return Object.assign({}, base, { quantity: l.quantity, done: l.quantity > was ? false : !!base.done });   // more of it to cook → the chef ticks it again
        }
        return { id: tmp - idx, menu_item_id: l.menu_item_id, name: l.name, quantity: l.quantity, price_at_order: l.price, kind: l.kind, size: l.size, temperature: l.temperature, done: false };
      });
      return Object.assign(withItems(x, items), { note: note, total_amount: sumTotal(items), last_edit: changes.length ? { by: by, at: at, changes: changes } : x.last_edit });
    });
    S.editing = null; paint();
    opt({ ids: [o.id], apply: apply, method: 'PATCH', path: '/orders/' + o.id, body: payload, what: 'save the changes',
          onOk: updated => { if (updated && updated.id != null && Array.isArray(updated.items)) replaceOrder(updated); } });
  }

  function deleteOrder(o) {
    const key = 'o:' + o.id + ':del';
    if (S.armed !== key) { arm(key); return; }
    disarm(); paint();
    opt({ ids: [o.id], apply: list => list.filter(x => x.id !== o.id), method: 'DELETE', path: '/orders/' + o.id, okStatuses: [404], what: 'remove the order', success: 'Order removed' });
  }

  function setReady(id, val) {
    opt({ ids: [id], method: 'PATCH', path: '/orders/' + id + '/cooked', body: { cooked: val }, what: 'update that',
          apply: list => list.map(o => o.id !== id ? o : withItems(o, itemsOf(o).map(i => Object.assign({}, i, { done: val })))),   // "Ready to serve" ticks everything
          onOk: updated => { if (updated && updated.id != null && Array.isArray(updated.items)) replaceOrder(updated); } });
  }

  function tickItem(oid, iid, val) {
    if (iid < 0) { toast('Just a moment — that item is still being saved'); return; }
    opt({ ids: [oid], method: 'PATCH', path: '/orders/' + oid + '/items/' + iid + '/done', body: { done: val }, what: 'tick that',
          apply: list => list.map(o => o.id !== oid ? o : withItems(o, itemsOf(o).map(i => i.id === iid ? Object.assign({}, i, { done: val }) : i))),
          onOk: updated => { if (updated && updated.id != null && Array.isArray(updated.items)) replaceOrder(updated); } });
  }

  function setStatus(id, status) {
    opt({ ids: [id], method: 'PATCH', path: '/orders/' + id + '/status?new_status=' + encodeURIComponent(status), what: 'change the status',
          apply: list => list.map(o => o.id !== id ? o : Object.assign({}, o, { status: status })),
          onOk: updated => { if (updated && updated.id != null && Array.isArray(updated.items)) replaceOrder(updated); } });
  }

  function moveOrder(id, val) {
    if (!val) return;
    const table_id = val === 'walkin' ? null : Number(val);
    const t = table_id == null ? null : tableById(table_id);
    opt({ ids: [id], method: 'PATCH', path: '/orders/' + id + '/table', body: { table_id: table_id }, what: 'move the order',
          apply: list => list.map(o => o.id !== id ? o : Object.assign({}, o, { table_id: table_id, table_number: t ? String(t.table_number) : null })),
          onOk: updated => { if (updated && updated.id != null) replaceOrder(updated); },
          success: 'Order moved' });
  }

  /* ---- clubbing (merging) orders ---- */
  function clubGo() {
    const ids = Array.from(S.picked);
    if (ids.length < 2) return;
    if (S.armed !== 'club') { arm('club'); return; }
    const sources = allOrders().filter(o => ids.indexOf(o.id) >= 0).sort((a, b) => tsOf(a) - tsOf(b));
    if (sources.length < 2) return;
    const survivor = sources[0].id, order = sources.map(x => x.id), baseClub = num(sources[0].clubbed_count);
    const from = sources.map(x => ({ id: x.id, created_at: x.created_at }));
    const apply = list => {
      const group = list.filter(x => ids.indexOf(x.id) >= 0), surv = group.find(x => x.id === survivor);
      if (!surv) return list;
      const seen = new Set(), items = [];
      order.forEach(sid => { const g = group.find(x => x.id === sid); itemsOf(g || {}).forEach(i => { if (!seen.has(i.id)) { seen.add(i.id); items.push(i); } }); });
      const merged = Object.assign(withItems(surv, items), { total_amount: sumTotal(items), clubbed_count: Math.max(num(surv.clubbed_count), baseClub + order.length - 1), merged_from: surv.merged_from || from });
      return list.filter(x => x.id === survivor || ids.indexOf(x.id) < 0).map(x => x.id === survivor ? merged : x);
    };
    S.selecting = false; S.picked = new Set(); disarm(); paint();
    opt({ ids: ids, apply: apply, method: 'POST', path: '/orders/merge', body: { order_ids: ids }, what: 'club those orders', success: 'Orders clubbed into one',
          onOk: merged => {
            if (merged && merged.id != null && Array.isArray(merged.items)) {
              if (!merged.merged_from) merged.merged_from = from;
              ctx.setOrders([merged].concat(allOrders().filter(o => ids.indexOf(o.id) < 0)));
            }
          } });
  }

  /* ---- unclubbing: split a clubbed order back into its original orders ----
     Tap once to arm, again to confirm (same as Remove). The backend restores the original orders — their own
     items, notes and placed times — and drops the clubbed one. The split itself can't be drawn before the
     server answers (the originals are rebuilt there), so this one shows "Unclubbing…" — but it does retry
     on a bad connection like the rest. */
  async function unclubOrder(o) {
    const key = 'o:' + o.id + ':unclub';
    if (S.armed !== key) { arm(key); return; }
    await run(key, async () => {
      let res;
      try { res = await send('POST', '/orders/' + o.id + '/unmerge', undefined, [400]); }
      catch (e) {
        if (/not found|method not allowed/i.test((e && e.message) || '')) throw new Error('Unclub isn’t switched on in the server yet');
        throw e;
      }
      const restored = Array.isArray(res) ? res : (res && Array.isArray(res.orders) ? res.orders : null);
      if (restored && restored.length) ctx.setOrders(applyOverlays(restored.concat(allOrders().filter(x => x.id !== o.id))));
      else await reloadOrders();                       // also the case when a retry found it already split
      ctx.changed();
      const n = restored ? restored.length : (Array.isArray(o.merged_from) ? o.merged_from.length : 0);
      toast(n ? 'Split back into ' + n + ' orders' : 'Order unclubbed');
    });
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                             */
  /* ------------------------------------------------------------------ */
  function onGridClick(e) {
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (t.dataset.act === 'open') openSheet(t.dataset.tid === 'walkin' ? 'walkin' : Number(t.dataset.tid));
    else if (t.dataset.act === 'filter') { G.filter = t.dataset.v; renderGrid(); }
    else if (t.dataset.act === 'zfilter') { G.zone = t.dataset.v; renderGrid(); }
    else if (t.dataset.act === 'sum') {
      if (t.dataset.v === 'bill') { G.filter = G.filter === 'bill' ? 'all' : 'bill'; renderGrid(); }   // just the tables asking for the bill
      else if (t.dataset.v === 'open') { G.filter = G.filter === 'occ' ? 'all' : 'occ'; renderGrid(); }   // only the tables with an open order
      else openLst(t.dataset.v);                                                                    // ready + not-ready lists, together
    }
  }

  /* Ready / Not-ready panel: both groups side by side in one list, the tapped one first. */
  let LST = null;
  function lstOrders() {
    const open = allOrders().filter(isOpen).sort((a, b) => tsOf(b) - tsOf(a));
    return { ready: open.filter(isReady), prep: open.filter(o => !isReady(o)) };
  }
  function lstRow(o) {
    const t = o.table_id == null ? null : tableById(o.table_id);
    const label = o.table_id == null ? 'Walk-in' : (t ? tl(t) : 'Table ?');
    const items = (o.items || []).map(i => num(i.quantity) + '× ' + (i.name || 'Item')).join(', ') || 'No items';
    return '<button type="button" class="tc-lrow" data-act="lst-go" data-tid="' + (o.table_id == null ? 'walkin' : o.table_id) + '">' +
      '<span class="tc-lrow-top"><b>' + esc(label) + '</b><span>' + fmtTime(o.created_at) + ' · ' + money(o.total_amount) + '</span></span>' +
      '<span class="tc-lrow-items">' + esc(items) + '</span>' + byChip(o) + '</button>';
  }
  function paintLst() {
    if (!LST) return;
    const g = lstOrders();
    const sec = (key, title, cls) => '<div class="tc-lsec ' + cls + '"><div class="tc-lsec-h">' + title + ' <b>' + g[key].length + '</b></div>' +
      (g[key].length ? g[key].map(lstRow).join('') : '<div class="tc-empty">None right now.</div>') + '</div>';
    const order = LST.first === 'prep' ? ['prep', 'ready'] : ['ready', 'prep'];
    const meta = { ready: ['Ready to serve', 'ready'], prep: ['Not ready', 'prep'] };
    LST.body.innerHTML = order.map(k => sec(k, meta[k][0], meta[k][1])).join('');
  }
  function openLst(first) {
    if (!LST) {
      const back = document.createElement('div'); back.className = 'tc-back'; back.hidden = true;
      const box = document.createElement('div'); box.className = 'tc-sheet tc-lst'; box.hidden = true;
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Ready and not ready orders');
      box.innerHTML = '<div class="tc-grab"></div><div class="tc-head"><div class="tc-title"><div class="tc-h-num">Orders to serve</div></div>' +
        '<button type="button" class="tc-chip" data-act="lst-close">Close</button></div><div class="tc-scroll"></div>';
      document.body.appendChild(back); document.body.appendChild(box);
      LST = { back: back, box: box, body: box.querySelector('.tc-scroll'), first: first };
      back.addEventListener('click', closeLst);
      box.addEventListener('click', e => {
        const t = e.target.closest('[data-act]'); if (!t) return;
        if (t.dataset.act === 'lst-close') closeLst();
        else if (t.dataset.act === 'lst-go') { closeLst(); openSheet(t.dataset.tid === 'walkin' ? 'walkin' : Number(t.dataset.tid)); }
      });
    }
    LST.first = first;
    paintLst();
    LST.back.hidden = false; LST.box.hidden = false;
    requestAnimationFrame(() => { LST.back.classList.add('show'); LST.box.classList.add('show'); });
    LST.open = true;
  }
  function closeLst() {
    if (!LST || !LST.open) return;
    LST.open = false;
    LST.back.classList.remove('show'); LST.box.classList.remove('show');
    LST.back.hidden = true; LST.box.hidden = true;
  }

  function onSheetClick(e) {
    if (!S) return;
    const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
    const act = t.dataset.act;
    const art = t.closest('[data-oid]'), oid = art ? Number(art.dataset.oid) : null;
    const order = () => allOrders().find(o => o.id === oid) || olderList().find(o => o.id === oid);
    const line = () => S.editing && S.editing.lines[Number(t.dataset.i)];

    switch (act) {
      case 'close': closeSheet(); break;
      case 'qr-toggle': toggleQr(); break;
      case 'o-ready': { const o = order(); if (o) setReady(o.id, !isReady(o)); break; }
      case 'i-tick': { const o = order(), it = o && itemsOf(o).find(i => i.id === Number(t.dataset.iid)); if (it) tickItem(o.id, it.id, !it.done); break; }
      case 'o-kot': { const o = order(); if (o && ctx.printKot) { ctx.printKot(o); paint(); } break; }
      case 'download': run('download', async () => { await downloadPoster(tableById(S.tid)); await sleep(350); }); break;
      case 'edit': S.renaming = true; S.renameVal = String(tableById(S.tid).table_number); S.zoneVal = tableById(S.tid).zone || ''; S.nameVal = tableById(S.tid).name || ''; disarm(); paint(); break;
      case 'rn-reset': { S.nameVal = ''; const i = el.head.querySelector('#tc-rn-name'); if (i) { i.value = ''; i.focus(); } break; }
      case 'zone': S.zoneVal = t.dataset.v || ''; el.head.querySelectorAll('[data-act="zone"]').forEach(b => { const on = (b.dataset.v || '') === S.zoneVal; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); break;
      case 'rn-cancel': S.renaming = false; paint(); break;
      case 'rn-save': saveRename(); break;
      case 'remove': removeTable(); break;

      case 'range': G.range = t.dataset.v; el.bodyHtml = ''; renderBody(true); break;
      case 'sort': G.sort = G.sort === 'old' ? 'new' : 'old'; el.bodyHtml = ''; renderBody(true); break;

      case 'o-edit': { const o = order(); if (o) startEdit(o); break; }
      case 'o-trim': { const o = order(); if (o && isOpen(o)) { startEdit(o); S.editing.trimOnly = true; paint(); } break; }
      case 'o-del': { const o = order(); if (o) deleteOrder(o); break; }
      case 'o-unclub': { const o = order(); if (o) unclubOrder(o); break; }
      case 'o-settle': { const o = order(); if (o && ctx.settle) ctx.settle(o); break; }
      case 'b-reprint': case 'b-edit': case 'b-del': {
        const o = order();
        if (o && o.bill_id != null && ctx.billAction) ctx.billAction(act === 'b-reprint' ? 'reprint' : act === 'b-edit' ? 'edit' : 'delete', o.bill_id, t);
        break;
      }
      case 'e-cancel': S.editing = null; paint(); break;
      case 'e-save': saveEdit(); break;
      case 'l-inc': { const l = line(); if (l && !(S.editing.trimOnly && l.quantity >= l.maxQty)) { l.quantity += 1; paint(); } break; }
      case 'l-dec': { const l = line(); if (l && l.quantity > 1) { l.quantity -= 1; paint(); } break; }
      case 'l-del': { S.editing.lines.splice(Number(t.dataset.i), 1); paint(); break; }

      case 'club-start': S.selecting = true; S.picked = new Set(); disarm(); paint(); break;
      case 'club-cancel': S.selecting = false; S.picked = new Set(); disarm(); paint(); break;
      case 'club-go': clubGo(); break;
    }
  }

  function onSheetChange(e) {
    if (!S) return;
    const t = e.target, act = t.dataset && t.dataset.act;
    if (act === 'pick') {
      const id = Number(t.dataset.oid);
      if (t.checked) S.picked.add(id); else S.picked.delete(id);
      disarm(); paint();
    } else if (act === 'o-move') moveOrder(Number(t.dataset.oid), t.value);
    else if (act === 'e-add' && t.value && S.editing) {
      const m = (ctx.getMenu() || []).find(x => String(x.id) === t.value);
      if (m) {
        // A dish with options (type / size / hot-cold) has to be added WITH a choice — it is priced by that choice.
        const addLine = ch => {
          if (!S || !S.editing) return;
          const same = l => l.menu_item_id === m.id && (l.kind || null) === (ch.kind || null) && (l.size || null) === (ch.size || null) && (l.temperature || null) === (ch.temp || null) && (l.addons || []).map(a => (a && a.name) || a).sort().join('+') === (ch.addons || []).map(a => a.name).sort().join('+');
          const ex = S.editing.lines.find(same);
          if (ex) ex.quantity += 1;
          else {
            const lab = [ch.kind, ch.size, ch.temp === 'hot' ? 'Hot' : ch.temp === 'cold' ? 'Cold' : null].filter(Boolean).join(' · ');
            S.editing.lines.push({ id: null, menu_item_id: m.id, kind: ch.kind || null, size: ch.size || null, temperature: ch.temp || null,
              addons: (ch.addons || []).map(a => a.name),
              name: (lab ? m.name + ' · ' + lab : m.name) + ((ch.addons || []).length ? ' + ' + ch.addons.map(a => a.name).join(', ') : ''),
              price: (ctx.choicePrice ? ctx.choicePrice(m, ch.kind, ch.size, ch.temp) : num(m.price)) + (ch.addons || []).reduce((t, a) => t + (Number(a.price) || 0), 0), quantity: 1 });
          }
          paint();
        };
        if (ctx.pickChoice) ctx.pickChoice(m, addLine); else addLine({});
        return;
      }
      paint();
    }
  }

  function onSheetInput(e) {
    if (!S) return;
    const t = e.target;
    if (t.id === 'tc-rn') S.renameVal = t.value;
    else if (t.id === 'tc-rn-name') S.nameVal = t.value;
    else if (t.dataset && t.dataset.act === 'e-note' && S.editing) S.editing.note = t.value;
    else if (t.dataset && t.dataset.act === 'e-find' && S.editing) {
      // live-filter the "add an item" list: type a few letters, tap the dish
      const sel = t.parentNode.querySelector('select[data-act="e-add"]'); if (!sel) return;
      const q = t.value.trim().toLowerCase();
      const ms = (ctx.getMenu() || []).filter(m => m.is_available !== false && (!q || String(m.name).toLowerCase().indexOf(q) !== -1));
      sel.innerHTML = (q ? '' : '<option value="">＋ Add an item…</option>') +
        ms.map(m => '<option value="' + m.id + '">' + esc(m.name) + ' — ' + money(m.price) + '</option>').join('') +
        (q && !ms.length ? '<option value="" disabled>No dish matches “' + esc(t.value.trim()) + '”</option>' : '');
      sel.size = q ? Math.min(6, Math.max(2, ms.length || 1)) : 0;
      if (!q) sel.removeAttribute('size');
    }
  }

  function onKey(e) {
    if (!S) return;
    if (e.key === 'Escape') { if (S.renaming) { S.renaming = false; paint(); } else closeSheet(); }
    else if (e.key === 'Enter' && e.target && (e.target.id === 'tc-rn' || e.target.id === 'tc-rn-name')) { e.preventDefault(); saveRename(); }
  }

  /* ------------------------------------------------------------------ */
  /* DOM + CSS                                                          */
  /* ------------------------------------------------------------------ */
  function build() {
    el.host = document.getElementById('orders-body');
    const back = document.createElement('div'); back.className = 'tc-back'; back.hidden = true;
    const sheet = document.createElement('div'); sheet.className = 'tc-sheet'; sheet.hidden = true;
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Table details');
    sheet.innerHTML = '<div class="tc-grab"></div><div class="tc-head" id="tc-head"></div>' +
      '<div class="tc-scroll" id="tc-scroll"><div class="tc-qrwrap" id="tc-qrwrap"></div><div class="tc-actions" id="tc-actions"></div><div id="tc-body"></div></div>';
    document.body.appendChild(back); document.body.appendChild(sheet);
    el.back = back; el.sheet = sheet;
    el.head = sheet.querySelector('#tc-head'); el.scroll = sheet.querySelector('#tc-scroll');
    el.qrwrap = sheet.querySelector('#tc-qrwrap'); el.actions = sheet.querySelector('#tc-actions'); el.body = sheet.querySelector('#tc-body');
    el.host.addEventListener('click', onGridClick);
    back.addEventListener('click', closeSheet);
    sheet.addEventListener('click', onSheetClick);
    sheet.addEventListener('change', onSheetChange);
    sheet.addEventListener('input', onSheetInput);
    document.addEventListener('keydown', onKey);
  }

  function injectCss() {
    if (document.getElementById('tc-css')) return;
    const st = document.createElement('style'); st.id = 'tc-css';
    st.textContent = `
.tc-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 12px}
.tc-sum-i{all:unset;box-sizing:border-box;cursor:pointer;background:#fff;border:1px solid var(--border);border-radius:12px;padding:10px 8px;text-align:center}
.tc-sum-i b{display:block;font:700 22px/1.1 'Inter',sans-serif;color:#171A21}
.tc-sum-i span{display:block;margin-top:3px;font:600 11px/1.2 'Inter',sans-serif;color:#7a8090}
.tc-sum-i:active{transform:scale(.97)}.tc-sum-i.on{border-color:#171A21;box-shadow:inset 0 0 0 1px #171A21}
.tc-lst .tc-head{display:flex;align-items:center;justify-content:space-between}
.tc-lsec{margin:0 0 16px}.tc-lsec-h{font:700 13px/1 'Inter',sans-serif;margin:4px 0 8px;color:#171A21}.tc-lsec-h b{opacity:.55;margin-left:4px}
.tc-lsec.ready .tc-lsec-h{color:#1a8f5a}.tc-lsec.prep .tc-lsec-h{color:#c47a0a}
.tc-lrow{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;background:#fff;border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin:0 0 8px}
.tc-lrow-top{display:flex;justify-content:space-between;font:600 12px/1.2 'Inter',sans-serif;color:#7a8090}.tc-lrow-top b{font-size:14px;color:#171A21}
.tc-lrow-items{display:block;margin-top:5px;font:500 12.5px/1.35 'Inter',sans-serif;color:#4b5160}
.tc-sum-i.ready b{color:#1a8f5a}.tc-sum-i.prep b{color:#c47a0a}
.tc-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.tc-chips.top{margin-bottom:14px}
.tc-chip{all:unset;box-sizing:border-box;cursor:pointer;padding:7px 13px;border-radius:999px;font:600 12.5px/1 'Inter',sans-serif;color:#4b5160;background:#fff;border:1px solid var(--border);transition:background .15s,color .15s}
.tc-chip b{font-weight:700;opacity:.65;margin-left:2px}
.tc-chip.on{background:linear-gradient(180deg,#3A4050,#171A21);color:#fff;border-color:#171A21;box-shadow:0 6px 12px -8px rgba(23,26,33,.9)}
.tc-sum.four{grid-template-columns:repeat(4,1fr)}@media (max-width:420px){.tc-sum.four .tc-sum-i span{font-size:10px}}
.tc-sum-i.bill b{color:#C2185B}.tc-sum-i.bill{border-color:rgba(230,57,118,.45);background:#FFF3F7}
.tc-badge.bill{background:#E63976;color:#fff;animation:tcBill 1.6s ease-in-out infinite}
.tc-card.bill{border-color:rgba(230,57,118,.55);box-shadow:0 0 0 2px rgba(230,57,118,.16)}
.tc-billreq{display:flex;flex-direction:column;gap:2px;padding:11px 14px;margin:0 0 10px;border-radius:12px;background:#FFF3F7;border:1px solid rgba(230,57,118,.4);color:#8C2C52;font:500 12.5px/1.4 'Inter',sans-serif}
.tc-billreq b{font-weight:800;font-size:13.5px;color:#C2185B}
@keyframes tcBill{0%,100%{box-shadow:0 0 0 0 rgba(230,57,118,.5)}50%{box-shadow:0 0 0 6px rgba(230,57,118,0)}}
@media (prefers-reduced-motion:reduce){.tc-badge.bill{animation:none}}
.tc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px}
.tc-card{all:unset;box-sizing:border-box;cursor:pointer;position:relative;display:flex;flex-direction:column;gap:6px;padding:14px 14px 13px 17px;border-radius:18px;background:var(--paper);border:1px solid var(--border);overflow:hidden;transition:transform .15s,box-shadow .2s,border-color .2s}
.tc-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--border)}
.tc-card.occ::before{background:linear-gradient(180deg,#E63976,#FF9770)}.tc-card.emp::before{background:linear-gradient(180deg,#5BD08F,#2FA968)}
.tc-card:hover{transform:translateY(-2px);box-shadow:0 14px 26px -18px rgba(23,26,33,.55);border-color:#d5d8de}
.tc-card:active{transform:scale(.98)}.tc-card:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.tc-card.walk{border-style:dashed}
.tc-card-top{display:flex;align-items:center;justify-content:space-between}
.tc-lab{font:700 10px/1 'Inter',sans-serif;letter-spacing:.16em;color:var(--text-secondary)}
.tc-dot{width:9px;height:9px;border-radius:50%;background:#2FA968;box-shadow:0 0 0 4px rgba(47,169,104,.16)}
.tc-card.occ .tc-dot{background:var(--teal);box-shadow:0 0 0 4px rgba(230,57,118,.16)}
.tc-num{font:700 34px/1.05 'Space Grotesk',sans-serif;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tc-num.long{font-size:21px;padding:6px 0}
.tc-badge{align-self:flex-start;font:700 10.5px/1 'Inter',sans-serif;padding:4px 9px;border-radius:999px}
.tc-badge.occ{background:var(--amber-soft);color:#8C2C52}.tc-badge.emp{background:#E3F4EA;color:#1F7A45}.tc-badge.ready{background:#DDF3E5;color:#14703C;box-shadow:0 0 0 2px rgba(34,165,101,.28)}
.tc-ready{display:inline-flex;align-items:center;gap:5px;font:700 10.5px/1 'Inter',sans-serif;padding:4px 9px;border-radius:999px;background:#DDF3E5;color:#14703C}.tc-ready::before{content:'';width:6px;height:6px;border-radius:50%;background:#22A565}
.tc-ready-btn.is-on{border-style:solid;border-color:#22A565;background:#EAF8F0}
.tc-meta{font-size:12px;color:var(--text-secondary)}
.tc-active{display:inline-flex;align-items:baseline;gap:4px;padding:4px 9px 4px 10px;border-radius:999px;background:linear-gradient(180deg,#F5669A,#E63976);color:#fff;font:700 15px/1 'Space Grotesk',sans-serif;box-shadow:0 6px 14px -6px rgba(230,57,118,.8)}
.tc-active small{font:700 9px/1 'Inter',sans-serif;letter-spacing:.06em;text-transform:uppercase;opacity:.9}
.tc-kot-note{align-self:center;font-size:11.5px;color:var(--text-secondary)}

.tc-back{position:fixed;inset:0;z-index:90;background:rgba(23,26,33,.5);opacity:0;transition:opacity .2s;backdrop-filter:blur(2px)}.tc-back.show{opacity:1}.tc-back[hidden]{display:none}
.tc-sheet{position:fixed;z-index:91;left:0;right:0;bottom:0;max-height:93vh;display:flex;flex-direction:column;background:#F8F9FB;border-radius:24px 24px 0 0;transform:translateY(102%);transition:transform .26s cubic-bezier(.22,.9,.3,1);box-shadow:0 -20px 50px -20px rgba(23,26,33,.5);font-family:'Inter',sans-serif}
.tc-sheet.show{transform:translateY(0)}.tc-sheet[hidden]{display:none}
.tc-sheet *{box-sizing:border-box}
@media (min-width:720px){.tc-sheet{left:50%;right:auto;bottom:auto;top:50%;width:min(600px,94vw);max-height:90vh;border-radius:24px;transform:translate(-50%,-46%) scale(.97);opacity:0;transition:transform .22s,opacity .2s}.tc-sheet.show{transform:translate(-50%,-50%) scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){.tc-sheet,.tc-back,.tc-card{transition:none}}
.tc-grab{width:40px;height:4px;border-radius:4px;background:#d3d6dd;margin:9px auto 0}@media (min-width:720px){.tc-grab{display:none}}
.tc-head{display:flex;align-items:center;gap:10px;padding:12px 14px 12px 18px;border-bottom:1px solid var(--border);background:#fff;border-radius:24px 24px 0 0}
.tc-title{flex:1;min-width:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tc-h-num{font:700 24px/1.1 'Space Grotesk',sans-serif;color:var(--ink)}
.tc-x{all:unset;cursor:pointer;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#F0F1F4;color:#4b5160;font-size:14px;flex:0 0 auto}.tc-x:hover{background:#e4e6ea}
.tc-rename{flex:1;min-width:0}.tc-rename label{display:block;font:700 10.5px/1 'Inter',sans-serif;letter-spacing:.12em;color:var(--text-secondary);margin-bottom:7px;text-transform:uppercase}
.tc-rv-lab{margin-top:12px}
.tc-zchip{all:unset;cursor:pointer;padding:7px 14px;border-radius:999px;border:1.5px solid #D5D9E0;font:700 13px 'Inter',sans-serif;color:var(--ink);background:#fff}.tc-zchip.on{background:var(--ink);border-color:var(--ink);color:#fff}
.tc-rn-note{margin:8px 2px 0;font:500 11.5px/1.4 'Inter',sans-serif;color:var(--text-secondary)}
.tc-zrow{margin-bottom:8px}
.tc-rn-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.tc-rn{flex:1;min-width:90px;font:700 18px 'Space Grotesk',sans-serif;padding:9px 14px;border-radius:999px;border:2px solid var(--teal);background:#fff;color:var(--ink);outline:none}
.tc-scroll{overflow-y:auto;padding:16px 16px 40px;-webkit-overflow-scrolling:touch}

.tc-qrwrap{display:flex;flex-direction:column;align-items:center;gap:10px}.tc-qrwrap[hidden],.tc-actions[hidden]{display:none}
.tc-qrwrap:not([hidden]),.tc-actions:not([hidden]){animation:tcFold .24s cubic-bezier(.22,.9,.3,1)}
@keyframes tcFold{from{opacity:0;transform:translateY(-8px) scale(.97)}}
.tc-qrbtn{all:unset;box-sizing:border-box;cursor:pointer;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex:0 0 auto;color:var(--ink);background:#F0F1F4;box-shadow:inset 0 0 0 1px var(--border);transition:background .18s,color .18s,transform .12s}
.tc-title .tc-badge{align-self:center}
.tc-qrbtn:hover{background:#e4e6ea}.tc-qrbtn:active{transform:scale(.93)}
.tc-qrbtn.on{color:#fff;background:linear-gradient(180deg,#F5669A,#E63976);box-shadow:0 8px 14px -8px rgba(230,57,118,.8)}
.tc-qrbtn:focus-visible{outline:3px solid rgba(230,57,118,.35);outline-offset:2px}
.tc-qr{position:relative;width:246px;height:246px;padding:13px;border-radius:24px;background:#fff;box-shadow:0 18px 34px -20px rgba(23,26,33,.6),inset 0 0 0 1px var(--border)}
.tc-qr-in{width:220px;height:220px;opacity:0;transform:scale(.94);transition:opacity .35s,transform .35s}.tc-qr.ready .tc-qr-in{opacity:1;transform:none}
.tc-qr-in canvas,.tc-qr-in img{display:block;width:220px;height:220px}
.tc-qr:not(.ready):not(.err)::after{content:"";position:absolute;inset:13px;border-radius:14px;background:linear-gradient(100deg,#eef0f3 30%,#fafbfc 50%,#eef0f3 70%);background-size:220% 100%;animation:tcShim 1.1s linear infinite}
.tc-qr.err .tc-qr-in{opacity:1;transform:none;display:grid;place-items:center;text-align:center;font-size:12.5px;color:var(--danger);width:220px}
@keyframes tcShim{to{background-position:-220% 0}}
.tc-qr-cap{font-size:12px;color:var(--text-secondary)}
.tc-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:center;margin:14px 0 20px}
.tc-hint{width:100%;text-align:center;font-size:11.5px;color:var(--text-secondary);margin-top:-2px}

.tc-pill{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:12px 22px;border-radius:999px;font:700 13.5px/1 'Inter',sans-serif;letter-spacing:.01em;color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;transition:transform .12s,filter .15s,background .25s,color .2s,box-shadow .25s}
.tc-pill.sm{padding:9px 15px;font-size:12.5px}
.tc-pill.rose{background:linear-gradient(180deg,#F5669A 0%,#E63976 55%,#D42B68 100%);box-shadow:0 10px 18px -10px rgba(230,57,118,.85),inset 0 1px 0 rgba(255,255,255,.42),inset 0 -2px 0 rgba(0,0,0,.08)}
.tc-pill.ink{background:linear-gradient(180deg,#3E4453 0%,#252A35 55%,#171A21 100%);box-shadow:0 10px 18px -10px rgba(23,26,33,.85),inset 0 1px 0 rgba(255,255,255,.2)}
.tc-pill.danger{background:linear-gradient(180deg,#FFF5F2 0%,#FBDDD5 100%);color:#B3432E;box-shadow:0 8px 16px -10px rgba(179,67,46,.6),inset 0 0 0 1.5px #F1B9AD,inset 0 1px 0 #fff}
.tc-pill.danger.armed{background:linear-gradient(180deg,#E1735B,#B3432E);color:#fff;box-shadow:0 10px 18px -10px rgba(179,67,46,.85),inset 0 1px 0 rgba(255,255,255,.35);animation:tcPulse 1s ease-in-out infinite}
@keyframes tcPulse{50%{filter:brightness(1.08)}}
.tc-pill:hover:not([disabled]){filter:brightness(1.06)}.tc-pill:active:not([disabled]){transform:translateY(1px) scale(.96)}
.tc-pill:focus-visible{outline:3px solid rgba(230,57,118,.35);outline-offset:2px}
.tc-pill[disabled]{cursor:not-allowed;pointer-events:none}
.tc-pill.is-locked{background:linear-gradient(180deg,#F1F2F5,#DEE1E7);color:#9AA0AC;box-shadow:inset 0 0 0 1px #E1E4EA;animation:none}
.tc-pill.is-busy{background:linear-gradient(180deg,#FFC3A2,#FF9770);color:#5A2A10;box-shadow:0 10px 18px -12px rgba(255,151,112,.9),inset 0 1px 0 rgba(255,255,255,.5);animation:none}
.tc-pill.is-done{background:linear-gradient(180deg,#63D797,#2FA968);color:#fff;box-shadow:0 10px 18px -12px rgba(47,169,104,.9),inset 0 1px 0 rgba(255,255,255,.4)}
.tc-dots{display:inline-flex;gap:3px}.tc-dots i{width:5px;height:5px;border-radius:50%;background:currentColor;animation:tcDot 1s infinite ease-in-out}.tc-dots i:nth-child(2){animation-delay:.15s}.tc-dots i:nth-child(3){animation-delay:.3s}
@keyframes tcDot{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1.15)}}

.tc-sec{margin-top:8px;margin-bottom:22px}
.tc-sec-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;min-height:34px}
.tc-sec-h h4{margin:0;font:700 15px 'Space Grotesk',sans-serif;color:var(--ink);display:flex;align-items:center;gap:8px}
.tc-count{font:700 11px/1 'Inter',sans-serif;padding:4px 8px;border-radius:999px;background:var(--amber-soft);color:#8C2C52}
.tc-sort{all:unset;cursor:pointer;font:700 12px 'Inter',sans-serif;color:var(--teal);padding:6px 4px}
.tc-sum{font-size:12.5px;color:var(--text-secondary);margin:2px 2px 12px}.tc-sum b{color:var(--ink)}
.tc-empty{font-size:13px;color:var(--text-secondary);text-align:center;padding:20px 12px;background:#fff;border:1px dashed var(--border);border-radius:14px}.tc-empty.sm{padding:10px;font-size:12.5px}
.tc-linkbtn{all:unset;cursor:pointer;color:var(--teal);font-weight:700}
/* Open vs History look different at a glance:
   open  = warm pink panel, cards with a rose stripe and a pulsing "live" dot on the heading
   history = cool grey panel, flatter muted cards with a green "done" stripe */
.tc-sec--open,.tc-sec--hist{border-radius:20px;padding:12px 12px 2px}
.tc-sec--open{background:linear-gradient(180deg,#FFEEF3,#FFF6F1 75%);border:1px solid #F7CFDC}
.tc-sec--open .tc-sec-h h4{color:#B01E50}
.tc-sec--open .tc-sec-h h4::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--teal);box-shadow:0 0 0 0 rgba(230,57,118,.55);animation:tcLive 1.8s infinite}
@keyframes tcLive{0%{box-shadow:0 0 0 0 rgba(230,57,118,.55)}70%{box-shadow:0 0 0 7px rgba(230,57,118,0)}100%{box-shadow:0 0 0 0 rgba(230,57,118,0)}}
.tc-sec--hist{background:#EEF0F3;border:1px solid #E1E4E9}
.tc-sec--hist .tc-sec-h h4{color:#4B5260}
.tc-sec--hist .tc-sec-h h4::before{content:"";width:16px;height:16px;flex:0 0 auto;background:no-repeat center/16px url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234B5260' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 3-6.7L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3Cpath d='M12 7v5l3 2'/%3E%3C/svg%3E")}
.tc-sec--hist .tc-empty,.tc-sec--open .tc-empty{background:rgba(255,255,255,.7)}
.tc-ord--open,.tc-ord--done{position:relative;overflow:hidden;padding-left:19px}
.tc-ord--open::before,.tc-ord--done::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px}
.tc-ord--open{border-color:#F3C4D4;box-shadow:0 10px 22px -16px rgba(230,57,118,.55)}
.tc-ord--open::before{background:linear-gradient(180deg,#F5669A,#E63976)}
.tc-ord--done{background:#FAFBFC;border-color:#E2E5EA;box-shadow:none}
.tc-ord--done::before{background:#9FD9B8}
.tc-ord--done .tc-amt{color:#4B5260}
.tc-amt--in{font:600 11.5px 'Inter',sans-serif;color:var(--text-secondary)}
.tc-bill{margin:8px 0 0;padding:8px 10px;border-radius:10px;background:#F3F4F7;font-size:12.5px}
.tc-bill-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-variant-numeric:tabular-nums;color:var(--text-secondary)}
.tc-bill-row.neg span:last-child{color:#1F8A52}
.tc-bill-row.strong{margin-top:4px;padding-top:6px;border-top:1px solid #DDE0E6;font-weight:700;color:var(--ink)}
.tc-ord--done .tc-items li{color:#5D6472}
@media (prefers-reduced-motion:reduce){.tc-sec--open .tc-sec-h h4::before{animation:none}}
.tc-clubbar{background:linear-gradient(120deg,#FFECD1,#FFE3EC);border-radius:16px;padding:12px 14px;margin-bottom:10px}
.tc-clubbar p{margin:0 0 10px;font-size:12.5px;color:#5b2a3d;line-height:1.45}.tc-row{display:flex;gap:8px;flex-wrap:wrap}

.tc-ord{background:#fff;border:1px solid var(--border);border-radius:16px;padding:13px 14px;margin-bottom:10px;transition:border-color .2s,box-shadow .2s}
.tc-ord.picked{border-color:var(--teal);box-shadow:0 0 0 3px rgba(230,57,118,.12)}.tc-ord.editing{border-color:#FF9770;box-shadow:0 0 0 3px rgba(255,151,112,.18)}
.tc-ord-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tc-when{font-size:12px;color:var(--text-secondary);flex:1;min-width:120px}
.tc-by{font:700 11px/1 'Inter',sans-serif;padding:4px 8px;border-radius:999px;white-space:nowrap}
.tc-by.qr{background:#E3F0FF;color:#1D5FB0}.tc-by.staff{background:var(--amber-soft);color:#8C2C52}
html[data-theme="dark"] .tc-by.qr{background:#16263B;color:#8DB9F2}
html[data-theme="dark"] .tc-sum-i.bill,html[data-theme="dark"] .tc-billreq{background:#3A1624;color:#F7B6CB}html[data-theme="dark"] .tc-billreq b,html[data-theme="dark"] .tc-sum-i.bill b{color:#FF7FA8}
.tc-ono{font:700 13px/1 'Space Grotesk',sans-serif;color:var(--text);background:var(--canvas);border:1px solid var(--border);padding:4px 8px;border-radius:8px;letter-spacing:.02em}
.tc-amt{font:700 16px 'Space Grotesk',sans-serif;color:var(--ink)}
.tc-merged{margin-top:8px;font-size:11.5px;font-weight:600;color:#7a4b00;background:#FFF3D6;border-radius:10px;padding:5px 10px;display:inline-block}
.tc-items{list-style:none;margin:10px 0 0;padding:0}.tc-items li{display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:13px;border-bottom:1px dashed #eceef1}.tc-items li:last-child{border-bottom:0}
.tc-items li span:last-child{color:var(--text-secondary);white-space:nowrap}
.tc-delta{display:inline-block;margin-left:8px;font-size:11px;font-weight:800;padding:1px 7px;border-radius:999px}
.tc-delta.pos{background:#DDF3E4;color:#17703A}.tc-delta.neg{background:#FBE0E0;color:#B3261E}
.tc-items li.tc-hl.pos{background:#F0FAF3;border-radius:6px;padding-left:6px;padding-right:6px}
.tc-items li.tc-hl.neg{background:#FFF3F2;border-radius:6px;padding-left:6px;padding-right:6px}
.tc-items li.tc-gone{background:#FFF3F2;border-radius:6px;padding-left:6px;padding-right:6px}.tc-gone s{color:#B3261E}
.tc-itn{display:flex;align-items:center;gap:9px;min-width:0}.tc-itn>span{min-width:0}
.tc-tick{flex:none;width:22px;height:22px;border-radius:50%;border:2px solid #C5CAD3;background:transparent;padding:0;cursor:pointer;position:relative;transition:background .12s,border-color .12s,transform .12s}
.tc-tick:active{transform:scale(.88)}.tc-tick.ro{cursor:default;width:16px;height:16px;border-width:1.5px}
.tc-tick.on{background:#22A565;border-color:#22A565}.tc-tick.on::after{content:'';position:absolute;left:50%;top:46%;width:5px;height:10px;border:solid #fff;border-width:0 2.2px 2.2px 0;transform:translate(-50%,-50%) rotate(45deg)}
.tc-tick.ro.on::after{width:4px;height:8px;border-width:0 2px 2px 0}
.tc-prog{display:inline-flex;align-items:center;font:700 10.5px/1 'Inter',sans-serif;padding:4px 9px;border-radius:999px;background:#FFF1D6;color:#8A5A00}
.tc-badge.part{background:#FFF1D6;color:#8A5A00;box-shadow:0 0 0 2px rgba(217,154,0,.25)}
html[data-theme="dark"] .tc-tick{border-color:#5A6170}
html[data-theme="dark"] .tc-prog,html[data-theme="dark"] .tc-badge.part{background:#3A2E12;color:#F2C877}
html[data-theme="dark"] .tc-delta.pos{background:rgba(34,165,101,.30);color:#8CEBB4}
html[data-theme="dark"] .tc-delta.neg{background:rgba(239,83,80,.30);color:#FFB0AB}
html[data-theme="dark"] .tc-bill{background:rgba(255,255,255,.06)}
html[data-theme="dark"] .tc-bill-row.strong{border-top-color:rgba(255,255,255,.16);color:var(--text)}
html[data-theme="dark"] .tc-bill-row.neg span:last-child{color:#4ADE80}
html[data-theme="dark"] .tc-items li.tc-hl.pos{background:rgba(34,165,101,.15)}
html[data-theme="dark"] .tc-items li.tc-hl.neg,html[data-theme="dark"] .tc-items li.tc-gone{background:rgba(239,83,80,.15)}
html[data-theme="dark"] .tc-gone s{color:#FF9C96}
html[data-theme="dark"] .tc-edited b{color:#F2C877}
.tc-edited{font-size:11.5px;color:var(--text-secondary);margin-top:6px}.tc-edited b{color:#8A5A00}
.tc-note-view{margin-top:8px;font-size:12.5px;background:var(--amber-soft);color:#8C2C52;padding:8px 10px;border-radius:10px}
.tc-done{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:12px;width:100%;margin-top:12px;padding:12px 14px;border-radius:14px;border:1.5px dashed #cfd3db;background:#FAFBFC;font:600 13.5px 'Inter',sans-serif;color:#2b2f3a;transition:background .18s,border-color .18s,transform .12s}
.tc-done:hover:not([disabled]){border-color:#2FA968;background:#F2FBF6}.tc-done:active:not([disabled]){transform:scale(.985)}
.tc-done:focus-visible{outline:3px solid rgba(47,169,104,.35);outline-offset:2px}
.tc-done[disabled]{cursor:default}.tc-done[disabled]:not(.is-busy):not(.is-on){opacity:.5}
.tc-done-box{width:24px;height:24px;border-radius:8px;border:2px solid #c3c8d1;background:#fff;flex:0 0 auto;position:relative;transition:all .18s}
.tc-done.is-on{border-style:solid;border-color:#BFE8D0;background:#EEF9F2;color:#1F7A45}
.tc-done.is-on{display:inline-flex;width:auto;gap:7px;margin-top:10px;padding:6px 12px 6px 7px;border-radius:999px;font-size:12px}
.tc-done.is-on .tc-done-box{width:17px;height:17px;border-radius:50%;border-width:0}
.tc-done.is-on .tc-done-box::after{font-size:10.5px}
.tc-done.is-on .tc-done-box,.tc-done.is-busy .tc-done-box{background:linear-gradient(180deg,#63D797,#2FA968);border-color:#2FA968}
.tc-done.is-on .tc-done-box::after,.tc-done.is-busy .tc-done-box::after{content:"✓";position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:14px;font-weight:700}
.tc-ord-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.tc-sel{font:600 12.5px 'Inter',sans-serif;padding:8px 12px;border-radius:999px;border:1px solid var(--border);background:#fff;color:#2b2f3a;max-width:100%}.tc-find{width:100%;box-sizing:border-box;margin-top:10px;font:500 13.5px 'Inter',sans-serif;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:#fff;color:#2b2f3a}.tc-find+.tc-sel.wide{margin-top:6px}.tc-sel.wide{width:100%;margin-top:10px;border-radius:12px;padding:10px 12px}.tc-sel[disabled]{opacity:.5}
.tc-check{position:relative;width:24px;height:24px;flex:0 0 auto;cursor:pointer}.tc-check input{position:absolute;opacity:0;inset:0;width:100%;height:100%;margin:0;cursor:pointer}
.tc-check i{position:absolute;inset:0;border-radius:8px;border:2px solid #c9cdd6;background:#fff;transition:all .15s}.tc-check input:checked+i{background:linear-gradient(180deg,#F5669A,#E63976);border-color:#E63976}
.tc-check input:checked+i::after{content:"✓";position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:14px;font-weight:700}

.tc-warn{margin:10px 0 0;font-size:12px;background:#FFF3D6;color:#7a4b00;padding:8px 10px;border-radius:10px}
.tc-lines{list-style:none;margin:10px 0 0;padding:0}
.tc-lines li{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed #eceef1}
.tc-ln{flex:1;min-width:0;font-size:13.5px;font-weight:600;display:flex;flex-direction:column}.tc-ln small{font-weight:400;color:var(--text-secondary);font-size:11.5px}
.tc-step{display:inline-flex;align-items:center;gap:2px;background:#F0F1F4;border-radius:999px;padding:3px}
.tc-step button{all:unset;cursor:pointer;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:16px;font-weight:700;color:var(--ink);background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.12)}.tc-step button[disabled]{opacity:.35;cursor:default}
.tc-step b{min-width:26px;text-align:center;font-size:13.5px}
.tc-rx{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:#B3432E;font-size:12px;background:#FDECE8}.tc-rx:hover{background:#f8d9d1}
.tc-note{width:100%;margin-top:10px;font:13px 'Inter',sans-serif;padding:10px 12px;border-radius:12px;border:1px solid var(--border);resize:vertical;background:#fff}
.tc-edit-total{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:13px;color:var(--text-secondary)}.tc-edit-total b{font:700 17px 'Space Grotesk',sans-serif;color:var(--ink)}
`;
    document.head.appendChild(st);
  }

  root.TableCards = {
    init: init, render: render, open: openSheet, close: closeSheet,
    overlay: function (list) { return applyOverlays(list); },   // the dashboard lays unconfirmed changes over every list it fetches
    billLines: billLines, finalOf: finalOf,                    // the bill's working + final amount — Order History uses the same ones
    label: tl,
    __debug: { state: () => S, G: G, fmtWhen: fmtWhen, rangeStart: rangeStart },
  };
})(typeof window !== 'undefined' ? window : globalThis);