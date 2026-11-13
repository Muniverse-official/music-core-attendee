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
try { token = sessionStorage.getItem('muniverse-attendee-console-v3') || ''; } catch {}

function render() {
  document.documentElement.lang = lang.value;
  const copy = translations[lang.value];
  document.querySelectorAll('[data-copy]').forEach(el => { el.textContent = copy[el.dataset.copy]; });
  gate.textContent = copy[gateKey] || '';
  result.textContent = copy[resultKey] || '';
  result.toggleAttribute('data-error', ['failed','rate','invalid'].includes(resultKey));
  byId('number').textContent = winnerNumber;
  byId('number-card').hidden = !winnerNumber;
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
  render();
  try {
    const data = await request({action:'lookup', email:byId('email').value, nickname:byId('nickname').value});
    resultKey = data.selection;
    winnerNumber = data.selection === 'primary' ? data.number : '';
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

lang.addEventListener('change', render);
const suggested = navigator.languages.find(language => /^(ko|en|ja|zh)(-|$)/i.test(language));
if (suggested) {
  const key = suggested.toLowerCase();
  lang.value = key.startsWith('zh') ? (/hant|-(tw|hk|mo)\b/.test(key) ? 'zh-TW' : 'zh-CN') : key.split('-')[0];
}
render();
void openPage();
