/* === Reward screen — стандартное поведение === */
/* Бóльшая часть рендера в landing.js. Здесь — фолбэки и доп. эффекты. */

(function () {
  'use strict';

  // Лёгкая анимация конфетти при появлении экрана награды
  function observeReward() {
    const reward = document.getElementById('screen-reward');
    if (!reward) return;
    const observer = new MutationObserver(() => {
      if (reward.classList.contains('active')) {
        burstConfetti();
      }
    });
    observer.observe(reward, { attributes: true, attributeFilter: ['class'] });
  }

  function burstConfetti() {
    const el = document.querySelector('.confetti-burst');
    if (!el) return;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'bounce 0.8s ease';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeReward);
  } else {
    observeReward();
  }
})();
