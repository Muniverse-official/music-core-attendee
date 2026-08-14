(async () => {
  'use strict';

  if (!window.MC_COPY) await import('./i18n.js');
  await import('./privacy-processing.js');

  const API = 'https://tcxugltvmatbgsmcepso.supabase.co/functions/v1/music-core-attendee';
  const $ = (id) => document.getElementById(id);
  const state = { token: '', accountEmail: '', nickname: '', eventDate: '' };
  const previewStep = new URLSearchParams(location.search).get('preview');
  const lang = () => (window.MC_COPY[$('lang').value] ? $('lang').value : 'en');
  const t = (key) => window.MC_COPY[lang()][key];

  function setText(id, value, html = false) {
    const element = $(id);
    if (!element) return;
    if (html) element.innerHTML = value;
    else element.textContent = value;
  }

  function setStep(number) {
    document.querySelectorAll('.step').forEach((element) => {
      element.classList.toggle('active', Number(element.dataset.step) === number);
    });
  }

  function applyLanguage() {
    document.documentElement.lang = lang();
    setText('heroTitle', t('heroTitle'), true);
    setText('heroDesc', t('heroDesc'));
    t('steps').forEach((label, index) => setText(`stepLabel${index + 1}`, label));
    setText('verifyTitle', t('verifyTitle'));
    setText('verifyDesc', t('verifyDesc'));
    setText('emailLabel', t('email'));
    setText('nicknameLabel', t('nickname'));
    setText('privacyTitle', t('privacyTitle'));
    setText('privacyText', t('privacy'), true);
    setText('consentLabel', t('consent'));
    setText('verifyBtnText', t('verifyBtn'));
    setText('infoTitle', t('infoTitle'));
    setText('infoDesc', t('infoDesc'));
    setText('eventDateLabel', t('eventDate'));
    setText('nameLabel', t('name'));
    setText('nationalityLabel', t('nationality'));
    setText('birthLabel', t('birth'));
    setText('phoneLabel', t('phone'));
    setText('contactLabel', t('contact'));
    setText('contactHint', t('contactHint'));
    setText('noticeText', t('notice'), true);
    setText('submitBtnText', t('submit'));
    setText('doneTitle', t('doneTitle'));
    setText('doneDesc', t('doneDesc'));
    setText('doneMain', t('doneMain'));
    setText('doneSub', t('doneSub'));
    setText('doneEventLabel', t('eventDate'));
    window.dispatchEvent(new CustomEvent('mc-language-change'));
  }

  function verifyReady() {
    const ready = $('consent').checked && $('email').value.trim() && $('nickname').value.trim();
    $('verifyBtn').disabled = !ready;
  }

  function busy(element, on) {
    element.classList.toggle('busy', on);
    element.disabled = on;
  }

  async function call(action, payload) {
    const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-music-core-request': '1' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
    });
    let data = {};
    try {
      data = await response.json();
    } catch {}
    return { r: response, data };
  }

  function errorText(code) {
    if (code === 'WINNER_MISMATCH') return t('mismatch');
    if (code === 'ALREADY_SUBMITTED') return t('duplicate');
    if (code === 'TOO_MANY_ATTEMPTS') return t('rate');
    if (code === 'CONSENT_REQUIRED') return t('consentNeeded');
    if (code === 'SESSION_INVALID') return t('session');
    if (code === 'UNDER_15') return t('under15');
    return t('network');
  }

  function calcAge(birth, event) {
    if (!birth || !event) return NaN;
    const birthParts = birth.split('-').map(Number);
    const eventParts = event.split('-').map(Number);
    let age = eventParts[0] - birthParts[0];
    if (
      eventParts[1] < birthParts[1] ||
      (eventParts[1] === birthParts[1] && eventParts[2] < birthParts[2])
    ) {
      age--;
    }
    return age;
  }

  async function verify() {
    const message = $('verifyMessage');
    message.textContent = '';
    const email = $('email').value.trim();
    const nickname = $('nickname').value.trim();

    if (!email || !nickname) {
      message.textContent = t('missingIdentity');
      return;
    }
    if (!$('consent').checked) {
      message.textContent = t('consentNeeded');
      return;
    }

    busy($('verifyBtn'), true);
    try {
      const { r, data } = await call('verify', { email, nickname, privacy_consent: true });
      if (!r.ok || !data.ok) {
        message.textContent = errorText(data.code);
        return;
      }
      state.token = data.token;
      state.accountEmail = email;
      state.nickname = nickname;
      state.eventDate = data.eventDate || '';
      $('contactEmail').value = email;
      setText('eventDate', state.eventDate || '-');
      $('step1').classList.add('hidden');
      $('step2').classList.remove('hidden');
      setStep(2);
      $('step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      message.textContent = t('network');
    } finally {
      busy($('verifyBtn'), false);
      verifyReady();
    }
  }

  async function submit() {
    const message = $('submitMessage');
    message.textContent = '';

    if (previewStep === 'step2') {
      message.textContent = '디자인 확인용 미리보기에서는 정보가 제출되지 않습니다.';
      return;
    }

    const fields = {
      name: $('name').value.trim(),
      nationality: $('nationality').value,
      birth_date: $('birthDate').value,
      phone: $('phone').value.trim(),
      contact_email: $('contactEmail').value.trim(),
    };
    if (Object.values(fields).some((value) => !value)) {
      message.textContent = t('missing');
      return;
    }

    const age = calcAge(fields.birth_date, state.eventDate);
    if (!Number.isFinite(age) || age < 15) {
      message.textContent = t('under15');
      return;
    }

    busy($('submitBtn'), true);
    try {
      const { r, data } = await call('submit', {
        token: state.token,
        account_email: state.accountEmail,
        muniverse_nickname: state.nickname,
        ...fields,
      });
      if (!r.ok || !data.ok) {
        message.textContent = errorText(data.code);
        if (data.code === 'SESSION_INVALID') setTimeout(() => location.reload(), 1500);
        return;
      }
      setText('doneEventDate', data.eventDate || state.eventDate || '-');
      $('step2').classList.add('hidden');
      $('done').classList.remove('hidden');
      setStep(3);
      $('done').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      message.textContent = t('network');
    } finally {
      busy($('submitBtn'), false);
    }
  }

  function showPreview() {
    if (previewStep !== 'step2') return;
    state.accountEmail = 'preview@muniverse.io';
    state.nickname = 'DESIGN PREVIEW';
    state.eventDate = '2026-08-22';
    $('contactEmail').value = state.accountEmail;
    setText('eventDate', `${state.eventDate} · PREVIEW`);
    $('step1').classList.add('hidden');
    $('step2').classList.remove('hidden');
    setStep(2);

    const note = document.createElement('p');
    note.className = 'preview-notice';
    note.textContent = '디자인 검수용 미리보기입니다. 입력 정보는 저장되지 않습니다.';
    Object.assign(note.style, {
      margin: '0 0 24px',
      padding: '12px 16px',
      border: '1px solid #d9e6f6',
      borderRadius: '10px',
      background: '#f4f8fd',
      color: '#496176',
      fontSize: '13px',
      lineHeight: '1.55',
      textAlign: 'center',
    });
    $('step2').insertBefore(note, $('step2').children[1]);
  }

  $('lang').addEventListener('change', applyLanguage);
  $('consent').addEventListener('change', verifyReady);
  $('email').addEventListener('input', verifyReady);
  $('nickname').addEventListener('input', verifyReady);
  $('verifyBtn').addEventListener('click', verify);
  $('submitBtn').addEventListener('click', submit);
  applyLanguage();
  verifyReady();
  showPreview();
})();
