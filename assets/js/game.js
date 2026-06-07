/* === KIBERone Hero Constructor — мини-игра 4 шага === */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const state = {
    step: 1,
    totalSteps: 4,
    color: 'purple',
    colorHex: '#6B2FB5',
    weapon: null,
    power: null,
    name: ''
  };

  // Иконки оружия (SVG-наложение поверх героя)
  const WEAPON_SVG = {
    laptop: `<g transform="translate(150, 130)">
      <rect x="-15" y="-10" width="30" height="20" rx="2" fill="#1A1A2E"/>
      <rect x="-13" y="-8" width="26" height="16" fill="#00C9FF"/>
      <rect x="-18" y="10" width="36" height="3" rx="1" fill="#444"/>
    </g>`,
    sword: `<g transform="translate(150, 145)">
      <rect x="-2" y="-25" width="4" height="50" fill="#C0C0C0"/>
      <rect x="-8" y="-30" width="16" height="6" fill="#FFD43B"/>
      <rect x="-1" y="25" width="2" height="10" fill="#FFD43B"/>
    </g>`,
    shield: `<g transform="translate(45, 145)">
      <path d="M0 -25 L 18 -15 L 18 10 Q 18 25 0 30 Q -18 25 -18 10 L -18 -15 Z" fill="#FFD43B" stroke="#1A1A2E" stroke-width="2"/>
      <text x="0" y="6" text-anchor="middle" fill="#1A1A2E" font-size="20" font-weight="bold" font-family="monospace">K</text>
    </g>`,
    wand: `<g transform="translate(150, 140)">
      <rect x="-1" y="-20" width="2" height="40" fill="#8B4513"/>
      <circle cx="0" cy="-25" r="8" fill="#FF3DA8"/>
      <circle cx="0" cy="-25" r="4" fill="#fff" opacity="0.8"/>
      <text x="0" y="-22" text-anchor="middle" fill="#1A1A2E" font-size="10" font-weight="bold">AI</text>
    </g>`
  };

  const HERO_INITIALS = {
    speed: 'F1',
    logic: 'L0',
    creativity: 'ART',
    strategy: 'STR'
  };

  // ---------- Step navigation ----------
  function updateProgress() {
    $('#step-current').textContent = state.step;
    $('#step-bar').style.width = (state.step / state.totalSteps * 100) + '%';
  }

  function goToStep(n) {
    state.step = n;
    updateProgress();
    ['choice-color', 'choice-weapon', 'choice-power', 'choice-name'].forEach((id, idx) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.hidden = (idx + 1 !== n);
    });
  }

  // ---------- Render hero visual ----------
  function renderHero() {
    const visual = $('#hero-visual');
    visual.style.color = state.colorHex;

    // Имя на бейдже
    const tag = $('#hero-name-tag');
    if (tag) tag.textContent = state.name || 'Без имени';

    // Текст на грудном экране
    const screen = $('#hero-screen-text');
    if (screen) {
      const ini = HERO_INITIALS[state.power] || '<K1>';
      screen.textContent = ini;
    }

    // Оружие
    const weapon = $('#hero-weapon');
    if (weapon && state.weapon) {
      weapon.innerHTML = WEAPON_SVG[state.weapon] || '';
    }

    // Лёгкая анимация
    visual.style.transform = 'scale(1.05)';
    setTimeout(() => { visual.style.transform = 'scale(1)'; }, 200);
  }

  // ---------- Choice handlers ----------
  function bindColorChoices() {
    $$('#choice-color .choice').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#choice-color .choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.color = btn.dataset.color;
        state.colorHex = btn.dataset.colorHex;
        renderHero();
        setTimeout(() => goToStep(2), 350);
      });
    });
  }

  function bindWeaponChoices() {
    $$('#choice-weapon .choice').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#choice-weapon .choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.weapon = btn.dataset.weapon;
        renderHero();
        setTimeout(() => goToStep(3), 350);
      });
    });
  }

  function bindPowerChoices() {
    $$('#choice-power .choice').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#choice-power .choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.power = btn.dataset.power;
        renderHero();
        setTimeout(() => goToStep(4), 350);
      });
    });
  }

  function bindNameInput() {
    const input = $('#hero-name-input');
    const confirm = $('#btn-name-confirm');
    input.addEventListener('input', (e) => {
      state.name = e.target.value.trim();
      renderHero();
      confirm.disabled = state.name.length < 2;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.name.length >= 2) {
        e.preventDefault();
        finishGame();
      }
    });
    confirm.addEventListener('click', finishGame);
  }

  function finishGame() {
    // Передаём данные в landing.js
    if (window.LandingApp) {
      window.LandingApp.onGameComplete({
        color: state.color,
        colorHex: state.colorHex,
        weapon: state.weapon,
        power: state.power,
        name: state.name
      });
    }
  }

  // ---------- Init ----------
  function init(landingState) {
    if (landingState && landingState.hero) {
      Object.assign(state, landingState.hero);
    }
    updateProgress();
    goToStep(1);
    bindColorChoices();
    bindWeaponChoices();
    bindPowerChoices();
    bindNameInput();
    renderHero();
  }

  window.HeroGame = { init };
})();
