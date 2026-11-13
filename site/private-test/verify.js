const byId = id => document.getElementById(id);
const form = byId('lookup');
const lang = byId('lang');
const banner = byId('banner');
const gate = byId('gate');
const result = byId('result');
const button = byId('submit');
const email = byId('email');
const nickname = byId('nickname');
const api = 'https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/attendee-private-test';
let token = '';
let gateKey = 'loading';
let resultKey = '';
try { token = sessionStorage.getItem('muniverse-attendee-console-v3') || ''; } catch {}

function render() {
  document.documentElement.lang = lang.value;
  const copy = translations[lang.value];
  document.querySelectorAll('[data-copy]').forEach(el => { el.textContent = copy[el.dataset.copy]; });
  gate.textContent = copy[gateKey] || '';
  result.textContent = copy[resultKey] || '';
  result.toggleAttribute('data-error', Boolean(resultKey) && resultKey !== 'success');
}

function closeTest(reason) {
  form.reset();
  form.hidden = true;
  banner.hidden = true;
  banner.removeAttribute('src');
  byId('admin').hidden = false;
  gateKey = reason;
  render();
}

async function request(action) {
  const response = await fetch(api, {
    method:'POST', cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer',
    headers:{authorization:`Bearer ${token}`, 'content-type':'application/json', 'x-admin-request':'1'},
    body:JSON.stringify({action}), signal:AbortSignal.timeout(12000),
  });
  if (response.status === 401) {
    token = '';
    closeTest('gated');
  }
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}

async function openTest() {
  if (!token) return closeTest('gated');
  try {
    const data = await request('preview');
    if (data.state.paused) return closeTest('paused');
    if (!/^data:image\/webp;base64,[\w+/=]+$/.test(data.banner || '')) throw new Error('Missing event image');
    banner.src = data.banner;
    banner.hidden = false;
    form.hidden = false;
    gateKey = '';
    render();
  } catch {
    if (token) closeTest('failed');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  if (email.value.trim().toLowerCase() !== email.placeholder || nickname.value.trim() !== nickname.placeholder) {
    resultKey = 'invalid';
    return render();
  }
  button.disabled = true;
  resultKey = '';
  render();
  try {
    const {state} = await request('verify');
    if (state.paused) return closeTest('paused');
    form.reset();
    resultKey = 'success';
  } catch {
    resultKey = 'failed';
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
void openTest();
