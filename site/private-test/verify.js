const byId = id => document.getElementById(id);
const form = byId('lookup');
const lang = byId('lang');
const banner = byId('banner');
const art = byId('art');
const gate = byId('gate');
const result = byId('result');
const button = byId('submit');
const api = 'https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/attendee-private-test';
let token = '';
let gateKey = 'loading';
let resultKey = '';
let preview = false;
let winnerNumber = '';
let winner;
let identity;
let consentMessage = '';
const consentForm = byId('consent-form');
try { token = sessionStorage.getItem('muniverse-attendee-console-v3') || ''; } catch {}

function render() {
  document.documentElement.lang = lang.value;
  const copy = {...translations[lang.value], ...consentCopy[lang.value]};
  document.querySelectorAll('[data-copy]').forEach(el => { el.textContent = copy[el.dataset.copy]; });
  gate.textContent = copy[gateKey] || '';
  result.textContent = copy[resultKey] || '';
  result.toggleAttribute('data-error', ['failed','rate','invalid'].includes(resultKey));
  byId('number').textContent = winnerNumber;
  byId('number-card').hidden = !winnerNumber;
  byId('japan-safeguards').hidden = lang.value !== 'ja';
  byId('winner-section').hidden = !winner;
  consentForm.hidden = !winner || winner.agreed || winner.expired;
  byId('winner-status').textContent = copy[consentMessage || (winner?.agreed ? 'accepted' : winner?.expired ? 'expired' : '')] || '';
  byId('deadline').textContent = winner?.deadline && !winner.agreed ? `${copy.deadlineText} · ${new Intl.DateTimeFormat(lang.value,{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(winner.deadline))} (KST)` : '';
  byId('attendance-list').replaceChildren(...copy.attendance.map(text => {const li=document.createElement('li');li.textContent=text;return li;}));
}

async function request(body, withToken = false) {
  const headers = {'content-type':'application/json', 'x-admin-request':'1'};
  if (withToken && token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(api, {
    method:'POST', cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer',
    headers, body:JSON.stringify(body), signal:AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.code || 'FAILED');
  return data;
}

async function openPage() {
  try {
    let data;
    try { data = await request({action:'preview'}, true); }
    catch (error) {
      if (!['UNAUTHORIZED','SESSION_EXPIRED'].includes(error.message)) throw error;
      token = '';
      data = await request({action:'preview'});
    }
    preview = data.preview === true;
    gateKey = data.open ? '' : preview ? 'preview' : 'closed';
    form.hidden = !data.open && !preview;
    button.disabled = preview;
    if (/^data:image\/webp;base64,[\w+/=]+$/.test(data.banner || '')) {
      banner.src = data.banner;
      byId('backdrop').src = data.banner;
      art.hidden = false;
    }
  } catch { gateKey = 'failed'; }
  render();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled || preview) return;
  button.disabled = true;
  resultKey = '';
  winnerNumber = '';
  winner = undefined;
  identity = undefined;
  consentMessage = '';
  consentForm.reset();
  render();
  try {
    const account = {email:byId('email').value, nickname:byId('nickname').value};
    const data = await request({action:'lookup', ...account});
    resultKey = data.selection;
    winnerNumber = data.selection === 'primary' ? data.number : '';
    if (data.selection === 'primary') { winner = data; identity = account; }
    form.reset();
  } catch (error) {
    if (error.message === 'ANNOUNCEMENT_CLOSED') {
      gateKey = 'closed';
      form.hidden = true;
      art.hidden = true;
      form.reset();
    } else {
      resultKey = {RATE_LIMITED:'rate', INVALID_FIELDS:'invalid'}[error.message] || 'failed';
    }
  } finally {
    button.disabled = false;
    render();
  }
});

consentForm.addEventListener('submit', async event => {
  event.preventDefault();
  const agree = byId('agree');
  if (!winner || !identity || winner.agreed || winner.expired || agree.disabled || !byId('collect-consent').checked) return;
  agree.disabled = true;
  button.disabled = true;
  consentMessage = '';
  try {
    await request({action:'consent', ...identity, name:byId('legal-name').value, phone:byId('phone').value, language:lang.value, collectionAgreed:true, agreed:true, version:'2026-11-13-v1'});
    winner.agreed = true;
    consentForm.reset();
    identity = undefined;
  } catch (error) {
    if (error.message === 'CONSENT_DEADLINE') winner.expired = true;
    else consentMessage = {RATE_LIMITED:'rate',INVALID_FIELDS:'formInvalid'}[error.message] || 'failed';
  } finally { agree.disabled = false; button.disabled = false; render(); }
});

lang.addEventListener('change', render);
const suggested = navigator.languages.find(language => /^(ko|en|ja|zh)(-|$)/i.test(language));
if (suggested) {
  const key = suggested.toLowerCase();
  lang.value = key.startsWith('zh') ? (/hant|-(tw|hk|mo)\b/.test(key) ? 'zh-TW' : 'zh-CN') : key.split('-')[0];
}
render();
void openPage();
