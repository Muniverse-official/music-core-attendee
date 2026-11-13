const byId = id => document.getElementById(id);
const lang = byId('lang');
const tokenKey = 'muniverse-attendee-console-v3';
const ticketKey = 'enhypen-registration-ticket';
const languageKey = 'enhypen-language';
const api = 'https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/attendee-private-test';
let token = stored(tokenKey);

function stored(key) {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}

function save(key,value) {
  try { sessionStorage.setItem(key,value); return true; } catch { return false; }
}

function setupLanguage(render) {
  const saved = stored(languageKey);
  if (translations[saved]) lang.value = saved;
  else {
    const suggested = navigator.languages.find(language => /^(ko|en|ja|zh)(-|$)/i.test(language))?.toLowerCase();
    if (suggested) lang.value = suggested.startsWith('zh') ? (/hant|-(tw|hk|mo)\b/.test(suggested) ? 'zh-TW' : 'zh-CN') : suggested.split('-')[0];
  }
  lang.addEventListener('change', () => { save(languageKey,lang.value); render(); });
}

async function request(body, withToken = false) {
  const headers = {'content-type':'application/json','x-admin-request':'1'};
  if (withToken && token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(api,{method:'POST',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.code || 'FAILED');
  return data;
}

function showPoster(data) {
  if (!/^data:image\/webp;base64,[\w+/=]+$/.test(data.banner || '')) return;
  byId('banner').src = data.banner;
  byId('backdrop').src = data.banner;
  byId('art').hidden = false;
}
