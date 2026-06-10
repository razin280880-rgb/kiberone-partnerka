/* === Партнёрский кабинет — controller === */

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // slug определяется на сервере по session cookie.
  // Demo-режим возможен только если ?demo=1 в URL — UI помечает «демо-данные».
  const params = new URLSearchParams(window.location.search);
  const DEMO = params.get('demo') === '1';
  let slug = null;  // заполнится из /api/auth/me

  const state = { partner: null, leads: [], payouts: [] };

  // --- Mock data fallback ---
  const MOCK = {
    partner: {
      slug: 'demo_chln_01',
      name: 'Детская стоматология «Зубарик»',
      type: 'stomat',
      city: 'Челны',
      rate_anketa: 200,
      tier: 'silver',
      requisites: {
        name: 'ИП Иванов И.И.',
        inn: '163100000000',
        account: '40802810500000000000',
        bank: 'АО «Тинькофф Банк»'
      },
      mr: { name: 'Анна', avatar: 'А', city: 'Челны', tg: 'https://t.me/anna_kiberone', wa: 'https://wa.me/79170000000' }
    },
    stats: {
      monthAmount: 17950,
      prevMonthAmount: 14200,
      leadsCount: 23,
      leadsTrend: '+5 к прошлой неделе',
      trialsCount: 9,
      trialsTrend: '+2',
      paidCount: 2,
      paidTrend: 'без изменений',
      scans30d: [3, 5, 4, 8, 6, 2, 7, 9, 5, 4, 6, 8, 3, 5, 7, 10, 6, 4, 8, 9, 5, 7, 11, 8, 6, 4, 5, 9, 7, 8],
      ratingPlace: 3,
      ratingTotal: 12,
      forecastLeads: 31,
      tierProgress: { current: 5, target: 10 }
    },
    leads: [
      { date: '12.06', age: 9, status: 'qualified', amount: 200, comment: '' },
      { date: '12.06', age: 7, status: 'pending', amount: null, comment: 'прозвон в 14:30' },
      { date: '11.06', age: 12, status: 'trial_booked', amount: 700, comment: 'пробный 15.06' },
      { date: '11.06', age: 6, status: 'qualified', amount: 200, comment: '' },
      { date: '10.06', age: 8, status: 'rejected', amount: 0, comment: 'сотрудник партнёра' },
      { date: '10.06', age: 11, status: 'paid', amount: 2700, comment: '+2000₽ оплата' },
      { date: '09.06', age: 10, status: 'trial_came', amount: 700, comment: 'пробный 10.06' },
      { date: '08.06', age: 7, status: 'qualified', amount: 200, comment: '' }
    ],
    payouts: [
      { period: 'Май 2026', leads: 27, trials: 11, paid: 3, amount: 16800, status: 'paid', act: '#' },
      { period: 'Апрель 2026', leads: 22, trials: 8, paid: 2, amount: 12400, status: 'paid', act: '#' },
      { period: 'Март 2026', leads: 18, trials: 5, paid: 1, amount: 8500, status: 'paid', act: '#' }
    ]
  };

  // ---------- Tabs ----------
  function initTabs() {
    $$('.cab-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        $$('.cab-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $$('.cab-pane').forEach(p => p.classList.remove('active'));
        const pane = document.querySelector(`[data-pane="${target}"]`);
        if (pane) pane.classList.add('active');
        history.replaceState(null, '', `?p=${slug}&tab=${target}`);
      });
    });

    // Включить начальный таб из URL
    const initialTab = params.get('tab');
    if (initialTab) {
      const t = document.querySelector(`.cab-tab[data-tab="${initialTab}"]`);
      if (t) t.click();
    }
  }

  // ---------- Аутентификация ----------
  async function checkAuth() {
    if (DEMO) return { authenticated: true, partner_slug: 'demo_chln_01' };
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = await r.json();
      if (!data.authenticated) {
        window.location.href = '/login.html';
        return null;
      }
      return data;
    } catch (e) {
      window.location.href = '/login.html';
      return null;
    }
  }

  async function doLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) { /* fallthrough */ }
    window.location.href = '/login.html';
  }

  // ---------- Загрузка данных ----------
  async function loadData() {
    if (DEMO) return MOCK;
    try {
      const r = await fetch('/api/stats', { credentials: 'same-origin' });
      if (r.status === 401) {
        window.location.href = '/login.html';
        return MOCK;
      }
      if (r.ok) {
        const data = await r.json();
        // Сливаем с моком: если в БД партнёр пустой/новый — UI всё равно рендерится.
        return { ...MOCK, ...data, partner: { ...MOCK.partner, ...(data.partner || {}) } };
      }
    } catch (e) {
      console.warn('API недоступен, рендер моков', e);
    }
    return MOCK;
  }

  // ---------- Рендеры ----------
  function fmtRub(n) {
    return new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
  }

  function renderHeader(data) {
    $('#cab-partner-name').textContent = data.partner.name;
    $('#cab-partner-meta').textContent = data.partner.city + ' · ' + tierLabel(data.partner.tier);
  }

  function tierLabel(tier) {
    return ({ base: '🟢 Базовый', silver: '⚪ Серебряный', gold: '🟡 Золотой', year: '🏆 Партнёр года' })[tier] || 'Базовый';
  }

  function renderDashboard(data) {
    const s = data.stats;
    $('#stat-amount').textContent = fmtRub(s.monthAmount);

    const diff = s.monthAmount - s.prevMonthAmount;
    const pct = s.prevMonthAmount ? Math.round((diff / s.prevMonthAmount) * 100) : 0;
    $('#stat-amount-trend').textContent = (pct >= 0 ? '↑ ' : '↓ ') + Math.abs(pct) + '% к прошлому месяцу';

    $('#stat-leads').textContent = s.leadsCount;
    $('#stat-leads-trend').textContent = s.leadsTrend;
    $('#stat-trials').textContent = s.trialsCount;
    $('#stat-trials-trend').textContent = s.trialsTrend;
    $('#stat-paid').textContent = s.paidCount;
    $('#stat-paid-trend').textContent = s.paidTrend;

    $('#forecast-leads').textContent = s.forecastLeads + ' анкет';
    const pctBar = Math.min(100, (s.leadsCount / s.forecastLeads) * 100);
    $('#forecast-bar-current').style.width = pctBar + '%';
    const norm = 5 * 4; // 5 анкет в неделю × 4 нед
    $('#forecast-status').textContent = s.leadsCount >= norm ? `✅ Норма выполнена` : `${norm - s.leadsCount} осталось`;

    // Воронка
    const scansSum = s.scans30d.reduce((a, b) => a + b, 0);
    const stages = [
      { id: 'scans', value: scansSum, max: scansSum },
      { id: 'leads', value: s.leadsCount, max: scansSum },
      { id: 'trials', value: s.trialsCount, max: scansSum },
      { id: 'paid', value: s.paidCount, max: scansSum }
    ];
    stages.forEach(st => {
      const pct = st.max ? (st.value / st.max * 100) : 0;
      document.getElementById('fb-' + st.id).style.width = pct + '%';
      document.getElementById('fn-' + st.id).textContent = st.value;
    });

    // Чарт
    renderChart(s.scans30d);

    // Рейтинг
    $('#rating-place').textContent = s.ratingPlace + ' из ' + s.ratingTotal;
    $('#rating-city').textContent = 'в ' + data.partner.city;
    $('#tier-badge').textContent = tierLabel(data.partner.tier);
    $('#tier-desc').textContent = data.partner.tier === 'base'
      ? 'Достигните 10 анкет/мес 3 месяца подряд → Серебряный'
      : data.partner.tier === 'silver'
      ? 'Достигните 20 анкет/мес или 5 оплат/квартал → Золотой'
      : data.partner.tier === 'gold'
      ? 'Будьте топ-1 в городе по итогам года → Партнёр года'
      : 'Вы — топ! Спасибо 💜';
  }

  function renderChart(data) {
    const el = $('#chart-scans');
    const max = Math.max(...data, 1);
    el.innerHTML = data.map(v => {
      const h = Math.max(2, (v / max) * 100);
      return `<div class="chart-bar" style="height:${h}%" title="${v} сканов"></div>`;
    }).join('');
  }

  function statusPill(s) {
    const map = {
      qualified: { cls: 'status-qualified', text: '✅ Квалифицирована' },
      pending: { cls: 'status-pending', text: '⏳ В прозвоне' },
      trial_booked: { cls: 'status-trial', text: '📅 На пробном' },
      trial_came: { cls: 'status-trial', text: '✅ Пришёл на пробный' },
      paid: { cls: 'status-paid', text: '💰 Оплатил' },
      rejected: { cls: 'status-rejected', text: '❌ Не квалифицирована' }
    };
    const m = map[s] || { cls: '', text: s };
    return `<span class="status-pill ${m.cls}">${m.text}</span>`;
  }

  function renderLeads(data) {
    const tbody = $('#leads-tbody');
    if (!data.leads.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Пока нет анкет</td></tr>`;
      return;
    }
    tbody.innerHTML = data.leads.map(l => `
      <tr>
        <td>${l.date}</td>
        <td>${l.age} лет</td>
        <td>${statusPill(l.status)}</td>
        <td><strong>${l.amount == null ? '—' : fmtRub(l.amount)}</strong></td>
        <td><span class="hint">${l.comment || ''}</span></td>
        <td>${l.status === 'rejected' ? '<button class="btn-secondary" data-action="dispute">Оспорить</button>' : ''}</td>
      </tr>
    `).join('');
  }

  function renderPayouts(data) {
    const tbody = $('#payouts-tbody');
    if (!data.payouts.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">Пока нет выплат</td></tr>`;
      return;
    }
    tbody.innerHTML = data.payouts.map(p => `
      <tr>
        <td>${p.period}</td>
        <td>${p.leads}</td>
        <td>${p.trials}</td>
        <td>${p.paid}</td>
        <td><strong>${fmtRub(p.amount)}</strong></td>
        <td>${p.status === 'paid' ? '<span class="status-pill status-qualified">✅ Выплачено</span>' : '<span class="status-pill status-pending">⏳ В очереди</span>'}</td>
        <td><a href="${p.act}" class="btn-secondary" download>PDF</a></td>
      </tr>
    `).join('');

    const req = data.partner.requisites || {};
    $('#req-name').textContent = req.name || '—';
    $('#req-inn').textContent = req.inn || '—';
    $('#req-account').textContent = req.account || '—';
    $('#req-bank').textContent = req.bank || '—';
  }

  function renderLoyalty(data) {
    const tier = data.partner.tier || 'base';
    $('#loy-tier-icon').textContent = ({ base: '🟢', silver: '⚪', gold: '🟡', year: '🏆' })[tier] || '🟢';
    $('#loy-tier-name').textContent = tierLabel(tier).replace(/^.\s/, '');
    const rate = data.partner.rate_anketa + ({ base: 0, silver: 20, gold: 50 })[tier] || 0;
    $('#loy-rate').textContent = (data.partner.rate_anketa + ({ base: 0, silver: 20, gold: 50 }[tier] || 0)) + ' ₽/анкета';

    const p = data.stats.tierProgress || { current: 0, target: 10 };
    $('#prog-text').textContent = `${p.current} из ${p.target}`;
    $('#prog-bar').style.width = Math.min(100, (p.current / p.target) * 100) + '%';
  }

  function renderSupport(data) {
    const mr = data.partner.mr;
    if (!mr) return;
    $('#mr-name').textContent = mr.name;
    $('#mr-avatar').textContent = mr.avatar;
    $('#mr-tg').href = mr.tg;
    $('#mr-wa').href = mr.wa;
  }

  // ---------- Init ----------
  async function init() {
    const auth = await checkAuth();
    if (!auth) return;  // редирект на /login.html
    slug = auth.partner_slug;

    initTabs();
    initLogout();

    const data = await loadData();
    state.partner = data.partner;
    renderHeader(data);
    renderDashboard(data);
    renderLeads(data);
    renderPayouts(data);
    renderLoyalty(data);
    renderSupport(data);

    // Refer-button
    const btnRefer = document.getElementById('btn-refer');
    if (btnRefer) {
      btnRefer.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(`https://partner.it-kiber.ru/refer/${slug}`);
          btnRefer.textContent = '✅ Ссылка скопирована';
        } catch (e) {
          btnRefer.textContent = `https://partner.it-kiber.ru/refer/${slug}`;
        }
      });
    }
  }

  function initLogout() {
    const btn = document.getElementById('btn-logout');
    if (btn) btn.addEventListener('click', doLogout);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
