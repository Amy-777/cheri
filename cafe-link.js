/* Hotel <-> restaurant link, from the app. Both account types get the same small dialog:
   "Your key" (copy it) + "Paste the other account's key". The link is live only once BOTH sides have pasted the other's key.
   Opened from: the profile menu (everyone), the hotel's Setup tab and Dining tab. */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => { try { (typeof showToast === 'function' ? showToast : alert)(m); } catch (e) { /* */ } };
  let ov = null, ST = null;

  function css() {
    if (document.getElementById('cl-css')) return;
    const s = document.createElement('style'); s.id = 'cl-css';
    s.textContent = '#cl-ov{position:fixed;inset:0;background:rgba(23,26,33,.55);display:none;align-items:center;justify-content:center;z-index:300;padding:16px}#cl-ov.show{display:flex}' +
      '.cl-card{width:100%;max-width:420px;max-height:90vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#1c1f26);border:1px solid var(--border,#e5e7eb);border-radius:20px;padding:22px 20px;box-shadow:0 24px 60px rgba(0,0,0,.35)}' +
      '.cl-card h3{margin:0 0 4px;font-size:18px}.cl-card p{margin:0 0 12px;font-size:13px;line-height:1.5;color:var(--text-secondary,#667085)}' +
      '.cl-lbl{font:700 11px/1 Inter,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--text-secondary,#667085);margin:14px 0 6px}' +
      '.cl-key{display:flex;gap:8px;align-items:center}.cl-key b{flex:1;font:700 20px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;padding:12px;border-radius:12px;background:var(--canvas,#f4f5f7);text-align:center}' +
      '.cl-card input{width:100%;box-sizing:border-box;font:600 16px ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;padding:12px;border-radius:12px;border:1px solid var(--border,#d0d5dd);background:var(--surface,#fff);color:inherit}' +
      '.cl-btn{border:0;cursor:pointer;font:600 14px Inter,sans-serif;padding:11px 16px;border-radius:12px;background:var(--amber,#d9822b);color:#fff}.cl-btn.ghost{background:var(--canvas,#f1f2f4);color:inherit}.cl-btn.danger{background:#fde8e8;color:#b42318}' +
      '.cl-row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}.cl-ok{margin:12px 0 0;padding:12px;border-radius:12px;background:#e7f6ec;color:#146c2e;font-size:13.5px;line-height:1.45}' +
      '.cl-wait{margin:12px 0 0;padding:12px;border-radius:12px;background:#fff6e0;color:#8a5a00;font-size:13px;line-height:1.45}.cl-err{margin:10px 0 0;color:#b42318;font-size:13px}';
    document.head.appendChild(s);
  }
  async function load() { try { ST = await apiGet('/link'); } catch (e) { ST = null; } return ST; }
  function view(msg) {
    if (!ov) { css(); ov = document.createElement('div'); ov.id = 'cl-ov'; document.body.appendChild(ov); ov.addEventListener('click', onClick); }
    ov.classList.add('show');
    if (!ST) { ov.innerHTML = '<div class="cl-card"><h3>Link accounts</h3><p>Couldn’t load right now — check your connection and try again.</p><div class="cl-row"><button class="cl-btn ghost" data-a="close">Close</button></div></div>'; return; }
    const hotel = ST.kind === 'hotel', other = hotel ? 'restaurant' : 'hotel';
    let status = '';
    if (ST.linked) status = '<div class="cl-ok"><b>Linked with ' + esc(ST.partner && ST.partner.name) + '.</b> ' + (hotel
      ? 'Guests who scan a room QR now see the restaurant’s menu, and their orders go to the restaurant’s kitchen. “Call Room Service” still rings your hotel staff.'
      : 'Guests of that hotel can order from your menu through their room QR. Those orders arrive on your Orders tab as “Hotel · Rm …”.') + '</div>';
    else if (ST.waiting) status = '<div class="cl-wait">You pasted the ' + other + '’s key. Now ask them to paste <b>your key</b> (above) in their account — it links the moment they do.</div>';
    const body = ST.linked
      ? '<div class="cl-row"><button class="cl-btn danger" data-a="unlink">Unlink</button><button class="cl-btn ghost" data-a="close">Close</button></div>'
      : '<div class="cl-lbl">Paste the ' + other + '’s key</div><input id="cl-in" placeholder="XXXX-XXXX" value="' + esc(ST.entered) + '" autocomplete="off" autocapitalize="characters">' +
        '<div class="cl-row"><button class="cl-btn" data-a="connect">Connect</button><button class="cl-btn ghost" data-a="close">Close</button></div>';
    ov.innerHTML = '<div class="cl-card"><h3>' + (hotel ? 'Link your restaurant' : 'Link a hotel') + '</h3>' +
      '<p>' + (hotel ? 'Own a restaurant or café on this app? Link it so room guests can order from its menu.' : 'Supply food to a hotel on this app? Link it so its room guests can order from your menu.') +
      ' Each account has a key — paste each key into the other account. The link works only when both have been pasted.</p>' +
      '<div class="cl-lbl">Your key — give it to the ' + other + '</div><div class="cl-key"><b>' + esc(ST.my_key) + '</b><button class="cl-btn ghost" data-a="copy">Copy</button></div>' +
      status + body + (msg ? '<div class="cl-err">' + esc(msg) + '</div>' : '') + '</div>';
  }
  async function onClick(e) {
    const t = e.target; if (t === ov) { ov.classList.remove('show'); return; }
    const a = t.dataset && t.dataset.a; if (!a) return;
    if (a === 'close') ov.classList.remove('show');
    else if (a === 'copy') { try { await navigator.clipboard.writeText(ST.my_key); toast('Key copied'); } catch (x) { toast('Select and copy the key'); } }
    else if (a === 'connect') {
      const v = (document.getElementById('cl-in') || {}).value || '';
      if (v.replace(/[^A-Za-z0-9]/g, '').length < 8) return view('Paste the full key (8 letters/digits).');
      t.disabled = true;
      try { ST = await apiSend('POST', '/link', { key: v }); view(); changed(); } catch (x) { t.disabled = false; view((x && x.message) || 'Couldn’t connect'); }
    } else if (a === 'unlink') {
      if (!confirm('Unlink? Room QRs go back to call-only, and new room orders stop reaching the restaurant.')) return;
      try { ST = await apiSend('DELETE', '/link'); view(); changed(); } catch (x) { view((x && x.message) || 'Couldn’t unlink'); }
    }
  }
  function changed() { try { document.dispatchEvent(new CustomEvent('cafelink:changed', { detail: ST })); } catch (e) { /* */ } }
  async function open() { await load(); view(); }

  function mount() {
    const anchor = document.getElementById('profile-staff-item');
    if (!anchor || document.getElementById('profile-link-item')) return;
    const b = document.createElement('button'); b.className = 'profile-menu-item'; b.id = 'profile-link-item';
    b.innerHTML = '<span class="item-icon-chip" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg></span><span class="item-label">Hotel / restaurant link</span><span class="item-chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>';
    b.addEventListener('click', () => { try { closeProfileMenu(); } catch (e) { /* */ } open(); });
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
    // owners only — staff don't manage links
    const hide = () => { try { b.style.display = (typeof role !== 'undefined' && role === 'owner') ? '' : 'none'; } catch (e) { /* */ } };
    hide(); setInterval(hide, 3000);
  }
  root.CafeLink = { open: open, load: load };
  const iv = setInterval(() => { if (document.getElementById('profile-staff-item')) { clearInterval(iv); mount(); } }, 500);
  setTimeout(() => clearInterval(iv), 60000);
})(window);
