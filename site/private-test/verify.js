const form = byId('lookup');
const button = byId('submit');
let preview = false;
let gateKey = 'loading';
let resultKey = '';

function render() {
  const copy = {...translations[lang.value],...consentCopy[lang.value]};
  document.documentElement.lang = lang.value;
  document.querySelectorAll('[data-copy]').forEach(el => { el.textContent = copy[el.dataset.copy] || ''; });
  byId('gate').textContent = copy[gateKey] || '';
  byId('result').textContent = copy[resultKey] || '';
  byId('result').toggleAttribute('data-error', ['none','invalid','rate','failed'].includes(resultKey));
}

setupLanguage(render);
render();
async function openLookup() {
  try {
    let data;
    try { data = await request({action:'preview'},true); }
    catch (error) {
      if (!['UNAUTHORIZED','SESSION_EXPIRED'].includes(error.message)) throw error;
      token = '';
      data = await request({action:'preview'});
    }
    preview = data.preview === true;
    gateKey = data.open ? '' : preview ? 'preview' : 'closed';
    form.hidden = !data.open && !preview;
    showPoster(data);
  } catch { gateKey = 'failed'; }
  render();
}

form.onsubmit = async event => {
  event.preventDefault();
  if (button.disabled || form.hidden) return;
  button.disabled = true;
  resultKey = '';
  render();
  try {
    const email = byId('email').value.trim();
    const data = await request({action:'lookup',email,nickname:byId('nickname').value},preview);
    if (data.selection === 'primary' || (data.selection === 'reserve' && data.ticket)) {
      if (!data.ticket || !save(ticketKey,data.ticket)) throw new Error('FAILED');
      save(languageKey,lang.value);
      form.reset();
      location.assign('./registration.html');
      return;
    }
    resultKey = data.selection;
  } catch (error) {
    if (error.message === 'ANNOUNCEMENT_CLOSED' || ['UNAUTHORIZED','SESSION_EXPIRED'].includes(error.message)) {
      gateKey = error.message === 'ANNOUNCEMENT_CLOSED' ? 'closed' : 'previewExpired';
      form.hidden = true;
      byId('art').hidden = true;
      form.reset();
    } else {
      resultKey = {RATE_LIMITED:'rate',INVALID_FIELDS:'invalid'}[error.message] || 'failed';
    }
  } finally {
    button.disabled = false;
    render();
    if (resultKey) byId('result').focus();
  }
};
void openLookup();
