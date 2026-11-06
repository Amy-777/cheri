/* hotel.js — chéri for hotels: rooms, bookings and guest billing (folio), inside the existing dashboard.
 *
 * Loaded by dashboard.html with ONE extra line (<script src="hotel.js"></script>, after bt-print.js). It touches
 * none of the existing code: it injects its own nav button, view, modal and CSS at runtime, and only for
 * accounts set to "Hotel". Cafes and restaurants never see any of it.
 *
 * Account type:  cafe.business_type ('cafe' | 'hotel') once the backend has it, else this device's copy
 *                (localStorage 'cheri-biz-<cafeId>'), which the setup page and the profile menu set.
 * Hotel = Rooms + Dining (everything the app already does: menu, orders, calls, billing) + Website (later).
 *
 * DATA — saved to the hotel's account (GET/PUT /hotel/data, one document per hotel with a revision number) so every phone and
 * laptop sees the same rooms, bookings and bills. This browser keeps a local copy too (key 'cheri-hotel-v1-<cafeId>') so a bad
 * connection never loses work, and an old local-only hotel is uploaded the first time it syncs. If two devices save at the same
 * moment the later one is told, and refreshed (409). Setup → "Download backup" still works. Original suggested contract:
 *   GET/PUT   /hotel/settings          GET/POST/PATCH/DELETE /hotel/room-types, /hotel/rooms
 *   GET/POST  /hotel/bookings          PATCH /hotel/bookings/{id}  (status, dates, room, rate, discount)
 *   POST      /hotel/bookings/{id}/charges | /payments | /checkout   → returns the invoice
 *
 * Restaurant ↔ room: a room's QR is an ordinary table named "Room 204" (existing /tables API), so room-service
 * orders arrive in the normal Orders tab. Here they can be posted onto the guest's folio ("charge to room").
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- helpers */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const money = v => '₹' + num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const pad = (n, l) => String(n).padStart(l, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  const parse = s => { const p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const nightsBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const fmtD = s => parse(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const fmtDY = s => parse(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const dayOf = iso => ymd(new Date(iso));   // the guest's local calendar day, not UTC
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const toast = m => { try { showToast(m); } catch (e) { /* no toast host */ } };
  const cafeObj = () => { try { return typeof cafe !== 'undefined' ? cafe : null; } catch (e) { return null; } };
  const $ = (sel, r) => (r || document).querySelector(sel);
  const opts = (list, sel) => list.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(sel) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
  const METHODS = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['other', 'Other']];

  /* ---------------------------------------------------------------- store (kept in the hotel's account, with a copy on this device) */
  const blank = () => ({
    v: 1,
    settings: { legalName: '', gstin: '', address: '', phone: '', invoicePrefix: 'INV', extraTax: 18, cancelDays: 1,
                slab: { t1: 1000, r1: 0, t2: 7500, r2: 5, r3: 18 }, amenities: [] },
    types: [], rooms: [], bookings: [], halls: [], banquet: [], posted: {}, seq: { booking: 0, invoice: 0, banquet: 0 },
    cal: {},      // per room type per day: { rate, min, limit, stop }  — key 'typeId|YYYY-MM-DD'
    plans: [{ id: 'ep', name: 'Room only', addon: 0 }, { id: 'cp', name: 'With breakfast', addon: 300 }, { id: 'map', name: 'Breakfast + dinner', addon: 700 }],
    promos: [],   // { id, name, pct, from, to, on }
  });
  let DB = null, DBKEY = null, REV = 0, sync = { state: 'loading', msg: '' };
  let pushTimer = null, pushing = false, pushAgain = false;
  const adopt = d => {
    const b = blank();
    return Object.assign(b, d || {}, { settings: Object.assign(b.settings, (d || {}).settings || {}, { slab: Object.assign(b.settings.slab, ((d || {}).settings || {}).slab || {}) }) });
  };
  function readLocal() {
    let raw = null; try { raw = localStorage.getItem(DBKEY); } catch (e) { /* blocked */ }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }       // corrupt — ignore; the old text stays in storage until the next save
  }
  function writeLocal() { try { localStorage.setItem(DBKEY, JSON.stringify(DB)); } catch (e) { /* the server copy is the real one */ } }
  function dbLoad() {                                  // instant: this device's copy (or blank) — dbSync() then brings in the account's copy
    const c = cafeObj();
    DBKEY = 'cheri-hotel-v1-' + (c && c.id);
    DB = adopt(readLocal());
  }
  const apiOk = () => typeof apiGet === 'function' && typeof apiSend === 'function';
  async function dbSync() {
    if (!apiOk()) { sync = { state: 'local', msg: '' }; return; }
    try {
      const r = await apiGet('/hotel/data');
      const local = readLocal();
      if (r.data) {
        if (local && JSON.stringify(local) !== JSON.stringify(r.data)) { try { localStorage.setItem(DBKEY + '-before-sync', JSON.stringify(local)); } catch (e) { /* */ } }
        DB = adopt(r.data); REV = r.revision; writeLocal();
      } else if (local && ((local.rooms || []).length || (local.types || []).length || (local.bookings || []).length)) {
        DB = adopt(local); REV = 0; await pushNow();      // a hotel that so far lived only on this device moves into the account
      } else { REV = 0; }
      sync = { state: 'ok', msg: '' };
    } catch (e) { sync = { state: 'error', msg: (e && e.message) || 'Couldn’t reach the server' }; }
    render();
  }
  function dbSave() {                                  // local copy now, the account copy a moment later
    writeLocal();
    sync = { state: 'saving', msg: '' };
    clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 500);
  }
  async function pushNow() {
    if (!apiOk()) return;
    if (pushing) { pushAgain = true; return; }
    pushing = true;
    try {
      do {
        pushAgain = false;
        try {
          const r = await apiSend('PUT', '/hotel/data', { data: DB, revision: REV });
          REV = r.revision; sync = { state: 'ok', msg: '' };
        } catch (e) {
          const d = e && e.detail;
          if (e && (e.status === 409 || (d && d.revision != null))) {        // someone else saved first: take their copy
            const theirs = (d && d.data) ? d : await apiGet('/hotel/data');
            DB = adopt(theirs.data); REV = theirs.revision; writeLocal();
            sync = { state: 'ok', msg: '' }; pushAgain = false;
            toast('Another device saved changes first — your screen was refreshed. Redo your last edit if it’s missing.');
            closeModal(); render();
          } else { sync = { state: 'error', msg: (e && e.message) || 'Couldn’t save' }; pushAgain = false; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 6000); }
        }
      } while (pushAgain);
    } finally { pushing = false; }
    if (ST.tab === 'setup') render();
  }

  /* ---------------------------------------------------------------- domain */
  const typeById = id => DB.types.find(t => t.id === id);
  const roomById = id => DB.rooms.find(r => r.id === id);
  const bookingById = id => DB.bookings.find(b => b.id === id);
  const roomNo = b => { const r = roomById(b.roomId); return r ? r.no : (b.roomNo || '?'); };
  const typeName = b => { const t = typeById(b.typeId); return t ? t.name : 'Room'; };
  const sortRooms = (a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true });
  const live = b => b.status === 'reserved' || b.status === 'in';

  // A guest still checked in after their date stays in the room until they're checked out.
  const effOut = b => (b.status === 'in' && b.checkOut <= today()) ? addDays(today(), 1) : b.checkOut;
  function clashes(roomId, ci, co, exceptId) {
    return DB.bookings.filter(b => b.roomId === roomId && live(b) && b.id !== exceptId && b.checkIn < co && effOut(b) > ci);
  }
  function freeRooms(typeId, ci, co, exceptId) {
    return DB.rooms.filter(r => (!typeId || r.typeId === typeId) && r.hk !== 'blocked' && clashes(r.id, ci, co, exceptId).length === 0).sort(sortRooms);
  }
  const inHouse = r => DB.bookings.find(b => b.roomId === r.id && b.status === 'in');
  const roomState = r => inHouse(r) ? 'occupied' : (r.hk === 'blocked' ? 'blocked' : (r.hk === 'dirty' ? 'dirty' : 'vacant'));
  const STATE_LABEL = { occupied: 'Occupied', vacant: 'Vacant · clean', dirty: 'Needs cleaning', blocked: 'Out of service' };

  /* ---- rates & availability calendar ---- */
  const calKey = (typeId, d) => typeId + '|' + d;
  const calOf = (typeId, d) => DB.cal[calKey(typeId, d)] || {};
  function calSet(typeId, d, patch) {
    const k = calKey(typeId, d), e = Object.assign({}, DB.cal[k], patch);
    Object.keys(e).forEach(f => { if (e[f] === undefined || e[f] === null || e[f] === '' || e[f] === false) delete e[f]; });
    if (Object.keys(e).length) DB.cal[k] = e; else delete DB.cal[k];
  }
  const offerPct = d => DB.promos.filter(p => p.on && p.from <= d && d <= p.to).reduce((m, p) => Math.max(m, num(p.pct)), 0);
  function dayRate(typeId, d) {
    const t = typeById(typeId), c = calOf(typeId, d);
    const base = c.rate != null ? num(c.rate) : (t ? num(t.rate) : 0);
    return Math.round(base * (1 - offerPct(d) / 100));
  }
  function avgRate(typeId, ci, co) {
    const n = Math.max(1, nightsBetween(ci, co)); let sum = 0;
    for (let i = 0; i < n; i++) sum += dayRate(typeId, addDays(ci, i));
    return Math.round(sum / n);
  }
  function roomsLeft(typeId, d) {
    const all = DB.rooms.filter(r => r.typeId === typeId);
    const taken = all.filter(r => clashes(r.id, d, addDays(d, 1)).length > 0).length;
    const c = calOf(typeId, d), cap = c.limit != null ? Math.min(all.length, num(c.limit)) : all.length;
    return Math.max(0, cap - taken);
  }
  const planOf = id => DB.plans.find(p => p.id === id) || DB.plans[0] || { id: 'ep', name: 'Room only', addon: 0 };
  // Stop-sell and minimum stay are for the website and booking sites; the front desk can always override.
  const channelSrc = s => s === 'website' || s === 'ota';
  function restrictionMsg(typeId, ci, co) {
    const n = nightsBetween(ci, co);
    for (let i = 0; i < n; i++) { const d = addDays(ci, i); if (calOf(typeId, d).stop) return 'Closed for sale on ' + fmtD(d) + ' (stop-sell).'; }
    const m = num(calOf(typeId, ci).min);
    if (m > n) return 'Minimum stay on ' + fmtD(ci) + ' is ' + m + ' nights.';
    return '';
  }

  const slabRate = nightly => { const s = DB.settings.slab; return nightly <= s.t1 ? num(s.r1) : (nightly <= s.t2 ? num(s.r2) : num(s.r3)); };

  // The guest's bill. Room tariff and extras are entered WITHOUT GST and taxed here; restaurant orders posted
  // from the Orders tab already include their tax, so they're added as they are.
  function calc(b) {
    const n = Math.max(1, nightsBetween(b.checkIn, b.checkOut));
    const lines = [{ kind: 'room', desc: 'Room ' + roomNo(b) + ' · ' + typeName(b) + (b.planId && planOf(b.planId).addon ? ' (' + planOf(b.planId).name + ')' : '') + ' · ' + n + ' night' + (n > 1 ? 's' : '') + ' × ' + money(b.rate),
                     base: n * num(b.rate), rate: slabRate(num(b.rate)), sac: '996311' }];
    (b.charges || []).forEach(c => lines.push({ id: c.id, kind: c.kind, desc: c.desc, base: num(c.amount), rate: c.kind === 'food' ? 0 : num(c.taxRate), incl: c.kind === 'food', at: c.at }));
    const taxable = lines.filter(l => !l.incl).reduce((s, l) => s + l.base, 0);
    const sub = lines.reduce((s, l) => s + l.base, 0);
    const d = b.discount || { type: 'flat', value: 0 };
    const disc = d.type === 'pct' ? taxable * Math.min(100, Math.max(0, num(d.value))) / 100 : Math.min(taxable, Math.max(0, num(d.value)));
    const f = taxable ? (taxable - disc) / taxable : 1;
    const tax = {};
    lines.forEach(l => { if (l.incl) return; l.tax = l.base * f * l.rate / 100; tax[l.rate] = (tax[l.rate] || 0) + l.tax; });
    const taxTotal = Object.keys(tax).reduce((s, k) => s + tax[k], 0);
    const raw = sub - disc + taxTotal, total = Math.round(raw);
    const paid = (b.payments || []).reduce((s, p) => s + num(p.amount), 0);
    return { lines: lines, sub: sub, disc: disc, tax: tax, taxTotal: taxTotal, roundOff: total - raw, total: total, paid: paid, balance: total - paid, nights: n };
  }

  /* Restaurant orders that belong to a room: the open orders of the table named "Room 204" (or "R204"). */
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[\s\-_.]/g, '');
  const tableLabel = id => { const t = (getTables() || []).find(x => x.id === id); return t ? String(t.table_number) : null; };
  const isRoomTable = (label, no) => { const l = norm(label), n = norm(no); return l === 'room' + n || l === 'r' + n; };      // older QRs: a table literally named "Room 204"
  const tableFor = id => (getTables() || []).find(x => x.id === id);
  const isRoomTbl = (t, no) => !!t && ((t.is_room && norm(t.table_number) === norm(no)) || isRoomTable(t.table_number, no));
  const orderOpen = o => o.status !== 'paid' && !DB.posted[o.id];
  /* Linked restaurant (two-key link): its room orders arrive from the server, shaped like ordinary orders (id 'L<id>', linked: true). */
  const LK = { linked: false, restaurant: '', orders: [], menu: null, at: 0 };
  const linkedOrders = () => LK.orders.map(o => ({ id: 'L' + o.id, rid: o.id, linked: true, status: o.status, total_amount: o.total_amount, items: (o.items || []).map(i => ({ name: i.name, quantity: i.quantity })), room_no: o.room_no, created_at: o.created_at, note: o.note }));
  const allOrders = () => (getOrders() || []).concat(linkedOrders());
  function loadLink() {
    if (typeof apiGet !== 'function') return Promise.resolve();
    return apiGet('/link').then(st => {
      LK.linked = !!(st && st.linked);
      if (!LK.linked) { LK.orders = []; LK.menu = null; return; }
      return apiGet('/link/orders').then(r => { LK.restaurant = r.restaurant || ''; LK.orders = r.orders || []; });
    }).catch(() => {}).then(() => { LK.at = Date.now(); try { syncDiningTab(); if (host && host.style.display !== 'none' && !modal.classList.contains('show')) render(); } catch (e) { /* */ } });
  }
  let syncDiningTab = () => {};
  document.addEventListener('cafelink:changed', () => { LK.menu = null; loadLink(); });
  function ordersForRoom(room) {
    return (getOrders() || []).filter(o => o.table_id != null && orderOpen(o) && isRoomTbl(tableFor(o.table_id), room.no))
      .concat(linkedOrders().filter(o => orderOpen(o) && norm(o.room_no) === norm(room.no)));
  }
  function otherOrders(room) {
    return (getOrders() || []).filter(o => orderOpen(o) && !(o.table_id != null && isRoomTbl(tableFor(o.table_id), room.no)));
  }
  const roomTable = room => (getTables() || []).find(t => isRoomTbl(t, room.no));
  const orderSummary = o => (o.items || []).map(i => num(i.quantity) + '× ' + (i.name || 'Item')).join(', ') || 'No items';
  const orderWhere = o => { if (o.linked) return 'Room ' + o.room_no + ' · ' + (LK.restaurant || 'restaurant'); if (o.table_id == null) return 'Walk-in'; const t = tableFor(o.table_id); return t ? ((t.is_room ? 'Room ' : 'Table ') + t.table_number) : 'Table ?'; };

  /* ---------------------------------------------------------------- state */
  const ST = { rs: null, rep: 7, inc: 7, rateTouched: false, tab: 'rooms', bk: 'timeline', bkMode: 'rooms', hall: null, bqm: null, enq: null, enqId: null, bf: 'arriving', tl: null, folioId: null, bookingId: null, roomId: null, msg: '' };
  let host = null, modal = null, ready = false;

  /* ---------------------------------------------------------------- CSS */
  function injectCss() {
    if (document.getElementById('ht-css')) return;
    const st = document.createElement('style'); st.id = 'ht-css';
    st.textContent = `
.ht-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 14px}
.ht-stat{background:var(--paper);border:1px solid var(--border);border-radius:12px;padding:10px 6px;text-align:center}
.ht-stat b{display:block;font:700 20px/1.1 'Space Grotesk',sans-serif}.ht-stat span{display:block;margin-top:3px;font-size:10.5px;font-weight:600;color:var(--text-secondary)}
.ht-sec{font:700 12px/1 'Inter',sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--text-secondary);margin:18px 0 8px}
.ht-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.ht-room{all:unset;box-sizing:border-box;cursor:pointer;background:var(--paper);border:1px solid var(--border);border-left:4px solid #9AA0AC;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:3px;min-height:86px}
.ht-room b{font:700 20px/1 'Space Grotesk',sans-serif}.ht-room small{font-size:11px;color:var(--text-secondary)}
.ht-room.occupied{border-left-color:#E63976}.ht-room.vacant{border-left-color:#22A565}.ht-room.dirty{border-left-color:#D99A00}.ht-room.blocked{border-left-color:#6B7280;opacity:.75}
.ht-badge{display:inline-block;align-self:flex-start;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:999px;background:#EEF0F3;color:#4b5160}
.ht-badge.occupied,.ht-badge.in{background:#FFE3EC;color:#B02357}.ht-badge.vacant,.ht-badge.out{background:#DDF4E6;color:#17784A}
.ht-badge.dirty,.ht-badge.reserved{background:#FFF1CC;color:#8A6200}.ht-badge.cancelled,.ht-badge.noshow{background:#EEF0F3;color:#6B7280}
.ht-row{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;background:var(--paper);border:1px solid var(--border);border-radius:12px;padding:11px 12px;margin:0 0 8px}
.ht-row-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.ht-row-top b{font-size:14px}
.ht-row small{display:block;margin-top:4px;color:var(--text-secondary);font-size:12px;line-height:1.35}
.ht-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.ht-chip{all:unset;box-sizing:border-box;cursor:pointer;padding:7px 13px;border-radius:999px;font:600 12.5px/1 'Inter',sans-serif;color:#4b5160;background:var(--paper);border:1px solid var(--border)}
.ht-chip.on{background:var(--ink,#171A21);color:#fff;border-color:var(--ink,#171A21)}
.ht-am-g{margin:14px 0 6px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-secondary)}.ht-am-row{display:flex;flex-wrap:wrap;gap:6px}.ht-am-row:empty::before{content:'Nothing added yet';font-size:12px;color:var(--text-secondary)}
.ht-am-c{display:inline-flex!important;align-items:center;gap:6px;font-size:12px!important;padding:7px 11px!important}.ht-am-c svg{flex:none}.ht-am-add{display:flex;gap:8px;margin-top:10px}.ht-am-add input{flex:1;min-width:0}.ht-am-n{font-size:12px;color:var(--text-secondary);margin:10px 0 0}
.ht-tl{overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--paper);max-height:60vh}
.ht-tl table{border-collapse:separate;border-spacing:0;font-size:11px;min-width:100%}
.ht-tl th,.ht-tl td{border-bottom:1px solid var(--border);border-right:1px solid var(--border);min-width:44px;height:34px;text-align:center;padding:0}
.ht-tl th{position:sticky;top:0;background:var(--paper);z-index:2;font-weight:700;height:38px;line-height:1.1}.ht-tl th.today{color:var(--teal)}
.ht-tl th:first-child,.ht-tl td:first-child{position:sticky;left:0;z-index:3;background:var(--paper);min-width:70px;font-weight:700;text-align:left;padding:0 8px}
.ht-tl td.free{cursor:pointer}.ht-tl td.free:hover{background:#F1F3F6}
.ht-tl td.bk{cursor:pointer;color:#fff;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:60px;padding:0 4px}
.ht-tl td.bk.reserved{background:#D99A00}.ht-tl td.bk.in{background:#E63976}.ht-tl td.bk.out{background:#9AA0AC}
body.is-hotel nav.bottom-nav button[data-view="inventory"],body.is-hotel nav.bottom-nav button[data-view="analytics"]{display:none!important}body.is-hotel:not(.hotel-dining) nav.bottom-nav button[data-view="orders"],body.is-hotel:not(.hotel-dining) nav.bottom-nav button[data-view="menu"]{display:none!important}
.ht-person{border:1px solid var(--border,#e5e0d4);border-radius:12px;padding:10px 12px;margin:8px 0}.ht-idrow{display:flex;align-items:center;gap:10px;margin:8px 0}.ht-thumb{width:58px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #d9d4c6;cursor:zoom-in;background:#eee}.ht-sub{font-weight:600;margin:14px 0 4px}.ht-pline{padding:6px 0;border-top:1px solid #e9e4d6}.ht-pline:first-child{border-top:0}.ht-lb{position:fixed;inset:0;background:rgba(0,0,0,.86);display:grid;place-items:center;z-index:100000;cursor:zoom-out}.ht-lb img{max-width:92vw;max-height:88vh;border-radius:6px}
.ht-modes{margin:0 0 10px}.ht-dot{background:#c0392b;color:#fff;border-radius:9px;padding:0 6px;font-size:11px;margin-left:4px}
.ht-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin:6px 0}.ht-cal-h{text-align:center;font-size:11px;color:var(--text-secondary);padding:2px 0}
.ht-cal-d{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0 6px;border:1px solid var(--border,#e5e0d4);border-radius:10px;background:#fffdf8;cursor:pointer;font:inherit}
.ht-cal-d b{font-weight:600;font-size:14px}.ht-cal-d i{display:block;width:70%;height:5px;border-radius:3px;background:#e7e2d5}.ht-cal-d i.on{background:#9b3b2e}
.ht-cal-d.today{outline:2px solid #2f6b4f}.ht-cal-d.past{opacity:.55}.ht-dim{opacity:.6}
.ht-nav{display:flex;gap:8px;align-items:center;margin:0 0 10px}.ht-nav .spacer{flex:1}
.ht-card{background:var(--paper);border:1px solid var(--border);border-radius:14px;padding:14px;margin:0 0 12px}
.ht-card h3{margin:0 0 10px;font-size:14px}
.ht-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ht-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.ht-m input,.ht-m select,.ht-m textarea,.ht-card input,.ht-card select{width:100%;box-sizing:border-box;font:500 14px 'Inter',sans-serif;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--paper);color:var(--text);margin:0 0 10px}
.ht-m h2{margin:0 0 4px;font-size:18px}.ht-m .sub{margin:0 0 14px;color:var(--text-secondary);font-size:13px}
.ht-err{color:var(--danger);font-size:12.5px;margin:0 0 10px;min-height:0}
.ht-sum{background:var(--canvas);border-radius:10px;padding:10px 12px;font-size:13px;margin:0 0 12px;line-height:1.5}
.ht-bill{width:100%;border-collapse:collapse;font-size:13px}.ht-bill td{padding:6px 0;border-bottom:1px dashed var(--border);vertical-align:top}.ht-bill td:last-child{text-align:right;white-space:nowrap;padding-left:10px}
.ht-bill tr.tot td{font-weight:700;font-size:15px;border-bottom:none;padding-top:10px}.ht-bill tr.sub td{color:var(--text-secondary)}
.ht-bill .x{all:unset;cursor:pointer;color:var(--danger);font-size:12px;margin-left:6px}
.ht-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.ht-actions .btn{flex:1;text-align:center;min-width:120px}
.ht-danger{color:var(--danger)!important}
.ht-pick{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px dashed var(--border);font-size:13px}.ht-pick input{width:auto;margin:3px 0 0}
.ht-pick small{display:block;color:var(--text-secondary)}
.ht-help{font-size:12px;color:var(--text-secondary);line-height:1.45;margin:0 0 10px}
.ht-banner{background:#FFF7E0;border:1px solid #F1DDA0;color:#6B5200;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.45;margin:0 0 14px}
.ht-bt{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ht-bt button{all:unset;cursor:pointer;box-sizing:border-box;border:2px solid var(--border);border-radius:14px;padding:16px 12px;text-align:center;font-weight:700;font-size:14px;background:var(--paper)}
.ht-bt button small{display:block;font-weight:500;font-size:12px;color:var(--text-secondary);margin-top:6px;line-height:1.35}.ht-bt button.on{border-color:var(--teal);background:var(--teal-soft)}
.ht-tl td.rc{cursor:pointer;font-weight:600;font-size:11px;min-width:54px}.ht-tl td.rc:hover{background:#F1F3F6}
.ht-tl td.rc.stop{background:#F7E7E3;color:#B3432E}.ht-tl td.rc.zero{color:#B3432E}.ht-tl td.rc.ov{color:var(--teal);text-decoration:underline}.ht-tl td.rc.off{color:#17784A}
/* Hotel look: its own palette (deep green + brass on warm ivory) and a serif for headings and big numbers */
#view-hotel,#ht-modal{--teal:#0F5F55;--teal-soft:#DDEFEA;--amber:#B58A3C;--canvas:#F6F1E6;--paper:#FFFDF8;--border:#E4DCC8;--ink:#10302B}
html[data-theme="dark"] #view-hotel,html[data-theme="dark"] #ht-modal{--teal:#4DB6A5;--teal-soft:#16332E;--amber:#D9B25F;--canvas:#161A19;--paper:#1E2423;--border:#2D3735;--ink:#E7EFEC}
#view-hotel h1,#ht-modal h2,.ht-card h3,.ht-stat b,.ht-room b{font-family:'Fraunces',Georgia,serif;font-weight:600;letter-spacing:-.01em}
#view-hotel .page-head h1{font-size:24px}
.ht-stat,.ht-card,.ht-row,.ht-room,.ht-tl{box-shadow:0 1px 0 rgba(16,48,43,.04),0 8px 18px -14px rgba(16,48,43,.35)}
.ht-sec{color:var(--amber)}
.ht-badge.occupied,.ht-badge.in{background:#DDEFEA;color:#0F5F55}.ht-room.occupied{border-left-color:#0F5F55}
.ht-badge.vacant,.ht-badge.out{background:#EFE7D3;color:#6B5420}.ht-room.vacant{border-left-color:#B58A3C}
.ht-tl td.bk.in{background:#0F5F55}.ht-tl td.bk.reserved{background:#B58A3C}
`;
    document.head.appendChild(st);
    if (!document.getElementById('ht-font')) { const l = document.createElement('link'); l.id = 'ht-font'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap'; document.head.appendChild(l); }
  }

  /* ---------------------------------------------------------------- tabs */
  const SUB = { rooms: 'Live status of every room.', bookings: 'Reservations, check-ins and check-outs.', rates: 'Room rates by date and plan.', billing: 'Guest bills and payments.', dining: 'Your linked restaurant — room orders and its menu.', setup: 'Room types, floors and hotel settings.' };
  const ICON = {
    rooms: '<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.5"/>',
    bookings: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    rates: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    billing: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    dining: '<path d="M7 3v8M4 3v5a3 3 0 0 0 3 3 3 3 0 0 0 3-3V3M7 11v10M17 3c-2 2-3 4.5-3 7h3v11"/>',
    setup: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'
  };
  const svgFor = k => '<svg class="nav-icon" width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + '</svg>';
  const TABS = [['rooms', 'Rooms'], ['bookings', 'Bookings'], ['rates', 'Rates'], ['billing', 'Billing'], ['dining', 'Dining'], ['setup', 'Setup']];

  function render() {
    if (!host || !DB) return;
    const tabs = '';
    const T = TABS.filter(t => t[0] === ST.tab)[0] || TABS[0]; const hh = host.querySelector('h1'), hp = host.querySelector('.page-head p');
    if (hh) hh.textContent = T[1]; if (hp) hp.textContent = SUB[T[0]] || '';
    let body = '';
    if (ST.tab === 'rooms') body = viewRooms();
    else if (ST.tab === 'bookings') body = viewBookings();
    else if (ST.tab === 'rates') body = viewRates();
    else if (ST.tab === 'billing') body = viewBilling();
    else if (ST.tab === 'dining') body = viewDining();
    else body = viewSetup();
    const keep = window.scrollY;
    $('#ht-body', host).innerHTML = tabs + body;
    window.scrollTo(0, keep);
  }

  const needsSetup = () => !DB.types.length || !DB.rooms.length;
  const setupNudge = () => '<div class="ht-card"><h3>Let’s set up your rooms</h3><p class="ht-help">Add your room types (Deluxe, Suite…) with their nightly rate, then add the rooms themselves. It takes a minute — you can add many rooms at once.</p><div class="ht-actions"><button class="btn btn-primary" data-h="tab" data-v="setup">Go to Setup</button></div></div>';

  /* ---- Rooms ---- */
  function viewRooms() {
    if (needsSetup()) return setupNudge();
    const t = today();
    const occ = DB.rooms.filter(r => roomState(r) === 'occupied').length;
    const dirty = DB.rooms.filter(r => roomState(r) === 'dirty').length;
    const arr = DB.bookings.filter(b => b.status === 'reserved' && b.checkIn <= t).length;
    const dep = DB.bookings.filter(b => b.status === 'in' && b.checkOut <= t).length;
    const stat = (n, l) => '<div class="ht-stat"><b>' + n + '</b><span>' + l + '</span></div>';
    const floors = {};
    DB.rooms.slice().sort(sortRooms).forEach(r => { (floors[r.floor || 'Rooms'] = floors[r.floor || 'Rooms'] || []).push(r); });
    const arrivals = DB.bookings.filter(b => b.status === 'reserved' && b.checkIn <= t), leaving = DB.bookings.filter(b => b.status === 'in' && b.checkOut <= t);
    const mini = b => '<button type="button" class="ht-row" data-h="booking" data-id="' + b.id + '"><span class="ht-row-top"><b>' + esc(b.guest.name) + '</b><span>Room ' + esc(roomNo(b)) + '</span></span><small>' + fmtD(b.checkIn) + ' → ' + fmtD(b.checkOut) + ' · ' + esc(typeName(b)) + '</small></button>';
    const todayCard = (arrivals.length || leaving.length) ? '<div class="ht-sec">Today</div>' +
      (arrivals.length ? '<p class="ht-help" style="margin:0 0 6px"><b>Arrivals (' + arrivals.length + ')</b></p>' + arrivals.map(mini).join('') : '') +
      (leaving.length ? '<p class="ht-help" style="margin:8px 0 6px"><b>Departures (' + leaving.length + ')</b></p>' + leaving.map(mini).join('') : '') : '';
    return '<div class="ht-stats">' + stat(occ + '/' + DB.rooms.length, 'Occupied') + stat(dirty, 'To clean') + stat(arr, 'Arriving') + stat(dep, 'Leaving') + '</div>' + todayCard +
      Object.keys(floors).map(f => '<div class="ht-sec">' + (f === 'Rooms' ? 'Rooms' : 'Floor ' + esc(f)) + '</div><div class="ht-grid">' + floors[f].map(roomCard).join('') + '</div>').join('');
  }
  function roomCard(r) {
    const s = roomState(r), b = inHouse(r), ty = typeById(r.typeId);
    const food = ordersForRoom(r).length;
    return '<button type="button" class="ht-room ' + s + '" data-h="room" data-id="' + r.id + '"><b>' + esc(r.no) + '</b>' +
      '<small>' + esc(ty ? ty.name : '—') + '</small><span class="ht-badge ' + s + '">' + STATE_LABEL[s] + '</span>' +
      (b ? '<small>' + esc(b.guest.name) + ' · till ' + fmtD(b.checkOut) + '</small>' : '') +
      (food ? '<small>' + food + ' order' + (food > 1 ? 's' : '') + ' to bill</small>' : '') + '</button>';
  }

  /* ---- Bookings ---- */
  function viewBookings() {
    if (needsSetup() && ST.bkMode === 'rooms') return setupNudge();
    const nEnq = (ST.enq || []).length;
    const modes = '<div class="ht-chips ht-modes"><button class="ht-chip' + (ST.bkMode === 'rooms' ? ' on' : '') + '" data-h="bkMode" data-v="rooms">Rooms</button><button class="ht-chip' + (ST.bkMode === 'banquet' ? ' on' : '') + '" data-h="bkMode" data-v="banquet">Banquet</button><button class="ht-chip' + (ST.bkMode === 'requests' ? ' on' : '') + '" data-h="bkMode" data-v="requests">Website requests' + (nEnq ? ' <b class="ht-dot">' + nEnq + '</b>' : '') + '</button></div>';
    if (ST.bkMode === 'banquet') return modes + viewBanquet();
    if (ST.bkMode === 'requests') return modes + viewRequests();
    const head = modes + '<div class="ht-nav"><button class="btn btn-primary" data-h="newBooking">+ New booking</button><span class="spacer"></span>' +
      '<div class="ht-chips" style="margin:0"><button class="ht-chip' + (ST.bk === 'timeline' ? ' on' : '') + '" data-h="bk" data-v="timeline">Timeline</button><button class="ht-chip' + (ST.bk === 'list' ? ' on' : '') + '" data-h="bk" data-v="list">List</button></div></div>';
    return head + (ST.bk === 'timeline' ? viewTimeline() : viewList());
  }
  function viewTimeline() {
    const start = ST.tl || (ST.tl = today()), DAYS = 14, t = today();
    const days = []; for (let i = 0; i < DAYS; i++) days.push(addDays(start, i));
    const th = days.map(d => '<th class="' + (d === t ? 'today' : '') + '">' + parse(d).toLocaleDateString('en-IN', { weekday: 'short' }) + '<br>' + parse(d).getDate() + '</th>').join('');
    const rows = DB.rooms.slice().sort(sortRooms).map(r => {
      const cells = days.map(d => {
        const b = DB.bookings.find(x => x.roomId === r.id && x.status !== 'cancelled' && x.status !== 'noshow' && x.checkIn <= d && (x.status === 'out' ? x.checkOut : effOut(x)) > d);
        if (b) return '<td class="bk ' + b.status + '" data-h="booking" data-id="' + b.id + '" title="' + esc(b.guest.name) + '">' + (d === b.checkIn || d === start ? esc(b.guest.name.split(' ')[0]) : '') + '</td>';
        return '<td class="free" data-h="newBooking" data-room="' + r.id + '" data-date="' + d + '"></td>';
      }).join('');
      return '<tr><td>' + esc(r.no) + '</td>' + cells + '</tr>';
    }).join('');
    return '<div class="ht-nav"><button class="btn btn-ghost btn-sm" data-h="tlMove" data-v="-7">‹ Week</button><button class="btn btn-ghost btn-sm" data-h="tlMove" data-v="0">Today</button><button class="btn btn-ghost btn-sm" data-h="tlMove" data-v="7">Week ›</button><span class="spacer"></span><small style="color:var(--text-secondary)">' + fmtD(days[0]) + ' – ' + fmtD(days[DAYS - 1]) + '</small></div>' +
      '<div class="ht-tl"><table><thead><tr><th>Room</th>' + th + '</tr></thead><tbody>' + rows + '</tbody></table></div><p class="ht-help" style="margin-top:8px">Tap an empty cell to book that room from that day · tap a coloured bar to open the booking.</p>';
  }
  const LIST_FILTERS = [['arriving', 'Arriving'], ['in', 'In-house'], ['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Cancelled']];
  function filterBookings(f) {
    const t = today(), all = DB.bookings.slice();
    let list;
    if (f === 'arriving') list = all.filter(b => b.status === 'reserved' && b.checkIn <= t);
    else if (f === 'in') list = all.filter(b => b.status === 'in');
    else if (f === 'upcoming') list = all.filter(b => b.status === 'reserved' && b.checkIn > t);
    else if (f === 'past') list = all.filter(b => b.status === 'out');
    else list = all.filter(b => b.status === 'cancelled' || b.status === 'noshow');
    return list.sort((a, b) => f === 'past' || f === 'cancelled' ? (b.checkIn < a.checkIn ? -1 : 1) : (a.checkIn < b.checkIn ? -1 : 1));
  }
  function bookingRow(b) {
    const c = calc(b), bal = b.status === 'in' || b.status === 'reserved';
    return '<button type="button" class="ht-row" data-h="booking" data-id="' + b.id + '"><span class="ht-row-top"><b>' + esc(b.guest.name) + '</b><span class="ht-badge ' + b.status + '">' + ({ reserved: 'Reserved', in: 'Checked in', out: 'Checked out', cancelled: 'Cancelled', noshow: 'No-show' })[b.status] + '</span></span>' +
      '<small>Room ' + esc(roomNo(b)) + ' · ' + esc(typeName(b)) + ' · ' + fmtD(b.checkIn) + ' → ' + fmtD(b.checkOut) + ' (' + c.nights + 'n)' + (bal && c.paid ? ' · paid ' + money(c.paid) : '') + '</small></button>';
  }
  function viewList() {
    const chips = '<div class="ht-chips">' + LIST_FILTERS.map(f => '<button class="ht-chip' + (ST.bf === f[0] ? ' on' : '') + '" data-h="bf" data-v="' + f[0] + '">' + f[1] + ' ' + filterBookings(f[0]).length + '</button>').join('') + '</div>';
    const list = filterBookings(ST.bf);
    return chips + (list.length ? list.map(bookingRow).join('') : '<div class="empty-note">Nothing here.</div>');
  }

  /* ---- Rates & availability ---- */
  function viewRates() {
    if (needsSetup()) return setupNudge();
    const start = ST.rs || (ST.rs = today()), DAYS = 14, t = today();
    const days = []; for (let i = 0; i < DAYS; i++) days.push(addDays(start, i));
    const th = days.map(d => '<th class="' + (d === t ? 'today' : '') + '">' + parse(d).toLocaleDateString('en-IN', { weekday: 'short' }) + '<br>' + parse(d).getDate() + '</th>').join('');
    const blocks = DB.types.map(ty => {
      const total = DB.rooms.filter(r => r.typeId === ty.id).length;
      const cell = (d, kind) => {
        const c = calOf(ty.id, d), left = roomsLeft(ty.id, d), pct = offerPct(d);
        let cls = 'rc', txt = '';
        if (kind === 'av') { cls += c.stop ? ' stop' : (left === 0 ? ' zero' : ''); txt = c.stop ? 'Closed' : left; }
        else if (kind === 'rate') { cls += (c.rate != null ? ' ov' : '') + (pct ? ' off' : ''); txt = '₹' + dayRate(ty.id, d).toLocaleString('en-IN'); }
        else { txt = c.min ? c.min + 'n' : '–'; if (c.limit != null && kind === 'min') txt += ''; }
        return '<td class="' + cls + '" data-h="rateCell" data-type="' + ty.id + '" data-date="' + d + '">' + txt + '</td>';
      };
      const row = (label, kind) => '<tr><td>' + label + '</td>' + days.map(d => cell(d, kind)).join('') + '</tr>';
      return '<div class="ht-sec">' + esc(ty.name) + ' · ' + total + ' room' + (total === 1 ? '' : 's') + '</div><div class="ht-tl"><table><thead><tr><th>' + esc(ty.name) + '</th>' + th + '</tr></thead><tbody>' + row('Available', 'av') + row('Rate', 'rate') + row('Min stay', 'min') + '</tbody></table></div>';
    }).join('');
    const promos = DB.promos.map(p => '<div class="ht-pick"><span style="flex:1"><b>' + esc(p.name) + ' · ' + num(p.pct) + '% off</b><small>' + fmtD(p.from) + ' – ' + fmtD(p.to) + (p.on ? '' : ' · paused') + '</small></span><button class="btn btn-ghost btn-sm" data-h="togglePromo" data-id="' + p.id + '">' + (p.on ? 'Pause' : 'Resume') + '</button><button class="btn btn-ghost btn-sm ht-danger" data-h="delPromo" data-id="' + p.id + '">Delete</button></div>').join('');
    return '<div class="ht-nav"><button class="btn btn-primary" data-h="bulk">Bulk update</button><button class="btn btn-ghost" data-h="tlMoveR" data-v="-7">‹</button><button class="btn btn-ghost" data-h="tlMoveR" data-v="0">Today</button><button class="btn btn-ghost" data-h="tlMoveR" data-v="7">›</button><span class="spacer"></span></div>' +
      '<p class="ht-help">Tap any day to change its rate, rooms for sale, minimum stay, or close it. <b>Bulk update</b> changes many days and room types at once. Closed days and minimum stays apply to website &amp; booking-site reservations — the front desk can still book.</p>' + blocks +
      '<div class="ht-card" style="margin-top:16px"><h3>Offers</h3>' + (promos || '<p class="ht-help">Run a discount for a date range — it is applied to the rates above automatically.</p>') + '<div class="ht-actions"><button class="btn btn-ghost" data-h="addPromo">+ New offer</button></div></div>';
  }
  function rateCellForm(typeId, d) {
    const ty = typeById(typeId), c = calOf(typeId, d);
    openModal(head(esc(ty.name), fmtDY(d)) +
      '<div class="ht-2"><div><label>Rate / night (₹, no GST)</label><input id="ht-rc-rate" type="number" min="0" step="any" value="' + (c.rate != null ? c.rate : '') + '" placeholder="' + num(ty.rate) + ' (standard)"></div><div><label>Rooms for sale</label><input id="ht-rc-limit" type="number" min="0" value="' + (c.limit != null ? c.limit : '') + '" placeholder="all"></div></div>' +
      '<div class="ht-2"><div><label>Minimum stay (nights)</label><input id="ht-rc-min" type="number" min="0" value="' + (c.min || '') + '" placeholder="none"></div><div><label>Sale status</label><select id="ht-rc-stop">' + opts([['0', 'Open'], ['1', 'Closed (stop-sell)']], c.stop ? '1' : '0') + '</select></div></div>' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="close">Cancel</button><button class="btn btn-ghost" data-h="rcReset" data-type="' + typeId + '" data-date="' + d + '">Reset day</button><button class="btn btn-primary" data-h="rcSave" data-type="' + typeId + '" data-date="' + d + '">Save</button></div>');
  }
  function rcSave(typeId, d) {
    const r = val('ht-rc-rate'), l = val('ht-rc-limit'), m = val('ht-rc-min');
    if ((r !== '' && num(r) < 0) || (l !== '' && num(l) < 0) || (m !== '' && num(m) < 0)) return err('Numbers can’t be negative.');
    calSet(typeId, d, { rate: r === '' ? null : num(r), limit: l === '' ? null : num(l), min: m === '' || num(m) <= 1 ? null : num(m), stop: val('ht-rc-stop') === '1' });
    dbSave(); closeModal(); render();
  }
  function bulkForm() {
    const t = today();
    openModal(head('Bulk update', 'Change many days and room types at once. Leave a box empty to keep it as it is.') +
      '<label>Room types</label>' + DB.types.map(ty => '<label class="ht-pick"><input type="checkbox" class="ht-bu-type" value="' + ty.id + '" checked><span><b>' + esc(ty.name) + '</b></span></label>').join('') +
      '<div class="ht-2" style="margin-top:10px"><div><label>From</label><input id="ht-bu-from" type="date" value="' + t + '"></div><div><label>To</label><input id="ht-bu-to" type="date" value="' + addDays(t, 30) + '"></div></div>' +
      '<label>On these days</label><div class="ht-chips" id="ht-bu-days">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => '<label class="ht-chip on" style="display:inline-block"><input type="checkbox" class="ht-bu-dow" value="' + ((i + 1) % 7) + '" checked style="display:none">' + n + '</label>').join('') + '</div>' +
      '<div class="ht-2"><div><label>Rate / night (₹)</label><input id="ht-bu-rate" type="number" min="0" step="any"></div><div><label>Rooms for sale</label><input id="ht-bu-limit" type="number" min="0"></div></div>' +
      '<div class="ht-2"><div><label>Minimum stay</label><input id="ht-bu-min" type="number" min="0" placeholder="1 = none"></div><div><label>Sale status</label><select id="ht-bu-stop">' + opts([['', 'No change'], ['1', 'Close (stop-sell)'], ['0', 'Open']]) + '</select></div></div>' +
      '<label class="ht-pick"><input type="checkbox" id="ht-bu-reset"><span>Reset these days to standard instead<small>Clears custom rate, limit, minimum stay and closures</small></span></label>' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="close">Cancel</button><button class="btn btn-primary" data-h="bulkApply">Apply</button></div>');
  }
  function bulkApply() {
    const types = Array.prototype.map.call(modal.querySelectorAll('.ht-bu-type:checked'), x => x.value);
    const dows = Array.prototype.map.call(modal.querySelectorAll('.ht-bu-dow:checked'), x => Number(x.value));
    const from = val('ht-bu-from'), to = val('ht-bu-to');
    if (!types.length) return err('Pick at least one room type.');
    if (!from || !to || to < from) return err('Pick a valid date range.');
    if (nightsBetween(from, to) > 400) return err('Pick a range of up to 400 days.');
    const reset = $('#ht-bu-reset', modal).checked, r = val('ht-bu-rate'), l = val('ht-bu-limit'), m = val('ht-bu-min'), st = val('ht-bu-stop');
    if (!reset && r === '' && l === '' && m === '' && st === '') return err('Nothing to change — fill in at least one box.');
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (dows.indexOf(parse(d).getDay()) < 0) continue;
      types.forEach(tid => {
        if (reset) { delete DB.cal[calKey(tid, d)]; return; }
        const p = {};
        if (r !== '') p.rate = num(r); if (l !== '') p.limit = num(l); if (m !== '') p.min = num(m) <= 1 ? null : num(m); if (st !== '') p.stop = st === '1';
        calSet(tid, d, p);
      });
      n++;
    }
    dbSave(); closeModal(); render(); toast(n + ' day' + (n === 1 ? '' : 's') + ' updated');
  }
  function promoForm() {
    openModal(head('New offer', 'A percentage off your nightly rates between two dates.') +
      '<label>Name</label><input id="ht-o-name" placeholder="Diwali offer">' +
      '<div class="ht-2"><div><label>Discount %</label><input id="ht-o-pct" type="number" min="1" max="90" step="any"></div><span></span></div>' +
      '<div class="ht-2"><div><label>From</label><input id="ht-o-from" type="date" value="' + today() + '"></div><div><label>To</label><input id="ht-o-to" type="date" value="' + addDays(today(), 14) + '"></div></div>' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="close">Cancel</button><button class="btn btn-primary" data-h="savePromo">Create offer</button></div>');
  }
  function savePromo() {
    const name = val('ht-o-name'), pct = num(val('ht-o-pct')), from = val('ht-o-from'), to = val('ht-o-to');
    if (!name) return err('Name the offer.');
    if (!(pct >= 1 && pct <= 90)) return err('Discount must be between 1% and 90%.');
    if (!from || !to || to < from) return err('Pick a valid date range.');
    DB.promos.push({ id: uid(), name: name, pct: pct, from: from, to: to, on: true }); dbSave(); closeModal(); render();
  }
  function planForm(id) {
    const p = id ? DB.plans.find(x => x.id === id) : { name: '', addon: 0 };
    openModal(head(id ? 'Edit meal plan' : 'New meal plan', 'Added to the nightly rate when a guest picks it.') +
      '<label>Name</label><input id="ht-pl-name" value="' + esc(p.name) + '" placeholder="With breakfast">' +
      '<label>Extra per night (₹)</label><input id="ht-pl-add" type="number" min="0" step="any" value="' + num(p.addon) + '">' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="close">Cancel</button>' + (id && DB.plans.length > 1 ? '<button class="btn btn-ghost ht-danger" data-h="delPlan" data-id="' + id + '">Delete</button>' : '') + '<button class="btn btn-primary" data-h="savePlan" data-id="' + (id || '') + '">Save</button></div>');
  }
  function savePlan(id) {
    const name = val('ht-pl-name'); if (!name) return err('Give the plan a name.');
    const data = { name: name, addon: Math.max(0, num(val('ht-pl-add'))) };
    if (id) Object.assign(DB.plans.find(x => x.id === id), data); else DB.plans.push(Object.assign({ id: uid() }, data));
    dbSave(); closeModal(); render();
  }

  /* ---- Billing ---- */
  function viewBilling() {
    const t = today();
    const inh = DB.bookings.filter(b => b.status === 'in').sort((a, b) => (a.checkOut < b.checkOut ? -1 : 1));
    const invs = DB.bookings.filter(b => b.status === 'out' && b.invoice).sort((a, b) => (b.checkedOutAt || '') < (a.checkedOutAt || '') ? -1 : 1).slice(0, 40);
    let collected = 0;
    DB.bookings.forEach(b => (b.payments || []).forEach(p => { if (dayOf(p.at) === t) collected += num(p.amount); }));
    const open = inh.reduce((s, b) => s + Math.max(0, calc(b).balance), 0);
    const stat = (n, l) => '<div class="ht-stat" style="grid-column:span 2"><b>' + money(n) + '</b><span>' + l + '</span></div>';
    return '<div class="ht-stats">' + stat(collected, 'Collected today') + stat(open, 'Due from in-house guests') + '</div>' + reportCard() + incomeCard() +
      '<div class="ht-sec">In-house folios</div>' +
      (inh.length ? inh.map(b => { const c = calc(b); return '<button type="button" class="ht-row" data-h="folio" data-id="' + b.id + '"><span class="ht-row-top"><b>Room ' + esc(roomNo(b)) + ' · ' + esc(b.guest.name) + '</b><b>' + money(c.balance) + ' due</b></span><small>Bill ' + money(c.total) + ' · paid ' + money(c.paid) + ' · out ' + fmtD(b.checkOut) + (b.checkOut <= t ? ' · <span class="ht-danger">leaving today</span>' : '') + '</small></button>'; }).join('') : '<div class="empty-note">No guests checked in.</div>') +
      '<div class="ht-sec">Recent invoices</div>' +
      (invs.length ? invs.map(b => '<button type="button" class="ht-row" data-h="folio" data-id="' + b.id + '"><span class="ht-row-top"><b>' + esc(b.invoice.no) + ' · ' + esc(b.guest.name) + '</b><b>' + money(b.invoice.calc.total) + '</b></span><small>Room ' + esc(b.invoice.roomNo) + ' · ' + fmtDY(b.checkIn) + ' → ' + fmtDY(b.checkOut) + '</small></button>').join('') : '<div class="empty-note">No invoices yet.</div>');
  }

  function reportCard() {
    const n = ST.rep, t = today(), total = DB.rooms.length;
    if (!total) return '';
    let nights = 0, rev = 0; const bySrc = {};
    for (let i = 0; i < n; i++) {
      const d = addDays(t, -i);
      DB.bookings.forEach(b => { if ((b.status === 'in' || b.status === 'out') && b.checkIn <= d && b.checkOut > d) { nights++; rev += num(b.rate); bySrc[b.source] = (bySrc[b.source] || 0) + 1; } });
    }
    let fut = 0; for (let i = 0; i < 7; i++) { const d = addDays(t, i); fut += DB.rooms.filter(r => clashes(r.id, d, addDays(d, 1)).length > 0).length; }
    const pct = x => Math.round(x * 100) + '%';
    const stat = (v, l) => '<div class="ht-stat"><b>' + v + '</b><span>' + l + '</span></div>';
    const srcName = { 'walk-in': 'Walk-in', phone: 'Phone', website: 'Website', ota: 'Booking sites', other: 'Other' };
    return '<div class="ht-sec">Performance</div><div class="ht-chips"><button class="ht-chip' + (n === 7 ? ' on' : '') + '" data-h="rep" data-v="7">Last 7 days</button><button class="ht-chip' + (n === 30 ? ' on' : '') + '" data-h="rep" data-v="30">Last 30 days</button></div>' +
      '<div class="ht-stats">' + stat(pct(nights / (total * n)), 'Occupancy') + stat(money(nights ? rev / nights : 0), 'Avg. rate') + stat(money(rev / n / total), 'Per room / day') + stat(nights, 'Room nights') + '</div>' +
      '<p class="ht-help">Room revenue ' + money(rev) + ' (before GST) · next 7 days booked: ' + pct(fut / (total * 7)) + (Object.keys(bySrc).length ? ' · ' + Object.keys(bySrc).map(k => srcName[k] || k).map((nm, i) => nm + ' ' + bySrc[Object.keys(bySrc)[i]]).join(', ') + ' nights' : '') + '</p>' +
      '<div class="ht-actions" style="margin:0 0 4px"><button class="btn btn-ghost" data-h="csv">Download bookings report (CSV)</button></div>';
  }

  /* Daily income: rooms vs dining, plus what was actually collected. Room income = nightly tariff of every night a guest stayed
     (before GST) + extras on the day they were added; dining = restaurant orders posted to room bills + paid orders not posted. */
  function incomeRows() {
    const t = today(), n = ST.inc === 'm' ? Number(t.slice(8)) : Number(ST.inc) || 7, rows = {};
    const day = d => rows[d] || (rows[d] = { d: d, room: 0, dine: 0, coll: 0 });
    for (let i = 0; i < n; i++) day(addDays(t, -i));
    DB.bookings.forEach(b => {
      if (b.status === 'in' || b.status === 'out') for (let d = b.checkIn; d < b.checkOut; d = addDays(d, 1)) if (rows[d]) rows[d].room += num(b.rate);
      (b.charges || []).forEach(c => { const d = dayOf(c.at); if (!rows[d]) return; if (c.kind === 'food') rows[d].dine += num(c.amount); else rows[d].room += num(c.amount); });
      (b.payments || []).forEach(p => { const d = dayOf(p.at); if (rows[d]) rows[d].coll += num(p.amount); });
    });
    allOrders().forEach(o => { if (o.status !== 'paid' || DB.posted[o.id] || !o.created_at) return; const d = dayOf(o.created_at); if (rows[d]) rows[d].dine += num(o.total_amount); });
    return Object.keys(rows).sort().reverse().map(k => rows[k]);
  }
  function incomeCard() {
    if (!DB.rooms.length && !DB.bookings.length) return '';
    const list = incomeRows(), sum = k => list.reduce((s, r) => s + r[k], 0);
    const chip = (v, l) => '<button class="ht-chip' + (String(ST.inc) === String(v) ? ' on' : '') + '" data-h="inc" data-v="' + v + '">' + l + '</button>';
    const row = (a, b, c, d, e, bold) => '<div style="display:grid;grid-template-columns:1.1fr 1fr 1fr 1fr 1fr;gap:6px;padding:8px 2px;border-top:1px solid var(--border,#e5e0d4);font-size:12.5px;font-variant-numeric:tabular-nums;' + (bold ? 'font-weight:700' : '') + '"><span>' + a + '</span><span style="text-align:right">' + b + '</span><span style="text-align:right">' + c + '</span><span style="text-align:right">' + d + '</span><span style="text-align:right">' + e + '</span></div>';
    const m = v => v ? money(v) : '–';
    return '<div class="ht-sec">Daily income</div><div class="ht-chips">' + chip(7, 'Last 7 days') + chip(30, 'Last 30 days') + chip('m', 'This month') + '</div>' +
      '<div class="ht-stats"><div class="ht-stat" style="grid-column:span 2"><b>' + money(sum('room')) + '</b><span>Rooms</span></div><div class="ht-stat" style="grid-column:span 2"><b>' + money(sum('dine')) + '</b><span>Dining</span></div></div>' +
      '<div class="ht-card">' + row('<small>Day</small>', '<small>Rooms</small>', '<small>Dining</small>', '<small>Total</small>', '<small>Collected</small>', true) +
      list.map(r => row(fmtD(r.d), m(r.room), m(r.dine), m(r.room + r.dine), m(r.coll))).join('') +
      row('Total', money(sum('room')), money(sum('dine')), money(sum('room') + sum('dine')), money(sum('coll')), true) + '</div>' +
      '<p class="ht-help">Rooms and room extras are before GST; dining is as billed. “Collected” is money received on guest bills (advances and payments, less refunds).</p>' +
      '<div class="ht-actions" style="margin:0 0 4px"><button class="btn btn-ghost" data-h="csvinc">Download daily income (CSV)</button></div>';
  }
  function exportIncomeCsv() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Date', 'Rooms', 'Dining', 'Total', 'Collected']].concat(incomeRows().map(r => [r.d, r.room, r.dine, r.room + r.dine, r.coll]));
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cheri-hotel-daily-income-' + today() + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportCsv() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Booking', 'Guest', 'Phone', 'Room', 'Type', 'Check-in', 'Check-out', 'Nights', 'Status', 'Source', 'Total', 'Paid', 'Balance', 'Invoice']];
    DB.bookings.slice().sort((a, b) => a.checkIn < b.checkIn ? -1 : 1).forEach(b => {
      const c = b.status === 'out' && b.invoice ? b.invoice.calc : calc(b);
      rows.push([b.no, b.guest.name, b.guest.phone, roomNo(b), typeName(b), b.checkIn, b.checkOut, c.nights, b.status, b.source, c.total, c.paid, c.balance, b.invoice ? b.invoice.no : '']);
    });
    const blob = new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cheri-hotel-bookings-' + today() + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---- Setup ---- */
  function viewDining() {
    if (!LK.linked) return '<div class="ht-card ht-m"><h3>Link your restaurant</h3><p class="ht-help">Link your restaurant or café account with two keys. Room QRs then show its menu, guests order from their room, and the orders appear here to add to their room bill.</p><button class="btn btn-primary" data-h="openLink">Link restaurant</button></div>';
    if (LK.menu === null) { LK.menu = []; apiGet('/link/menu').then(r => { LK.menu = (r.items || []).filter(i => i.menu_for !== 'dine'); if (ST.tab === 'dining') render(); }).catch(() => { LK.menu = null; }); }
    const stCls = { placed: 'New', preparing: 'Preparing', served: 'Served' };
    const rows = LK.orders.length ? LK.orders.map(o => '<div class="ht-row" style="cursor:default"><span class="ht-row-top"><b>Room ' + esc(o.room_no || '?') + '</b><b>' + money(o.total_amount) + '</b></span><small>' + esc((o.items || []).map(i => num(i.quantity) + '× ' + i.name).join(', ')) + ' · ' + esc(stCls[o.status] || o.status) + '</small></div>').join('')
      : '<p class="ht-help">No open room orders. When a guest orders from their room QR it shows up here, live.</p>';
    const by = {}; (LK.menu || []).forEach(i => { (by[i.category] = by[i.category] || []).push(i); });
    const menu = Object.keys(by).map(c => '<div class="ht-sec">' + esc(c) + '</div>' + by[c].map(i => '<div class="ht-row" style="cursor:default"><span class="ht-row-top"><b' + (i.available ? '' : ' style="opacity:.5"') + '>' + esc(i.name) + '</b><b>' + money(i.price) + '</b></span>' + (i.available ? '' : '<small>Not available right now</small>') + '</div>').join('')).join('');
    return '<div class="ht-card ht-m"><h3>' + esc(LK.restaurant) + '</h3><p class="ht-help">Linked restaurant. Room orders go to its kitchen; its staff see them as “Hotel · Rm …”. Menu changes are made in the restaurant account.</p><button class="btn btn-ghost btn-sm" data-h="openLink">Manage link</button></div>' +
      '<div class="ht-sec">Open room orders</div>' + rows + '<div class="ht-sec">Restaurant menu (view only)</div>' + (menu || '<p class="ht-help">Loading the menu…</p>');
  }
  /* Card / UPI / net-banking through the hotel's OWN Razorpay account. The money goes straight to the hotel; the secret key is kept encrypted on the server and never shown again. */
  const RZ = { loaded: false, connected: false, keyId: '', mode: '', busy: false };
  function loadRz() {
    if (RZ.loaded || typeof apiGet !== 'function' || g_role() !== 'owner') return; RZ.loaded = true;
    apiGet('/hotel/pay-keys').then(r => { RZ.connected = !!r.connected; RZ.keyId = r.key_id || ''; RZ.mode = r.mode || ''; if (ST.tab === 'setup' && !modal.classList.contains('show')) render(); }).catch(() => { RZ.loaded = false; });
  }
  function rzCard() {
    if (g_role() !== 'owner') return '';
    loadRz();
    const on = !!((DB.settings.pay || {}).online);
    return '<div class="ht-card ht-m"><h3>Take card &amp; UPI payments (Razorpay)</h3>' +
      '<p class="ht-help">Guests pay their advance on your booking page by UPI, card or net banking, and the money goes <b>straight to your own Razorpay account</b>. The booking is marked “Paid” by itself — nothing to check by hand.</p>' +
      (RZ.connected
        ? '<div class="ht-banner" style="background:#e7f6ec;color:#146c2e"><b>Connected</b> — key ' + esc(RZ.keyId) + ' (' + (RZ.mode === 'live' ? 'live' : 'TEST mode — no real money') + ')</div>' +
          '<label class="ht-pick"><input type="checkbox" id="ht-s-online"' + (on ? ' checked' : '') + ' data-h="rzOnline"><span>Offer “Pay now” on my booking page<small>' + (num((DB.settings.pay || {}).advancePct) > 0 ? 'Asks for the advance % set above.' : 'Advance is 0%, so guests pay the whole stay. Set an advance % above to ask for less.') + '</small></span></label>' +
          '<div class="ht-actions"><button class="btn btn-ghost btn-sm" data-h="rzTest">Test the keys</button><button class="btn btn-ghost btn-sm" data-h="rzOff">Disconnect</button></div>'
        : '<ol class="ht-help" style="padding-left:18px;margin:0 0 10px"><li>Create your Razorpay account at razorpay.com and finish KYC (GST isn’t required — choose “unregistered”).</li><li>In the Razorpay dashboard: <b>Account &amp; Settings → API Keys → Generate Key</b> (use <b>Live</b> mode for real payments).</li><li>Paste the Key ID and Key Secret below.</li></ol>' +
          '<label>Key ID</label><input id="ht-rz-id" placeholder="rzp_live_xxxxxxxxxxxx" autocapitalize="off" autocomplete="off">' +
          '<label>Key Secret</label><input id="ht-rz-sec" type="password" placeholder="Shown once by Razorpay" autocomplete="off">' +
          '<div class="ht-actions"><button class="btn btn-primary" data-h="rzSave">Save &amp; test</button></div>') +
      '</div>';
  }
  function rzAct(a, t) {
    if (typeof apiSend !== 'function') return;
    if (a === 'rzSave') {
      const kid = val('ht-rz-id').trim(), sec = val('ht-rz-sec').trim(); if (!kid || !sec) return toast('Paste both the Key ID and the Key Secret');
      t.disabled = true; t.textContent = 'Checking with Razorpay…';
      apiSend('PUT', '/hotel/pay-keys', { key_id: kid, key_secret: sec }).then(r => { RZ.connected = true; RZ.keyId = r.key_id; RZ.mode = r.mode; DB.settings.pay = Object.assign({}, DB.settings.pay || {}, { online: true }); dbSave(); render(); toast('Connected — guests can now pay online'); })
        .catch(e => { t.disabled = false; t.textContent = 'Save & test'; toast((e && e.message) || 'Couldn’t save the keys'); });
    } else if (a === 'rzTest') {
      t.disabled = true; apiSend('POST', '/hotel/pay-keys/test').then(() => { t.disabled = false; toast('Keys work ✓'); }).catch(e => { t.disabled = false; toast((e && e.message) || 'Razorpay didn’t accept the keys'); });
    } else if (a === 'rzOff') {
      if (!confirm('Disconnect Razorpay? Guests will only see UPI-proof and pay-at-hotel.')) return;
      apiSend('DELETE', '/hotel/pay-keys').then(() => { RZ.connected = false; DB.settings.pay = Object.assign({}, DB.settings.pay || {}, { online: false }); dbSave(); render(); toast('Disconnected'); }).catch(e => toast((e && e.message) || 'Couldn’t disconnect'));
    }
  }
  function viewSetup() {
    const S = DB.settings, sl = S.slab;
    const types = DB.types.map(t => '<button type="button" class="ht-row" data-h="editType" data-id="' + t.id + '"><span class="ht-row-top"><b>' + esc(t.name) + '</b><b>' + money(t.rate) + '/night</b></span><small>Sleeps ' + num(t.capacity || 2) + ' · ' + DB.rooms.filter(r => r.typeId === t.id).length + ' room(s)' + (t.desc ? ' · ' + esc(t.desc) : '') + '</small></button>').join('');
    const rooms = DB.rooms.slice().sort(sortRooms).map(r => '<button type="button" class="ht-chip" data-h="room" data-id="' + r.id + '">' + esc(r.no) + '</button>').join(' ');
    const syncMsg = sync.state === 'error' ? '<div class="ht-banner"><b>Not saved to your account yet:</b> ' + esc(sync.msg) + '. Your changes are kept on this device and retried automatically.</div>'
      : '<p class="ht-help" style="margin:0 2px 10px">' + (sync.state === 'saving' ? 'Saving…' : sync.state === 'loading' ? 'Loading your hotel…' : 'Saved to your account — every device sees the same rooms and bookings.') + '</p>';
    return syncMsg +
      '<div class="ht-card"><h3>Room types</h3>' + (types || '<p class="ht-help">None yet — add your first, e.g. “Deluxe”.</p>') + '<div class="ht-actions"><button class="btn btn-primary" data-h="editType">+ Add room type</button></div></div>' +
      '<div class="ht-card"><h3>Banquet halls</h3>' + ((DB.halls || []).map(h => '<button type="button" class="ht-row" data-h="editHall" data-id="' + h.id + '"><span class="ht-row-top"><b>' + esc(h.name) + '</b><b>' + (num(h.price) ? 'from ' + money(h.price) : '') + '</b></span><small>Up to ' + num(h.capacity) + ' guests' + (h.desc ? ' · ' + esc(h.desc) : '') + '</small></button>').join('') || '<p class="ht-help">No halls yet — add one to take banquet bookings and show its free dates on your website.</p>') + '<div class="ht-actions"><button class="btn btn-ghost" data-h="editHall">+ Add hall</button></div></div>' +
      '<div class="ht-card"><h3>Meal plans</h3>' + DB.plans.map(p => '<button type="button" class="ht-row" data-h="editPlan" data-id="' + p.id + '"><span class="ht-row-top"><b>' + esc(p.name) + '</b><b>' + (p.addon ? '+' + money(p.addon) : 'included') + '</b></span></button>').join('') + '<div class="ht-actions"><button class="btn btn-ghost" data-h="editPlan">+ Add meal plan</button></div></div>' +
      '<div class="ht-card"><h3>Rooms (' + DB.rooms.length + ')</h3>' + (rooms || '<p class="ht-help">No rooms yet.</p>') +
      '<div class="ht-actions"><button class="btn btn-primary" data-h="addRooms"' + (DB.types.length ? '' : ' disabled') + '>+ Add rooms</button><button class="btn btn-ghost" data-h="roomQrs"' + (DB.rooms.length ? '' : ' disabled') + '>Create room QRs</button></div>' +
      '<p class="ht-help" style="margin-top:8px">Each room gets its own QR (print it from the Orders tab → tap the room’s card). A guest who scans it sees a big <b>Call Room Service</b> button; the call rings your staff exactly like a table call.</p>' +
      '<p class="ht-help">Room QRs let guests call room service. A hotel account has no menu or kitchen of its own — to let guests order food from their room, link your restaurant account with the two-key link.</p><button class="btn btn-ghost btn-sm" data-h="openLink">' + (LK.linked ? 'Linked with ' + esc(LK.restaurant || 'restaurant') + ' — manage' : 'Link restaurant account') + '</button></div>' +
      '<div class="ht-card ht-m"><h3>Hotel details on invoices</h3>' +
      '<label>Hotel / legal name</label><input id="ht-s-name" value="' + esc(S.legalName) + '" placeholder="' + esc((cafeObj() || {}).name || '') + '">' +
      '<label>GSTIN</label><input id="ht-s-gstin" value="' + esc(S.gstin) + '" placeholder="22AAAAA0000A1Z5">' +
      '<label>Address</label><input id="ht-s-addr" value="' + esc(S.address) + '">' +
      '<label>Phone</label><input id="ht-s-phone" value="' + esc(S.phone) + '">' +
      '<div class="ht-2"><div><label>Invoice prefix</label><input id="ht-s-prefix" value="' + esc(S.invoicePrefix) + '"></div><div><label>Extras GST %</label><input id="ht-s-extra" type="number" min="0" step="any" value="' + num(S.extraTax) + '"></div></div>' +
      '<label>Free cancellation up to (days before check-in)</label><input id="ht-s-cdays" type="number" min="0" value="' + num(S.cancelDays) + '"></div>' +
      '<div class="ht-card ht-m"><h3>Online booking payments</h3><p class="ht-help">Guests who book on your website can pay an advance by UPI and send the reference number or a screenshot. You check it in Bookings, then accept. Leave the UPI ID empty to take no payment online.</p>' +
      '<div class="ht-2"><div><label>UPI ID</label><input id="ht-s-upi" value="' + esc((S.pay || {}).upi || '') + '" placeholder="yourhotel@okicici" autocapitalize="off"></div><div><label>Name on the UPI account</label><input id="ht-s-payee" value="' + esc((S.pay || {}).payee || '') + '"></div></div>' +
      '<div class="ht-2"><div><label>Advance to ask for (% of the stay)</label><input id="ht-s-adv" type="number" min="0" max="100" value="' + num((S.pay || {}).advancePct) + '"></div><div><label>Pay at the hotel</label><select id="ht-s-athotel"><option value="1"' + ((S.pay || {}).atHotel === false ? '' : ' selected') + '>Allowed (no advance needed)</option><option value="0"' + ((S.pay || {}).atHotel === false ? ' selected' : '') + '>Not allowed (advance is a must)</option></select></div></div>' +
      '<div class="ht-actions"><button class="btn btn-primary" data-h="saveSettings">Save details</button></div></div>' +
      '<div class="ht-card ht-m"><h3>Hotel facilities</h3><p class="ht-help">What the whole hotel offers. Guests see these with icons above your rooms on your website. Room-only things (like the bed or AC) go on each room type.</p>' + amPicker('ht-s-am', 'property', S.amenities || []) +
      '<div class="ht-actions"><button class="btn btn-primary" data-h="saveSettings">Save facilities</button></div></div>' +
      rzCard() +
      '<div class="ht-card ht-m"><h3>GST on room rent (by nightly rate, before tax)</h3><p class="ht-help">The standard rule is already filled in: up to ₹1,000 → 0%, ₹1,001 to ₹7,500 → 5%, above ₹7,500 → 18%. Check it with your accountant — rules change. Rates you enter for rooms are <b>without GST</b>; GST is added on the bill.</p>' +
      '<div class="ht-3"><div><label>Up to ₹</label><input id="ht-s-t1" type="number" min="0" value="' + num(sl.t1) + '"></div><div><label>GST %</label><input id="ht-s-r1" type="number" min="0" step="any" value="' + num(sl.r1) + '"></div><span></span>' +
      '<div><label>Up to ₹</label><input id="ht-s-t2" type="number" min="0" value="' + num(sl.t2) + '"></div><div><label>GST %</label><input id="ht-s-r2" type="number" min="0" step="any" value="' + num(sl.r2) + '"></div><span></span>' +
      '<div><label>Above</label><input disabled value="₹' + num(sl.t2) + '"></div><div><label>GST %</label><input id="ht-s-r3" type="number" min="0" step="any" value="' + num(sl.r3) + '"></div></div>' +
      '<div class="ht-actions"><button class="btn btn-ghost" data-h="slabReset">Use the standard rule</button><button class="btn btn-primary" data-h="saveSettings">Save details</button></div></div>' +
      '<div class="ht-card"><h3>Backup</h3><p class="ht-help">Your hotel is saved in your account. You can still download a copy for your own records, or restore one.</p><div class="ht-actions"><button class="btn btn-ghost" data-h="backup">Download backup</button><button class="btn btn-ghost" data-h="restore">Restore from file</button></div><input type="file" id="ht-restore" accept="application/json" hidden></div>';
  }


  /* ---------------------------------------------------------------- banquet */
  const SLOT_L = { morning: 'Morning', evening: 'Evening', full: 'Full day' };
  const slotSet = sl => sl === 'full' ? ['morning', 'evening'] : [sl];
  const bqLive = x => x.status === 'confirmed' || x.status === 'tentative';
  const hallById = id => (DB.halls || []).find(h => h.id === id);
  function bqBusy(hallId, date, exceptId) {
    const set = {};
    (DB.banquet || []).forEach(x => { if (x.hallId === hallId && x.date === date && bqLive(x) && x.id !== exceptId) slotSet(x.slot).forEach(s => { set[s] = x; }); });
    return set;
  }
  function viewBanquet() {
    if (!(DB.halls || []).length) return '<div class="ht-card"><h3>Banquet bookings</h3><p class="ht-help">Add your hall first (name, capacity) — then this calendar shows every function, and your website shows guests which dates are free.</p><div class="ht-actions"><button class="btn btn-primary" data-h="editHall">+ Add a hall</button></div></div>';
    const hall = hallById(ST.hall) || DB.halls[0]; ST.hall = hall.id;
    const m0 = ST.bqm || (ST.bqm = today().slice(0, 7)), first = parse(m0 + '-01'), dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7, t = today();
    let cells = '<span class="ht-cal-h">Mon</span><span class="ht-cal-h">Tue</span><span class="ht-cal-h">Wed</span><span class="ht-cal-h">Thu</span><span class="ht-cal-h">Fri</span><span class="ht-cal-h">Sat</span><span class="ht-cal-h">Sun</span>';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= dim; d++) {
      const iso = m0 + '-' + pad(d, 2), b = bqBusy(hall.id, iso), n = Object.keys(b).length;
      cells += '<button type="button" class="ht-cal-d' + (iso === t ? ' today' : '') + (iso < t ? ' past' : '') + '" data-h="bqDay" data-date="' + iso + '"><b>' + d + '</b><i class="' + (b.morning ? 'on' : '') + '"></i><i class="' + (b.evening ? 'on' : '') + '"></i></button>';
    }
    const up = (DB.banquet || []).filter(x => x.hallId === hall.id && bqLive(x) && x.date >= t).sort((a, c) => a.date < c.date ? -1 : 1).slice(0, 30);
    const list = up.map(x => '<button type="button" class="ht-row" data-h="bqEdit" data-id="' + x.id + '"><span class="ht-row-top"><b>' + esc(x.guest.name) + (x.event ? ' · ' + esc(x.event) : '') + '</b><b>' + fmtD(x.date) + ' · ' + SLOT_L[x.slot] + '</b></span><small>' + (x.status === 'tentative' ? 'Tentative · ' : '') + num(x.guests) + ' guests' + (num(x.total) ? ' · ' + money(x.total) + (num(x.advance) ? ' (advance ' + money(x.advance) + ')' : '') : '') + '</small></button>').join('');
    const chips = DB.halls.length > 1 ? '<div class="ht-chips">' + DB.halls.map(h => '<button class="ht-chip' + (h.id === hall.id ? ' on' : '') + '" data-h="hallPick" data-id="' + h.id + '">' + esc(h.name) + '</button>').join('') + '</div>' : '';
    return chips + '<div class="ht-nav"><button class="btn btn-ghost btn-sm" data-h="bqMove" data-v="-1">‹</button><b style="font-family:Fraunces,serif">' + first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) + '</b><button class="btn btn-ghost btn-sm" data-h="bqMove" data-v="1">›</button><span class="spacer"></span><button class="btn btn-primary" data-h="bqNew">+ New function</button></div>' +
      '<div class="ht-cal">' + cells + '</div><p class="ht-help">Left bar = morning, right bar = evening. Filled means taken. Tap a date to book or see who has it.</p>' +
      '<div class="ht-card"><h3>Upcoming at ' + esc(hall.name) + '</h3>' + (list || '<p class="ht-help">Nothing booked yet.</p>') + '</div>';
  }
  function bqDay(date) {
    const hall = hallById(ST.hall); if (!hall) return;
    const busy = bqBusy(hall.id, date);
    const rows = ['morning', 'evening', 'full'].map(sl => {
      const taken = slotSet(sl).map(x => busy[x]).filter(Boolean)[0];
      const own = sl !== 'full' ? busy[sl] : null;
      if (own && (own.slot === sl)) return '<button type="button" class="ht-row" data-h="bqEdit" data-id="' + own.id + '"><span class="ht-row-top"><b>' + SLOT_L[sl] + '</b><b>' + esc(own.guest.name) + '</b></span><small>' + esc(own.event || 'Function') + ' · ' + num(own.guests) + ' guests' + (own.status === 'tentative' ? ' · tentative' : '') + '</small></button>';
      if (taken) return '<div class="ht-row ht-dim"><span class="ht-row-top"><b>' + SLOT_L[sl] + '</b><b>Not free</b></span><small>' + (sl === 'full' ? 'Part of this day is already booked' : 'Taken by a full-day booking') + '</small></div>';
      return '<button type="button" class="ht-row" data-h="bqNew" data-date="' + date + '" data-slot="' + sl + '"><span class="ht-row-top"><b>' + SLOT_L[sl] + '</b><b style="color:var(--teal,#2f6b4f)">Free · book</b></span></button>';
    }).join('');
    openModal(head(esc(hall.name), fmtDY(date)) + rows + '<div class="ht-actions">' + closeBtn + '</div>');
  }
  function bqForm(id, pre) {
    pre = pre || {};
    const x = id ? (DB.banquet || []).find(b => b.id === id) : null;
    const hall = hallById(x ? x.hallId : (pre.hallId || ST.hall)) || DB.halls[0];
    const f = x || { guest: { name: pre.name || '', phone: pre.phone || '' }, date: pre.date || today(), slot: pre.slot || 'evening', guests: pre.guests || '', event: pre.event || '', total: '', advance: '', status: 'confirmed', notes: pre.notes || '' };
    ST.bqId = id || null; ST.enqId = pre.enqId || null; ST.bqHall = hall.id;
    openModal(head(id ? 'Edit function' : 'New function', esc(hall.name)) +
      '<label>Host name</label><input id="ht-q-name" value="' + esc(f.guest.name) + '" autocomplete="off">' +
      '<div class="ht-2"><div><label>Phone</label><input id="ht-q-phone" type="tel" value="' + esc(f.guest.phone) + '"></div><div><label>Event</label><input id="ht-q-event" value="' + esc(f.event) + '" placeholder="Wedding, birthday…"></div></div>' +
      '<div class="ht-2"><div><label>Date</label><input id="ht-q-date" type="date" value="' + f.date + '"></div><div><label>Slot</label><select id="ht-q-slot">' + opts([['morning', 'Morning'], ['evening', 'Evening'], ['full', 'Full day']], f.slot) + '</select></div></div>' +
      '<div class="ht-2"><div><label>Guests</label><input id="ht-q-guests" type="number" min="1" value="' + esc(f.guests) + '"></div><div><label>Status</label><select id="ht-q-status">' + opts([['confirmed', 'Confirmed'], ['tentative', 'Tentative (holds the date)']], f.status === 'tentative' ? 'tentative' : 'confirmed') + '</select></div></div>' +
      '<div class="ht-2"><div><label>Total charge (₹)</label><input id="ht-q-total" type="number" min="0" step="any" value="' + esc(f.total) + '"></div><div><label>Advance received (₹)</label><input id="ht-q-adv" type="number" min="0" step="any" value="' + esc(f.advance) + '"></div></div>' +
      '<label>Notes</label><input id="ht-q-notes" value="' + esc(f.notes) + '" placeholder="Menu, decoration, timings…">' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="close">Cancel</button>' + (id ? '<button class="btn btn-ghost ht-danger" data-h="cancelBq" data-id="' + id + '">Cancel function</button>' : '') + '<button class="btn btn-primary" data-h="saveBq" data-id="' + (id || '') + '">' + (id ? 'Save' : 'Book it') + '</button></div>');
  }
  function saveBq(id) {
    const name = val('ht-q-name'), phone = val('ht-q-phone'), date = val('ht-q-date'), slot = val('ht-q-slot'), hallId = ST.bqHall;
    if (!name) return err('Enter the host’s name.');
    if (!phone) return err('Enter a phone number.');
    if (!date) return err('Pick a date.');
    const busy = bqBusy(hallId, date, id), clash = slotSet(slot).filter(s => busy[s]);
    if (clash.length) return err('That slot is already taken by ' + busy[clash[0]].guest.name + '.');
    const data = { hallId: hallId, date: date, slot: slot, guest: { name: name, phone: phone }, event: val('ht-q-event'), guests: Math.max(1, num(val('ht-q-guests')) || 1), status: val('ht-q-status') || 'confirmed', total: num(val('ht-q-total')), advance: num(val('ht-q-adv')), notes: val('ht-q-notes') };
    if (id) Object.assign(DB.banquet.find(b => b.id === id), data);
    else {
      DB.seq.banquet = (DB.seq.banquet || 0) + 1;
      DB.banquet.push(Object.assign({ id: uid(), no: 'Q-' + pad(DB.seq.banquet, 4), createdAt: new Date().toISOString() }, data));
      if (ST.enqId) { markEnq(ST.enqId, 'accepted'); ST.enqId = null; }
    }
    ST.hall = hallId; ST.bqm = date.slice(0, 7);
    dbSave(); closeModal(); render(); toast(id ? 'Saved' : 'Function booked');
  }
  function hallForm(id) {
    const h = id ? hallById(id) : { name: '', capacity: '', price: '', desc: '' };
    openModal(head(id ? 'Edit hall' : 'New hall') +
      '<label>Name</label><input id="ht-h-name" value="' + esc(h.name) + '" placeholder="Grand Banquet Hall">' +
      '<div class="ht-2"><div><label>Capacity (guests)</label><input id="ht-h-cap" type="number" min="1" value="' + esc(h.capacity) + '"></div><div><label>Starting price (₹, optional)</label><input id="ht-h-price" type="number" min="0" step="any" value="' + esc(h.price) + '"></div></div>' +
      '<label>Short description</label><input id="ht-h-desc" value="' + esc(h.desc) + '" placeholder="AC · stage · parking for 80 cars">' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="close">Cancel</button>' + (id ? '<button class="btn btn-ghost ht-danger" data-h="delHall" data-id="' + id + '">Delete</button>' : '') + '<button class="btn btn-primary" data-h="saveHall" data-id="' + (id || '') + '">Save</button></div>');
  }
  function saveHall(id) {
    const name = val('ht-h-name'), cap = num(val('ht-h-cap'));
    if (!name) return err('Give the hall a name.');
    if (!(cap > 0)) return err('How many guests can it hold?');
    if (DB.halls.some(h => h.id !== id && h.name.toLowerCase() === name.toLowerCase())) return err('You already have a hall with that name.');
    const data = { name: name, capacity: Math.round(cap), price: num(val('ht-h-price')), desc: val('ht-h-desc') };
    if (id) Object.assign(hallById(id), data); else { const h = Object.assign({ id: uid() }, data); DB.halls.push(h); if (!ST.hall) ST.hall = h.id; }
    dbSave(); closeModal(); render();
  }
  function delHall(id) {
    if ((DB.banquet || []).some(x => x.hallId === id && bqLive(x) && x.date >= today())) return err('This hall has upcoming functions — cancel them first.');
    DB.halls = DB.halls.filter(h => h.id !== id); if (ST.hall === id) ST.hall = null; dbSave(); closeModal(); render();
  }

  /* ---------------------------------------------------------------- website requests */
  function loadEnq() {
    if (typeof apiGet !== 'function') return;
    apiGet('/hotel/enquiries?status=open').then(list => {
      const n = (ST.enq || []).length; ST.enq = Array.isArray(list) ? list : [];
      setBadge(ST.enq.length);
      if (host && host.style.display !== 'none' && ST.tab === 'bookings' && ST.bkMode === 'requests' && !modal.classList.contains('show') && n !== ST.enq.length) render();
    }).catch(() => { if (ST.enq == null) ST.enq = []; });
  }
  function setBadge(n) { const b = document.getElementById('badge-hbk'); if (b) { b.textContent = n > 9 ? '9+' : n; b.style.display = n ? '' : 'none'; } }
  function markEnq(id, status) {
    if (typeof apiSend !== 'function') return;
    apiSend('PATCH', '/hotel/enquiries/' + id, { status: status }).catch(() => {});
    ST.enq = (ST.enq || []).filter(e => e.id !== id); setBadge(ST.enq.length);
  }
  function viewRequests() {
    if (ST.enq == null) { loadEnq(); return '<p class="ht-help">Loading…</p>'; }
    if (!ST.enq.length) return '<div class="ht-card"><h3>Website requests</h3><p class="ht-help">Nothing waiting. When a guest asks for a room or a hall on your website, it appears here — call them, then tap Accept to turn it into a booking.</p></div>';
    return ST.enq.map(e => {
      const d = e.details || {}, wa = String(e.phone).replace(/\D/g, '');
      const what = e.kind === 'room'
        ? esc(d.typeName) + ' · ' + fmtD(d.ci) + ' → ' + fmtD(d.co) + ' (' + d.nights + ' night' + (d.nights > 1 ? 's' : '') + ') · ' + num(d.adults) + ' adult' + (num(d.adults) > 1 ? 's' : '') + (num(d.children) ? ', ' + d.children + ' child' : '') + (num(d.rooms) > 1 ? ' · ' + d.rooms + ' rooms' : '') + ' · ' + money(d.rate) + '/night'
        : esc(d.hallName) + ' · ' + fmtD(d.date) + ' · ' + SLOT_L[d.slot] + ' · ' + num(d.guests) + ' guests' + (d.event ? ' · ' + esc(d.event) : '');
      return '<div class="ht-card"><h3>' + esc(e.name) + ' <small style="font-weight:400;color:var(--text-secondary)">' + esc(e.ref) + '</small></h3><p style="margin:0 0 6px">' + what + '</p>' +
        (d.total ? '<p style="margin:0 0 6px">Stay total <b>' + money(d.total) + '</b> incl. ' + num(d.gstPct) + '% GST</p>' : '') +
        (d.pay && d.pay.mode === 'upi' ? '<div class="ht-banner">Paid <b>' + money(d.pay.due) + '</b> by UPI — not checked yet.' + (d.pay.utr ? '<br>Reference <b>' + esc(d.pay.utr) + '</b>' : '') + (d.pay.proofId ? ' <button type="button" class="btn btn-ghost btn-sm" data-h="viewDoc" data-id="' + d.pay.proofId + '">View screenshot</button>' : '') + '<br><small>Open your UPI app and look for this payment before you accept.</small></div>' : (d.pay && d.pay.mode === 'online' ? (d.pay.status === 'paid' ? '<div class="ht-banner" style="background:#e7f6ec;color:#146c2e">Paid <b>' + money(d.pay.due) + '</b> online — confirmed by Razorpay.<br><small>Payment ' + esc(d.pay.paymentId || '') + '</small></div>' : '<div class="ht-banner">Started an online payment of <b>' + money(d.pay.due) + '</b>, but it hasn’t gone through. Don’t accept until it shows paid — or call the guest.</div>') : d.pay && d.pay.mode === 'hotel' ? '<p class="ht-help" style="margin:0 0 6px">Will pay at the hotel.</p>' : '')) +
        (d.requests && d.requests.length ? '<p class="ht-help" style="margin:0 0 6px">Asked for: ' + esc(d.requests.join(', ')) + '</p>' : '') +
        (e.note ? '<p class="ht-help" style="margin:0 0 6px">“' + esc(e.note) + '”</p>' : '') +
        '<div class="ht-actions"><a class="btn btn-ghost" href="tel:' + esc(e.phone) + '">Call ' + esc(e.phone) + '</a>' + (wa.length >= 8 ? '<a class="btn btn-ghost" target="_blank" rel="noopener" href="https://wa.me/' + wa + '">WhatsApp</a>' : '') +
        '<button class="btn btn-ghost ht-danger" data-h="enqDecline" data-id="' + e.id + '">Decline</button><button class="btn btn-primary" data-h="enqAccept" data-id="' + e.id + '">Accept</button></div></div>';
    }).join('');
  }
  function enqAccept(id) {
    const e = (ST.enq || []).find(x => String(x.id) === String(id)); if (!e) return; const d = e.details || {};
    if (e.kind === 'room') {
      if (needsSetup()) return;
      bookingForm(null, { name: e.name, phone: e.phone, email: e.email || '', ci: d.ci, co: d.co, typeId: DB.types.some(t => t.id === d.typeId) ? d.typeId : undefined, adults: d.adults, kids: d.children, src: 'website', adv: d.pay && (d.pay.mode === 'upi' || (d.pay.mode === 'online' && d.pay.status === 'paid')) ? d.pay.due : 0, advm: d.pay && d.pay.mode === 'online' ? 'card' : 'upi', notes: [e.note || '', d.requests && d.requests.length ? 'Asked for: ' + d.requests.join(', ') : '', d.pay && d.pay.utr ? 'UPI ref ' + d.pay.utr : (d.pay && d.pay.paymentId ? 'Razorpay ' + d.pay.paymentId : '')].filter(Boolean).join(' · ') + (num(d.rooms) > 1 ? ' (asked for ' + d.rooms + ' rooms — add the others)' : ''), enqId: e.id });
    } else {
      if (!hallById(d.hallId)) return toast('That hall no longer exists');
      bqForm(null, { hallId: d.hallId, name: e.name, phone: e.phone, date: d.date, slot: d.slot, guests: d.guests, event: d.event, notes: e.note || '', enqId: e.id });
    }
  }

  /* ---------------------------------------------------------------- modal */
  function openModal(html) {
    modal.innerHTML = '<div class="modal ht-m">' + html + '</div>';
    modal.classList.add('show');
  }
  function closeModal() { if (modal) { modal.classList.remove('show'); modal.innerHTML = ''; } ST.bookingId = ST.folioId = ST.roomId = null; }
  const err = m => { const e = $('#ht-err', modal); if (e) e.textContent = m || ''; };
  const val = id => { const e = $('#' + id, modal) || $('#' + id, host); return e ? e.value.trim() : ''; };
  const head = (title, sub) => '<h2>' + title + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '');
  const closeBtn = '<button class="btn btn-ghost" data-h="close">Close</button>';

  /* ---- settings ---- */
  function saveSettings() {
    const S = DB.settings;
    S.legalName = val('ht-s-name'); S.gstin = val('ht-s-gstin').toUpperCase(); S.address = val('ht-s-addr'); S.phone = val('ht-s-phone');
    S.invoicePrefix = (val('ht-s-prefix') || 'INV').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'INV';
    S.extraTax = Math.max(0, num(val('ht-s-extra'))); S.cancelDays = Math.max(0, Math.round(num(val('ht-s-cdays'))));
    S.pay = { upi: val('ht-s-upi').replace(/\s/g, ''), payee: val('ht-s-payee'), advancePct: Math.max(0, Math.min(100, Math.round(num(val('ht-s-adv'))))), atHotel: val('ht-s-athotel') !== '0', online: !!(DB.settings.pay || {}).online };
    if (S.pay.upi && S.pay.upi.indexOf('@') < 1) { toast('That UPI ID doesn’t look right (it has an @, like name@bank)'); return; }
    S.slab = { t1: num(val('ht-s-t1')), r1: num(val('ht-s-r1')), t2: Math.max(num(val('ht-s-t1')), num(val('ht-s-t2'))), r2: num(val('ht-s-r2')), r3: num(val('ht-s-r3')) };
    if (document.getElementById('ht-s-am')) { S.amenities = AM() ? AM().clean(amRead('ht-s-am'), 40) : (S.amenities || []); if (ST.amPend) delete ST.amPend['ht-s-am']; }
    dbSave(); render(); toast('Saved');
  }

  /* ---- amenities picker: tap the ones you have, add your own ---- */
  const AM = () => window.Amenities;
  const amChip = (label, on) => '<button type="button" class="ht-chip ht-am-c' + (on ? ' on' : '') + '" data-h="amTog" data-v="' + esc(label) + '">' + (AM() ? AM().svg(label, 15) : '') + '<span>' + esc(label) + '</span></button>';
  function amPicker(id, kind, selected) {
    const A = AM(); if (!A) return '<p class="ht-help">Amenities list is loading — reopen this screen.</p>';
    const groups = kind === 'room' ? A.ROOM : A.PROPERTY, sel = A.clean((ST.amPend && ST.amPend[id]) || selected, 40), known = [];
    const body = groups.map(g => { g[1].forEach(it => known.push(it)); return '<p class="ht-am-g">' + esc(g[0]) + '</p><div class="ht-am-row">' + g[1].map(it => amChip(it, sel.some(x => A.same(x, it)))).join('') + '</div>'; }).join('');
    const own = sel.filter(x => !known.some(k => A.same(k, x)));
    return '<div class="ht-am" id="' + id + '">' + body + '<p class="ht-am-g">Your own</p><div class="ht-am-row ht-am-custom">' + own.map(x => amChip(x, true)).join('') + '</div>' +
      '<div class="ht-am-add"><input id="' + id + '-new" maxlength="40" placeholder="Add your own, e.g. Bonfire on request" autocomplete="off"><button type="button" class="btn btn-ghost btn-sm" data-h="amAdd" data-id="' + id + '">Add</button></div></div>';
  }
  const amRead = id => Array.prototype.map.call(document.querySelectorAll('#' + id + ' .ht-am-c.on'), b => b.dataset.v);
  const amKeep = id => { ST.amPend = ST.amPend || {}; ST.amPend[id] = amRead(id); };
  function amAdd(id) {
    const A = AM(), box = document.getElementById(id), inp = document.getElementById(id + '-new'); if (!A || !box || !inp) return;
    const label = A.clean([inp.value], 1)[0]; if (!label) return;
    const chips = Array.prototype.slice.call(box.querySelectorAll('.ht-am-c')), hit = chips.find(b => A.same(b.dataset.v, label));
    if (hit) hit.classList.add('on');
    else if (amRead(id).length >= 40) { toast('That’s the most amenities one list can hold'); return; }
    else { const row = box.querySelector('.ht-am-custom'); if (!row) return; row.insertAdjacentHTML('beforeend', amChip(label, true)); }
    inp.value = ''; inp.focus(); amKeep(id);
  }

  /* ---- room types ---- */
  function typeForm(id) {
    const t = id ? typeById(id) : { name: '', rate: '', capacity: 2, desc: '' };
    openModal(head(id ? 'Edit room type' : 'New room type') +
      '<label>Name</label><input id="ht-t-name" value="' + esc(t.name) + '" placeholder="Deluxe">' +
      '<div class="ht-2"><div><label>Rate per night (₹, without GST)</label><input id="ht-t-rate" type="number" min="0" step="any" value="' + esc(t.rate) + '"></div><div><label>Sleeps</label><input id="ht-t-cap" type="number" min="1" value="' + esc(t.capacity) + '"></div></div>' +
      '<label>Short description (optional)</label><input id="ht-t-desc" value="' + esc(t.desc) + '" placeholder="Balcony, city view">' +
      '<div class="ht-2"><div><label>Bed</label><input id="ht-t-bed" value="' + esc(t.bed || '') + '" placeholder="1 queen bed"></div><div><label>Size (m²)</label><input id="ht-t-size" type="number" min="0" value="' + esc(t.size || '') + '"></div></div>' +
      '<label>Amenities in this room</label>' + amPicker('ht-t-am', 'room', Array.isArray(t.amenities) ? t.amenities : String(t.amenities || '').split(',')) +
      '<p class="ht-help">Tap to switch on. These show with a small icon on your website next to the room photo.</p>' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="close">Cancel</button>' +
      (id ? '<button class="btn btn-ghost ht-danger" data-h="delType" data-id="' + id + '">Delete</button>' : '') +
      '<button class="btn btn-primary" data-h="saveType" data-id="' + (id || '') + '">Save</button></div>');
  }
  function saveType(id) {
    const name = val('ht-t-name'), rate = num(val('ht-t-rate'));
    if (!name) return err('Give the room type a name.');
    if (!(rate >= 0) || val('ht-t-rate') === '') return err('Enter the nightly rate.');
    if (DB.types.some(t => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) return err('You already have a type with that name.');
    const data = { name: name, rate: rate, capacity: Math.max(1, num(val('ht-t-cap')) || 2), desc: val('ht-t-desc'), bed: val('ht-t-bed'), size: val('ht-t-size'), amenities: AM() ? AM().clean(amRead('ht-t-am'), 30) : [] };
    if (id) Object.assign(typeById(id), data); else DB.types.push(Object.assign({ id: uid() }, data));
    dbSave(); closeModal(); render();
  }
  function delType(id) {
    if (DB.rooms.some(r => r.typeId === id)) return err('Move or delete the rooms of this type first.');
    DB.types = DB.types.filter(t => t.id !== id); dbSave(); closeModal(); render();
  }

  /* ---- rooms ---- */
  function parseRoomList(txt) {
    const out = [];
    String(txt).split(/[,\n;]+/).forEach(part => {
      const p = part.trim(); if (!p) return;
      const m = p.match(/^(\d+)\s*[-–to]+\s*(\d+)$/i);
      if (m && Number(m[2]) >= Number(m[1]) && Number(m[2]) - Number(m[1]) < 300) { for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(String(n)); }
      else out.push(p);
    });
    return out;
  }
  function addRoomsForm() {
    openModal(head('Add rooms', 'Add many at once — e.g. <b>101-110, 201-208</b>.') +
      '<label>Room numbers</label><input id="ht-r-list" placeholder="101-110, 201-208">' +
      '<div class="ht-2"><div><label>Room type</label><select id="ht-r-type">' + opts(DB.types.map(t => [t.id, t.name + ' · ' + money(t.rate)])) + '</select></div>' +
      '<div><label>Floor (optional)</label><input id="ht-r-floor" placeholder="auto from number"></div></div>' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="close">Cancel</button><button class="btn btn-primary" data-h="saveRooms">Add rooms</button></div>');
  }
  function saveRooms() {
    const list = parseRoomList(val('ht-r-list'));
    if (!list.length) return err('Enter at least one room number.');
    const have = new Set(DB.rooms.map(r => String(r.no).toLowerCase())), typeId = val('ht-r-type'), floorIn = val('ht-r-floor');
    let added = 0, skipped = 0;
    list.forEach(no => {
      if (have.has(no.toLowerCase())) { skipped++; return; }
      have.add(no.toLowerCase());
      const fl = floorIn || (/^\d{3,}$/.test(no) ? String(Math.floor(Number(no) / 100)) : '');
      DB.rooms.push({ id: uid(), no: no, floor: fl, typeId: typeId, hk: 'clean' }); added++;
    });
    dbSave(); closeModal(); render();
    toast(added + ' room' + (added === 1 ? '' : 's') + ' added' + (skipped ? ' · ' + skipped + ' already existed' : ''));
  }
  function roomSheet(id) {
    const r = roomById(id); if (!r) return;
    ST.roomId = id;
    const s = roomState(r), b = inHouse(r), ty = typeById(r.typeId);
    const next = DB.bookings.filter(x => x.roomId === r.id && x.status === 'reserved').sort((a, c) => a.checkIn < c.checkIn ? -1 : 1)[0];
    const tbl = roomTable(r), food = ordersForRoom(r);
    openModal(head('Room ' + esc(r.no), esc(ty ? ty.name : '') + (r.floor ? ' · floor ' + esc(r.floor) : '')) +
      '<p><span class="ht-badge ' + s + '">' + STATE_LABEL[s] + '</span></p>' +
      (b ? '<div class="ht-sum"><b>' + esc(b.guest.name) + '</b><br>' + fmtD(b.checkIn) + ' → ' + fmtD(b.checkOut) + ' · ' + esc(b.guest.phone || '') + '</div><div class="ht-actions" style="margin:0 0 12px"><button class="btn btn-primary" data-h="folio" data-id="' + b.id + '">Open bill</button><button class="btn btn-ghost" data-h="booking" data-id="' + b.id + '">Booking</button></div>' : '') +
      (next && !b ? '<div class="ht-sum">Next: <b>' + esc(next.guest.name) + '</b> · ' + fmtD(next.checkIn) + ' → ' + fmtD(next.checkOut) + '</div>' : '') +
      (food.length ? '<div class="ht-banner">' + food.length + ' open room-service order' + (food.length > 1 ? 's' : '') + ' — post them to the guest’s bill from the folio.</div>' : '') +
      '<div class="ht-actions">' +
      (!b ? '<button class="btn btn-primary" data-h="newBooking" data-room="' + r.id + '" data-date="' + today() + '">New booking</button>' : '') +
      (!b && r.hk !== 'clean' ? '<button class="btn btn-ghost" data-h="hk" data-id="' + r.id + '" data-v="clean">Mark clean</button>' : '') +
      (!b && r.hk !== 'dirty' ? '<button class="btn btn-ghost" data-h="hk" data-id="' + r.id + '" data-v="dirty">Mark dirty</button>' : '') +
      (!b && r.hk !== 'blocked' ? '<button class="btn btn-ghost" data-h="hk" data-id="' + r.id + '" data-v="blocked">Out of service</button>' : '') +
      '</div><div class="ht-actions">' +
      (tbl ? '<button class="btn btn-ghost" data-h="showQr" data-id="' + tbl.id + '">Show room QR</button>' : '<button class="btn btn-ghost" data-h="makeQr" data-id="' + r.id + '">Create room QR</button>') +
      '<button class="btn btn-ghost" data-h="editRoom" data-id="' + r.id + '">Edit</button></div>' +
      '<div class="ht-actions">' + closeBtn + '</div>');
  }
  function editRoom(id) {
    const r = roomById(id);
    openModal(head('Edit room ' + esc(r.no)) +
      '<div class="ht-2"><div><label>Room number</label><input id="ht-e-no" value="' + esc(r.no) + '"></div><div><label>Floor</label><input id="ht-e-floor" value="' + esc(r.floor) + '"></div></div>' +
      '<label>Room type</label><select id="ht-e-type">' + opts(DB.types.map(t => [t.id, t.name]), r.typeId) + '</select>' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="room" data-id="' + id + '">Back</button><button class="btn btn-ghost ht-danger" data-h="delRoom" data-id="' + id + '">Delete</button><button class="btn btn-primary" data-h="saveRoom" data-id="' + id + '">Save</button></div>');
  }
  function saveRoom(id) {
    const r = roomById(id), no = val('ht-e-no');
    if (!no) return err('Room number can’t be empty.');
    if (DB.rooms.some(x => x.id !== id && String(x.no).toLowerCase() === no.toLowerCase())) return err('That room number already exists.');
    r.no = no; r.floor = val('ht-e-floor'); r.typeId = val('ht-e-type');
    dbSave(); closeModal(); render();
  }
  function delRoom(id) {
    if (DB.bookings.some(b => b.roomId === id && live(b))) return err('This room has active bookings — move or cancel them first.');
    DB.bookings.forEach(b => { if (b.roomId === id) b.roomNo = roomById(id).no; });
    DB.rooms = DB.rooms.filter(r => r.id !== id); dbSave(); closeModal(); render();
  }
  async function makeQr(roomIds) {
    const api = (typeof apiSend === 'function') ? apiSend : null;
    if (!api) return toast('Not ready yet — try again in a moment');
    let ok = 0, fail = 0, lastMsg = '';
    for (const id of roomIds) {
      const r = roomById(id); if (!r || roomTable(r)) continue;
      try { const t = await api('POST', '/tables', { table_number: String(r.no), is_room: true }); (getTables() || []).push(t); ok++; }
      catch (e) { fail++; lastMsg = e && e.message; }
    }
    try { renderTables(); renderOrders(); } catch (e) { /* views not mounted */ }
    toast(ok + ' room QR' + (ok === 1 ? '' : 's') + ' created' + (fail ? ' · ' + fail + ' failed' + (lastMsg ? ' (' + lastMsg + ')' : '') : ''));
    if (ST.roomId) roomSheet(ST.roomId); else render();
  }

  /* ---- guests' ID photos (kept on the server, shown only to this hotel's owner / billing staff) ---- */
  const IDT = ['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'Other'];
  const blankPerson = () => ({ name: '', phone: '', address: '', idType: 'Aadhaar', idNo: '', idDocId: null });
  const DOCURL = {};
  function docUrl(id) {
    if (!DOCURL[id]) DOCURL[id] = fetch(API_BASE + '/hotel/id-docs/' + id, { headers: authHeaders() })
      .then(r => { if (!r.ok) throw new Error('x'); return r.blob(); }).then(b => URL.createObjectURL(b)).catch(() => { delete DOCURL[id]; return ''; });
    return DOCURL[id];
  }
  function compressImg(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader(); fr.onerror = rej;
      fr.onload = () => {
        const im = new Image(); im.onerror = rej;
        im.onload = () => {
          const sc = Math.min(1, 1100 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(im.width * sc)); cv.height = Math.max(1, Math.round(im.height * sc));
          cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          let q = 0.72, out = cv.toDataURL('image/jpeg', q);
          while (out.length * 0.75 > 420000 && q > 0.35) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
          res(out);
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function uploadDoc(file) { const data = await compressImg(file); const r = await apiSend('POST', '/hotel/id-docs', { data: data }); return r.id; }
  function paintDocs(box) { box.querySelectorAll('img[data-doc]').forEach(im => docUrl(im.dataset.doc).then(u => { if (u) im.src = u; })); }
  function showDoc(id) {
    docUrl(id).then(u => {
      if (!u) return toast('Couldn’t open that photo');
      const lb = document.createElement('div'); lb.className = 'ht-lb'; lb.innerHTML = '<img alt="ID photo">'; lb.firstChild.src = u;
      lb.addEventListener('click', () => lb.remove()); document.body.appendChild(lb);
    });
  }
  const fieldIn = (i, f, v, ph, type) => '<input' + (type ? ' type="' + type + '"' : '') + ' data-pi="' + i + '" data-pf="' + f + '" value="' + esc(v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' autocomplete="off">';
  function drawPeople() {
    const box = $('#ht-people', modal); if (!box) return;
    box.innerHTML = ST.people.map((p, i) =>
      '<div class="ht-person"><div class="ht-row-top"><b>Person ' + (i + 2) + '</b><button type="button" class="btn btn-ghost btn-sm" data-h="delPerson" data-i="' + i + '">Remove</button></div>' +
      '<div class="ht-2"><div><label>Name</label>' + fieldIn(i, 'name', p.name) + '</div><div><label>Phone</label>' + fieldIn(i, 'phone', p.phone, '', 'tel') + '</div></div>' +
      '<label>Address</label>' + fieldIn(i, 'address', p.address) +
      '<div class="ht-2"><div><label>ID proof</label><select data-pi="' + i + '" data-pf="idType">' + opts(IDT.map(x => [x, x]), p.idType) + '</select></div><div><label>ID number</label>' + fieldIn(i, 'idNo', p.idNo) + '</div></div>' +
      '<div class="ht-idrow">' + (p.idDocId ? '<img class="ht-thumb" data-doc="' + p.idDocId + '" data-h="viewDoc" data-id="' + p.idDocId + '" alt="ID photo">' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-h="pidoc" data-i="' + i + '">' + (p.idDocId ? 'Replace ID photo' : 'Attach ID photo') + '</button></div></div>').join('');
    paintDocs(box);
  }
  function drawPrimary() {
    const sp = $('#ht-pdoc', modal); if (!sp) return;
    sp.innerHTML = (ST.pdoc ? '<img class="ht-thumb" data-doc="' + ST.pdoc + '" data-h="viewDoc" data-id="' + ST.pdoc + '" alt="ID photo">' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-h="pidoc" data-i="p">' + (ST.pdoc ? 'Replace ID photo' : 'Attach ID photo') + '</button>';
    paintDocs(sp);
  }

  /* ---- booking form ---- */
  function bookingForm(id, pre) {
    pre = pre || {};
    const b = id ? bookingById(id) : null;
    const types = DB.types;
    const room0 = pre.roomId ? roomById(pre.roomId) : (b ? roomById(b.roomId) : null);
    ST.enqId = pre.enqId || null;
    const f = b ? { name: b.guest.name, phone: b.guest.phone, email: b.guest.email, adults: b.adults, kids: b.children, ci: b.checkIn, co: b.checkOut, typeId: b.typeId, roomId: b.roomId, rate: b.rate, planId: b.planId, src: b.source, idt: b.guest.idType, idn: b.guest.idNo, gst: b.guest.gstin, co_: b.guest.company, notes: b.notes }
      : { name: pre.name || '', phone: pre.phone || '', email: pre.email || '', adults: pre.adults || 2, kids: pre.kids || 0, ci: pre.ci || pre.date || today(), co: pre.co || addDays(pre.date || today(), 1), typeId: pre.typeId || (room0 ? room0.typeId : types[0].id), roomId: room0 ? room0.id : '', rate: '', planId: DB.plans[0].id, src: pre.src || 'walk-in', idt: 'Aadhaar', idn: '', gst: '', co_: '', notes: pre.notes || '' };
    ST.bookingId = id || null; ST.rateTouched = !!id;
    ST.people = b && Array.isArray(b.others) ? JSON.parse(JSON.stringify(b.others)) : []; ST.pdoc = b ? (b.guest.idDocId || null) : null;
    ST.bf0 = f;
    openModal(head(id ? 'Edit booking' : 'New booking') +
      '<label>Guest name</label><input id="ht-b-name" value="' + esc(f.name) + '" autocomplete="off">' +
      '<div class="ht-2"><div><label>Phone</label><input id="ht-b-phone" type="tel" value="' + esc(f.phone) + '"></div><div><label>Email (optional)</label><input id="ht-b-email" type="email" value="' + esc(f.email) + '"></div></div>' +
      '<div class="ht-2"><div><label>Check-in</label><input id="ht-b-ci" type="date" value="' + f.ci + '"></div><div><label>Check-out</label><input id="ht-b-co" type="date" value="' + f.co + '"></div></div>' +
      '<div class="ht-2"><div><label>Room type</label><select id="ht-b-type">' + opts(types.map(t => [t.id, t.name + ' · ' + money(t.rate)]), f.typeId) + '</select></div><div><label>Room</label><select id="ht-b-room"></select></div></div>' +
      '<div class="ht-2"><div><label>Meal plan</label><select id="ht-b-plan">' + opts(DB.plans.map(p => [p.id, p.name + (p.addon ? ' · +' + money(p.addon) : '')]), f.planId) + '</select></div><div><label>Rate / night (no GST)</label><input id="ht-b-rate" type="number" min="0" step="any" value="' + esc(f.rate) + '"></div></div>' +
      '<div class="ht-2"><div><label>Adults</label><input id="ht-b-ad" type="number" min="1" value="' + esc(f.adults) + '"></div><div><label>Children</label><input id="ht-b-kids" type="number" min="0" value="' + esc(f.kids) + '"></div></div>' +
      '<div id="ht-b-sum" class="ht-sum"></div>' +
      (id ? '' : '<div class="ht-2"><div><label>Advance paid (₹)</label><input id="ht-b-adv" type="number" min="0" step="any" placeholder="0" value="' + (pre && pre.adv ? esc(pre.adv) : '') + '"></div><div><label>Advance via</label><select id="ht-b-advm">' + opts(METHODS, pre && pre.advm ? pre.advm : 'cash') + '</select></div></div>') +
      '<div class="ht-2"><div><label>Booked via</label><select id="ht-b-src">' + opts([['walk-in', 'Walk-in'], ['phone', 'Phone'], ['website', 'Website'], ['ota', 'Booking site / agent'], ['other', 'Other']], f.src) + '</select></div><div><label>ID proof</label><select id="ht-b-idt">' + opts(['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'Other'].map(x => [x, x]), f.idt) + '</select></div></div>' +
      '<div class="ht-2"><div><label>ID number (optional)</label><input id="ht-b-idn" value="' + esc(f.idn) + '"></div><div><label>Company GSTIN (optional)</label><input id="ht-b-gst" value="' + esc(f.gst) + '" placeholder="for a GST invoice"></div></div>' +
      '<label>Address</label><input id="ht-b-addr" value="' + esc(b ? (b.guest.address || '') : '') + '" placeholder="Home address of the main guest">' +
      '<div class="ht-idrow" id="ht-pdoc"></div>' +
      '<div class="ht-sub">Other people staying</div><div id="ht-people"></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-h="addPerson">+ Add person</button><input type="file" id="ht-file" accept="image/*" hidden>' +
      '<label>Company name (if GSTIN)</label><input id="ht-b-comp" value="' + esc(f.co_) + '">' +
      '<label>Notes</label><input id="ht-b-notes" value="' + esc(f.notes) + '" placeholder="Late arrival, extra bed…">' +
      '<p class="ht-err" id="ht-err"></p><div class="ht-actions"><button class="btn btn-ghost" data-h="close">Cancel</button><button class="btn btn-primary" data-h="saveBooking" data-id="' + (id || '') + '">' + (id ? 'Save changes' : 'Create booking') + '</button></div>');
    drawPeople(); drawPrimary();
    refreshBookingForm(true);
    if (!f.rate) autoRate();
  }
  function autoRate() {
    if (ST.rateTouched) return refreshBookingForm();
    const ci = val('ht-b-ci'), co = val('ht-b-co'), tid = val('ht-b-type'), el = $('#ht-b-rate', modal);
    if (el && ci && co && co > ci) el.value = avgRate(tid, ci, co) + num(planOf(val('ht-b-plan')).addon);
    refreshBookingForm();
  }
  function refreshBookingForm(first) {
    const typeId = val('ht-b-type'), ci = val('ht-b-ci'), co = val('ht-b-co');
    const sel = $('#ht-b-room', modal); if (!sel) return;
    const keep = first ? (ST.bf0 && ST.bf0.roomId) : sel.value;
    let free = (ci && co && co > ci) ? freeRooms(typeId, ci, co, ST.bookingId) : [];
    sel.innerHTML = '<option value="">' + (free.length ? 'Auto-assign (' + free.length + ' free)' : 'None free for these dates') + '</option>' + opts(free.map(r => [r.id, 'Room ' + r.no]), keep);
    const n = (ci && co) ? nightsBetween(ci, co) : 0, rate = num(val('ht-b-rate'));
    const sum = $('#ht-b-sum', modal);
    const rm = (n > 0 && channelSrc(val('ht-b-src'))) ? restrictionMsg(typeId, ci, co) : '';
    if (sum) sum.innerHTML = (rm ? '<span class="ht-danger"><b>' + esc(rm) + '</b></span><br>' : '') + (n > 0 ? '<b>' + n + ' night' + (n > 1 ? 's' : '') + '</b> × ' + money(rate) + ' = <b>' + money(n * rate) + '</b> + GST (' + slabRate(rate) + '%) ≈ <b>' + money(Math.round(n * rate * (1 + slabRate(rate) / 100))) + '</b>' : 'Check-out must be after check-in.');
  }
  function saveBooking(id) {
    const name = val('ht-b-name'), phone = val('ht-b-phone'), ci = val('ht-b-ci'), co = val('ht-b-co'), typeId = val('ht-b-type'), rate = num(val('ht-b-rate'));
    if (!name) return err('Enter the guest’s name.');
    if (!phone) return err('Enter a phone number.');
    if (!ci || !co || co <= ci) return err('Check-out must be after check-in.');
    if (val('ht-b-rate') === '' || rate < 0) return err('Enter the rate per night.');
    const old = id ? bookingById(id) : null;
    if (channelSrc(val('ht-b-src'))) { const rm = restrictionMsg(typeId, ci, co); if (rm) return err(rm + ' Choose “Walk-in” or “Phone” to book it anyway.'); }
    let roomId = val('ht-b-room');
    if (!roomId) { const fr = freeRooms(typeId, ci, co, id)[0]; if (!fr) return err('No ' + ((typeById(typeId) || {}).name || '') + ' room is free for these dates.'); roomId = fr.id; }
    else if (clashes(roomId, ci, co, id).length) return err('That room is already booked for these dates.');
    const adv = id ? 0 : num(val('ht-b-adv'));
    const others = (ST.people || []).map(p => ({ name: (p.name || '').trim(), phone: (p.phone || '').trim(), address: (p.address || '').trim(), idType: p.idType || 'Aadhaar', idNo: (p.idNo || '').trim(), idDocId: p.idDocId || null }))
      .filter(p => p.name || p.phone || p.idNo || p.idDocId);
    if (others.some(p => !p.name)) return err('Enter a name for every extra person, or remove them.');
    const guest = { address: val('ht-b-addr'), idDocId: ST.pdoc || null, name: name, phone: phone, email: val('ht-b-email'), idType: val('ht-b-idt'), idNo: val('ht-b-idn'), gstin: val('ht-b-gst').toUpperCase(), company: val('ht-b-comp') };
    const data = { guest: guest, others: others, adults: Math.max(1, num(val('ht-b-ad')) || 1), children: Math.max(0, num(val('ht-b-kids'))), typeId: typeId, planId: val('ht-b-plan') || DB.plans[0].id, roomId: roomId, roomNo: roomById(roomId).no, checkIn: ci, checkOut: co, rate: rate, source: val('ht-b-src'), notes: val('ht-b-notes') };
    if (old) { Object.assign(old, data); toast('Booking updated'); }
    else {
      DB.seq.booking++;
      const nb = Object.assign({ id: uid(), no: 'B-' + pad(DB.seq.booking, 4), status: 'reserved', createdAt: new Date().toISOString(), charges: [], payments: [], discount: { type: 'flat', value: 0 } }, data);
      if (adv > 0) nb.payments.push({ id: uid(), at: new Date().toISOString(), method: val('ht-b-advm') || 'cash', amount: adv, kind: 'advance', note: 'Advance' });
      DB.bookings.push(nb); toast('Booking ' + nb.no + ' created');
      if (ST.enqId) { markEnq(ST.enqId, 'accepted'); ST.enqId = null; }
    }
    dbSave(); closeModal(); render();
  }

  /* ---- booking sheet ---- */
  function bookingSheet(id) {
    const b = bookingById(id); if (!b) return;
    ST.bookingId = id;
    const c = calc(b);
    const label = { reserved: 'Reserved', in: 'Checked in', out: 'Checked out', cancelled: 'Cancelled', noshow: 'No-show' }[b.status];
    openModal(head(esc(b.guest.name), esc(b.no) + ' · <span class="ht-badge ' + b.status + '">' + label + '</span>') +
      '<div class="ht-sum">Room <b>' + esc(roomNo(b)) + '</b> · ' + esc(typeName(b)) + '<br>' + fmtDY(b.checkIn) + ' → ' + fmtDY(b.checkOut) + ' · ' + c.nights + ' night' + (c.nights > 1 ? 's' : '') + '<br>' + b.adults + ' adult' + (b.adults > 1 ? 's' : '') + (b.children ? ' + ' + b.children + ' child' : '') +
      '<br>' + esc(b.guest.phone) + (b.guest.email ? ' · ' + esc(b.guest.email) : '') + (b.guest.company ? '<br>' + esc(b.guest.company) + ' · ' + esc(b.guest.gstin) : '') + (b.notes ? '<br>Note: ' + esc(b.notes) : '') + '</div>' +
      ((b.others && b.others.length) || b.guest.idDocId || b.guest.address ? '<div class="ht-sum">' + [b.guest].concat(b.others || []).map(p => '<div class="ht-pline"><b>' + esc(p.name) + '</b>' + (p.phone ? ' · ' + esc(p.phone) : '') + (p.address ? '<br><small>' + esc(p.address) + '</small>' : '') + (p.idType && (p.idNo || p.idDocId) ? '<br><small>' + esc(p.idType) + (p.idNo ? ' · ' + esc(p.idNo) : '') + '</small>' : '') + (p.idDocId ? ' <button type="button" class="btn btn-ghost btn-sm" data-h="viewDoc" data-id="' + p.idDocId + '">View ID photo</button>' : '') + '</div>').join('') + '</div>' : '') +
      '<div class="ht-sum">Bill so far <b>' + money(c.total) + '</b> · paid <b>' + money(c.paid) + '</b> · ' + (c.balance >= 0 ? 'due <b>' + money(c.balance) + '</b>' : 'refund <b>' + money(-c.balance) + '</b>') + '</div>' +
      '<div class="ht-actions">' +
      (b.status === 'reserved' ? '<button class="btn btn-primary" data-h="checkIn" data-id="' + id + '">Check in</button>' : '') +
      (b.status === 'in' ? '<button class="btn btn-primary" data-h="folio" data-id="' + id + '">Bill &amp; check out</button>' : '') +
      (b.status === 'out' ? '<button class="btn btn-primary" data-h="folio" data-id="' + id + '">View invoice</button>' : '') +
      (b.status === 'reserved' ? '<button class="btn btn-ghost" data-h="folio" data-id="' + id + '">Bill / advance</button>' : '') +
      (live(b) ? '<button class="btn btn-ghost" data-h="editBooking" data-id="' + id + '">Edit</button>' : '') +
      '</div>' +
      (b.status === 'reserved' ? '<div class="ht-actions"><button class="btn btn-ghost ht-danger" data-h="cancelAsk" data-id="' + id + '">Cancel booking</button><button class="btn btn-ghost" data-h="noShow" data-id="' + id + '">Mark no-show</button></div>' : '') +
      '<div class="ht-actions">' + closeBtn + '</div>');
  }
  function checkIn(id) {
    const b = bookingById(id), r = roomById(b.roomId);
    if (!r) return toast('Pick a room for this booking first (Edit).');
    if (inHouse(r)) return toast('Room ' + r.no + ' still has a guest checked in.');
    if (r.hk === 'blocked') return toast('Room ' + r.no + ' is out of service.');
    b.status = 'in'; b.checkedInAt = new Date().toISOString();
    dbSave(); render(); bookingSheet(id); toast('Checked in · Room ' + r.no);
  }
  function cancelAsk(id) {
    const b = bookingById(id), adv = calc(b).paid;
    openModal(head('Cancel booking?', esc(b.guest.name) + ' · ' + fmtD(b.checkIn) + ' → ' + fmtD(b.checkOut)) +
      (function () { const dd = nightsBetween(today(), b.checkIn), cd = num(DB.settings.cancelDays); return '<p class="ht-help">' + (dd >= cd ? 'Within your free-cancellation window (' + cd + ' day' + (cd === 1 ? '' : 's') + ' before check-in).' : 'Inside the ' + cd + '-day free-cancellation window — you may keep the advance.') + '</p>'; })() +
      (adv > 0 ? '<div class="ht-banner">An advance of <b>' + money(adv) + '</b> was collected. Refund it, or keep it as a cancellation fee?</div>' : '') +
      '<div class="ht-actions"><button class="btn btn-ghost" data-h="booking" data-id="' + id + '">Go back</button>' +
      (adv > 0 ? '<button class="btn btn-ghost" data-h="doCancel" data-id="' + id + '" data-v="keep">Cancel · keep advance</button><button class="btn btn-primary" data-h="doCancel" data-id="' + id + '" data-v="refund">Cancel · refund advance</button>' : '<button class="btn btn-primary" data-h="doCancel" data-id="' + id + '" data-v="keep">Cancel booking</button>') + '</div>');
  }
  function doCancel(id, mode) {
    const b = bookingById(id), adv = calc(b).paid;
    if (mode === 'refund' && adv > 0) b.payments.push({ id: uid(), at: new Date().toISOString(), method: 'cash', amount: -adv, kind: 'refund', note: 'Advance refunded on cancellation' });
    b.status = 'cancelled'; b.cancelledAt = new Date().toISOString();
    dbSave(); closeModal(); render(); toast('Booking cancelled');
  }

  /* ---------------------------------------------------------------- folio (guest bill) */
  const nowIso = () => new Date().toISOString();
  const QUICK = ['Laundry', 'Minibar', 'Extra bed', 'Airport pickup', 'Spa', 'Late check-out'];
  function folioView(id) {
    const b = bookingById(id); if (!b) return;
    ST.folioId = id;
    const open = b.status === 'in' || b.status === 'reserved';
    const fin = b.status === 'out' && b.invoice;
    const c = fin ? b.invoice.calc : calc(b);
    const rows = c.lines.map(l => '<tr><td>' + esc(l.desc) + (l.incl ? '<br><small style="color:var(--text-secondary)">incl. tax</small>' : (l.rate ? '<br><small style="color:var(--text-secondary)">GST ' + l.rate + '%</small>' : '')) + '</td><td>' + money(l.base) +
      (open && l.id && l.kind === 'extra' ? '<button class="x" data-h="delCharge" data-id="' + id + '" data-c="' + l.id + '" title="Remove">Remove</button>' : '') + '</td></tr>').join('');
    const taxRows = Object.keys(c.tax).filter(k => c.tax[k] > 0).map(k => '<tr class="sub"><td>CGST ' + (k / 2) + '%</td><td>' + money(c.tax[k] / 2) + '</td></tr><tr class="sub"><td>SGST ' + (k / 2) + '%</td><td>' + money(c.tax[k] / 2) + '</td></tr>').join('');
    const pays = (b.payments || []).map(p => '<tr class="sub"><td>' + fmtD(dayOf(p.at)) + ' · ' + esc(p.kind === 'refund' ? 'Refund' : (p.kind === 'advance' ? 'Advance' : 'Payment')) + ' · ' + esc(p.method) + '</td><td>' + (p.amount < 0 ? '−' : '') + money(Math.abs(p.amount)) + '</td></tr>').join('');
    let html = head('Room ' + esc(roomNo(b)) + ' · ' + esc(b.guest.name), esc(b.no) + ' · ' + fmtD(b.checkIn) + ' → ' + fmtD(b.checkOut) + (fin ? ' · <b>' + esc(b.invoice.no) + '</b>' : '')) +
      '<table class="ht-bill">' + rows + '<tr class="sub"><td>Subtotal</td><td>' + money(c.sub) + '</td></tr>' +
      (c.disc ? '<tr class="sub"><td>Discount</td><td>−' + money(c.disc) + '</td></tr>' : '') + taxRows +
      (Math.abs(c.roundOff) > 0.004 ? '<tr class="sub"><td>Round off</td><td>' + (c.roundOff < 0 ? '−' : '') + money(Math.abs(c.roundOff)) + '</td></tr>' : '') +
      '<tr class="tot"><td>Total</td><td>' + money(c.total) + '</td></tr>' + pays +
      '<tr class="tot"><td>' + (c.balance >= 0 ? 'Balance due' : 'To refund') + '</td><td>' + money(Math.abs(c.balance)) + '</td></tr></table>';
    if (open) {
      html += '<div class="ht-sec">Add a charge</div><div class="ht-chips">' + QUICK.map(q => '<button class="ht-chip" data-h="quick" data-v="' + q + '">' + q + '</button>').join('') + '</div>' +
        '<div class="ht-2"><input id="ht-c-desc" placeholder="Description"><input id="ht-c-amt" type="number" min="0" step="any" placeholder="Amount ₹ (without GST)"></div>' +
        '<div class="ht-2"><div><label>GST % on this charge</label><input id="ht-c-tax" type="number" min="0" step="any" value="' + num(DB.settings.extraTax) + '"></div><div><label>&nbsp;</label><button class="btn btn-ghost" data-h="addCharge" data-id="' + id + '" style="width:100%;margin-bottom:10px">Add charge</button></div></div>';
      if (b.status === 'in') html += orderPicker(b);
      const d = b.discount || { type: 'flat', value: 0 };
      html += '<div class="ht-sec">Discount</div><div class="ht-2"><select id="ht-d-type">' + opts([['flat', '₹ off'], ['pct', '% off']], d.type) + '</select><input id="ht-d-val" type="number" min="0" step="any" value="' + (d.value || '') + '" placeholder="0"></div>' +
        '<button class="btn btn-ghost btn-sm" data-h="setDisc" data-id="' + id + '">Apply discount</button>' +
        '<div class="ht-sec">Take a payment</div><div class="ht-2"><input id="ht-p-amt" type="number" min="0" step="any" placeholder="Amount ₹' + (c.balance > 0 ? ' (due ' + Math.round(c.balance) + ')' : '') + '"><select id="ht-p-m">' + opts(METHODS) + '</select></div>' +
        '<button class="btn btn-ghost btn-sm" data-h="addPay" data-id="' + id + '">Add payment</button>';
    }
    html += '<p class="ht-err" id="ht-err"></p>';
    if (b.status === 'in') {
      const bal = Math.round(c.balance * 100) / 100;
      html += '<div class="ht-sec">Check out</div>' + (Math.abs(bal) > 0.005 ? '<select id="ht-co-m">' + opts(METHODS) + '</select>' : '') +
        '<div class="ht-actions"><button class="btn btn-ghost" data-h="printInv" data-id="' + id + '">Print bill</button><button class="btn btn-primary" data-h="checkOut" data-id="' + id + '">' +
        (bal > 0.005 ? 'Collect ' + money(bal) + ' &amp; check out' : (bal < -0.005 ? 'Refund ' + money(-bal) + ' &amp; check out' : 'Check out')) + '</button></div>';
    } else if (open) html += '<div class="ht-actions"><button class="btn btn-ghost" data-h="printInv" data-id="' + id + '">Print proforma</button></div>';
    else if (fin) html += '<div class="ht-actions"><button class="btn btn-primary" data-h="printInv" data-id="' + id + '">Print invoice</button></div>';
    html += '<div class="ht-actions">' + closeBtn + '</div>';
    openModal(html);
    ST.folioId = id;
  }
  function orderPicker(b) {
    const r = roomById(b.roomId); if (!r) return '';
    const mine = ordersForRoom(r), other = otherOrders(r);
    const item = (o, chk) => '<label class="ht-pick"><input type="checkbox" class="ht-ord" value="' + o.id + '"' + (chk ? ' checked' : '') + '><span><b>' + esc(orderWhere(o)) + ' · ' + money(o.total_amount) + '</b><small>' + esc(orderSummary(o)) + '</small></span></label>';
    return '<div class="ht-sec">Restaurant &amp; room service</div>' +
      '<p class="ht-help">Food ordered from this room’s QR shows up here. Tick what to charge, then add it to the bill — it’s added at the price the guest saw (tax included) and no GST is added again.</p>' +
      (mine.length ? mine.map(o => item(o, true)).join('') : '<p class="ht-help">No open orders from this room’s QR' + (roomTable(r) ? '.' : ' (the room has no QR yet — create it from the room screen).') + '</p>') +
      (other.length ? '<details><summary class="ht-help" style="cursor:pointer">Charge a restaurant bill from another table to this room (' + other.length + ')</summary>' + other.map(o => item(o, false)).join('') + '</details>' : '') +
      ((mine.length || other.length) ? '<label class="ht-pick"><input type="checkbox" id="ht-close" checked><span>Also close the orders in the Orders tab<small>They’re paid by the room bill</small></span></label><button class="btn btn-ghost btn-sm" data-h="postOrders" data-id="' + b.id + '">Add selected to the room bill</button>' : '');
  }
  function addCharge(id) {
    const b = bookingById(id), desc = val('ht-c-desc'), amt = num(val('ht-c-amt'));
    if (!desc) return err('Describe the charge (e.g. Laundry).');
    if (!(amt > 0)) return err('Enter an amount above zero.');
    b.charges.push({ id: uid(), at: nowIso(), kind: 'extra', desc: desc, amount: amt, taxRate: Math.max(0, num(val('ht-c-tax'))) });
    dbSave(); folioView(id); render();
  }
  function delCharge(id, cid) { const b = bookingById(id); b.charges = b.charges.filter(c => c.id !== cid); dbSave(); folioView(id); render(); }
  function setDisc(id) { const b = bookingById(id); b.discount = { type: val('ht-d-type') === 'pct' ? 'pct' : 'flat', value: Math.max(0, num(val('ht-d-val'))) }; dbSave(); folioView(id); render(); }
  function addPay(id) {
    const b = bookingById(id), amt = num(val('ht-p-amt'));
    if (!(amt > 0)) return err('Enter the amount received.');
    b.payments.push({ id: uid(), at: nowIso(), method: val('ht-p-m') || 'cash', amount: amt, kind: 'payment', note: '' });
    dbSave(); folioView(id); render(); toast(money(amt) + ' received');
  }
  function postOrders(id) {
    const b = bookingById(id), ids = Array.prototype.map.call(modal.querySelectorAll('.ht-ord:checked'), x => x.value);
    if (!ids.length) return err('Tick the orders to post.');
    const closeIt = !!($('#ht-close', modal) || {}).checked, all = allOrders();
    let n = 0;
    ids.forEach(oid => {
      const o = all.find(x => String(x.id) === String(oid)); if (!o || DB.posted[o.id]) return;
      b.charges.push({ id: uid(), at: nowIso(), kind: 'food', desc: 'Restaurant · ' + orderWhere(o) + ' · #' + o.id + ' — ' + orderSummary(o), amount: num(o.total_amount), taxRate: 0, ref: o.id });
      DB.posted[o.id] = b.id; n++;
      if (o.linked && typeof apiSend === 'function') {                              // the restaurant's order: close it THERE too, so nobody collects twice
        LK.orders = LK.orders.filter(x => x.id !== o.rid);
        apiSend('POST', '/link/orders/' + o.rid + '/charge').catch(() => { toast('Order #' + o.rid + ' is on the bill but the restaurant couldn’t be told — mark it paid there.'); });
      } else if (closeIt && typeof apiSend === 'function') {
        const prev = o.status; o.status = 'paid';                                     // instant, like the rest of the app
        apiSend('PATCH', '/orders/' + o.id + '/status?new_status=paid').catch(() => { o.status = prev; toast('Order #' + o.id + ' is on the bill but couldn’t be closed in Orders — close it there.'); try { renderOrders(); } catch (e) { /* */ } });
      }
    });
    dbSave(); try { renderOrders(); } catch (e) { /* orders view not mounted */ }
    folioView(id); render(); toast(n + ' order' + (n === 1 ? '' : 's') + ' added to the room bill');
  }
  const fyOf = d => { const y = d.getFullYear(), s = d.getMonth() >= 3 ? y : y - 1; return s + '-' + pad((s + 1) % 100, 2); };
  function checkOut(id) {
    const b = bookingById(id), r = roomById(b.roomId), t = today();
    if (r && ordersForRoom(r).length && !confirm('This room has open room-service orders that are not on the bill. Check out anyway?')) return;
    if (t > b.checkOut) { b.checkOut = t; toast('Stay extended to today — billed for the extra night(s)'); }
    else if (t < b.checkOut && t > b.checkIn && confirm('The guest is leaving before the booked check-out.\n\nOK = bill only the nights stayed.\nCancel = bill the full booked stay.')) b.checkOut = t;
    const c = calc(b), bal = Math.round(c.balance * 100) / 100, m = val('ht-co-m') || 'cash';
    if (bal > 0.005) b.payments.push({ id: uid(), at: nowIso(), method: m, amount: bal, kind: 'payment', note: 'Settled at check-out' });
    else if (bal < -0.005) b.payments.push({ id: uid(), at: nowIso(), method: m, amount: bal, kind: 'refund', note: 'Refunded at check-out' });
    const final = calc(b), d = new Date();
    DB.seq.invoice++;
    b.invoice = { no: DB.settings.invoicePrefix + '/' + fyOf(d) + '/' + pad(DB.seq.invoice, 4), date: nowIso(), calc: final, roomNo: roomNo(b), typeName: typeName(b) };
    b.status = 'out'; b.checkedOutAt = nowIso();
    if (r) r.hk = 'dirty';
    dbSave(); render(); folioView(id); toast('Checked out · ' + b.invoice.no);
  }

  /* ---------------------------------------------------------------- invoice */
  function printInvoice(id) {
    const b = bookingById(id), fin = b.status === 'out' && b.invoice, c = fin ? b.invoice.calc : calc(b), S = DB.settings, cf = cafeObj() || {};
    const name = S.legalName || cf.name || '', title = fin ? (S.gstin ? 'TAX INVOICE' : 'INVOICE') : 'PROFORMA — not a final invoice';
    const lines = c.lines.map(l => '<tr><td>' + esc(l.desc) + (l.sac ? '<br><small>SAC ' + l.sac + '</small>' : '') + '</td><td class="r">' + money(l.base) + '</td></tr>').join('');
    const taxes = Object.keys(c.tax).filter(k => c.tax[k] > 0).map(k => '<tr><td>CGST ' + (k / 2) + '%</td><td class="r">' + money(c.tax[k] / 2) + '</td></tr><tr><td>SGST ' + (k / 2) + '%</td><td class="r">' + money(c.tax[k] / 2) + '</td></tr>').join('');
    const pays = (b.payments || []).map(p => '<tr><td>' + (p.amount < 0 ? 'Refund' : 'Paid') + ' · ' + esc(p.method) + ' · ' + fmtD(dayOf(p.at)) + '</td><td class="r">' + (p.amount < 0 ? '−' : '') + money(Math.abs(p.amount)) + '</td></tr>').join('');
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(fin ? b.invoice.no : 'Proforma') + '</title><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;margin:24px;max-width:720px}h1{font-size:20px;margin:0}h2{font-size:14px;letter-spacing:.08em;margin:18px 0 6px}' +
      'table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-bottom:1px solid #ddd;vertical-align:top}.r{text-align:right;white-space:nowrap}small{color:#666}' +
      '.tot td{font-weight:700;font-size:15px;border-top:2px solid #111}.meta{display:flex;justify-content:space-between;gap:20px;margin-top:10px}.foot{margin-top:28px;color:#666;font-size:11px}</style></head><body>' +
      '<h1>' + esc(name) + '</h1><div>' + esc(S.address) + (S.phone ? '<br>Ph: ' + esc(S.phone) : '') + (S.gstin ? '<br>GSTIN: ' + esc(S.gstin) : '') + '</div>' +
      '<h2>' + title + '</h2><div class="meta"><div><b>' + esc(b.guest.company || b.guest.name) + '</b>' + (b.guest.company ? '<br>' + esc(b.guest.name) : '') + (b.guest.gstin ? '<br>GSTIN: ' + esc(b.guest.gstin) : '') + '<br>' + esc(b.guest.phone) + '</div>' +
      '<div style="text-align:right">' + (fin ? 'Invoice: <b>' + esc(b.invoice.no) + '</b><br>' : '') + 'Date: ' + fmtDY(dayOf(fin ? b.invoice.date : nowIso())) + '<br>Room ' + esc(roomNo(b)) + ' · ' + esc(typeName(b)) + '<br>' + fmtDY(b.checkIn) + ' → ' + fmtDY(b.checkOut) + '</div></div>' +
      '<table style="margin-top:14px">' + lines + '<tr><td>Subtotal</td><td class="r">' + money(c.sub) + '</td></tr>' + (c.disc ? '<tr><td>Discount</td><td class="r">−' + money(c.disc) + '</td></tr>' : '') + taxes +
      (Math.abs(c.roundOff) > 0.004 ? '<tr><td>Round off</td><td class="r">' + (c.roundOff < 0 ? '−' : '') + money(Math.abs(c.roundOff)) + '</td></tr>' : '') +
      '<tr class="tot"><td>Total</td><td class="r">' + money(c.total) + '</td></tr>' + pays + '<tr><td><b>' + (c.balance >= 0 ? 'Balance due' : 'Refund') + '</b></td><td class="r"><b>' + money(Math.abs(c.balance)) + '</b></td></tr></table>' +
      '<div class="foot">Restaurant items are charged inclusive of tax. Thank you for staying with us.</div></body></html>';
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const d = f.contentWindow.document; d.open(); d.write(html); d.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Couldn’t open the print dialog'); } setTimeout(() => f.remove(), 2000); }, 250);
  }

  /* ---------------------------------------------------------------- backup */
  function backup() {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'cheri-hotel-backup-' + today() + '.json'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function restoreFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const p = JSON.parse(rd.result);
        if (!p || !Array.isArray(p.rooms) || !Array.isArray(p.bookings) || !Array.isArray(p.types)) throw new Error('bad');
        if (!confirm('Replace everything in this hotel with the backup (' + p.rooms.length + ' rooms, ' + p.bookings.length + ' bookings)? This changes it for every device.')) return;
        DB = adopt(p); dbSave(); render(); toast('Backup restored');
      } catch (e) { toast('That doesn’t look like a chéri hotel backup'); }
    };
    rd.readAsText(file);
  }

  /* ---------------------------------------------------------------- account type */
  const getOrders = () => { try { return typeof orders !== 'undefined' && Array.isArray(orders) ? orders : []; } catch (e) { return []; } };
  const getTables = () => { try { return typeof tables !== 'undefined' && Array.isArray(tables) ? tables : []; } catch (e) { return []; } };
  function bizType() {
    const c = cafeObj(); if (!c) return 'cafe';
    return c.business_type === 'hotel' ? 'hotel' : 'cafe';   // the server decides; a device setting can never turn a café into a hotel
  }
  /* ---------------------------------------------------------------- events */
  function act(a, t) {
    const id = t.dataset.id, v = t.dataset.v;
    switch (a) {
      case 'tab': ST.tab = v; render(); break;
      case 'bk': ST.bk = v; render(); break;
      case 'addPerson': if ((ST.people || []).length >= 8) { toast('That’s the most people one booking can hold'); break; } ST.people.push(blankPerson()); drawPeople(); break;
      case 'delPerson': { const p = ST.people.splice(Number(t.dataset.i), 1)[0]; if (p && p.idDocId && typeof apiSend === 'function') apiSend('DELETE', '/hotel/id-docs/' + p.idDocId).catch(() => {}); drawPeople(); break; }
      case 'pidoc': ST.docTarget = t.dataset.i; { const fi = $('#ht-file', modal); if (fi) fi.click(); } break;
      case 'viewDoc': showDoc(id); break;
      case 'bkMode': ST.bkMode = v; if (v === 'requests') loadEnq(); render(); break;
      case 'hallPick': ST.hall = id; render(); break;
      case 'bqMove': { const p = (ST.bqm || today().slice(0, 7)).split('-').map(Number), d = new Date(p[0], p[1] - 1 + Number(v), 1); ST.bqm = d.getFullYear() + '-' + pad(d.getMonth() + 1, 2); render(); break; }
      case 'bqDay': bqDay(t.dataset.date); break;
      case 'bqNew': if (!(DB.halls || []).length) { ST.tab = 'setup'; render(); break; } bqForm(null, { date: t.dataset.date, slot: t.dataset.slot, hallId: ST.hall }); break;
      case 'bqEdit': bqForm(id); break;
      case 'saveBq': saveBq(id || null); break;
      case 'cancelBq': { const x = DB.banquet.find(b => b.id === id); if (x) { x.status = 'cancelled'; dbSave(); closeModal(); render(); toast('Function cancelled'); } break; }
      case 'editHall': hallForm(id || null); break;
      case 'saveHall': saveHall(id || null); break;
      case 'delHall': delHall(id); break;
      case 'enqAccept': enqAccept(id); break;
      case 'enqDecline': markEnq(Number(id), 'declined'); render(); toast('Declined'); break;
      case 'bf': ST.bf = v; render(); break;
      case 'rateCell': rateCellForm(t.dataset.type, t.dataset.date); break;
      case 'rcSave': rcSave(t.dataset.type, t.dataset.date); break;
      case 'rcReset': delete DB.cal[calKey(t.dataset.type, t.dataset.date)]; dbSave(); closeModal(); render(); break;
      case 'tlMoveR': ST.rs = v === '0' ? today() : addDays(ST.rs || today(), Number(v)); render(); break;
      case 'bulk': bulkForm(); break;
      case 'bulkApply': bulkApply(); break;
      case 'addPromo': promoForm(); break;
      case 'savePromo': savePromo(); break;
      case 'togglePromo': { const p = DB.promos.find(x => x.id === id); p.on = !p.on; dbSave(); render(); break; }
      case 'delPromo': DB.promos = DB.promos.filter(x => x.id !== id); dbSave(); render(); break;
      case 'editPlan': planForm(id || null); break;
      case 'savePlan': savePlan(id || null); break;
      case 'delPlan': DB.plans = DB.plans.filter(x => x.id !== id); dbSave(); closeModal(); render(); break;
      case 'rep': ST.rep = Number(v); render(); break;
      case 'csv': exportCsv(); break;
      case 'inc': ST.inc = v === 'm' ? 'm' : Number(v); render(); break;
      case 'csvinc': exportIncomeCsv(); break;
      case 'tlMove': ST.tl = v === '0' ? today() : addDays(ST.tl || today(), Number(v)); render(); break;
      case 'close': closeModal(); break;
      case 'room': roomSheet(id); break;
      case 'hk': { const r = roomById(id); r.hk = v; dbSave(); render(); roomSheet(id); break; }
      case 'editRoom': editRoom(id); break;
      case 'saveRoom': saveRoom(id); break;
      case 'delRoom': delRoom(id); break;
      case 'addRooms': addRoomsForm(); break;
      case 'saveRooms': saveRooms(); break;
      case 'editType': typeForm(id || null); break;
      case 'saveType': saveType(id || null); break;
      case 'delType': delType(id); break;
      case 'saveSettings': saveSettings(); break;
      case 'amTog': t.classList.toggle('on'); { const bx = t.closest('.ht-am'); if (bx) amKeep(bx.id); } break;
      case 'amAdd': amAdd(id); break;
      case 'slabReset': { const set = (k, v) => { const e = document.getElementById(k); if (e) e.value = v; }; set('ht-s-t1', 1000); set('ht-s-r1', 0); set('ht-s-t2', 7500); set('ht-s-r2', 5); set('ht-s-r3', 18); toast('Standard rule filled in — press Save'); break; }
      case 'rzSave': case 'rzTest': case 'rzOff': rzAct(a, t); break;
      case 'rzOnline': DB.settings.pay = Object.assign({}, DB.settings.pay || {}, { online: !!t.checked }); dbSave(); toast(t.checked ? 'Guests can pay online' : 'Online payment hidden'); break;
      case 'openLink': try { CafeLink.open(); } catch (e) { toast('Linking isn’t available on this screen'); } break;
      case 'dining': {
        const on = !!(t.checked); ST.dining = on;
        apiSend('PUT', '/hotel/settings', { room_dining: on }).then(() => toast(on ? 'Guests can now order from their room QR' : 'Room QR is call-only now'))
          .catch(e => { ST.dining = !on; t.checked = !on; toast((e && e.message) || 'Couldn’t change it'); });
        break;
      }
      case 'makeQr': makeQr([id]); break;
      case 'roomQrs': makeQr(DB.rooms.map(r => r.id)); break;
      case 'showQr': closeModal(); try { TableCards.open(Number(id)); } catch (e) { toast('Open the Orders tab and tap the room’s card'); } break;
      case 'newBooking': if (needsSetup()) return; bookingForm(null, { roomId: t.dataset.room, date: t.dataset.date }); break;
      case 'editBooking': bookingForm(id); break;
      case 'saveBooking': saveBooking(id || null); break;
      case 'booking': bookingSheet(id); break;
      case 'checkIn': checkIn(id); break;
      case 'cancelAsk': cancelAsk(id); break;
      case 'doCancel': doCancel(id, v); break;
      case 'noShow': { const b = bookingById(id); b.status = 'noshow'; dbSave(); closeModal(); render(); break; }
      case 'folio': folioView(id); break;
      case 'quick': { const d = $('#ht-c-desc', modal); if (d) { d.value = v; const a2 = $('#ht-c-amt', modal); if (a2) a2.focus(); } break; }
      case 'addCharge': addCharge(id); break;
      case 'delCharge': delCharge(id, t.dataset.c); break;
      case 'setDisc': setDisc(id); break;
      case 'addPay': addPay(id); break;
      case 'postOrders': postOrders(id); break;
      case 'checkOut': checkOut(id); break;
      case 'printInv': printInvoice(id); break;
      case 'backup': backup(); break;
      case 'restore': { const f = $('#ht-restore', host); if (f) f.click(); break; }
    }
  }
  function onClick(e) {
    if (modal && e.target === modal) { closeModal(); return; }
    const t = e.target.closest('[data-h]'); if (!t) return;
    if (!t.closest('#view-hotel') && !t.closest('#ht-modal')) return;
    if (t.disabled) return;
    act(t.dataset.h, t);
  }
  function onChange(e) {
    if (e.target.id === 'ht-file' && e.target.files && e.target.files[0]) {
      const file = e.target.files[0], tgt = ST.docTarget; e.target.value = ''; toast('Uploading…');
      uploadDoc(file).then(newId => {
        const old = tgt === 'p' ? ST.pdoc : (ST.people[tgt] || {}).idDocId;
        if (tgt === 'p') { ST.pdoc = newId; drawPrimary(); } else if (ST.people[tgt]) { ST.people[tgt].idDocId = newId; drawPeople(); }
        if (old && old !== newId) apiSend('DELETE', '/hotel/id-docs/' + old).catch(() => {});
        toast('ID photo attached');
      }).catch(er => toast((er && er.message) || 'Couldn’t upload that photo'));
      return;
    }
    if (e.target.dataset && e.target.dataset.pi !== undefined && ST.people[+e.target.dataset.pi]) { ST.people[+e.target.dataset.pi][e.target.dataset.pf] = e.target.value; return; }
    if (e.target.classList && e.target.classList.contains('ht-bu-dow')) { e.target.parentNode.classList.toggle('on', e.target.checked); return; }
    if (e.target.id === 'ht-restore' && e.target.files && e.target.files[0]) { restoreFile(e.target.files[0]); e.target.value = ''; return; }
    if (modal && modal.contains(e.target) && ['ht-b-type', 'ht-b-ci', 'ht-b-co', 'ht-b-plan', 'ht-b-src'].indexOf(e.target.id) >= 0) {
      if (e.target.id === 'ht-b-ci') { const co = $('#ht-b-co', modal); if (co.value <= e.target.value) co.value = addDays(e.target.value, 1); }
      autoRate();
    }
  }
  function onInput(e) {
    if (e.target.dataset && e.target.dataset.pi !== undefined && ST.people[+e.target.dataset.pi]) { ST.people[+e.target.dataset.pi][e.target.dataset.pf] = e.target.value; return; }
    if (e.target.id === 'ht-b-rate') { ST.rateTouched = true; refreshBookingForm(); } }

  /* ---------------------------------------------------------------- mount */
  const BED = '<svg class="nav-icon" width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.5"/></svg>';
  function mountCommon() {
    injectCss();
    modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'ht-modal';
    document.body.appendChild(modal);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', e => { const i = e.target; if (e.key === 'Enter' && i && i.id && /-new$/.test(i.id) && i.closest && i.closest('.ht-am')) { e.preventDefault(); amAdd(i.id.replace(/-new$/, '')); } });
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
  }
  const g_role = () => { try { return typeof role !== 'undefined' ? role : null; } catch (e) { return null; } };
  function mountHotel() {
    dbLoad();
    dbSync();
    try { if (typeof apiGet === 'function' && role === 'owner') apiGet('/hotel/settings').then(r => { ST.dining = !!r.room_dining; if (ST.tab === 'setup') render(); }).catch(() => {}); } catch (e) { /* */ }
    const main = document.querySelector('main'); if (!main) return;
    host = document.createElement('section'); host.id = 'view-hotel'; host.style.display = 'none';
    host.innerHTML = '<div class="page-head"><div><h1>Hotel</h1><p>Rooms, bookings and guest bills.</p></div></div><div id="ht-body"></div>';
    main.appendChild(host);
    try { if (typeof ALL_VIEWS !== 'undefined' && ALL_VIEWS.indexOf('hotel') < 0) ALL_VIEWS.push('hotel'); } catch (e) { /* */ }
    const nav = document.querySelector('nav.bottom-nav'), after = nav && nav.querySelector('button[data-view="calls"]');
    const btns = {};
    if (nav) {
      let prev = after;
      TABS.forEach(t => {
        const b = document.createElement('button'); b.dataset.view = 'hotel-' + t[0]; btns[t[0]] = b;
        b.innerHTML = '<span class="nav-icon-wrap">' + svgFor(t[0]) + '</span><span>' + t[1] + '</span>' + (t[0] === 'bookings' ? '<span class="nav-badge" id="badge-hbk" style="display:none;">0</span>' : '');
        nav.insertBefore(b, prev ? prev.nextSibling : nav.querySelector('.nav-cursor')); prev = b;
        b.addEventListener('click', () => {
          nav.querySelectorAll('button[data-view]').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          try { moveNavCursorTo(b); } catch (e) { /* */ }
          ST.tab = t[0]; showView('hotel'); render();
        });
      });
      const wb = document.createElement('button'); wb.dataset.view = 'hotel-website'; btns.website = wb;
      wb.innerHTML = '<span class="nav-icon-wrap"><svg class="nav-icon" width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg></span><span>Website</span>';
      nav.insertBefore(wb, prev.nextSibling);
      wb.addEventListener('click', () => { try { AboutStudio.open(); } catch (e) { toast('The website builder isn’t available on this screen'); } });   // opens full screen; the nav stays where it was
      try { compactNav(nav, btns); } catch (e) { /* the full bar still works */ }
      const act0 = nav.querySelector('button[data-view].active');
      requestAnimationFrame(() => { try { if (act0) moveNavCursorTo(act0); } catch (e) { /* */ } });
    }
    loadEnq(); setInterval(loadEnq, 30000);
    document.body.classList.add('is-hotel');
    const allowed = () => g_role() === 'owner' || (typeof can === 'function' && (can('billing') || can('calls') || can('order_alerts')));
    const sync = () => {
      Object.keys(btns).forEach(k => { btns[k].style.display = allowed() && (k !== 'dining' || LK.linked) ? '' : 'none'; });
      const c = cafeObj(); document.body.classList.remove('hotel-dining');   // Orders and Menu belong to a linked restaurant account, never to the hotel account itself
    };
    syncDiningTab = sync; sync(); setInterval(sync, 3000);
    loadLink(); setInterval(loadLink, 20000);
    setInterval(() => { if (host.style.display !== 'none' && !modal.classList.contains('show')) render(); }, 4000);   // keep room-service badges live
    render();
  }

  /* A hotel's bottom bar had nine tabs squeezed in. Keep the everyday ones (Calls, Rooms, Bookings, Billing) and
     tuck the rest behind a "More" button that opens a tidy sheet. The tabs themselves are untouched — the sheet just presses them. */
  function compactNav(nav, btns) {
    const st = document.createElement('style');
    st.textContent = 'body.is-hotel nav.bottom-nav button.ht-in-more{display:none!important}' +
      '.ht-more-btn{all:unset;box-sizing:border-box;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:10.5px;font-weight:600;color:var(--text-secondary);cursor:pointer;position:relative;z-index:1;min-height:48px;padding:6px 2px}' +
      '.ht-more-btn.active{color:var(--teal)}.ht-more-btn .nav-icon-wrap{display:flex;align-items:center;justify-content:center;width:34px;height:28px;border-radius:12px}.ht-more-btn.active .nav-icon-wrap{background:var(--teal-soft)}' +
      '.ht-more-bd{position:fixed;inset:0;z-index:44;background:rgba(15,17,22,.35)}' +
      '.ht-more-sheet{position:fixed;left:0;right:0;bottom:calc(var(--bottom-nav-h) + var(--safe-bottom));z-index:45;background:var(--paper);border-radius:20px 20px 0 0;padding:16px 14px 18px;box-shadow:0 -12px 40px -16px rgba(0,0,0,.35);display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-height:60vh;overflow-y:auto}' +
      '.ht-more-it{all:unset;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 6px;border-radius:14px;background:var(--canvas,#f4f4f1);color:var(--ink,#171a21);font-size:12.5px;font-weight:600;cursor:pointer;text-align:center;min-height:76px;justify-content:center}' +
      '.ht-more-it.active{background:var(--teal-soft);color:var(--teal)}.ht-more-it svg{width:22px;height:22px}' +
      '@media(min-width:1100px){.ht-more-btn{display:none}body.is-hotel nav.bottom-nav button.ht-in-more{display:flex!important}}';
    document.head.appendChild(st);
    ['rates', 'dining', 'setup', 'website'].forEach(k => { if (btns[k]) btns[k].classList.add('ht-in-more'); });
    ['orders', 'menu'].forEach(v => { const b = nav.querySelector('button[data-view="' + v + '"]'); if (b) b.classList.add('ht-in-more'); });
    const more = document.createElement('button'); more.type = 'button'; more.className = 'ht-more-btn'; more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false');
    more.innerHTML = '<span class="nav-icon-wrap"><svg class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg></span><span>More</span>';
    nav.insertBefore(more, nav.querySelector('.nav-cursor'));
    const label = b => { const k = [].slice.call(b.children).filter(c => !c.classList.contains('nav-icon-wrap') && !c.classList.contains('nav-badge')).pop(); return k ? k.textContent.trim() : ''; };
    let bd = null, sheet = null;
    const close = () => { if (bd) bd.remove(); if (sheet) sheet.remove(); bd = sheet = null; more.setAttribute('aria-expanded', 'false'); };
    const open = () => {
      const items = [].slice.call(nav.querySelectorAll('button.ht-in-more'));
      items.forEach(b => b.classList.remove('ht-in-more'));                      // measure what this account may really see
      const shown = items.filter(b => getComputedStyle(b).display !== 'none');
      items.forEach(b => b.classList.add('ht-in-more'));
      if (!shown.length) return;
      bd = document.createElement('div'); bd.className = 'ht-more-bd'; bd.addEventListener('click', close);
      sheet = document.createElement('div'); sheet.className = 'ht-more-sheet'; sheet.setAttribute('role', 'menu');
      shown.forEach(b => {
        const t = document.createElement('button'); t.type = 'button'; t.className = 'ht-more-it' + (b.classList.contains('active') ? ' active' : ''); t.setAttribute('role', 'menuitem');
        const ic = b.querySelector('.nav-icon-wrap'); t.innerHTML = (ic ? ic.innerHTML : '') + '<span>' + label(b).replace(/[<>&]/g, '') + '</span>';
        t.addEventListener('click', () => { close(); b.click(); });
        sheet.appendChild(t);
      });
      document.body.appendChild(bd); document.body.appendChild(sheet); more.setAttribute('aria-expanded', 'true');
    };
    more.addEventListener('click', () => { if (sheet) close(); else open(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const syncActive = () => {
      const on = !!nav.querySelector('button.ht-in-more.active');
      if (more.classList.contains('active') !== on) {
        more.classList.toggle('active', on);
        if (on) { try { moveNavCursorTo(more); } catch (e) { /* */ } }
      } else if (on) { try { moveNavCursorTo(more); } catch (e) { /* */ } }
    };
    new MutationObserver(syncActive).observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
    syncActive();
  }
  function start() {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const c = cafeObj();
      const known = g_role() === 'owner' || (typeof permsKnown === 'function' && permsKnown());
      if (c && c.id != null && known) {
        clearInterval(iv);
        if (ready) return; ready = true;
        mountCommon();
        const type0 = bizType();
        if (type0 === 'hotel') mountHotel();
        // The first paint can come from the last visit. If the server then says this account is the other kind
        // (hotel ↔ café), rebuild once so the right bar shows without a manual refresh.
        const watch = setInterval(() => {
          const c = cafeObj(), t = bizType();
          if (!c || c.id == null || t === type0) return;
          clearInterval(watch);
          try { const tag = String(c.id) + ':' + t; if (sessionStorage.getItem('ht-rebuilt') === tag) return; sessionStorage.setItem('ht-rebuilt', tag); } catch (e) { return; }
          location.reload();
        }, 1500);
      } else if (tries > 240) clearInterval(iv);
    }, 400);
  }

  function siteInfo() {
    if (!DB) return null;
    const have = {}; DB.rooms.forEach(r => { if (r.hk !== 'blocked') have[r.typeId] = 1; });
    return { types: DB.types.filter(t => have[t.id]).map(t => ({ id: t.id, name: t.name, capacity: t.capacity || 2, desc: t.desc || '', rate: num(t.rate) })), halls: (DB.halls || []).map(x => ({ id: x.id, name: x.name, capacity: x.capacity, desc: x.desc || '', price: num(x.price) })) };
  }
  root.Hotel = { siteInfo: siteInfo, render: render, calc: calc, __debug: { db: () => DB, ST: ST, ordersForRoom: ordersForRoom, orderWhere: orderWhere } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
