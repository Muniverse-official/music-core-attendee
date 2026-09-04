(() => {
  'use strict';

  const COPY = {
    ko: {
      message: '이미 방청자 정보 등록이 완료되었습니다.',
      help: '등록 정보 수정이 필요한 경우 support@muniverse.io로 문의해 주세요.'
    },
    en: {
      message: 'Your attendee information has already been registered.',
      help: 'To request a correction, contact support@muniverse.io.'
    },
    ja: {
      message: '観覧者情報はすでに登録されています。',
      help: '登録情報の修正が必要な場合は support@muniverse.io までお問い合わせください。'
    },
    'zh-TW': {
      message: '觀眾資料已完成登記。',
      help: '如需更正已登記資料，請聯絡 support@muniverse.io。'
    },
    'zh-CN': {
      message: '观众信息已完成登记。',
      help: '如需更正已登记信息，请联系 support@muniverse.io。'
    }
  };

  const $ = (id) => document.getElementById(id);
  function apply() {
    const copy = COPY[$('lang')?.value] || COPY.ko;
    if ($('alreadyMessage')) $('alreadyMessage').textContent = copy.message;
    if ($('alreadyHelp')) $('alreadyHelp').textContent = copy.help;
  }

  $('lang')?.addEventListener('change', () => queueMicrotask(apply));
  window.addEventListener('mc-language-change', () => queueMicrotask(apply));
  apply();
})();
