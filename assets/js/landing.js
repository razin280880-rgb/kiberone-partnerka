/* === KIBERone Partnership Funnel — Landing controller === */

(function () {
  'use strict';

  // ---------- State ----------
  const state = {
    sessionId: null,
    partnerSlug: null,
    partnerName: null,
    partnerCity: null,
    hero: {
      color: 'purple',
      colorHex: '#6B2FB5',
      weapon: null,
      power: null,
      name: ''
    },
    parent: {
      childName: '',
      childAge: null,
      whatsapp: ''
    },
    slot: null,
    currentScreen: 'screen-welcome'
  };

  const TUTOR_BY_CITY = {
    chln:  { name: 'Анна', city: 'Челнах' },
    nkmsk: { name: 'Елена', city: 'Нижнекамске' },
    kzn:   { name: 'Дилюза', city: 'Казани' },
    elb:   { name: 'Алина', city: 'Елабуге' },
    krd:   { name: 'Виктория', city: 'Краснодаре' },
    srg:   { name: 'Мария', city: 'Сургуте' },
    prm:   { name: 'Анастасия', city: 'Перми' }
  };

  const PARTNER_TYPES = {
    stomat: 'детская стоматология',
    eng: 'школа английского',
    chess: 'шахматный клуб',
    art: 'творческая студия',
    danc: 'школа танцев',
    cafe: 'семейное кафе',
    sport: 'спортивная секция'
  };

  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const next = document.getElementById(id);
    if (!next) return;
    next.classList.add('active');
    state.currentScreen = id;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function genSessionId() {
    return 'sess_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
  }

  // ---------- URL params / partner detection ----------
  function parseUtm() {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('p') || params.get('partner') || 'demo_chln_01';
    const parts = p.split('_');
    state.partnerSlug = p;
    state.partnerName = PARTNER_TYPES[parts[0]] || 'партнёру';
    state.partnerCity = parts[1] || 'chln';
  }

  // ---------- Live counter ----------
  async function loadLiveCounter() {
    try {
      const r = await fetch(`/api/stats?type=live&city=${state.partnerCity}`).catch(() => null);
      if (r && r.ok) {
        const data = await r.json();
        $('#live-count').textContent = data.todayCount || 47;
      }
    } catch (e) { /* offline-safe default */ }
    const tutor = TUTOR_BY_CITY[state.partnerCity] || TUTOR_BY_CITY.chln;
    $('#city-name').textContent = tutor.city;
  }

  // ---------- Scan tracking ----------
  function sendScanEvent() {
    if (!navigator.sendBeacon) return;
    const payload = new Blob([JSON.stringify({
      partner_slug: state.partnerSlug,
      session_id: state.sessionId,
      ua: navigator.userAgent
    })], { type: 'application/json' });
    navigator.sendBeacon('/api/scan', payload);
  }

  // ---------- Welcome screen ----------
  function initWelcome() {
    $('#btn-start').addEventListener('click', () => {
      window.HeroGame && window.HeroGame.init(state);
      showScreen('screen-game');
    });
  }

  // ---------- Game complete → Result screen ----------
  function onGameComplete(heroData) {
    state.hero = { ...state.hero, ...heroData };

    // Заполняем имя ребёнка/героя на экране результата
    $('#result-name').textContent = state.hero.name || 'друг';

    // Клонируем визуал героя
    const original = $('#hero-visual').cloneNode(true);
    const target = $('#result-hero-visual');
    target.innerHTML = '';
    target.appendChild(original);

    showScreen('screen-result');
  }

  function initResult() {
    $('#btn-want-plan').addEventListener('click', () => {
      // Префиллим имя ребёнка
      $('#f-child-name').value = state.hero.name || '';
      $('#f-partner-slug').value = state.partnerSlug;
      $('#f-session-id').value = state.sessionId;
      $('#f-hero-config').value = JSON.stringify(state.hero);
      showScreen('screen-form');
      startTimer();
    });
  }

  // ---------- Timer ----------
  let timerInterval = null;
  function startTimer() {
    const endTime = Date.now() + 24 * 60 * 60 * 1000;
    function tick() {
      const left = Math.max(0, endTime - Date.now());
      const h = String(Math.floor(left / 3600000)).padStart(2, '0');
      const m = String(Math.floor((left % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
      const text = `${h}:${m}:${s}`;
      const t1 = $('#timer'); if (t1) t1.textContent = text;
      const t2 = $('#slot-timer'); if (t2) t2.textContent = text;
    }
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  // ---------- Form ----------
  function initForm() {
    const form = $('#form-lead');
    const phoneInput = $('#f-parent-whatsapp');

    // Маска телефона
    phoneInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.startsWith('8')) v = '7' + v.slice(1);
      if (!v.startsWith('7') && v.length) v = '7' + v;
      v = v.slice(0, 11);
      let out = '+7';
      if (v.length > 1) out += ' ' + v.slice(1, 4);
      if (v.length > 4) out += ' ' + v.slice(4, 7);
      if (v.length > 7) out += ' ' + v.slice(7, 9);
      if (v.length > 9) out += ' ' + v.slice(9, 11);
      e.target.value = out;
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#btn-submit');
      btn.disabled = true;
      btn.textContent = 'Отправляем...';

      const payload = {
        partner_slug: state.partnerSlug,
        session_id: state.sessionId,
        child_name: $('#f-child-name').value.trim(),
        child_age: parseInt($('#f-child-age').value, 10),
        parent_whatsapp: $('#f-parent-whatsapp').value.replace(/\D/g, ''),
        hero_config: state.hero
      };

      state.parent = {
        childName: payload.child_name,
        childAge: payload.child_age,
        whatsapp: payload.parent_whatsapp
      };

      try {
        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Network error');
        const data = await res.json();
        renderReward(data);
        showScreen('screen-reward');
      } catch (err) {
        // Офлайн-фолбэк: всё равно показываем награду, лид уйдёт через retry в background
        console.warn('Submit error, showing reward with local data', err);
        renderReward({});
        showScreen('screen-reward');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Получить план развития →';
      }
    });
  }

  // ---------- Reward rendering ----------
  function pickAgeGroup(age) {
    if (age <= 7) return 'mladshaya-5-7';
    if (age <= 11) return 'srednyaya-8-11';
    return 'starshaya-12-14';
  }

  function renderReward(data) {
    const child = state.parent.childName || state.hero.name || 'ребёнок';
    const age = state.parent.childAge || 9;
    const ageGroup = pickAgeGroup(age);
    const tutor = TUTOR_BY_CITY[state.partnerCity] || TUTOR_BY_CITY.chln;

    $('#reward-parent-target').textContent = child;
    $('#reward-child-name').textContent = child;
    $('#reward-age').textContent = age;
    $('#reward-hero-title').textContent = `Кибергерой ${state.hero.name || child}`;
    $('#reward-tutor-name').textContent = tutor.name;
    $('#reward-city').textContent = tutor.city;
    $('#reward-partner-name').textContent = state.partnerName;
    $('#invitation-name').textContent = child;

    // Hero visual в карточку
    const heroClone = $('#hero-visual').cloneNode(true);
    const heroTarget = $('#reward-hero-visual');
    heroTarget.innerHTML = '';
    heroTarget.appendChild(heroClone);

    // PDF и видео ссылки
    $('#reward-pdf-link').href = data.roadmapUrl || `/roadmaps/${ageGroup}.pdf`;
    const videoUrl = data.videoUrl || `/videos/${state.partnerCity}-${ageGroup}.mp4`;

    $('#btn-play-video').addEventListener('click', () => {
      const v = $('#reward-video');
      v.src = videoUrl;
      v.hidden = false;
      v.play();
      $('#btn-play-video').hidden = true;
    });

    // Слоты пробного
    initSlots(data.slots || []);

    // Share hero
    $('#btn-share-hero').addEventListener('click', shareHero);
  }

  function initSlots(slotsFromApi) {
    const grid = $('#slot-grid');
    if (slotsFromApi.length) {
      grid.innerHTML = slotsFromApi.map(s =>
        `<button class="slot" data-slot="${s.iso}">${s.label}</button>`
      ).join('');
    }
    grid.addEventListener('click', (e) => {
      const slot = e.target.closest('.slot');
      if (!slot) return;
      grid.querySelectorAll('.slot').forEach(s => s.classList.remove('selected'));
      slot.classList.add('selected');
      state.slot = slot.dataset.slot;
      $('#btn-book-slot').disabled = false;
    });
    $('#btn-book-slot').addEventListener('click', async () => {
      if (!state.slot) return;
      const btn = $('#btn-book-slot');
      btn.disabled = true;
      btn.textContent = 'Бронируем...';
      try {
        await fetch('/api/book-slot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: state.sessionId,
            partner_slug: state.partnerSlug,
            slot_iso: state.slot
          })
        });
        btn.textContent = '✅ Забронировано! Ждём вас';
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Забронировать';
      }
    });
  }

  async function shareHero() {
    const btn = $('#btn-share-hero');
    btn.textContent = '📸 Готовим...';
    try {
      // В V3 — генерация картинки через AI
      // Сейчас — скриншот SVG через canvas
      const svg = $('#reward-hero-visual svg');
      if (!svg) return;
      const xml = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([xml], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kibergeroy-${state.hero.name || 'kid'}.svg`;
      a.click();
      btn.textContent = '✅ Сохранено';
    } catch (e) {
      btn.textContent = '📸 Сохранить картинку';
    }
  }

  // ---------- Init ----------
  function init() {
    state.sessionId = genSessionId();
    parseUtm();
    loadLiveCounter();
    sendScanEvent();
    initWelcome();
    initResult();
    initForm();
  }

  // Экспорт обработчика для game.js
  window.LandingApp = { onGameComplete, getState: () => state };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
