/* analytics.js — the Analytics tab: charts, plain-language lines, a picker for any of the last 7 days,
 * and downloads.
 *
 * Loaded as a plain <script src="analytics.js">, no build step, attaches itself as window.Analytics.
 * dashboard.html's showView('analytics') calls Analytics.load() — only when that tab is opened, never on
 * the 4-second poll, because this is aggregation (SUM / GROUP BY over real history), not a cheap row fetch.
 *
 * Backend:  GET  /analytics?range=today|week|month          one of the usual ranges
 *           GET  /analytics?range=day&date=2026-10-03       ONE day, in full, compared with the same
 *                                                           weekday a week earlier
 *           GET  /analytics/days                            the strip: last 7 days with their sales
 *           GET  /analytics/period?kind=month&value=2026-10 a whole calendar month (or kind=year&value=2026):
 *                                                           daily/monthly sales vs the previous period, calendar,
 *                                                           heatmap, item mix, edits, repeat customers, ratings
 *           POST /analytics/export-link  -> { url }         a signed link; the browser downloads from it
 *
 * Every section has its own plain-language line underneath: someone who doesn't read a bar chart easily
 * should still walk away knowing what happened.
 *
 * Needs three globals from dashboard.html: apiGet(), apiSend(), escapeHtml() (and showToast() if present).
 */
(function (root) {
  'use strict';

  let analyticsRange = 'today';      // 'today' | 'week' | 'month' | 'day'
  let analyticsDate = null;          // an ISO date, when analyticsRange === 'day'
  let periodMonth = null;            // 'YYYY-MM' while looking at a calendar month
  let periodYear = null;             // 'YYYY' while looking at a year
  let cameFrom = null;               // { range } — set when a day was opened from the calendar, so there's a way back
  let lastPeriod = null;             // the data on screen (for the table view)
  const isPeriod = () => analyticsRange === 'month' || analyticsRange === 'year';
  const CLIENT_TTL = 45 * 1000;      // re-asking within 45s shows what we already have; after that, fresh numbers
  const cache = {};                  // 'today' | 'day:2026-10-03' -> { t, data }
  let daysCache = null;              // { t, data } for the strip
  let loadSeq = 0;                   // a slow earlier answer must never overwrite a later pick

  const fresh = e => !!e && Date.now() - e.t < CLIENT_TTL;
  const keyOf = () => analyticsRange === 'day' ? 'day:' + analyticsDate : analyticsRange;
  const toast = m => { if (typeof showToast === 'function') showToast(m); };

  function markActive() {
    document.querySelectorAll('.an-range-btn').forEach(b => b.classList.toggle('active', analyticsRange !== 'day' && b.dataset.range === analyticsRange));
    document.querySelectorAll('.an-day').forEach(b => {
      const on = analyticsRange === 'day' && b.dataset.date === analyticsDate;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const dayDl = document.getElementById('an-dl-day');
    if (dayDl) dayDl.hidden = analyticsRange !== 'day';
    const set = (id, hidden) => { const el = document.getElementById(id); if (el) el.hidden = hidden; };
    set('an-days-wrap', isPeriod());                       // the calendar replaces the 7-day strip
    set('an-period-bar', !isPeriod());
    set('an-dl-week-xlsx', isPeriod()); set('an-dl-week-csv', isPeriod());
    set('an-dl-month-xlsx', analyticsRange !== 'month'); set('an-dl-month-csv', analyticsRange !== 'month');
  }

  async function load(range, date) {
    if (range) { analyticsRange = range; if (range === 'day') analyticsDate = date || analyticsDate; else cameFrom = null; }
    if (analyticsRange === 'day' && !analyticsDate) analyticsRange = 'today';     // nothing picked yet
    if (isPeriod()) return loadPeriod();
    markActive();
    loadDays();                                                                    // the strip refreshes itself
    const seq = ++loadSeq, key = keyOf(), body = document.getElementById('an-body');
    if (!body) return;
    if (fresh(cache[key])) { renderAnalytics(cache[key].data); return; }
    if (body.firstElementChild) body.classList.add('an-reloading');       // keep the last screen in place, dimmed, while the new one loads
    else body.innerHTML = '<div class="an-loading">Loading…</div>';
    try {
      const data = await apiGet(analyticsRange === 'day' ? '/analytics?range=day&date=' + analyticsDate : '/analytics?range=' + analyticsRange);
      cache[key] = { t: Date.now(), data };
      if (seq === loadSeq) renderAnalytics(data);
    } catch (e) {
      if (seq === loadSeq) body.innerHTML = `<div class="an-error">Couldn’t load analytics — ${escapeHtml(e.message || 'try again')}.</div>`;
    }
  }
  const setRange = range => load(range);
  const setDay = date => load('day', date);
  function invalidate() { for (const k in cache) delete cache[k]; daysCache = null; }
  function openDay(date) { cameFrom = { range: analyticsRange, label: lastPeriod ? lastPeriod.label : 'the month' }; load('day', date); }
  function backToPeriod() { const r = cameFrom && cameFrom.range; cameFrom = null; load(r || 'month'); }   // a bill was just saved / edited / deleted

  // ---------------------------------------------------------------- the last-7-days strip
  async function loadDays() {
    const box = document.getElementById('an-days');
    if (!box) return;
    if (fresh(daysCache)) { renderDays(daysCache.data); return; }
    try {
      const data = await apiGet('/analytics/days');
      daysCache = { t: Date.now(), data };
      renderDays(data);
    } catch (e) {
      if (!box.children.length) box.innerHTML = '<span class="an-days-err">Couldn’t load the days — reopen this tab to retry.</span>';
    }
  }
  function renderDays(data) {
    const box = document.getElementById('an-days');
    if (!box) return;
    const best = Math.max(...data.days.map(d => d.revenue), 0);
    box.innerHTML = data.days.map(d => `
      <button type="button" class="an-day" data-date="${d.date}" aria-pressed="false" onclick="Analytics.setDay('${d.date}')">
        <span class="an-day-name">${escapeHtml(d.label)}</span>
        <span class="an-day-date">${escapeHtml(d.day_text)}</span>
        <span class="an-day-amt">${d.revenue > 0 ? RUPEE(d.revenue) : '—'}</span>
        ${d.revenue > 0 && d.revenue === best ? '<span class="an-day-best">Best day</span>' : ''}
      </button>`).join('');
    markActive();
  }

  // ---------------------------------------------------------------- downloads
  async function openDownload(url) {
    if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins && Capacitor.Plugins.Browser) {
      await Capacitor.Plugins.Browser.open({ url });          // the phone's own browser handles saving the file
    } else {
      const a = document.createElement('a');                  // a link click, not window.open: an attachment doesn't
      a.href = url; a.rel = 'noopener';                       // leave the page, and isn't blocked as a popup
      document.body.appendChild(a); a.click(); a.remove();
    }
  }
  async function download(kind, fmt) {
    let from, to;
    if (kind === 'month') {                                                       // the calendar month on screen
      if (analyticsRange !== 'month' || !periodMonth) return;
      const [y, m] = periodMonth.split('-').map(Number);
      from = periodMonth + '-01';
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      to = periodMonth + '-' + String(last).padStart(2, '0');
      const today = istToday(); if (to > today) to = today;
    } else {
      const days = daysCache && daysCache.data && daysCache.data.days;
      if (!days || !days.length) { toast('Still loading the days — try again in a moment'); return; }
      from = days[days.length - 1].date; to = days[0].date;                       // all 7 days
      if (kind === 'day') { if (analyticsRange !== 'day') return; from = to = analyticsDate; }
    }
    const btn = document.querySelector(`[data-dl="${kind}-${fmt}"]`);
    const label = btn ? btn.textContent : '';
    if (btn) { if (btn.dataset.busy === '1') return; btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = 'Preparing…'; }
    try {
      const r = await apiSend('POST', '/analytics/export-link', { from_date: from, to_date: to, format: fmt });
      await openDownload(r.url);
      toast(fmt === 'csv' ? 'Your CSV is downloading' : 'Your Excel file is downloading');
    } catch (e) {
      toast(e.message || 'Couldn’t prepare the download');
    } finally {
      if (btn) { btn.dataset.busy = ''; btn.disabled = false; btn.textContent = label; }
    }
  }

  // ---------------------------------------------------------------- wording
  const RUPEE = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const PCT = (now, prev) => prev > 0 ? Math.round(((now - prev) / prev) * 100) : (now > 0 ? 100 : 0);
  const RANGE_WORD = { today: 'Today', week: 'This week', month: 'This month' };
  const COMPARE_WORD = { today: 'yesterday', week: 'last week', month: 'last month' };
  const rangeWord = d => d.range === 'day' ? d.title : RANGE_WORD[d.range];            // "Saturday", "Yesterday", "This week"
  const comparisonWord = d => d.range === 'day' ? d.compare_label : COMPARE_WORD[d.range];   // "last Saturday"
  function whenWord(d) {                                                                // "today" / "yesterday" / "on Saturday"
    if (d.range === 'day') return d.title === 'Today' ? 'today' : d.title === 'Yesterday' ? 'yesterday' : 'on ' + d.title;
    return rangeWord(d).toLowerCase();
  }

  function trendBadge(now, prev) {
    const pct = PCT(now, prev);
    if (pct === 0) return '<span class="an-kpi-trend flat">No change</span>';
    return `<span class="an-kpi-trend ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%</span>`;
  }

  const INSIGHT_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
  function insightLine(text) { return `<div class="an-insight">${INSIGHT_ICON}<span>${text}</span></div>`; }

  function busiestWindowSentence(hours) {
    const peak = hours.reduce((a, b) => (b.count > a.count ? b : a), hours[0]);
    if (!peak || peak.count === 0) return 'No orders were placed in this period.';
    const fmt = h => { const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12} ${h < 12 ? 'AM' : 'PM'}`; };
    return `Most customers came in between ${fmt(peak.hour)} and ${fmt((peak.hour + 2) % 24)}.`;
  }

  function busiestDaySentence(days) {
    const peak = days.reduce((a, b) => (b.count > a.count ? b : a), days[0]);
    if (peak.count === 0) return 'No sales yet in this range.';
    const full = { Sun: 'Sundays', Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays' };
    return `So far, ${full[peak.day]} has been the busiest.`;
  }

  // "Rahul acknowledged the most calls (43), while Shriya acknowledged the fewest (29)."
  function staffCallsSentence(staff) {
    if (staff.length === 1) return `${escapeHtml(staff[0].name)} acknowledged ${staff[0].count} call${staff[0].count === 1 ? '' : 's'}.`;
    const top = staff[0], bottom = staff[staff.length - 1];
    if (top.count === bottom.count) return `Everyone on the team acknowledged the same number of calls (${top.count} each).`;
    return `${escapeHtml(top.name)} acknowledged the most calls (${top.count}), while ${escapeHtml(bottom.name)} acknowledged the fewest (${bottom.count}).`;
  }

  // ---------------------------------------------------------------- the screen

  /* ---- Dues: what is owed right now, how old it is, who owes most, and what moved in the chosen days ---- */
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function duesDates() {
    const today = new Date();
    if (analyticsRange === 'week') { const a = new Date(today); a.setDate(a.getDate() - 6); return [ymd(a), ymd(today)]; }
    if (analyticsRange === 'day' && analyticsDate) return [analyticsDate, analyticsDate];
    if (analyticsRange === 'month' && periodMonth) { const [y, m] = periodMonth.split('-').map(Number); return [periodMonth + '-01', periodMonth + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0')]; }
    if (analyticsRange === 'year' && periodYear) return [periodYear + '-01-01', periodYear + '-12-31'];
    return [ymd(today), ymd(today)];
  }
  let duesSeq = 0;
  async function paintDues() {
    const body = document.getElementById('an-body'); if (!body) return;
    const seq = ++duesSeq, [a, b] = duesDates();
    let d; try { d = await apiGet('/credits/summary?start=' + a + '&end=' + b); } catch (e) { return; }
    if (seq !== duesSeq || !body.isConnected) return;
    body.querySelectorAll('.an-dues').forEach(n => n.remove());
    if (!d || (!d.outstanding && !d.period.given && !d.period.received && !d.top_people.length)) return;       // nobody has used credit — no clutter
    const max = Math.max(1, ...d.aging.map(x => x.amount));
    const aging = d.aging.map(x => `<div class="an-bar-row"><span class="an-bar-label">${escapeHtml(x.label)}</span><div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round(x.amount / max * 100)}%"></div></div><span class="an-bar-value">${RUPEE(x.amount)}${x.count ? ` <small>· ${x.count}</small>` : ''}</span></div>`).join('');
    const people = d.top_people.map((p, i) => `<div class="an-bar-row"><span class="an-bar-label" style="width:auto;flex:1;color:var(--text);">${i + 1}. ${escapeHtml(p.name)}${p.phone ? ` <small style="color:var(--text-secondary)">${escapeHtml(p.phone)}</small>` : ''}</span><span class="an-bar-value"><b>${RUPEE(p.due)}</b> <small>· ${p.oldest_days}d${p.bills > 1 ? ' · ' + p.bills + ' bills' : ''}</small></span></div>`).join('');
    const el = document.createElement('div'); el.className = 'an-dues';
    el.innerHTML = `
      <div class="an-kpis">
        <div class="an-kpi-card"><div class="an-kpi-label">Dues outstanding</div><div class="an-kpi-value">${RUPEE(d.outstanding)}</div><div class="an-kpi-label" style="margin-top:6px">${d.open_count} bill${d.open_count === 1 ? '' : 's'} · ${d.people_count} ${d.people_count === 1 ? 'person' : 'people'}</div></div>
        <div class="an-kpi-card"><div class="an-kpi-label">Put on credit</div><div class="an-kpi-value">${RUPEE(d.period.given)}</div></div>
        <div class="an-kpi-card"><div class="an-kpi-label">Dues received</div><div class="an-kpi-value">${RUPEE(d.period.received)}</div></div>
      </div>
      ${d.outstanding ? `<div class="an-panel"><h3 class="an-panel-title">Dues by age</h3>${aging}</div>` : ''}
      ${people ? `<div class="an-panel"><h3 class="an-panel-title">Top 5 who owe</h3>${people}</div>` : ''}`;
    const anchor = body.querySelector('.an-kpis');
    if (anchor && anchor.nextElementSibling) anchor.parentNode.insertBefore(el, anchor.nextElementSibling.nextSibling || null); else body.appendChild(el);
  }

  function renderAnalytics(d) {
    const body = document.getElementById('an-body');
    if (!body) return;
    body.classList.remove('an-reloading');
    const revTrend = trendBadge(d.revenue.total, d.revenue.prev_total);
    const ordTrend = trendBadge(d.orders.count, d.orders.prev_count);
    const avgOrder = d.orders.count > 0 ? d.revenue.total / d.orders.count : 0;
    const revPct = PCT(d.revenue.total, d.revenue.prev_total);
    const noSales = d.orders.count === 0 && d.revenue.total === 0;
    const revDirection = revPct > 0 ? 'more' : 'less';
    const revSentence = noSales
      ? `No sales were recorded ${whenWord(d)}.`
      : revPct === 0
        ? `${rangeWord(d)}'s total sale is ${RUPEE(d.revenue.total)} — about the same as ${comparisonWord(d)}.`
        : `${rangeWord(d)}'s total sale is ${RUPEE(d.revenue.total)} — that's ${Math.abs(revPct)}% ${revDirection} than ${comparisonWord(d)}.`;

    const backBtn = d.range === 'day' && cameFrom
      ? `<button type="button" class="an-back" onclick="Analytics.backToPeriod()">← Back to ${escapeHtml(cameFrom.label)}</button>` : '';
    const dayHeader = d.range === 'day'
      ? `${backBtn}<div class="an-daytitle"><b>${escapeHtml(d.date_text)}</b><span>compared with ${escapeHtml(d.compare_label)}</span></div>` : '';

    let itemsPanel = '';
    if (d.top_items.length) {
      const topItem = d.top_items[0];
      const maxQty = Math.max(...d.top_items.map(i => i.qty), 1);
      const itemsHtml = d.top_items.map(i => `
        <div class="an-bar-wrap">
          <div class="an-bar-row">
            <span class="an-bar-label">${escapeHtml(i.name)}</span>
            <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.max(4, i.qty / maxQty * 100)}%"></div></div>
            <span class="an-bar-value">${i.qty} sold</span>
          </div>
          ${i.breakdown ? `<div class="an-bar-sub">${i.breakdown.map(b => `${escapeHtml(b.label)} ${b.qty}`).join(' · ')}</div>` : ''}
        </div>`).join('');
      itemsPanel = `
        <div class="an-panel">
          <h3 class="an-panel-title">Top selling items</h3>
          ${itemsHtml}
          ${insightLine(`${escapeHtml(topItem.name)} was your best seller, with ${topItem.qty} sold ${whenWord(d)}.`)}
        </div>`;
    }

    let hoursPanel = '';
    if (d.busiest_hours.some(h => h.count > 0)) {
      const maxHour = Math.max(...d.busiest_hours.map(h => h.count), 1);
      const peakHour = d.busiest_hours.reduce((a, b) => (b.count > a.count ? b : a), d.busiest_hours[0]).hour;
      const bars = d.busiest_hours.map(h => `<div class="an-hour-bar${h.hour === peakHour ? ' peak' : ''}" style="height:${Math.max(4, h.count / maxHour * 100)}%" title="${h.count} orders at ${h.hour}:00"></div>`).join('');
      const labels = d.busiest_hours.map((h, i) => `<span>${i % 3 === 0 ? (h.hour % 12 === 0 ? 12 : h.hour % 12) : ''}</span>`).join('');
      hoursPanel = `
        <div class="an-panel">
          <h3 class="an-panel-title">Busiest hours</h3>
          <div class="an-hours-chart">${bars}</div>
          <div class="an-hours-labels">${labels}</div>
          ${insightLine(busiestWindowSentence(d.busiest_hours))}
        </div>`;
    }

    let payPanel = '';
    if (d.payment_methods.length) {
      const totalPay = d.payment_methods.reduce((s, p) => s + p.amount, 0) || 1;
      const topMethod = d.payment_methods.reduce((a, b) => (b.amount > a.amount ? b : a), d.payment_methods[0]);
      const payHtml = d.payment_methods.map(p => `
        <div class="an-bar-row">
          <span class="an-bar-label">${escapeHtml(p.method)}</span>
          <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.max(4, p.amount / totalPay * 100)}%"></div></div>
          <span class="an-bar-value">${RUPEE(p.amount)}</span>
        </div>`).join('');
      payPanel = `
        <div class="an-panel">
          <h3 class="an-panel-title">How customers paid</h3>
          ${payHtml}
          ${insightLine(`Most customers paid by ${escapeHtml(topMethod.method)} — ${Math.round(topMethod.amount / totalPay * 100)}% of all sales.`)}
        </div>`;
    }

    body.innerHTML = `
      ${dayHeader}
      <div class="an-kpis">
        <div class="an-kpi-card"><div class="an-kpi-label">Total sales</div><div class="an-kpi-value">${RUPEE(d.revenue.total)}</div>${revTrend}</div>
        <div class="an-kpi-card"><div class="an-kpi-label">Orders</div><div class="an-kpi-value">${d.orders.count}</div>${ordTrend}</div>
        <div class="an-kpi-card"><div class="an-kpi-label">Average order</div><div class="an-kpi-value">${RUPEE(avgOrder)}</div></div>
      </div>
      ${insightLine(revSentence)}
      ${itemsPanel}
      ${hoursPanel}
      ${payPanel}
      ${renderDayOfWeekPanel(d.day_of_week)}
      ${renderDineInPanel(d.avg_table_turnover_minutes, d.order_type_split)}
      ${renderStaffCallsPanel(d.staff_calls_handled, d)}
    `;
    paintDues();
  }

  function renderDayOfWeekPanel(days) {
    if (!days || !days.length) return '';
    const max = Math.max(...days.map(d => d.count), 1);
    const bars = days.map(d => `<div class="an-bar-row"><span class="an-bar-label">${d.day}</span><div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.max(4, d.count / max * 100)}%"></div></div><span class="an-bar-value">${d.count}</span></div>`).join('');
    return `
      <div class="an-panel">
        <h3 class="an-panel-title">Busiest days</h3>
        ${bars}
        ${insightLine(busiestDaySentence(days))}
      </div>`;
  }

  function renderDineInPanel(turnoverMinutes, split) {
    if (!split || (split.dine_in === 0 && split.counter === 0)) return '';
    const total = split.dine_in + split.counter || 1;
    const turnoverText = turnoverMinutes != null ? `${turnoverMinutes} min` : '—';
    const dineInPct = Math.round(split.dine_in / total * 100);
    const sentence = turnoverMinutes != null
      ? `A dine-in table sits for about ${turnoverMinutes} minutes on average. ${dineInPct}% of orders were dine-in, the rest counter/walk-in.`
      : `${dineInPct}% of orders were dine-in, the rest counter/walk-in.`;
    return `
      <div class="an-panel">
        <h3 class="an-panel-title">Dine-in &amp; table turnover</h3>
        <div class="an-kpis" style="padding:0; margin-bottom:0;">
          <div class="an-kpi-card">
            <div class="an-kpi-label">Avg. table time</div>
            <div class="an-kpi-value">${turnoverText}</div>
          </div>
          <div class="an-kpi-card">
            <div class="an-kpi-label">Dine-in</div>
            <div class="an-kpi-value">${split.dine_in}</div>
          </div>
          <div class="an-kpi-card">
            <div class="an-kpi-label">Counter</div>
            <div class="an-kpi-value">${split.counter}</div>
          </div>
        </div>
        ${insightLine(sentence)}
      </div>`;
  }

  function renderStaffCallsPanel(data, d) {
    // No one on the team has calls access at all — the whole section stays off rather than showing an
    // empty chart with nothing to say about it.
    if (!data || !data.staff || !data.staff.length) return '';
    const staff = data.staff;
    const max = Math.max(...staff.map(s => s.count), 1);
    const bars = staff.map(s => `<div class="an-bar-row"><span class="an-bar-label">${escapeHtml(s.name)}</span><div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.max(4, s.count / max * 100)}%"></div></div><span class="an-bar-value">${s.count} call${s.count === 1 ? '' : 's'}</span></div>`).join('');
    // Call history is kept for 30 days — an honest note when the chosen range reaches further back.
    const retentionNote = data.limited_by_retention
      ? `<p style="font-size:11.5px; color:var(--text-secondary); margin:-4px 0 10px;">Call history is only kept for 30 days, so this reflects what's available, not necessarily all of ${whenWord(d)}.</p>`
      : '';
    return `
      <div class="an-panel">
        <h3 class="an-panel-title">Staff — calls handled</h3>
        ${retentionNote}
        ${bars}
        ${insightLine(staffCallsSentence(staff))}
      </div>`;
  }


  // ================================================================ whole month / whole year
  const SHORT = n => {                                    // axis labels: 1.5k, 2L (lakh), 1Cr
    n = Math.round(n);
    if (n >= 1e7) return +(n / 1e7).toFixed(1) + 'Cr';
    if (n >= 1e5) return +(n / 1e5).toFixed(1) + 'L';
    if (n >= 1e3) return +(n / 1e3).toFixed(1) + 'k';
    return String(n);
  };
  const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
  const istToday = () => istNow().toISOString().slice(0, 10);
  const curMonth = () => istToday().slice(0, 7);
  const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + k; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = ym => MONTHS[Number(ym.slice(5)) - 1] + ' ' + ym.slice(0, 4);

  function niceTicks(max) {                               // 4-5 round gridlines up to a round maximum
    if (!(max > 0)) return [0, 1];
    const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw);
    const out = []; for (let v = 0; v <= max + step * 0.999; v += step) { out.push(+v.toFixed(6)); if (v >= max) break; }
    return out;
  }

  function renderPeriodBar() {
    const bar = document.getElementById('an-period-bar'); if (!bar) return;
    const cur = curMonth(), curY = cur.slice(0, 4);
    if (analyticsRange === 'month') {
      const min = addMonths(cur, -35);
      bar.innerHTML = `<button type="button" class="an-step" id="an-prev" aria-label="Previous month" ${periodMonth <= min ? 'disabled' : ''}>‹</button>
        <input type="month" class="an-month-input" id="an-month" value="${periodMonth}" min="${min}" max="${cur}" aria-label="Pick a month">
        <button type="button" class="an-step" id="an-next" aria-label="Next month" ${periodMonth >= cur ? 'disabled' : ''}>›</button>`;
      const go = v => { if (v && v >= min && v <= cur) { periodMonth = v; load(); } };
      bar.querySelector('#an-prev').onclick = () => go(addMonths(periodMonth, -1));
      bar.querySelector('#an-next').onclick = () => go(addMonths(periodMonth, 1));
      bar.querySelector('#an-month').onchange = e => go(e.target.value);
    } else {
      const minY = String(Number(curY) - 2);
      bar.innerHTML = `<button type="button" class="an-step" id="an-prev" aria-label="Previous year" ${periodYear <= minY ? 'disabled' : ''}>‹</button>
        <div class="an-period-title" aria-live="polite">${periodYear}</div>
        <button type="button" class="an-step" id="an-next" aria-label="Next year" ${periodYear >= curY ? 'disabled' : ''}>›</button>`;
      const go = v => { if (v >= minY && v <= curY) { periodYear = v; load(); } };
      bar.querySelector('#an-prev').onclick = () => go(String(Number(periodYear) - 1));
      bar.querySelector('#an-next').onclick = () => go(String(Number(periodYear) + 1));
    }
  }

  async function loadPeriod() {
    if (analyticsRange === 'month' && !periodMonth) periodMonth = curMonth();
    if (analyticsRange === 'year' && !periodYear) periodYear = curMonth().slice(0, 4);
    const kind = analyticsRange, value = kind === 'month' ? periodMonth : periodYear;
    markActive(); renderPeriodBar();
    const seq = ++loadSeq, key = 'period:' + kind + ':' + value, body = document.getElementById('an-body');
    if (!body) return;
    if (fresh(cache[key])) { renderPeriod(cache[key].data); return; }
    if (body.firstElementChild) body.classList.add('an-reloading'); else body.innerHTML = '<div class="an-loading">Loading…</div>';
    try {
      const data = await apiGet('/analytics/period?kind=' + kind + '&value=' + encodeURIComponent(value));
      cache[key] = { t: Date.now(), data };
      if (seq === loadSeq) renderPeriod(data);
    } catch (e) {
      if (seq === loadSeq) { body.classList.remove('an-reloading'); body.innerHTML = `<div class="an-error">Couldn’t load analytics — ${escapeHtml(e.message || 'try again')}.</div>`; }
    }
  }

  // Everything that follows is built from data we were sent, so text goes through esc() and nothing else.
  const esc = s => escapeHtml(s == null ? '' : String(s));

  function barChart(d) {
    const series = d.series, n = series.length, month = d.kind === 'month';
    const W = 340, H = 208, L = 40, R = 6, T = 22, B = 24, pw = W - L - R, ph = H - T - B;
    const maxVal = Math.max(...series.map(x => Math.max(x.revenue, x.prev_revenue || 0)), 0);
    const ticks = niceTicks(maxVal), top = ticks[ticks.length - 1] || 1;
    const y = v => T + ph - (v / top) * ph, slot = pw / n, bw = Math.max(2, Math.min(slot * 0.64, 26));
    const cx = i => L + slot * i + slot / 2;
    const grid = ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`).join('');
    const yLabels = ticks.map(t => `<text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${t === 0 ? '0' : '₹' + SHORT(t)}</text>`).join('');
    const bars = series.map((x, i) => {
      const h = Math.max(x.revenue > 0 ? 2 : 0, ph - (y(x.revenue) - T)), bx = cx(i) - bw / 2, by = T + ph - h, r = Math.min(4, bw / 2, h);
      const path = h <= 0 ? '' : `M${bx},${T + ph}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + bw - r}Q${bx + bw},${by} ${bx + bw},${by + r}V${T + ph}Z`;
      return path ? `<path class="an-bar${x.future ? ' future' : ''}" data-b="${i}" d="${path}"/>` : '';
    }).join('');
    const prevN = month && d.prev_days ? Math.min(d.prev_days, n) : n;     // last month may be shorter than this one — stop its line where it ends
    const prevPts = series.slice(0, prevN).map((x, i) => `${cx(i).toFixed(1)},${y(x.prev_revenue || 0).toFixed(1)}`).join(' ');
    const showPrev = series.some(x => x.prev_revenue > 0);
    const xLabels = series.map((x, i) => {
      const show = month ? (i === 0 || (i + 1) % 5 === 0) : true;
      return show ? `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle">${esc(x.label)}</text>` : '';
    }).join('');
    const hits = series.map((x, i) => `<rect class="an-hit" data-i="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${ph}" tabindex="0" role="img" aria-label="${esc(tipTitle(d, x))}: ${esc(RUPEE(x.revenue))}"/>`).join('');
    return `
      <div class="an-legend"><span><i class="k-bar"></i>${esc(d.label)}</span>${showPrev ? `<span><i class="k-line"></i>${esc(d.prev_label)}</span>` : ''}</div>
      <div class="an-chart-wrap">
        <svg class="an-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Sales ${month ? 'per day' : 'per month'}, ${esc(d.label)}">
          <g class="an-grid">${grid}</g>${yLabels}
          <text class="an-axis-title" x="${L - 6}" y="8" text-anchor="end">Sales</text>
          ${bars}${showPrev ? `<polyline class="an-prevline" points="${prevPts}"/>` : ''}
          ${xLabels}${hits}
        </svg>
        <div class="an-tip" hidden></div>
      </div>`;
  }
  const tipTitle = (d, x) => d.kind === 'month' ? `${x.weekday} ${x.label} ${MONTHS[Number(d.value.slice(5)) - 1].slice(0, 3)}` : `${MONTHS[x.key - 1]} ${d.value}`;

  // One tooltip for everything with a data-tip (heatmap cells, calendar days) or an .an-hit slot (bars).
  function wireTips(rootEl, d) {
    rootEl.querySelectorAll('.an-chart-wrap').forEach(wrap => {
      const tip = wrap.querySelector('.an-tip'); if (!tip) return;
      const show = (el, html) => {
        tip.innerHTML = html; tip.hidden = false;
        const wr = wrap.getBoundingClientRect(), er = el.getBoundingClientRect();
        const x = er.left - wr.left + er.width / 2 - tip.offsetWidth / 2;
        tip.style.left = Math.max(0, Math.min(x, wr.width - tip.offsetWidth)) + 'px';
        tip.style.top = Math.max(0, er.top - wr.top - tip.offsetHeight - 6) + 'px';
      };
      const hide = () => { tip.hidden = true; wrap.querySelectorAll('.an-bar.hover').forEach(b => b.classList.remove('hover')); };
      wrap.addEventListener('pointerover', e => {
        const h = e.target.closest('.an-hit');
        if (h) {
          const i = +h.dataset.i, x = d.series[i];
          wrap.querySelectorAll('.an-bar.hover').forEach(b => b.classList.remove('hover'));
          const bar = wrap.querySelector(`.an-bar[data-b="${i}"]`); if (bar) bar.classList.add('hover');
          show(h, `<span>${esc(tipTitle(d, x))}</span><b>${esc(RUPEE(x.revenue))}</b><span>${x.bills} bill${x.bills === 1 ? '' : 's'}</span>` +
            (x.prev_revenue ? `<br><span><i class="k dash"></i>${esc(RUPEE(x.prev_revenue))} ${esc(d.prev_label)}</span>` : ''));
          return;
        }
        const c = e.target.closest('[data-tip]');
        if (c) { const [a, b] = c.dataset.tip.split('|'); show(c, `<span>${esc(a)}</span><b>${esc(b)}</b>`); }
      });
      wrap.addEventListener('pointerleave', hide);
      wrap.addEventListener('focusin', e => { const h = e.target.closest('.an-hit'); if (h) h.dispatchEvent(new Event('pointerover', { bubbles: true })); });
      wrap.addEventListener('focusout', hide);
      wrap.addEventListener('click', e => {
        const h = e.target.closest('.an-hit');
        if (h && d.kind === 'month') { const x = d.series[+h.dataset.i]; if (!x.future) openDay(x.date); }
      });
    });
  }

  function calendar(d) {
    const first = new Date(d.series[0].date + 'T00:00:00Z'), lead = (first.getUTCDay() + 6) % 7;
    const max = Math.max(...d.series.map(x => x.revenue), 0), best = max > 0 ? d.series.find(x => x.revenue === max) : null;
    const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => `<div class="an-cal-h">${w}</div>`);
    for (let i = 0; i < lead; i++) cells.push('<span class="an-cal-cell blank"></span>');
    d.series.forEach(x => {
      const a = max > 0 && x.revenue > 0 ? 0.14 + 0.72 * (x.revenue / max) : 0;
      const bg = a ? `background:rgba(230,57,118,${a.toFixed(2)});` : '', dark = a > 0.5;
      cells.push(`<button type="button" class="an-cal-cell${x.future ? ' future' : ''}${best && x === best ? ' best' : ''}" ${x.future ? 'disabled' : `data-open-day="${x.date}"`} style="${bg}"
        aria-label="${esc(tipTitle(d, x))}: ${x.revenue ? esc(RUPEE(x.revenue)) : 'no sales'}">
        <span class="n" ${dark ? 'style="color:#fff"' : ''}>${x.label}</span><span class="v" ${dark ? 'style="color:#fff"' : ''}>${x.revenue ? SHORT(x.revenue) : ''}</span></button>`);
    });
    return `<div class="an-cal">${cells.join('')}</div>`;
  }

  function heatmap(h) {
    const max = Math.max(...h.grid.map(r => Math.max(...r)), 0);
    if (!max) return '';
    const head = '<span></span>' + h.hours.map(x => `<span class="an-heat-h">${x % 3 === 0 ? (x % 12 || 12) + (x < 12 ? 'a' : 'p') : ''}</span>`).join('');
    const rows = h.grid.map((r, di) => `<span class="an-heat-d">${h.days[di]}</span>` + r.map((c, hi) => {
      const hr = h.hours[hi], lab = `${h.days[di]} ${hr % 12 || 12}${hr < 12 ? ' AM' : ' PM'}`;
      const a = c ? 0.12 + 0.78 * (c / max) : 0;
      return `<span class="an-heat-c" data-tip="${esc(lab)}|${c} order${c === 1 ? '' : 's'}" ${a ? `style="background:rgba(230,57,118,${a.toFixed(2)})"` : ''}></span>`;
    }).join('')).join('');
    return `<div class="an-chart-wrap"><div class="an-heat" role="img" aria-label="Orders by weekday and hour">${head}${rows}</div><div class="an-tip" hidden></div></div>`;
  }
  function busiestSlot(h) {
    let best = { c: 0 };
    h.grid.forEach((r, di) => r.forEach((c, hi) => { if (c > best.c) best = { c, di, hi }; }));
    if (!best.c) return '';
    const hr = h.hours[best.hi], f = x => (x % 12 || 12) + (x % 24 < 12 ? ' AM' : ' PM');
    const full = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }[h.days[best.di]];
    return `Your busiest slot is ${full}s, ${f(hr)}–${f(hr + 1)} (${best.c} orders).`;
  }

  function hBars(rows, fmt, sub) {
    const max = Math.max(...rows.map(r => r.v), 1);
    return rows.map(r => `<div class="an-bar-wrap"><div class="an-bar-row"><span class="an-bar-label">${esc(r.label)}</span>
      <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.max(r.v > 0 ? 3 : 0, r.v / max * 100)}%"></div></div>
      <span class="an-bar-value" style="width:auto;min-width:56px">${fmt(r)}</span></div>${sub && sub(r) ? `<div class="an-bar-sub">${sub(r)}</div>` : ''}</div>`).join('');
  }
  const panel = (title, inner, insight) => `<div class="an-panel"><h3 class="an-panel-title">${title}</h3>${inner}${insight ? insightLine(insight) : ''}</div>`;

  function renderPeriod(d) {
    const body = document.getElementById('an-body'); if (!body) return;
    body.classList.remove('an-reloading');
    lastPeriod = d;
    const t = d.totals, month = d.kind === 'month';
    // Compare like with like: a half-finished month is set against the SAME DAYS of last month, not all of it.
    const k = d.series.filter(x => !x.future).length;
    const pRev = d.series.slice(0, k).reduce((a, x) => a + (x.prev_revenue || 0), 0);
    const pBills = d.series.slice(0, k).reduce((a, x) => a + (x.prev_bills || 0), 0);
    const pAvg = pBills ? pRev / pBills : 0;
    const cmp = d.is_current ? (month ? `the same ${k} day${k === 1 ? '' : 's'} of ${d.prev_label}` : `the same ${k} month${k === 1 ? '' : 's'} of ${d.prev_label}`) : d.prev_label;
    const kpi = (label, val, now, prev, extra) => `<div class="an-kpi-card"><div class="an-kpi-label">${label}</div><div class="an-kpi-value">${val}</div>${prev != null ? trendBadge(now, prev) : ''}${extra || ''}</div>`;
    const r = d.ratings, pr = d.prev_ratings;
    const noSales = t.bills === 0;

    const revPct = PCT(t.revenue, pRev);
    const headline = noSales ? `No sales were recorded in ${esc(d.label)}.`
      : (pRev <= 0 ? `${esc(d.label)}: ${RUPEE(t.revenue)} from ${t.bills} bill${t.bills === 1 ? '' : 's'} — there's nothing from ${esc(d.prev_label)} to compare with.`
        : `${esc(d.label)}${d.is_current ? ' so far' : ''}: ${RUPEE(t.revenue)} — ${revPct === 0 ? 'about the same as' : Math.abs(revPct) + '% ' + (revPct > 0 ? 'more than' : 'less than')} ${esc(cmp)}.`);

    // best day / month
    const real = d.series.filter(x => !x.future), bestX = real.reduce((a, x) => (x.revenue > (a ? a.revenue : 0) ? x : a), null);
    const bestLine = bestX ? `${month ? 'Best day' : 'Best month'}: ${esc(tipTitle(d, bestX))} — ${RUPEE(bestX.revenue)}.` : '';

    const chart = noSales ? '' : panel(month ? 'Sales each day' : 'Sales each month',
      barChart(d) + `<button type="button" class="an-table-btn" data-table-toggle aria-expanded="false">View as table</button><div data-table hidden></div>`,
      bestLine + (month ? ' Tap a bar to open that day.' : ''));

    const cal = month && !noSales ? panel('Calendar', `<div class="an-chart-wrap">${calendar(d)}</div>`,
      'Darker days sold more. Tap any day for its full breakdown.') : '';

    // weekday strength
    let wdPanel = '';
    const wd = d.weekdays.filter(w => w.n > 0);
    if (month && !noSales && wd.length) {
      const mean = wd.reduce((a, w) => a + w.avg, 0) / wd.length, top = wd.reduce((a, w) => (w.avg > a.avg ? w : a), wd[0]);
      const full = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
      wdPanel = panel('Average sales by weekday', hBars(d.weekdays.map(w => ({ label: w.day, v: w.avg, n: w.n })), r => RUPEE(r.v), r => ''),
        mean > 0 && top.avg > 0 ? `${full[top.day]}s are your strongest: about ${RUPEE(top.avg)} each, ${Math.round((top.avg / mean - 1) * 100)}% above your average day.` : '');
    }

    const heat = !noSales && heatmap(d.heatmap) ? panel('Busy times — weekday × hour', heatmap(d.heatmap), busiestSlot(d.heatmap)) : '';

    // items
    let itemsPanel = '', unsoldPanel = '', catPanel = '';
    if (d.items.length) {
      const top3 = d.items.slice(0, 3), share = Math.round(top3.reduce((a, i) => a + i.share, 0));
      itemsPanel = panel('Items by sales', hBars(d.items.map(i => ({ label: i.name, v: i.revenue, i })), r => RUPEE(r.v), r => `${r.i.qty} sold · ${r.i.share}% of sales`),
        `${esc(top3[0].name)} earned the most (${RUPEE(top3[0].revenue)}). ${d.items.length > 3 ? `Your top 3 items make ${share}% of all sales.` : ''}`);
    }
    if (d.categories.length > 1) {
      const c0 = d.categories[0], tot = d.categories.reduce((a, c) => a + c.revenue, 0) || 1;
      catPanel = panel('Sales by category', hBars(d.categories.map(c => ({ label: c.category, v: c.revenue })), r => RUPEE(r.v), null),
        `${esc(c0.category)} brings in ${Math.round(c0.revenue / tot * 100)}% of your sales.`);
    }
    if (!noSales && d.unsold_count) {
      unsoldPanel = panel('Never ordered', `<div class="an-pill-list">${d.unsold_items.map(n => `<span class="an-pill">${esc(n)}</span>`).join('')}${d.unsold_count > d.unsold_items.length ? `<span class="an-pill">+${d.unsold_count - d.unsold_items.length} more</span>` : ''}</div>`,
        `${d.unsold_count} item${d.unsold_count === 1 ? ' on your menu was' : 's on your menu were'} not ordered even once ${month ? 'this month' : 'this year'} — worth promoting, or removing.`);
    }

    // payments
    let payPanel = '';
    if (d.payment_methods.length) {
      const tot = d.payment_methods.reduce((a, p) => a + p.amount, 0) || 1, top = d.payment_methods[0];
      payPanel = panel('How customers paid', hBars(d.payment_methods.map(p => ({ label: p.method, v: p.amount })), r => RUPEE(r.v) , null),
        `${Math.round(top.amount / tot * 100)}% of sales came in by ${esc(top.method)}.`);
    }

    // who took the orders
    let srcPanel = '';
    const sc = d.sources, stot = sc.customer + sc.staff + sc.unknown;
    if (stot) {
      const rows = [{ label: 'Customers (QR)', v: sc.customer }, { label: 'Staff', v: sc.staff }].concat(sc.unknown ? [{ label: 'Older orders', v: sc.unknown }] : []);
      const known = sc.customer + sc.staff;
      srcPanel = panel('Who placed the orders', hBars(rows, r => r.v + ' order' + (r.v === 1 ? '' : 's'), null) +
        (sc.by_staff.length ? `<div class="an-sub-h">Orders taken by staff</div>` + hBars(sc.by_staff.map(s => ({ label: s.name, v: s.count })), r => r.v, null) : ''),
        known ? `${Math.round(sc.customer / known * 100)}% of orders were placed by customers themselves from the QR menu.` : '');
    }

    // edits / accountability
    const ed = d.edits;
    const editPanel = stot ? panel('Changes after ordering',
      `<div class="an-kpis" style="padding:0; margin-bottom:0;"><div class="an-kpi-card"><div class="an-kpi-label">Items changed</div><div class="an-kpi-value">${ed.total}</div></div><div class="an-kpi-card"><div class="an-kpi-label">Items removed</div><div class="an-kpi-value">${ed.removed}</div></div></div>` +
      (ed.by_staff.length ? `<div class="an-sub-h">By person</div>` + hBars(ed.by_staff.map(s => ({ label: s.name, v: s.count })), r => r.v, null) : ''),
      ed.total === 0 ? `No order or bill was changed after it was placed ${month ? 'this month' : 'this year'}.`
        : `${ed.total} item change${ed.total === 1 ? '' : 's'}${ed.by_staff.length ? `, most by ${esc(ed.by_staff[0].name)} (${ed.by_staff[0].count})` : ''}. Keep an eye on removals.`) : '';

    // customers
    const cu = d.customers;
    const custPanel = !noSales ? panel('Regular customers',
      `<div class="an-kpis" style="padding:0; margin-bottom:0;"><div class="an-kpi-card"><div class="an-kpi-label">Bills with a customer</div><div class="an-kpi-value">${cu.total_bills ? Math.round(cu.identified_bills / cu.total_bills * 100) : 0}%</div></div>
        <div class="an-kpi-card"><div class="an-kpi-label">Customers seen</div><div class="an-kpi-value">${cu.customers}</div></div>
        <div class="an-kpi-card"><div class="an-kpi-label">Came back</div><div class="an-kpi-value">${cu.returning}</div></div>
        <div class="an-kpi-card"><div class="an-kpi-label">New customers</div><div class="an-kpi-value">${cu.new}</div></div></div>`,
      cu.identified_bills === 0 ? 'No bills had a customer attached. Add a mobile number while billing to see who comes back, and to run loyalty rewards.'
        : `${Math.round(cu.identified_bills / cu.total_bills * 100)}% of bills had a customer attached. ${cu.returning} of ${cu.customers} had visited before.`) : '';

    body.innerHTML = `
      <div class="an-kpis">
        ${kpi('Total sales', RUPEE(t.revenue), t.revenue, pRev)}
        ${kpi('Bills', t.bills, t.bills, pBills)}
        ${kpi('Average bill', RUPEE(t.avg_bill), t.avg_bill, pAvg)}
        ${kpi('Discounts given', RUPEE(t.discounts), 0, null)}
        ${r.count ? kpi('Rating', r.avg.toFixed(1) + ' ★', r.avg, pr.avg, `<div class="an-kpi-label" style="margin-top:6px">${r.count} review${r.count === 1 ? '' : 's'}</div>`) : ''}
      </div>
      ${insightLine(headline)}
      ${t.bills && pBills ? insightLine(`Average bill ${t.avg_bill >= pAvg ? 'rose' : 'fell'} to ${RUPEE(t.avg_bill)} (was ${RUPEE(pAvg)} in ${esc(cmp)}); ${t.bills >= pBills ? 'more' : 'fewer'} bills too (${t.bills} vs ${pBills}).`) : ''}
      ${chart}${cal}${wdPanel}${heat}${itemsPanel}${catPanel}${unsoldPanel}${payPanel}${srcPanel}${editPanel}${custPanel}
      ${d.turnover_minutes != null ? panel('Table time', `<div class="an-kpis" style="padding:0;margin-bottom:0"><div class="an-kpi-card"><div class="an-kpi-label">Avg. time at a table</div><div class="an-kpi-value">${d.turnover_minutes} min</div></div></div>`, null) : ''}
    `;
    paintDues();
    wireTips(body, d);
    body.querySelectorAll('[data-open-day]').forEach(b => b.onclick = () => openDay(b.dataset.openDay));
    const tb = body.querySelector('[data-table-toggle]');
    if (tb) tb.onclick = () => {
      const box = body.querySelector('[data-table]'), open = box.hidden;
      if (open && !box.innerHTML) {
        const rows = d.series.filter(x => !x.future).map(x => `<tr><td>${esc(tipTitle(d, x))}</td><td>${esc(RUPEE(x.revenue))}</td><td>${x.bills}</td><td>${x.prev_revenue ? esc(RUPEE(x.prev_revenue)) : '—'}</td></tr>`).join('');
        box.innerHTML = `<table class="an-tbl"><thead><tr><th>${month ? 'Day' : 'Month'}</th><th>Sales</th><th>Bills</th><th>${esc(d.prev_label)}</th></tr></thead><tbody>${rows}</tbody></table>`;
      }
      box.hidden = !open; tb.textContent = open ? 'Hide table' : 'View as table'; tb.setAttribute('aria-expanded', String(open));
    };
  }

  root.Analytics = { load: load, setRange: setRange, setDay: setDay, download: download, invalidate: invalidate, openDay: openDay, backToPeriod: backToPeriod };
})(typeof window !== 'undefined' ? window : globalThis);
