const form = byId('consent-form');
const country = byId('country');
const fields = byId('registration-fields');
const checkboxes = [byId('collect-consent'),byId('disclose-consent')];
const ticket = stored(ticketKey);
let winner;
let gateKey = 'loading';
let message = '';
let busy = false;

function syncFields(copy = consentCopy[lang.value]) {
  const other = form.elements['nationality-mode'].value === 'OTHER';
  const koreanPhone = form.elements['phone-mode'].value === 'KR';
  byId('country-wrap').hidden = !other;
  country.disabled = !other;
  country.required = other;
  for (const [prefix,show] of [['korean',koreanPhone],['intl',!koreanPhone]]) {
    byId(`${prefix}-phone-wrap`).hidden = !show;
    byId(`${prefix}-phone`).disabled = !show;
    byId(`${prefix}-phone`).required = show;
  }
  byId('phone-hint').textContent = koreanPhone ? copy.krHint : copy.intlHint;
  const unlocked = checkboxes.every(box => box.checked);
  fields.hidden = !unlocked;
  fields.disabled = !unlocked;
  byId('agree').disabled = busy || Boolean(winner?.preview);
  byId('lookup-again').setAttribute('aria-disabled',String(busy));
}

function renderTerms(id, terms) {
  byId(id).replaceChildren(...terms.map(([label,value]) => {
    const row=document.createElement('div'), name=document.createElement('dt'), content=document.createElement('dd');
    name.textContent=label; content.textContent=value; row.append(name,content);
    return row;
  }));
}

function renderAttendance(copy) {
  const groups = copy.attendanceGroups || [['',copy.attendance]];
  byId('attendance-list').replaceChildren(...groups.map(([label,items]) => {
    const group=document.createElement('div');
    if (label) {const heading=document.createElement('h4'); heading.textContent=label; group.append(heading);}
    const list=document.createElement('ul');
    for (const text of items) {const item=document.createElement('li'); item.textContent=text; list.append(item);}
    group.append(list);
    return group;
  }));
}

function render() {
  const copy = {...translations[lang.value],...consentCopy[lang.value],...consentTerms[lang.value]};
  document.documentElement.lang = lang.value;
  document.querySelectorAll('[data-copy]').forEach(el => {el.textContent=copy[el.dataset.copy] || '';});
  byId('gate').textContent = copy[gateKey] || '';
  byId('number').textContent = winner?.number || '';
  byId('number-card').hidden = !winner;
  byId('winner-section').hidden = !winner;
  form.hidden = !winner || winner.agreed || winner.expired;
  byId('winner-status').textContent = copy[message || (winner?.agreed ? 'accepted' : winner?.expired ? 'expired' : '')] || '';
  byId('deadline').textContent = winner?.deadline && !winner.agreed ? `${copy.deadlineText} · ${new Intl.DateTimeFormat(lang.value,{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(winner.deadline))} (KST)` : '';
  byId('japan-safeguards').hidden = lang.value !== 'ja';
  byId('us-notice').hidden = lang.value !== 'en';
  byId('preview-note').hidden = !winner?.preview;
  renderTerms('collection-terms',copy.collectionTerms);
  renderTerms('disclosure-terms',copy.disclosureTerms);
  renderAttendance(copy);
  if (country.dataset.language !== lang.value) {
    const selected=country.value;
    const names=new Intl.DisplayNames([lang.value],{type:'region'}), sort=new Intl.Collator(lang.value);
    const regions=countryCodes.filter(code=>code !== 'KR').map(code=>[code,names.of(code) || code]);
    regions.sort((a,b)=>sort.compare(a[1],b[1]));
    country.replaceChildren(new Option(copy.country,''),...regions.map(([code,label])=>new Option(label,code)));
    country.value=selected;
    country.dataset.language=lang.value;
  }
  syncFields(copy);
}

async function openRegistration() {
  if (!ticket) {gateKey='registrationExpired'; render(); return;}
  try {
    winner = await request({action:'registration',ticket},true);
    gateKey = winner.preview ? 'preview' : '';
    if (winner.contactEmail) byId('contact-email').value = winner.contactEmail;
    void request({action:'preview'},true).then(showPoster).catch(()=>{});
  } catch (error) {
    gateKey=error.message==='ANNOUNCEMENT_CLOSED' ? 'closed' : ['SESSION_EXPIRED','UNAUTHORIZED','WINNER_MISSING'].includes(error.message) ? 'registrationExpired' : 'failed';
  }
  render();
}

form.addEventListener('change',()=>syncFields());
byId('lookup-again').onclick = event => { if (busy) event.preventDefault(); else save(ticketKey,''); };
form.onsubmit = async event => {
  event.preventDefault();
  if (!winner || winner.preview || winner.agreed || winner.expired || busy || fields.disabled) return;
  busy=true; message=''; syncFields();
  try {
    const phoneMode=form.elements['phone-mode'].value;
    await request({action:'consent',ticket,name:byId('legal-name').value,phoneMode,
      phone:byId(phoneMode==='KR'?'korean-phone':'intl-phone').value,birthDate:byId('birth-date').value,
      contactEmail:byId('contact-email').value,nationality:form.elements['nationality-mode'].value==='KR'?'KR':country.value,
      xAccount:byId('x-account').value,language:lang.value,collectionAgreed:checkboxes[0].checked,agreed:checkboxes[1].checked,version:'2026-11-13-v2'});
    winner.agreed=true;
    form.reset();
  } catch (error) {
    if (error.message==='CONSENT_DEADLINE') winner.expired=true;
    else message={SESSION_EXPIRED:'registrationExpired',ANNOUNCEMENT_CLOSED:'closed',RATE_LIMITED:'rate',INVALID_FIELDS:'formInvalid',INVALID_PHONE:'phoneInvalid',INVALID_X:'xInvalid'}[error.message] || 'failed';
  } finally {busy=false; render(); byId('winner-status').focus();}
};

setupLanguage(render);
render();
void openRegistration();
