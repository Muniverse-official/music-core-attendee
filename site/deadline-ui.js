(() => {
  'use strict';

  const DEADLINE_ISO = '2026-09-10T11:00:00+09:00';
  const DEADLINE_MS = Date.parse(DEADLINE_ISO);
  const COPY = {
    ko: {
      label: '등록 마감',
      closed: '방청자 정보 등록이 마감되었습니다. (2026.09.10 목 오전 11:00 KST)'
    },
    en: {
      label: 'Registration deadline',
      closed: 'Attendee registration closed on Sep 10, 2026 at 11:00 AM KST.'
    },
    ja: {
      label: '登録締切',
      closed: '観覧者情報の登録は2026年9月10日(木)11:00 (KST)に締め切りました。'
    },
    'zh-TW': {
      label: '登記截止',
      closed: '觀眾資料登記已於2026年9月10日 11:00 (KST) 截止。'
    },
    'zh-CN': {
      label: '登记截止',
      closed: '观众资料登记已于2026年9月10日 11:00 (KST) 截止。'
    }
  };

  const currentLang = () => {
    const value = document.getElementById('lang')?.value || 'ko';
    return COPY[value] ? value : 'en';
  };
  const deadlinePassed = () => Date.now() >= DEADLINE_MS;
  const copy = () => COPY[currentLang()];

  function render() {
    const text = document.getElementById('registrationDeadlineText');
    if (text) text.innerHTML = `<strong>${copy().label}</strong><br>2026.09.10 (Thu) 11:00 KST`;

    if (!deadlinePassed()) return;
    document.body.dataset.registrationClosed = 'true';
    ['verifyBtn', 'submitBtn'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = true;
    });
    ['verifyMessage', 'submitMessage'].forEach((id) => {
      const message = document.getElementById(id);
      if (message) message.textContent = copy().closed;
    });
  }

  document.addEventListener('click', (event) => {
    if (!deadlinePassed()) return;
    const button = event.target instanceof Element ? event.target.closest('#verifyBtn, #submitBtn') : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    render();
  }, true);

  document.addEventListener('input', () => {
    if (deadlinePassed()) queueMicrotask(render);
  }, true);
  document.addEventListener('change', () => queueMicrotask(render), true);
  window.addEventListener('mc-language-change', render);

  render();
})();
