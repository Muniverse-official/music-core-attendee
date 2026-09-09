(() => {
  'use strict';

  const deliveryCopy = {
    ko: {
      contact: '이메일',
      contactHint: '방청 안내는 문자로 별도 안내됩니다. 한국 번호가 없는 경우 X DM으로 안내됩니다.',
      doneSub: '입장 안내는 문자로 별도 안내됩니다. 한국 번호가 없는 경우 X DM으로 안내됩니다.'
    },
    en: {
      contact: 'Email',
      contactHint: 'Attendance instructions are sent separately by SMS. If you do not have a Korean phone number, we will contact you via X DM.',
      doneSub: 'Entry instructions are sent separately by SMS. If you do not have a Korean phone number, we will contact you via X DM.'
    },
    ja: {
      contact: 'メールアドレス',
      contactHint: '観覧案内はSMSで別途ご案内します。韓国の電話番号がない場合はXのDMでご案内します。',
      doneSub: '入場案内はSMSで別途ご案内します。韓国の電話番号がない場合はXのDMでご案内します。'
    },
    'zh-TW': {
      contact: '電子郵件',
      contactHint: '觀眾通知將另行以簡訊發送。若沒有韓國手機號碼，將透過 X 私訊通知。',
      doneSub: '入場資訊將另行以簡訊發送。若沒有韓國手機號碼，將透過 X 私訊通知。'
    },
    'zh-CN': {
      contact: '电子邮箱',
      contactHint: '观众通知将另行通过短信发送。如没有韩国手机号，将通过 X 私信通知。',
      doneSub: '入场信息将另行通过短信发送。如没有韩国手机号，将通过 X 私信通知。'
    }
  };

  function patchCopy() {
    const copy = window.MC_COPY;
    if (!copy) return;

    Object.entries(deliveryCopy).forEach(([lang, values]) => {
      if (copy[lang]) Object.assign(copy[lang], values);
    });

    if (copy.ko?.privacy) {
      copy.ko.privacy = copy.ko.privacy.replaceAll('방청 안내용 이메일', '이메일');
    }
    if (copy.en?.privacy) {
      copy.en.privacy = copy.en.privacy.replaceAll('email for attendance notices', 'email address');
    }
    if (copy.ja?.privacy) {
      copy.ja.privacy = copy.ja.privacy.replaceAll('観覧案内用メールアドレス', 'メールアドレス');
    }
    if (copy['zh-TW']?.privacy) {
      copy['zh-TW'].privacy = copy['zh-TW'].privacy.replaceAll('觀眾通知用電子郵件', '電子郵件');
    }
    if (copy['zh-CN']?.privacy) {
      copy['zh-CN'].privacy = copy['zh-CN'].privacy
        .replaceAll('观众通知用电子邮箱', '电子邮箱')
        .replaceAll('观众通知用电子邮件', '电子邮箱');
    }
  }

  function applyRuntimeCopy() {
    patchCopy();

    const langSelect = document.getElementById('lang');
    const lang = langSelect?.value || 'ko';
    const copy = window.MC_COPY?.[lang];
    if (!copy) return;

    const eyebrow = document.querySelector('.eyebrow');
    if (eyebrow) eyebrow.remove();

    const title = document.getElementById('heroTitle');
    const desc = document.getElementById('heroDesc');
    if (lang === 'ko') {
      if (title) title.innerHTML = '쇼! 음악중심<br><em>방청자 당첨 확인</em>';
      if (desc) desc.innerHTML = 'Muniverse에서 방청 당첨 여부를 확인하고<br>방청자 정보를 등록해주세요.';
      document.title = '쇼! 음악중심 방청자 당첨 확인 · Muniverse';
    }

    const contactLabel = document.getElementById('contactLabel');
    const contactHint = document.getElementById('contactHint');
    const doneSub = document.getElementById('doneSub');
    const privacyText = document.getElementById('privacyText');

    if (contactLabel) contactLabel.textContent = copy.contact;
    if (contactHint) contactHint.textContent = copy.contactHint;
    if (doneSub) doneSub.textContent = copy.doneSub;
    if (privacyText && copy.privacy) privacyText.innerHTML = copy.privacy;
  }

  patchCopy();
  applyRuntimeCopy();
  window.addEventListener('DOMContentLoaded', applyRuntimeCopy);
  window.addEventListener('mc-language-change', applyRuntimeCopy);
})();
