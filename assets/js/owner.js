/* === Owner dashboard controller === */

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const state = { period: 'week', data: null };

  function fmt(n) { return new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)); }
  function fmtRub(n) { return fmt(n) + ' ₽'; }

  // ---------- Auth guard ----------
  async function checkAuth() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = await r.json();
      // /api/auth/me возвращает partner если есть. Для owner partner будет '__owner__' или null.
      // Проверяем через /api/admin/overview — если 401/403, не тот.
      if (!data.authenticated) {
        window.location.href = '/owner-login.html';
        return false;
      }
      return true;
    } catch (e) {
      window.location.href = '/owner-login.html';
      return false;
    }
  }

  async function doLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
    catch (e) {}
    window.location.href = '/owner-login.html';
  }

  // ---------- Tabs ----------
  function initTabs() {
    $$('.cab-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.cab-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $$('.cab-pane').forEach(p => p.classList.remove('active'));
        const pane = document.querySelector(`[data-pane="${tab.dataset.tab}"]`);
        if (pane) pane.classList.add('active');
        if (tab.dataset.tab === 'disputes') loadDisputes();
      });
    });
  }

  // ---------- Loading ----------
  async function loadOverview() {
    const r = await fetch(`/api/admin/overview?period=${state.period}`, { credentials: 'same-origin' });
    if (r.status === 401 || r.status === 403) {
      window.location.href = '/owner-login.html';
      return null;
    }
    if (!r.ok) return null;
    return await r.json();
  }

  async function loadDisputes() {
    const r = await fetch('/api/admin/disputes/list', { credentials: 'same-origin' });
    if (!r.ok) return;
    const data = await r.json();
    renderDisputes(data.disputes || []);
  }

  // ---------- Rendering ----------
  function renderOverview(d) {
    state.data = d;

    // KPI cards
    $('#ov-amount').textContent = fmtRub(d.total.amount);
    $('#ov-partners').textContent = d.total.activePartners;
    $('#ov-scans').textContent = fmt(d.total.scans);
    $('#ov-leads').textContent = fmt(d.total.leads);
    $('#ov-trials').textContent = fmt(d.total.trials);
    $('#ov-paid').textContent = fmt(d.total.paid);

    // Disputes badge
    const badge = $('#disputes-badge');
    badge.textContent = d.activeDisputes || '';
    badge.classList.toggle('zero', !d.activeDisputes);

    // Funnel
    renderFunnel(d.total);

    // 12 weeks dynamics chart
    renderDynamics(d.dynamics12w);

    // Top / Bottom
    renderTop(d.topPartners);
    renderBottom(d.bottomPartners);

    // Cities table
    renderCities(d.cities, d.total);

    // Partners table (top 20)
    renderPartners(d.topPartners.slice(0, 20));

    // MRs
    renderMrs(d.mrs);
  }

  function renderFunnel(t) {
    const max = t.scans || 1;
    const stages = [
      { label: 'Сканы',   value: t.scans,  color: '#00C9FF' },
      { label: 'Анкеты',  value: t.leads,  color: '#6B2FB5' },
      { label: 'Пробные', value: t.trials, color: '#FFD43B' },
      { label: 'Оплаты',  value: t.paid,   color: '#2EC4B6' }
    ];
    $('#ov-funnel').innerHTML = stages.map(s => {
      const pct = (s.value / max * 100).toFixed(1);
      return `<div class="funnel-row">
        <div class="funnel-label">${s.label}</div>
        <div class="funnel-bar"><div class="funnel-bar-fill" style="width:${pct}%;background:${s.color}"></div></div>
        <div class="funnel-num">${fmt(s.value)}</div>
      </div>`;
    }).join('');
  }

  function renderDynamics(weeks) {
    const max = Math.max(...weeks.map(w => w.leads), 1);
    $('#ov-chart').innerHTML = weeks.map(w => {
      const h = Math.max(2, (w.leads / max) * 100);
      return `<div class="chart-bar" style="height:${h}%" title="${w.label}: ${w.leads} анкет, ${fmtRub(w.amount)}"></div>`;
    }).join('');
  }

  function renderTop(top) {
    if (!top.length) { $('#ov-top').innerHTML = '<div class="empty">Пока нет данных</div>'; return; }
    $('#ov-top').innerHTML = top.slice(0, 5).map((p, i) => `
      <div class="top-item">
        <div class="rank">${i + 1}</div>
        <div><div class="top-name">${p.name}</div><div class="top-city">${cityLabel(p.city)}</div></div>
        <div class="top-metric">${p.leads}</div>
      </div>
    `).join('');
  }

  function renderBottom(bottom) {
    if (!bottom.length) { $('#ov-bottom').innerHTML = '<div class="empty">✅ Все партнёры активны</div>'; return; }
    const now = Math.floor(Date.now() / 1000);
    $('#ov-bottom').innerHTML = bottom.map((p) => {
      const days = p.last_lead ? Math.floor((now - p.last_lead) / 86400) : '∞';
      return `<div class="top-item bottom-item">
        <div class="rank">⚠️</div>
        <div><div class="top-name">${p.name}</div><div class="top-city">${cityLabel(p.city)}</div></div>
        <div class="top-metric">${days} <small>дн.</small></div>
      </div>`;
    }).join('');
  }

  function cityLabel(key) {
    return ({ chln: 'Челны', nkmsk: 'Нижнекамск', kzn: 'Казань', elb: 'Елабуга',
             krd: 'Краснодар', srg: 'Сургут', prm: 'Пермь' })[key] || key;
  }

  function renderCities(cities, total) {
    $('#cities-tbody').innerHTML = cities.map(c => {
      const conv = c.leads > 0 ? ((c.paid / c.leads * 100).toFixed(1) + '%') : '—';
      return `<tr>
        <td><strong>${c.cityName}</strong></td>
        <td>${c.activePartners}</td>
        <td>${fmt(c.scans)}</td>
        <td>${fmt(c.leads)}</td>
        <td>${fmt(c.trials)}</td>
        <td>${fmt(c.paid)}</td>
        <td>${conv}</td>
        <td><strong>${fmtRub(c.amount)}</strong></td>
      </tr>`;
    }).join('') + `<tr style="background:#FAFAFE;font-weight:700">
      <td>Всего</td>
      <td>${total.activePartners}</td>
      <td>${fmt(total.scans)}</td>
      <td>${fmt(total.leads)}</td>
      <td>${fmt(total.trials)}</td>
      <td>${fmt(total.paid)}</td>
      <td>${total.leads ? ((total.paid / total.leads * 100).toFixed(1) + '%') : '—'}</td>
      <td>${fmtRub(total.amount)}</td>
    </tr>`;
  }

  function renderPartners(top) {
    $('#partners-tbody').innerHTML = top.map(p => `
      <tr>
        <td><strong>${p.name}</strong> <span style="color:var(--color-text-muted);font-size:0.78rem">${p.slug}</span></td>
        <td>${cityLabel(p.city)}</td>
        <td><strong>${p.leads}</strong></td>
        <td><strong>${p.paid || 0}</strong></td>
      </tr>
    `).join('');
  }

  function renderMrs(mrs) {
    if (!mrs.length) { $('#mrs-tbody').innerHTML = '<tr><td colspan="4" class="empty">Нет данных</td></tr>'; return; }
    $('#mrs-tbody').innerHTML = mrs.map(m => `
      <tr>
        <td><strong>${m.mr_name}</strong></td>
        <td>${m.partners}</td>
        <td><strong>${m.leads}</strong></td>
        <td><strong>${m.paid || 0}</strong></td>
      </tr>
    `).join('');
  }

  function renderDisputes(disputes) {
    if (!disputes.length) {
      $('#disputes-tbody').innerHTML = '<tr><td colspan="6" class="empty">✅ Активных диспутов нет</td></tr>';
      return;
    }
    $('#disputes-tbody').innerHTML = disputes.map(d => `
      <tr data-lead-id="${d.id}">
        <td>#${d.id}</td>
        <td>${d.partner_name}</td>
        <td>${cityLabel(d.partner_city)}</td>
        <td><div class="dispute-reason">${escapeHtml(d.dispute_reason)}</div></td>
        <td><span class="status-pill">${d.status}</span></td>
        <td>
          <div class="dispute-actions">
            <button class="btn-accept" data-action="accept">Принять</button>
            <button class="btn-reject" data-action="reject">Отклонить</button>
          </div>
        </td>
      </tr>
    `).join('');

    $('#disputes-tbody').addEventListener('click', onDisputeAction);
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function onDisputeAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const row = btn.closest('tr');
    const lead_id = parseInt(row.dataset.leadId, 10);

    const note = prompt(
      action === 'accept'
        ? 'Принять спор партнёра (анкета будет признана невалидной, начисление аннулировано).\n\nКомментарий партнёру (опционально):'
        : 'Отклонить спор партнёра (анкета остаётся валидной, начисление сохраняется).\n\nКомментарий партнёру (опционально):'
    );
    if (note === null) return;

    btn.disabled = true;
    btn.textContent = '...';
    const r = await fetch('/api/admin/disputes/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ lead_id, action, note })
    });
    if (r.ok) {
      row.remove();
      loadOverview().then(d => d && renderOverview(d));
    } else {
      btn.disabled = false;
      btn.textContent = action === 'accept' ? 'Принять' : 'Отклонить';
      alert('Не получилось.');
    }
  }

  function initRealtime() {
    if (!window.Realtime) return;
    window.Realtime.on('new_lead', () => {
      window.Realtime.showToast('🆕 Новая анкета в сети', 'success');
      reloadOverviewSilently();
    });
    window.Realtime.on('dispute_opened', (ev) => {
      window.Realtime.showToast(
        `⚖️ Новый диспут от партнёра (лид #${ev.payload?.lead_id})`,
        'warning',
        8000
      );
      reloadOverviewSilently();
      // Если на табе диспутов — мгновенно обновим ленту.
      const active = document.querySelector('.cab-tab.active');
      if (active && active.dataset.tab === 'disputes') loadDisputes();
    });
    window.Realtime.on('dispute_resolved', () => {
      reloadOverviewSilently();
    });
    window.Realtime.on('status_changed', () => {
      reloadOverviewSilently();
    });
    window.Realtime.start();
  }

  async function reloadOverviewSilently() {
    const d = await loadOverview();
    if (d) renderOverview(d);
  }

  // ---------- Init ----------
  async function init() {
    if (!(await checkAuth())) return;
    initTabs();
    $('#btn-logout').addEventListener('click', doLogout);
    $('#period-select').addEventListener('change', async (e) => {
      state.period = e.target.value;
      const d = await loadOverview();
      if (d) renderOverview(d);
    });
    const d = await loadOverview();
    if (d) renderOverview(d);
    initRealtime();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
