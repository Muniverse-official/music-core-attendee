(() => {
  'use strict';

  const audienceGuideCopy = {
    ko: {
      contactHint: '방청 안내는 문자로 별도 안내됩니다. (한국 번호가 없는 경우 X DM 또는 이메일로 안내됩니다.)',
      doneSub: '방청 안내는 문자로 별도 안내됩니다. 한국 번호가 없는 경우 X DM 또는 이메일로 안내됩니다.'
    },
    en: {
      contactHint: 'Attendance instructions will be sent separately by SMS. (If you do not have a Korean phone number, we will contact you via X DM or email.)',
      doneSub: 'Attendance instructions will be sent separately by SMS. If you do not have a Korean phone number, we will contact you via X DM or email.'
    },
    ja: {
      contactHint: '観覧案内はSMSで別途お送りします。（韓国の電話番号をお持ちでない場合は、XのDMまたはメールでご案内します。）',
      doneSub: '観覧案内はSMSで別途お送りします。韓国の電話番号をお持ちでない場合は、XのDMまたはメールでご案内します。'
    },
    'zh-TW': {
      contactHint: '觀眾入場通知將另行以簡訊發送。（若沒有韓國手機號碼，將透過 X 私訊或電子郵件通知。）',
      doneSub: '觀眾入場通知將另行以簡訊發送。若沒有韓國手機號碼，將透過 X 私訊或電子郵件通知。'
    },
    'zh-CN': {
      contactHint: '观众入场通知将另行通过短信发送。（如没有韩国手机号码，将通过 X 私信或电子邮件通知。）',
      doneSub: '观众入场通知将另行通过短信发送。如没有韩国手机号码，将通过 X 私信或电子邮件通知。'
    }
  };

  function currentLanguage() {
    const value = document.getElementById('lang')?.value || 'ko';
    return audienceGuideCopy[value] ? value : 'en';
  }

  function applyAudienceGuideCopy() {
    document.querySelector('.event-date-card')?.classList.add('hidden');
    document.querySelector('.done-date')?.classList.add('hidden');

    const copy = audienceGuideCopy[currentLanguage()];
    const contactHint = document.getElementById('contactHint');
    const doneSub = document.getElementById('doneSub');
    if (contactHint) contactHint.textContent = copy.contactHint;
    if (doneSub) doneSub.textContent = copy.doneSub;
  }

  function styleRequiredLabel() {
    const label = document.getElementById('consentLabel');
    if (!label) return;

    const text = label.textContent.trim();
    const match = text.match(/^(\[[^\]]+\]|【[^】]+】)\s*/);
    if (!match) return;

    label.textContent = '';
    const required = document.createElement('strong');
    required.textContent = match[1];
    label.append(required, document.createTextNode(` ${text.slice(match[0].length)}`));
  }

  function refreshUiCopy() {
    applyAudienceGuideCopy();
    styleRequiredLabel();
  }

  document.addEventListener('DOMContentLoaded', refreshUiCopy);
  window.addEventListener('mc-language-change', refreshUiCopy);
})();
