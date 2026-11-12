'use strict';

const scenes = {
  day: ['맑은 낮', '10:24'],
  night: ['맑은 밤', '20:42'],
  rain: ['비', '16:08'],
  snow: ['눈', '08:15'],
};
const buttons = document.querySelectorAll('[data-scene]');
const wallpaper = document.querySelector('#demoWallpaper');
const clock = document.querySelector('#demoClock');
const condition = document.querySelector('#demoCondition');
const status = document.querySelector('#sceneStatus');
let requestId = 0;
const motion = matchMedia('(prefers-reduced-motion: no-preference)');

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      if (motion.matches && target.animate) target.animate(
        [{ opacity: .28, transform: 'translateY(20px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 540, easing: 'cubic-bezier(.2,.72,.25,1)' }
      );
    }
  }, { threshold: .12 });
  document.querySelectorAll('[data-reveal]').forEach(node => observer.observe(node));
}

for (const button of buttons) {
  button.addEventListener('click', async () => {
    const scene = button.dataset.scene;
    const currentRequest = ++requestId;
    if (button.getAttribute('aria-pressed') === 'true') return;
    const next = new Image();
    next.src = '/assets/seoul-' + scene + '.jpg';
    try {
      await next.decode();
    } catch {
      if (currentRequest === requestId) status.textContent = '배경 사진을 불러오지 못했습니다.';
      return;
    }
    if (currentRequest !== requestId) return;
    wallpaper.src = next.src;
    [condition.textContent, clock.textContent] = scenes[scene];
    if (motion.matches && wallpaper.animate) {
      wallpaper.getAnimations().forEach(animation => animation.cancel());
      wallpaper.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 370, easing: 'ease-out' });
    }
    for (const choice of buttons) choice.setAttribute('aria-pressed', String(choice === button));
    status.textContent = '서울 배경 미리보기 · ' + scenes[scene][0];
  });
}
