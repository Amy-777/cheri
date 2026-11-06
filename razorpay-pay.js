/* razorpay-pay.js — "Pay online" for the cafe's own plan (first payment and renewals), Razorpay Standard Checkout.
 *
 * Loaded on dashboard.html after Razorpay's checkout.js. It adds a button to the existing payment screen (renderPaymentFlow); the UPI-screenshot
 * route underneath stays as the fallback. Flow: ask our server for an order (price is decided there) → open Razorpay's modal → send the three
 * values it returns to our server, which checks the signature before the plan is extended. No key secret ever reaches this file.
 */
(function () {
  'use strict';
  if (window.__rzpPayBound) return; window.__rzpPayBound = true;

  function setBusy(btn, on, label) { if (!btn) return; btn.disabled = on; if (label) btn.textContent = label; }
  const say = m => { try { showToast(m); } catch (e) { alert(m); } };

  async function payOnline(plan, period, btn) {
    const idle = btn ? btn.dataset.label : '';
    if (typeof Razorpay === 'undefined') return say('Online payment couldn’t load — check your connection, or pay by UPI below.');
    setBusy(btn, true, 'Starting…');
    let o;
    try { o = await apiSend('POST', '/subscription/razorpay/create-order', { plan: plan, period: period }); }
    catch (e) { setBusy(btn, false, idle); return say(e.message || 'Couldn’t start the payment — try again, or pay by UPI below.'); }
    let settled = false;
    const rz = new Razorpay({
      key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency, name: o.name, description: o.description,
      prefill: { name: o.prefill && o.prefill.name || '', email: o.prefill && o.prefill.email || '' },
      theme: { color: '#C2462F' },
      modal: { ondismiss: function () { if (!settled) { setBusy(btn, false, idle); say('Payment cancelled — you weren’t charged.'); } } },
      handler: async function (resp) {
        settled = true; setBusy(btn, true, 'Confirming…');
        try {
          const r = await apiSend('POST', '/subscription/razorpay/verify', {
            razorpay_payment_id: resp.razorpay_payment_id, razorpay_order_id: resp.razorpay_order_id, razorpay_signature: resp.razorpay_signature });
          activated(r.status);
        } catch (e) {
          setBusy(btn, false, idle);
          say((e.message || 'We couldn’t confirm the payment') + ' — if money was taken, it will be activated shortly or message us with your payment ID ' + (resp.razorpay_payment_id || ''));
        }
      },
    });
    rz.on('payment.failed', function (r) {
      const d = r && r.error && r.error.description ? r.error.description : 'The payment failed';
      say(d + '. You can try again.'); setBusy(btn, false, idle);
    });
    rz.open();
  }

  /* Same follow-up the activation-code route does, so the page unlocks without a reload. */
  function activated(st) {
    try {
      subStatus = st;
      if (typeof cafe !== 'undefined' && cafe) cafe.current_plan = st.current_plan;
      if (typeof applyPaywallState === 'function') applyPaywallState();
      const v = document.getElementById('view-subscription');
      if (v && v.style.display !== 'none' && typeof renderSubscriptionTab === 'function') renderSubscriptionTab();
      if (typeof renderTemplatesPanel === 'function') renderTemplatesPanel();
      if (typeof ensureSectionsLoaded === 'function') ensureSectionsLoaded();
      say('Payment received — you’re successfully subscribed!');
    } catch (e) { location.reload(); }
  }

  /* Add the button to the payment screen the dashboard already draws. */
  function wrap() {
    const orig = window.renderPaymentFlow;
    if (typeof orig !== 'function' || orig.__rzp) return;
    const w = function (container, plan, blocking, period) {
      orig.apply(this, arguments);
      try {
        const p = period || 'monthly', info = typeof PLAN_INFO !== 'undefined' ? PLAN_INFO[plan] : null;
        const amount = info ? (p === 'annual' && info.annualTotal ? info.annualTotal : info.amount) : '';
        const step = container.querySelector('#pay-step-1'); if (!step) return;
        const box = document.createElement('div'); box.className = 'rzp-online';
        box.innerHTML = '<button type="button" class="btn btn-primary rzp-btn" style="width:100%;box-sizing:border-box" data-label="Pay ₹' + amount + ' online">Pay ₹' + amount + ' online</button>' +
          '<p style="font-size:12px;color:var(--text-secondary);text-align:center;margin:8px 0 16px">UPI, cards or netbanking. Your plan starts the moment it goes through.</p>' +
          '<p style="font-size:12px;color:var(--text-secondary);text-align:center;margin:0 0 12px">— or pay by UPI and send a screenshot —</p>';
        step.insertBefore(box, step.firstChild);
        box.querySelector('.rzp-btn').addEventListener('click', ev => payOnline(plan, p, ev.currentTarget));
      } catch (e) { /* the manual route still works */ }
    };
    w.__rzp = true; window.renderPaymentFlow = w;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrap); else wrap();
})();
