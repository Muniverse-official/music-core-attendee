(async () => {
  'use strict';
  if (!window.MC_COPY) await import('./i18n.js');

  const API = 'https://tcxugltvmatbgsmcepso.supabase.co/functions/v1/music-core-attendee';
  const $ = (id) => document.getElementById(id);
  const state = { token: '', accountEmail: '', nickname: '', eventDate: '', busy: false };
  const previewStep = new URLSearchParams(location.search).get('preview');
  const lang = () => (window.MC_COPY[$('lang')?.value] ? $('lang').value : 'en');
  const t = (key) => window.MC_COPY[lang()][key];
  const setText = (id, value, html = false) => { const el = $(id); if (!el) return; html ? (el.innerHTML = value) : (el.textContent = value); };

  function setStep(number) {
    document.querySelectorAll('.step').forEach((element) => element.classList.toggle('active', Number(element.dataset.step) === number));
  }

  function applyLanguage() {
    document.documentElement.lang = lang();
    setText('heroTitle', t('heroTitle'), true); setText('heroDesc', t('heroDesc'));
    t('steps').forEach((label, index) => setText(`stepLabel${index + 1}`, label));
    setText('verifyTitle', t('verifyTitle')); setText('verifyDesc', t('verifyDesc'));
    setText('emailLabel', t('email')); setText('nicknameLabel', t('nickname'));
    setText('privacyTitle', t('privacyTitle')); setText('privacyText', t('privacy'), true);
    setText('consentLabel', t('consent')); setText('verifyBtnText', t('verifyBtn'));
    setText('infoTitle', t('infoTitle')); setText('infoDesc', t('infoDesc')); setText('eventDateLabel', t('eventDate'));
    setText('nameLabel', t('name')); setText('nationalityLabel', t('nationality')); setText('birthLabel', t('birth')); setText('phoneLabel', t('phone'));
    setText('contactLabel', t('contact')); setText('contactHint', t('contactHint')); setText('noticeText', t('notice'), true); setText('submitBtnText', t('submit'));
    setText('doneTitle', t('doneTitle')); setText('doneDesc', t('doneDesc')); setText('doneMain', t('doneMain')); setText('doneSub', t('doneSub'));
    setText('alreadyMessage', t('already'));
    setText('doneEventLabel', t('eventDate'));
    window.dispatchEvent(new CustomEvent('mc-language-change'));
  }

  function verifyReady() {
    const ready = Boolean($('consent')?.checked && $('email')?.value.trim() && $('nickname')?.value.trim());
    if ($('verifyBtn')) $('verifyBtn').disabled = !ready || state.busy;
  }

  function busy(button, on) { state.busy = on; button?.classList.toggle('busy', on); if (button) button.disabled = on; }

  async function call(action, payload) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-music-core-request': '1', 'x-request-id': crypto.randomUUID() },
        body: JSON.stringify(payload), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal
      });
      let data = {}; try { data = await response.json(); } catch {}
      return { response, data };
    } finally { clearTimeout(timeout); }
  }

  function errorText(code) {
    if (code === 'WINNER_MISMATCH' || code === 'IDENTITY_MISMATCH') return t('mismatch');
    if (code === 'RATE_LIMITED' || code === 'TOO_MANY_ATTEMPTS') return t('rate');
    if (code === 'CONSENT_REQUIRED') return t('consentNeeded');
    if (code === 'SESSION_INVALID' || code === 'SESSION_EXPIRED' || code === 'INVALID_SESSION') return t('session');
    if (code === 'UNDER_15') return t('under15');
    return t('network');
  }

  function showStep2() {
    document.body.classList.remove('already-state');
    $('step1')?.classList.add('hidden'); $('step2')?.classList.remove('hidden'); $('done')?.classList.add('hidden'); $('already')?.classList.add('hidden'); setStep(2);
    $('step2')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showDone(already = false, eventDate = '') {
    $('step1')?.classList.add('hidden'); $('step2')?.classList.add('hidden');
    $('done')?.classList.toggle('hidden', already); $('already')?.classList.toggle('hidden', !already);
    document.body.classList.toggle('already-state', already);
    if (already) {
      setText('alreadyMessage', t('already'));
      $('already')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setStep(3);
    setText('doneTitle', t('doneTitle')); setText('doneDesc', t('doneDesc')); setText('doneMain', t('doneMain')); setText('doneSub', t('doneSub'));
    setText('doneEventDate', eventDate || state.eventDate || '-');
    $('done')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  function ageOnDate(birth, eventDate) {
    if (!birth || !eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return NaN;
    const b = birth.split('-').map(Number); const e = eventDate.split('-').map(Number);
    if ([...b, ...e].some((n) => !Number.isFinite(n))) return NaN;
    let age = e[0] - b[0]; if (e[1] < b[1] || (e[1] === b[1] && e[2] < b[2])) age--; return age;
  }

  async function verify() {
    const message = $('verifyMessage'); if (message) message.textContent = '';
    const email = $('email')?.value.trim() || ''; const nickname = $('nickname')?.value.trim() || '';
    if (!email || !nickname) { if (message) message.textContent = t('missingIdentity'); return; }
    if (!validEmail(email)) { if (message) message.textContent = t('invalidEmail'); return; }
    if (!$('consent')?.checked) { if (message) message.textContent = t('consentNeeded'); return; }
    busy($('verifyBtn'), true);
    try {
      const { response, data } = await call('verify', { email, nickname, privacy_consent: true, website: $('website')?.value || '' });
      if (data.code === 'ALREADY_SUBMITTED') { showDone(true); return; }
      if (!response.ok || !data.ok) { if (message) message.textContent = errorText(data.code); return; }
      state.token = data.token || data.verificationToken || ''; state.accountEmail = email; state.nickname = nickname; state.eventDate = data.eventDate || '';
      if (!state.token || !state.eventDate) { if (message) message.textContent = t('network'); return; }
      if ($('contactEmail')) $('contactEmail').value = email; setText('eventDate', state.eventDate); showStep2();
    } catch { if (message) message.textContent = t('network'); }
    finally { busy($('verifyBtn'), false); verifyReady(); }
  }

  async function submit() {
    const message = $('submitMessage'); if (message) message.textContent = '';
    if (previewStep === 'step2') { if (message) message.textContent = t('preview'); return; }
    const contactValues = window.AttendeeFields?.values?.() || { nationality: $('nationality')?.value || '', phone: $('phone')?.value || '' };
    const fields = { name: $('name')?.value.trim() || '', nationality: contactValues.nationality || '', birth_date: $('birthDate')?.value || '', phone: contactValues.phone || '', contact_email: $('contactEmail')?.value.trim() || '' };
    if (!fields.name || !fields.nationality || !fields.birth_date || !fields.phone || !fields.contact_email) { if (message) message.textContent = t('missing'); return; }
    if (!validEmail(fields.contact_email)) { if (message) message.textContent = t('invalidEmail'); return; }
    if (!window.AttendeeFields?.valid?.()) { if (message) message.textContent = t('invalidPhone'); return; }
    const age = ageOnDate(fields.birth_date, state.eventDate); if (!Number.isFinite(age) || age < 15) { if (message) message.textContent = t('under15'); return; }
    busy($('submitBtn'), true);
    try {
      const { response, data } = await call('submit', { token: state.token, verification_token: state.token, account_email: state.accountEmail, muniverse_nickname: state.nickname, privacy_consent: true, website: $('website')?.value || '', ...fields });
      if (data.code === 'ALREADY_SUBMITTED') { showDone(true); return; }
      if (!response.ok || !data.ok) { if (message) message.textContent = errorText(data.code); if (['SESSION_INVALID','SESSION_EXPIRED','INVALID_SESSION'].includes(data.code)) setTimeout(() => location.reload(), 1600); return; }
      showDone(false, data.eventDate || state.eventDate);
    } catch { if (message) message.textContent = t('network'); }
    finally { busy($('submitBtn'), false); }
  }

  function showPreview() {
    if (previewStep !== 'step2') return;
    state.accountEmail = 'preview@muniverse.io'; state.nickname = 'DESIGN PREVIEW'; state.eventDate = '2026-09-19';
    if ($('contactEmail')) $('contactEmail').value = state.accountEmail; setText('eventDate', `${state.eventDate} · PREVIEW`); showStep2();
    const note = document.createElement('p'); note.className = 'preview-notice'; note.textContent = t('preview'); $('step2')?.insertBefore(note, $('step2')?.children[1] || null);
  }

  $('lang')?.addEventListener('change', applyLanguage); $('consent')?.addEventListener('change', verifyReady); $('email')?.addEventListener('input', verifyReady); $('nickname')?.addEventListener('input', verifyReady);
  $('verifyBtn')?.addEventListener('click', verify); $('submitBtn')?.addEventListener('click', submit);
  window.addEventListener('attendee-fields-change', () => { if ($('submitMessage')) $('submitMessage').textContent = ''; });
  applyLanguage(); verifyReady(); showPreview();
})();
