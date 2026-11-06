/* bt-print.js — direct Bluetooth printing for receipts and kitchen tickets.
 *
 * Loaded the same way analytics.js and table-cards.js are: a plain
 * <script src="bt-print.js">, no build step, attaches itself as window.BtPrint.
 *
 * WHAT THIS ACTUALLY DOES, AND WHY IT'S SAFE TO SHIP EVEN WITHOUT KNOWING THE
 * EXACT PRINTER MODEL IN ADVANCE:
 *
 * Most budget ESC/POS thermal printers (the Everycom EC58B included) use
 * "classic" Bluetooth, not Bluetooth Low Energy — and the Web Bluetooth API
 * (the only way a website can talk to a Bluetooth device directly, with no
 * app, no OS print dialog) can ONLY reach BLE devices. This is a hard limit
 * of the web platform, not something any amount of code here can work around.
 *
 * So this module tries the BLE path first. If the printer is BLE-capable, it
 * connects directly and prints with minimum friction — pick it once, and
 * every print after that reconnects silently, no picker, no dialog. If the
 * printer is classic Bluetooth (the likely case for this exact printer), the
 * BLE connection attempt fails quickly and cleanly, and printBill/printKot
 * fall back to the existing, already-working hidden-iframe + window.print()
 * flow — the same one already fixed for the Android browser-chooser bug.
 * Nothing about that existing path is removed; this only adds a better path
 * on top of it, for whatever hardware can actually use it.
 *
 * HOW TO CONFIRM (OR CORRECT) THE GATT IDs BELOW FOR A SPECIFIC PRINTER:
 * Open bluetooth-test.html (given separately), scan, and if the printer is
 * found, note the service/characteristic UUIDs Chrome reports. The ones below
 * are the single most common pairing used by generic/clone ESC/POS BLE
 * thermal printer modules — correct for a large share of them, but not
 * universal. If a specific printer turns out to use different ones, this is
 * a two-line change (PRINT_SERVICE_UUIDS / writeCharacteristic below), not a
 * rewrite.
 */
(function (root) {
  'use strict';

  // Tried in order — the most common generic BLE thermal-printer GATT service first.
  const PRINT_SERVICE_UUIDS = [
    '000018f0-0000-1000-8000-00805f9b34fb',  // the de-facto standard used by most generic/clone ESC/POS BLE printers
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',   // a second common one (Microchip/various OEM modules)
  ];
  const WRITE_CHARACTERISTIC_UUIDS = [
    '00002af1-0000-1000-8000-00805f9b34fb',
    '49535343-8841-43f4-a8d4-ecbe34729bb3',
  ];

  const DB_KEY = 'xyzzy_bt_printer_v1';   // remembers which device to reconnect to silently

  function rememberedId() {
    try { return localStorage.getItem(DB_KEY) || null; } catch (e) { return null; }
  }
  function remember(id) {
    try { localStorage.setItem(DB_KEY, id); } catch (e) { /* private mode etc — just skip remembering */ }
  }
  function forget() {
    try { localStorage.removeItem(DB_KEY); } catch (e) { /* ignore */ }
  }

  function supported() {
    return !!(root.navigator && root.navigator.bluetooth);
  }

  /* ---- Native path (the real Android app) ----
     Classic Bluetooth SPP via BtThermalPrinterPlugin — this is the actual working path
     for this printer (confirmed: it never showed up in a Web Bluetooth BLE scan, so it's
     Classic-only). Tried FIRST, before Web Bluetooth, whenever the app is running natively.
     Falls through to Web Bluetooth, then the print dialog, exactly as before if this
     isn't available or doesn't find anything. */
  const NATIVE_DB_KEY = 'xyzzy_bt_printer_native_v1';

  // The chosen printer is stored as {address, name}. (An earlier version stored just the
  // address string — still read correctly, name just shows as a generic label until re-chosen.)
  function nativeSavedPrinter() {
    try {
      const raw = localStorage.getItem(NATIVE_DB_KEY);
      if (!raw) return null;
      if (raw.charAt(0) === '{') { const p = JSON.parse(raw); return p && p.address ? p : null; }
      return { address: raw, name: 'Saved printer' };
    } catch (e) { return null; }
  }
  function nativeSavePrinter(device) {
    try { localStorage.setItem(NATIVE_DB_KEY, JSON.stringify({ address: device.address, name: device.name })); } catch (e) { /* ignore */ }
  }
  function nativeForget() {
    try { localStorage.removeItem(NATIVE_DB_KEY); } catch (e) { /* ignore */ }
  }
  function nativePlugin() {
    return (root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform() && root.Capacitor.Plugins)
      ? root.Capacitor.Plugins.BtThermalPrinter : null;
  }
  function nativeSupported() {
    return !!nativePlugin();
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return root.btoa(binary);
  }

  // Logged + toasted at each step so a failure always says WHERE and WHY, never silence.
  function nativeLog(msg) {
    try { console.log('[BtPrint]', msg); } catch (e) {}
    try { if (typeof showToast === 'function') showToast(msg); } catch (e) {}
  }

  // Races a promise against a deadline so no step can ever hang silently.
  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label + ' timed out')), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  async function nativeEnsurePermission(plugin) {
    const perm = await withTimeout(plugin.checkPermissions(), 8000, 'Permission check');
    if (perm.granted) return true;
    nativeLog('Allow Bluetooth access when asked…');
    const req = await withTimeout(plugin.requestPermissions(), 60000, 'Permission request');   // a person has to tap Allow
    return !!req.granted;
  }

  /** Paired devices, likely printers first. The person picks — this never chooses for them. */
  async function nativeListPrinters() {
    const plugin = nativePlugin();
    if (!plugin) return { devices: [], bluetoothEnabled: false, error: 'Not available here' };
    try {
      if (!(await nativeEnsurePermission(plugin))) return { devices: [], bluetoothEnabled: true, error: 'Bluetooth permission was not granted' };
      const res = await withTimeout(plugin.listPrinters(), 8000, 'Listing devices');
      return { devices: res.devices || [], bluetoothEnabled: res.bluetoothEnabled !== false };
    } catch (e) {
      return { devices: [], bluetoothEnabled: true, error: e.message || 'Could not list devices' };
    }
  }

  async function nativeOpenBluetoothSettings() {
    const plugin = nativePlugin();
    if (!plugin) return false;
    try { await plugin.openBluetoothSettings(); return true; } catch (e) { return false; }
  }

  /** Sends raw bytes to one specific printer. Resolves true, or throws with the real reason. */
  async function nativeSendTo(address, bytes) {
    const plugin = nativePlugin();
    // Up to two 9-second connection attempts happen natively (standard, then the documented
    // fallback), plus the print itself — so this ceiling must comfortably exceed that, or the
    // person would only ever see a generic timeout instead of the real error.
    await withTimeout(plugin.printBytes({ address, bytesBase64: bytesToBase64(bytes) }), 35000, 'Printing');
    return true;
  }

  /** A tiny slip confirming the right device was chosen — so a wrong pick shows up
   *  immediately at setup, not later in the middle of a real bill. */
  async function nativeTestPrint(device) {
    const e = encoder().init().align('center').bold(true).line('PRINTER CONNECTED').bold(false)
      .line(device.name || '').line('--------------------------------')
      .line('Bills will print here.').feed(3).cut();
    return nativeSendTo(device.address, e.build());
  }

  /** The printer to use: the saved one, or — first time only — whatever the person picks in the
   *  app's own printer list (dashboard.html provides pickPrinterNative). Never guesses. */
  async function nativeEnsurePrinter() {
    const saved = nativeSavedPrinter();
    if (saved) return saved;
    if (typeof root.pickPrinterNative === 'function') return await root.pickPrinterNative();
    return null;
  }

  async function nativePrintBytes(bytes) {
    const plugin = nativePlugin();
    if (!plugin) { nativeLog('Native printing not available here'); return false; }
    try {
      if (!(await nativeEnsurePermission(plugin))) { nativeLog('Bluetooth permission was not granted'); return false; }
      const printerChoice = await nativeEnsurePrinter();
      if (!printerChoice) { nativeLog('No printer chosen yet'); return false; }
      nativeLog('Connecting to ' + printerChoice.name + '…');
      await nativeSendTo(printerChoice.address, bytes);
      nativeLog('Printed');
      return true;
    } catch (e) {
      // The REAL reason, from the device layer — e.g. "Couldn't connect to "X" (read failed, socket
      // might closed or timeout…). Make sure it's switched on…" — not a generic timeout.
      nativeLog(e.message || 'Could not print');
      return false;   // falls through to Web Bluetooth / the print dialog
    }
  }

  /* ---- ESC/POS command building ----
     Plain-text receipt rendering: center/left alignment, bold, a cut at the end.
     Deliberately simple — these printers render raw text directly, no layout engine
     needed beyond basic ESC/POS control codes. */
  const ESC = 0x1b, GS = 0x1d;
  function encoder() {
    const chunks = [];
    return {
      raw(bytes) { chunks.push(new Uint8Array(bytes)); return this; },
      text(s) { chunks.push(new TextEncoder().encode(s)); return this; },
      line(s) { return this.text((s || '') + '\n'); },
      align(a) { return this.raw([ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0]); },
      bold(on) { return this.raw([ESC, 0x45, on ? 1 : 0]); },
      feed(n) { return this.raw([ESC, 0x64, n || 3]); },
      cut() { return this.raw([GS, 0x56, 1]); },
      init() { return this.raw([ESC, 0x40]); },
      build() {
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
      },
    };
  }

  function rupee(n) { return 'Rs ' + Math.round(n); }   // the rupee glyph itself doesn't exist in most thermal printer fonts
  function row(left, right, width) {
    width = width || 32;   // 32 chars is standard for a 58mm printer at normal font size
    const gap = Math.max(1, width - left.length - right.length);
    return left + ' '.repeat(gap) + right;
  }


  /* ---- Tax-invoice bill (the "Tax invoice" bill format in Profile) ----
     Same sections as the owner's old eZo bill: business details, bill number and date, items with
     Qty / Rate / Total, Sub Total, CGST + SGST, Total, how it was paid. A detail the owner left blank
     is simply not printed. */
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const m2 = n => r2(n).toFixed(2);
  const pad2 = n => String(n).padStart(2, '0');
  function fmtDate(d) { d = new Date(d); return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2); }
  function fmtTime(d) { d = new Date(d); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return pad2(h) + ':' + pad2(d.getMinutes()) + ' ' + ap; }
  function wrapText(t, w) {
    const out = []; let cur = '';
    String(t || '').split(/\s+/).filter(Boolean).forEach(word => {
      while (word.length > w) { if (cur) { out.push(cur); cur = ''; } out.push(word.slice(0, w)); word = word.slice(w); }
      if (!cur) cur = word; else if ((cur + ' ' + word).length <= w) cur += ' ' + word; else { out.push(cur); cur = word; }
    });
    if (cur) out.push(cur);
    return out;
  }
  /* The numbers on a tax invoice. When the bill has only GST (no discount, service charge or points), each
     line's Total includes its GST - exactly like the old bill - and the lines add up to the bill total.
     With a discount / service charge / points on the bill, lines stay plain rate x qty and add up to the Sub Total. */
  function taxModel(bill) {
    const g = Number(bill.gst_percent) || 0, gst = Number(bill.gst_amount) || 0;
    const plain = !(Number(bill.discount_amount) || Number(bill.service_charge_amount) || Number(bill.packaging_fee_amount) || Number(bill.loyalty_points_used));
    const lines = (bill.items || []).map(i => ({ name: String(i.name || ''), qty: Number(i.quantity) || 1, rate: Number(i.price_at_order) || 0 }));
    lines.forEach(l => { l.plain = r2(l.rate * l.qty); l.total = l.plain; });
    let inclusive = false;
    if (g > 0 && plain && lines.length) {
      const inc = lines.map(l => r2(l.plain * (1 + g / 100)));
      const diff = r2(Number(bill.total) - inc.reduce((a, b) => a + b, 0));
      if (Math.abs(diff) < 0.05) { inc[inc.length - 1] = r2(inc[inc.length - 1] + diff); lines.forEach((l, k) => { l.total = inc[k]; }); inclusive = true; }
    }
    const cgst = r2(gst / 2), sgst = r2(gst - cgst);
    return { lines, inclusive, g, half: g / 2, cgst, sgst, hasGst: gst > 0 || g > 0,
             qtyTotal: lines.reduce((a, l) => a + l.qty, 0), itemCount: lines.length };
  }
  const payName = m => ({ cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other', online: 'Online' }[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Payment'));
  const pctText = p => (Math.round(p * 100) / 100) + '%';
  function businessLines(cafeName, prof) {
    const out = [];
    if (prof.address) out.push(...wrapText(prof.address, 32));
    if (prof.gst_no) out.push('GST Number: ' + prof.gst_no);
    if (prof.fssai) out.push('FSSAI Number: ' + prof.fssai);
    if (prof.license_no) out.push('License Number: ' + prof.license_no);
    if (prof.phone) out.push('Phone: ' + prof.phone);
    return out;
  }

  function buildTaxReceiptBytes(bill, cafeName, prof) {
    const D = '--------------------------------', t = taxModel(bill);
    const e = encoder().init().align('center');
    if (cafeName) e.bold(true).line(cafeName).bold(false);
    businessLines(cafeName, prof).forEach(l => e.line(l));
    e.line(D).align('left');
    if (bill.bill_no) e.line('Bill No: ' + bill.bill_no);
    e.line('Bill Date: ' + fmtDate(bill.paid_at));
    if (bill.first_order_at) e.line('Created On: ' + fmtDate(bill.first_order_at) + ' ' + fmtTime(bill.first_order_at));
    if (bill.customer_name) e.line('Bill To: ' + bill.customer_name);
    e.line(bill.table_label ? bill.table_label : (bill.table_number ? 'Table: ' + bill.table_number : 'Walk-in')).line(D);
    const cols = (n, q, r, tt) => n.padEnd(12) + ' ' + String(q).padStart(3) + ' ' + String(r).padStart(6) + ' ' + String(tt).padStart(8);
    e.bold(true).line(cols('Item Name', 'Qty', 'Rate', 'Total')).bold(false);
    t.lines.forEach(l => {
      const nm = wrapText(l.name.replace(/\s*·\s*/g, ' - '), 12);   // thermal fonts have no middle dot
      e.line(cols(nm[0] || '', l.qty, m2(l.rate), m2(l.total)));
      nm.slice(1).forEach(x => e.line(x));
    });
    e.line(D).line('Total Items: ' + t.itemCount).line('Total Quantity: ' + t.qtyTotal)
      .line(row('Sub Total', m2(bill.subtotal)));
    if (Number(bill.discount_amount)) e.line(row('Discount', '-' + m2(bill.discount_amount)));
    if (Number(bill.service_charge_amount)) e.line(row('Service charge', m2(bill.service_charge_amount)));
    if (Number(bill.packaging_fee_amount)) e.line(row('Packaging fee', m2(bill.packaging_fee_amount)));
    if (t.hasGst) {
      e.line(row('CGST (' + pctText(t.half) + ')', m2(t.cgst))).line(row('SGST (' + pctText(t.half) + ')', m2(t.sgst)));
    }
    e.line(D).bold(true).line(row('Total', m2(bill.total))).bold(false).line(D);
    (bill.payments || []).forEach(p => e.line(row(payName(p.method), m2(p.amount))));
    if (bill.credit && Number(bill.credit.amount)) e.line(row('On credit', m2(bill.credit.amount))).line('(' + (bill.credit.name || 'pay later') + ')');
    if (prof.footer) e.line(D).align('center').line(prof.footer);
    e.feed(3).cut();
    return e.build();
  }

  function buildReceiptBytes(bill, cafeName, prof) {
    if (prof && prof.v === 2 && root.BillDesign) return root.BillDesign.toEscpos(bill, cafeName, prof);   // the owner's own bill design (bill-design.js)
    if (prof && prof.layout === 'tax') return buildTaxReceiptBytes(bill, cafeName, prof);
    const e = encoder().init().align('center').bold(true).line(cafeName || '').bold(false)
      .line(bill.table_label ? bill.table_label : (bill.table_number ? 'Table ' + bill.table_number : 'Walk-in'))
      .line('--------------------------------').align('left');
    (bill.items || []).forEach(i => {
      e.line(row(i.name + ' x' + i.quantity, rupee(i.price_at_order * i.quantity)));
    });
    e.line('--------------------------------')
      .line(row('Subtotal', rupee(bill.subtotal)));
    if (bill.discount_amount) e.line(row('Discount', '-' + rupee(bill.discount_amount)));
    if (bill.service_charge_amount) e.line(row('Service charge', rupee(bill.service_charge_amount)));
    if (bill.packaging_fee_amount) e.line(row('Packaging fee', rupee(bill.packaging_fee_amount)));
    if (bill.gst_amount) e.line(row('GST (' + bill.gst_percent + '%)', rupee(bill.gst_amount)));
    e.line('--------------------------------').bold(true)
      .line(row('Total', rupee(bill.total))).bold(false)
      .line('--------------------------------');
    const payLabel = m => ({ cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other', online: 'Online' }[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Payment'));
    (bill.payments || []).forEach(p => e.line(payLabel(p.method) + ': ' + rupee(p.amount)));
    if (bill.credit && Number(bill.credit.amount)) e.line('On credit: ' + rupee(bill.credit.amount) + (bill.credit.name ? ' (' + bill.credit.name + ')' : ''));
    e.line('--------------------------------').align('center')
      .line(new Date(bill.paid_at).toLocaleString()).feed(3).cut();
    return e.build();
  }

  function buildKotBytes(o, where, tables) {
    const fmt = d => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const e = encoder().init().align('center').bold(true).line('KOT').bold(false)
      .line(where).line('Order #' + o.id + '  ' + fmt(o.created_at))
      .line('--------------------------------').align('left').bold(true);
    (o.items || []).forEach(i => e.line((Number(i.quantity) || 1) + 'x  ' + i.name));
    e.bold(false);
    if (o.note) e.line('--------------------------------').line('NOTE: ' + o.note);
    e.line('--------------------------------').align('center').feed(3).cut();
    return e.build();
  }

  /* ---- Connection ---- */
  let cachedDevice = null, cachedChar = null;

  async function findWriteCharacteristic(server) {
    for (const svcId of PRINT_SERVICE_UUIDS) {
      try {
        const svc = await server.getPrimaryService(svcId);
        for (const charId of WRITE_CHARACTERISTIC_UUIDS) {
          try { return await svc.getCharacteristic(charId); } catch (e) { /* try the next characteristic id */ }
        }
      } catch (e) { /* this service isn't on this device — try the next one */ }
    }
    return null;
  }

  async function connect(forcePicker) {
    if (!supported()) return null;
    try {
      let device;
      if (!forcePicker && root.navigator.bluetooth.getDevices) {
        // Chrome's persistent-permission reconnect — the whole point of
        // "pick it once, it just prints after that": no picker shown at all here.
        const known = await root.navigator.bluetooth.getDevices();
        const id = rememberedId();
        device = known.find(d => d.id === id);
      }
      if (!device) {
        device = await root.navigator.bluetooth.requestDevice({
          filters: [{ services: PRINT_SERVICE_UUIDS }],
          optionalServices: PRINT_SERVICE_UUIDS,
        });
        remember(device.id);
      }
      const server = await device.gatt.connect();
      const char = await findWriteCharacteristic(server);
      if (!char) return null;
      cachedDevice = device; cachedChar = char;
      return char;
    } catch (e) {
      return null;   // no BLE printer found/selected, or it's classic Bluetooth — caller falls back
    }
  }

  async function writeInChunks(char, bytes) {
    // BLE write packets are small — most stacks cap around 180-240 bytes per write.
    const CHUNK = 180;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      await char.writeValue(bytes.slice(i, i + CHUNK));
    }
  }

  /**
   * Prints a bill receipt directly over BLE. Resolves true if it actually printed
   * this way; false means the caller should fall back to the dialog-based print.
   */
  async function printReceipt(bill, cafeName, prof) {
    if (nativeSupported()) {
      const bytes = buildReceiptBytes(bill, cafeName, prof);
      if (await nativePrintBytes(bytes)) return true;
      // native path exists but didn't work this time (no printer found, permission
      // refused, etc.) — still worth trying Web Bluetooth/the dialog below rather
      // than giving up immediately.
    }
    try {
      const char = cachedChar || await connect(false);
      if (!char) return false;
      await writeInChunks(char, buildReceiptBytes(bill, cafeName, prof));
      return true;
    } catch (e) {
      cachedChar = null;   // the connection may have dropped — don't reuse a dead handle next time
      return false;
    }
  }

  async function printKotTicket(order, where) {
    if (nativeSupported()) {
      const bytes = buildKotBytes(order, where);
      if (await nativePrintBytes(bytes)) return true;
    }
    try {
      const char = cachedChar || await connect(false);
      if (!char) return false;
      await writeInChunks(char, buildKotBytes(order, where));
      return true;
    } catch (e) {
      cachedChar = null;
      return false;
    }
  }

  /** Explicit "choose a printer" action for the profile button. In the app this opens the
   *  printer list; on the website it uses the Web Bluetooth picker. */
  async function choosePrinter() {
    if (nativeSupported()) {
      if (typeof root.pickPrinterNative !== 'function') return false;
      const chosen = await root.pickPrinterNative();
      return !!chosen;
    }
    const char = await connect(true);
    return !!char;
  }

  root.BtPrint = {
    supported, nativeSupported, printReceipt, printKotTicket, choosePrinter,
    receiptPreview: (bill, name, prof) => { if (prof && prof.v === 2 && root.BillDesign) return root.BillDesign.toText(bill, name, prof); const b = Array.from(buildReceiptBytes(bill, name, prof)), keep = []; let i = 0; while (i < b.length) { const c = b[i]; if (c === 0x1b) { i += (b[i + 1] === 0x40 ? 2 : 3); continue; } if (c === 0x1d) { i += 3; continue; } keep.push(c); i++; } return new TextDecoder().decode(new Uint8Array(keep)); },
    taxModel, fmtDate, fmtTime, m2, payName, pctText, businessLines, buildReceiptBytes,
    forget: () => { forget(); nativeForget(); },   // clears BOTH the website and the app's remembered printer
    isRemembered: () => nativeSupported() ? !!nativeSavedPrinter() : !!rememberedId(),
    // used by the printer picker in dashboard.html
    nativeListPrinters, nativeSavePrinter, nativeSavedPrinter, nativeForget,
    nativeTestPrint, nativeOpenBluetoothSettings,
    savedPrinterName: () => { const p = nativeSupported() ? nativeSavedPrinter() : null; return p ? p.name : null; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
