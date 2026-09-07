(() => {
  'use strict';

  function applyKoreanTitle() {
    const lang = document.getElementById('lang');
    const title = document.getElementById('heroTitle');
    if (!lang || !title || lang.value !== 'ko') return;
    title.innerHTML = '쇼! 음악중심<br><em>방청자 당첨 확인</em>';
    document.title = '쇼! 음악중심 방청자 당첨 확인 · Muniverse';
  }

  window.addEventListener('DOMContentLoaded', applyKoreanTitle);
  window.addEventListener('mc-language-change', applyKoreanTitle);
})();
