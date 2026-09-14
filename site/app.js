(async () => {
  'use strict';
  if (!window.MC_COPY) await import('./i18n.js');

  const API = 'https://tcxugltvmatbgsmcepso.supabase.co/functions/v1/music-core-attendee';
  const $ = (id) => document.getElementById(id);
  const state = { selectionType: 'primary', token: '', accountEmail: '', nickname: '', eventDate: '', eventDateTba: false, busy: false };
  const previewStep = new URLSearchParams(location.search).get('preview');
  const lang = () => (window.MC_COPY[$('lang')?.value] ? $('lang').value : 'en');
  const t = (key) => window.MC_COPY[lang()][key];
  const setText = (id, value, html = false) => { const el = $(id); if (!el) return; html ? (el.innerHTML = value) : (el.textContent = value); };
  const tbaText = () => ({ ko:'방청일은 추후 별도 안내됩니다.', en:'The attendance date will be announced separately.', ja:'観覧日は後日別途ご案内します。', 'zh-TW':'觀眾活動日期將另行通知。', 'zh-CN':'观众活动日期将另行通知。' }[lang()] || 'The attendance date will be announced separately.');
  const windowText = (code) => code === 'NOT_OPEN' ? ({ko:'아직 당첨자 확인 기간이 시작되지 않았습니다.',en:'Winner verification has not opened yet.',ja:'当選者確認期間はまだ開始していません。','zh-TW':'中獎者確認尚未開始。','zh-CN':'中奖者确认尚未开始。'}[lang()]||'Not open yet.') : ({ko:'당첨자 확인 및 정보 등록 기간이 종료되었습니다.',en:'Winner verification and registration have closed.',ja:'当選者確認・登録期間は終了しました。','zh-TW':'中獎確認與登記期間已結束。','zh-CN':'中奖确认与登记已结束。'}[lang()]||'Registration has closed.');
  const partialMismatchText = () => ({
    ko:'입력하신 이메일 또는 닉네임이 당첨자 정보와 일치하지 않습니다.',
    en:'The email or nickname you entered does not match the winner information.',
    ja:'入力したメールアドレスまたはニックネームが当選者情報と一致しません。',
    'zh-TW':'您輸入的電子郵件或暱稱與中獎者資料不符。',
    'zh-CN':'您输入的邮箱或昵称与中奖者信息不一致。'
  }[lang()] || 'The email or nickname you entered does not match the winner information.');
  const notListedText = () => ({
    ko:'입력하신 정보는 당첨자 명단에 없습니다.',
    en:'The information you entered is not on the winner list.',
    ja:'入力した情報は当選者名簿にありません。',
    'zh-TW':'您輸入的資料不在中獎者名單中。',
    'zh-CN':'您输入的信息不在中奖者名单中。'
  }[lang()] || 'The information you entered is not on the winner list.');
  const notSelectedText = () => ({
    ko:'당첨되지 않았습니다.',
    en:'You were not selected as a winner.',
    ja:'当選していません。',
    'zh-TW':'您未中獎。',
    'zh-CN':'您未中奖。'
  }[lang()] || 'You were not selected as a winner.');

  const reserveTranslations = {
  "ko": {
    "title": "예비 당첨자로 선정되셨습니다.",
    "body": "본 당첨자의 미등록으로 공석이 발생할 경우, 예비 당첨자 중 추가 당첨자를 선정해 개별 연락드립니다.",
    "instruction": "추가 당첨 시 원활한 방청 안내를 위해 아래에서 방청자 정보를 미리 등록해 주세요.",
    "note": "정보 등록만으로는 방청이 확정되지 않습니다. 등록 후 개별적으로 최종 당첨 안내를 받으셔야 방청이 확정됩니다.",
    "info": "추가 당첨 시 본인 확인과 방청 안내에 사용할 정보를 입력해 주세요.",
    "contact": "추가 당첨 시 등록하신 연락처로 개별 안내드립니다. 한국 번호가 없는 경우 X DM 또는 이메일로 안내드립니다.",
    "doneTitle": "예비 당첨자 정보 등록 완료",
    "doneDesc": "방청자 정보가 정상적으로 등록되었습니다.",
    "doneMain": "개별적으로 최종 당첨 안내를 받으셔야 방청이 확정됩니다.",
    "doneSub": "정보 등록만으로는 방청이 확정되지 않습니다. 등록 후 개별적으로 최종 당첨 안내를 받으셔야 방청이 확정됩니다. 등록하신 정보는 다시 입력하실 필요가 없습니다.",
    "already": "예비 당첨자 정보가 이미 등록되었습니다."
  },
  "en": {
    "title": "You have been selected as a reserve winner.",
    "body": "If places become available because primary winners do not register, we will select additional winners from the reserve list and contact them individually.",
    "instruction": "Please register your attendee information below in advance so we can provide attendance instructions if you are selected.",
    "note": "Registering your information does not confirm attendance. Your place is confirmed only after you receive an individual notice confirming your final selection.",
    "info": "Enter the information we will use to verify your identity and provide attendance instructions if you are selected.",
    "contact": "If you are selected as an additional winner, we will contact you using the details you provide. If you do not have a Korean phone number, we will use X DM or email.",
    "doneTitle": "Reserve winner information registered",
    "doneDesc": "Your attendee information has been saved.",
    "doneMain": "Your place is confirmed only after you receive an individual notice confirming your final selection.",
    "doneSub": "Registering your information does not confirm attendance. Your place is confirmed only after you receive an individual notice confirming your final selection. You will not need to enter your information again.",
    "already": "Your reserve winner information has already been registered."
  },
  "ja": {
    "title": "補欠当選者に選ばれました。",
    "body": "本当選者の未登録により欠員が出た場合、補欠当選者の中から追加当選者を選び、個別にご連絡します。",
    "instruction": "追加当選時にスムーズに観覧をご案内できるよう、下記より観覧者情報を事前にご登録ください。",
    "note": "情報の登録だけでは観覧は確定しません。登録後、最終当選の個別案内を受け取った時点で観覧が確定します。",
    "info": "追加当選時の本人確認と観覧案内に使用する情報をご入力ください。",
    "contact": "追加当選された場合、ご登録の連絡先に個別にご案内します。韓国の電話番号をお持ちでない場合は、XのDMまたはメールでご案内します。",
    "doneTitle": "補欠当選者情報の登録が完了しました",
    "doneDesc": "観覧者情報が正常に登録されました。",
    "doneMain": "最終当選の個別案内を受け取った時点で観覧が確定します。",
    "doneSub": "情報の登録だけでは観覧は確定しません。登録後、最終当選の個別案内を受け取った時点で観覧が確定します。 登録済みの情報を再入力する必要はありません。",
    "already": "補欠当選者情報はすでに登録されています。"
  },
  "zh-TW": {
    "title": "您已入選候補名單。",
    "body": "若正取中獎者未完成登記而出現空缺，我們將從候補名單中選出遞補中獎者，並個別聯絡。",
    "instruction": "為方便遞補中獎後提供觀眾入場資訊，請先在下方登記觀眾資料。",
    "note": "完成資料登記不代表已確定取得觀眾資格。登記後，您須收到個別發送的最終中獎通知，觀眾資格才會正式確定。",
    "info": "請填寫遞補中獎後用於身分確認及觀眾入場通知的資料。",
    "contact": "若您遞補中獎，我們將透過您登記的聯絡方式個別通知。若沒有韓國手機號碼，將透過 X 私訊或電子郵件通知。",
    "doneTitle": "候補中獎者資料登記完成",
    "doneDesc": "觀眾資料已成功儲存。",
    "doneMain": "收到個別發送的最終中獎通知後，觀眾資格才會正式確定。",
    "doneSub": "完成資料登記不代表已確定取得觀眾資格。登記後，您須收到個別發送的最終中獎通知，觀眾資格才會正式確定。 無須再次填寫已登記的資料。",
    "already": "您的候補中獎者資料已完成登記。"
  },
  "zh-CN": {
    "title": "您已入选候补名单。",
    "body": "若正式中奖者未完成登记而出现空缺，我们将从候补名单中选出递补中奖者，并单独联系。",
    "instruction": "为方便递补中奖后提供观众入场信息，请先在下方登记观众信息。",
    "note": "完成信息登记不代表已确定获得观众资格。登记后，您须收到单独发送的最终中奖通知，观众资格才会正式确定。",
    "info": "请填写递补中奖后用于身份核验及观众入场通知的信息。",
    "contact": "若您递补中奖，我们将通过您登记的联系方式单独通知。如没有韩国手机号，将通过 X 私信或电子邮件通知。",
    "doneTitle": "候补中奖者信息登记完成",
    "doneDesc": "观众信息已成功保存。",
    "doneMain": "收到单独发送的最终中奖通知后，观众资格才会正式确定。",
    "doneSub": "完成信息登记不代表已确定获得观众资格。登记后，您须收到单独发送的最终中奖通知，观众资格才会正式确定。 无须再次填写已登记的信息。",
    "already": "您的候补中奖者信息已完成登记。"
  }
};
  const isReserve = () => state.selectionType === 'reserve';
  const reserveCopy = () => reserveTranslations[lang()];
  function reserveLanguage() {
    const c = reserveCopy();
    for (const [id,key] of [['reserveTitle','title'],['reserveBody','body'],['reserveInstruction','instruction'],['reserveNote','note']]) setText(id,c[key]);
    if (!isReserve()) return;
    setText('infoDesc',c.info); setText('contactHint',c.contact);
    for (const id of ['doneTitle','doneDesc','doneMain','doneSub']) setText(id,c[id]);
    setText('alreadyMessage',c.already); setText('alreadyReserveNote',c.doneSub);
  }
  function setSelection(value) {
    state.selectionType = value === 'reserve' ? 'reserve' : 'primary';
    document.body.dataset.selectionType = state.selectionType;
    $('alreadyReserveNote')?.classList.toggle('hidden',!isReserve());
    applyLanguage();
  }

  function setStep(number) { document.querySelectorAll('.step').forEach((element) => element.classList.toggle('active', Number(element.dataset.step) === number)); }
  function applyLanguage() {
    document.documentElement.lang = lang(); setText('heroTitle', t('heroTitle'), true); setText('heroDesc', t('heroDesc'));
    t('steps').forEach((label, index) => setText(`stepLabel${index + 1}`, label)); setText('verifyTitle', t('verifyTitle')); setText('verifyDesc', t('verifyDesc'));
    setText('emailLabel', t('email')); setText('nicknameLabel', t('nickname')); setText('privacyTitle', t('privacyTitle')); setText('privacyText', t('privacy'), true);
    setText('consentLabel', t('consent')); setText('verifyBtnText', t('verifyBtn')); setText('infoTitle', t('infoTitle')); setText('infoDesc', t('infoDesc')); setText('eventDateLabel', t('eventDate'));
    setText('nameLabel', t('name')); setText('nationalityLabel', t('nationality')); setText('birthLabel', t('birth')); setText('phoneLabel', t('phone')); setText('contactLabel', t('contact')); setText('contactHint', t('contactHint'));
    setText('noticeText', t('notice'), true); setText('submitBtnText', t('submit')); setText('doneTitle', t('doneTitle')); setText('doneDesc', t('doneDesc')); setText('doneMain', t('doneMain')); setText('doneSub', t('doneSub'));
    setText('alreadyMessage', t('already')); setText('doneEventLabel', t('eventDate')); if (state.eventDateTba) { setText('eventDate', tbaText()); setText('doneEventDate', tbaText()); }
    window.dispatchEvent(new CustomEvent('mc-language-change'));reserveLanguage();
  }
  function verifyReady() { const ready = Boolean($('consent')?.checked && $('email')?.value.trim() && $('nickname')?.value.trim()); if ($('verifyBtn')) $('verifyBtn').disabled = !ready || state.busy; }
  function busy(button, on) { state.busy = on; button?.classList.toggle('busy', on); if (button) button.disabled = on; }
  async function call(action, payload) {
    const delay=Math.min(8000,Math.max(0,Number(window.AttendeeAvailability?.burstDelay?.(action)||0)));
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
    try { const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, { method:'POST', headers:{'content-type':'application/json','x-music-core-request':'1','x-request-id':crypto.randomUUID()}, body:JSON.stringify(payload), cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal }); let data={}; try{data=await response.json();}catch{} return {response,data}; }
    finally { clearTimeout(timeout); }
  }
  function errorText(code) { if (code==='NOT_OPEN'||code==='CLOSED') return windowText(code); if (code==='WINNER_PARTIAL_MISMATCH') return partialMismatchText(); if (code==='WINNER_NOT_LISTED'||code==='WINNER_MISMATCH'||code==='IDENTITY_MISMATCH') return notListedText(); if (code==='RATE_LIMITED'||code==='TOO_MANY_ATTEMPTS') return t('rate'); if (code==='CONSENT_REQUIRED') return t('consentNeeded'); if (['SESSION_INVALID','SESSION_EXPIRED','INVALID_SESSION'].includes(code)) return t('session'); if (code==='UNDER_15') return t('under15'); return t('network'); }
  function showVerifyError(message, code) {
    if (!message) return;
    message.classList.add('error');
    message.replaceChildren();
    const firstLine = document.createElement('span');
    firstLine.textContent = errorText(code);
    message.appendChild(firstLine);
    if (['WINNER_NOT_LISTED','WINNER_MISMATCH','IDENTITY_MISMATCH'].includes(code)) {
      message.appendChild(document.createElement('br'));
      const result = document.createElement('strong');
      result.textContent = notSelectedText();
      message.appendChild(result);
    }
  }
  function reauthenticate(){$('reserve')?.classList.add('hidden');state.token='';state.reauthPending=true;document.body.classList.remove('already-state');$('step2')?.classList.add('hidden');$('step1')?.classList.remove('hidden');setText('verifyMessage',t('session'));$('step1')?.scrollIntoView({behavior:'smooth',block:'start'});verifyReady();}
  function showStep2() { $('reserve')?.classList.toggle('hidden',!isReserve());reserveLanguage();document.body.classList.remove('already-state'); $('step1')?.classList.add('hidden'); $('step2')?.classList.remove('hidden'); $('done')?.classList.add('hidden'); $('already')?.classList.add('hidden'); setStep(2); (isReserve()?$('reserve'):$('step2'))?.scrollIntoView({behavior:'smooth',block:'start'}); }
  function showDone(already=false,eventDate='') { $('reserve')?.classList.add('hidden'); $('step1')?.classList.add('hidden'); $('step2')?.classList.add('hidden'); $('done')?.classList.toggle('hidden',already); $('already')?.classList.toggle('hidden',!already); document.body.classList.toggle('already-state',already); if(already){setText('alreadyMessage',t('already'));reserveLanguage();$('already')?.scrollIntoView({behavior:'smooth',block:'center'});return;} setStep(3); setText('doneTitle',t('doneTitle'));setText('doneDesc',t('doneDesc'));setText('doneMain',t('doneMain'));setText('doneSub',t('doneSub'));setText('doneEventDate',state.eventDateTba?tbaText():(eventDate||state.eventDate||'-'));reserveLanguage();$('done')?.scrollIntoView({behavior:'smooth',block:'center'}); }
  const validEmail=(value)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  function ageOnDate(birth,eventDate){if(!birth||!eventDate||!/^\d{4}-\d{2}-\d{2}$/.test(eventDate))return NaN;const b=birth.split('-').map(Number),e=eventDate.split('-').map(Number);if([...b,...e].some(n=>!Number.isFinite(n)))return NaN;let age=e[0]-b[0];if(e[1]<b[1]||(e[1]===b[1]&&e[2]<b[2]))age--;return age;}
  async function verify(){const message=$('verifyMessage');if(message){message.textContent='';message.classList.remove('error');}const email=$('email')?.value.trim()||'',nickname=$('nickname')?.value.trim()||'';if(!email||!nickname){if(message)message.textContent=t('missingIdentity');return}if(!validEmail(email)){if(message)message.textContent=t('invalidEmail');return}if(!$('consent')?.checked){if(message)message.textContent=t('consentNeeded');return}busy($('verifyBtn'),true);try{const{response,data}=await call('verify',{email,nickname,privacy_consent:true,website:$('website')?.value||''});if(data.code==='ALREADY_SUBMITTED'){setSelection(data.selectionType||state.selectionType);showDone(true);return}if(!response.ok||!data.ok){if(['WINNER_PARTIAL_MISMATCH','WINNER_NOT_LISTED','WINNER_MISMATCH','IDENTITY_MISMATCH'].includes(data.code)){showVerifyError(message,data.code);$('email')?.focus();return}if(message)message.textContent=errorText(data.code);return}setSelection(data.selectionType);state.token=data.token||data.verificationToken||'';state.accountEmail=email;state.nickname=nickname;state.eventDate=data.eventDate||'';state.eventDateTba=data.eventDateTba===true;if(!state.token){if(message)message.textContent=t('network');return}if($('contactEmail')&&(!state.reauthPending||!$('contactEmail').value))$('contactEmail').value=email;state.reauthPending=false;setText('eventDate',state.eventDateTba?tbaText():state.eventDate);showStep2()}catch{if(message)message.textContent=t('network')}finally{busy($('verifyBtn'),false);verifyReady()}}
  async function submit(){const message=$('submitMessage');if(message)message.textContent='';if(previewStep==='step2'){if(message)message.textContent=t('preview');return}const contactValues=window.AttendeeFields?.values?.()||{nationality:$('nationality')?.value||'',phone:$('phone')?.value||''};const fields={name:$('name')?.value.trim()||'',nationality:contactValues.nationality||'',birth_date:$('birthDate')?.value||'',phone:contactValues.phone||'',contact_email:$('contactEmail')?.value.trim()||'',x_account:$('xAccount')?.value.trim()||''};if(!fields.name||!fields.nationality||!fields.birth_date||!fields.phone||!fields.contact_email){if(message)message.textContent=t('missing');return}if(!validEmail(fields.contact_email)){if(message)message.textContent=t('invalidEmail');return}if(!window.AttendeeFields?.valid?.()){if(message)message.textContent=t('invalidPhone');return}if(!state.eventDateTba){const age=ageOnDate(fields.birth_date,state.eventDate);if(!Number.isFinite(age)||age<15){if(message)message.textContent=t('under15');return}}busy($('submitBtn'),true);try{const{response,data}=await call('submit',{token:state.token,verification_token:state.token,account_email:state.accountEmail,muniverse_nickname:state.nickname,privacy_consent:true,website:$('website')?.value||'',...fields});if(data.code==='ALREADY_SUBMITTED'){setSelection(data.selectionType||state.selectionType);showDone(true);return}if(!response.ok||!data.ok){if(message)message.textContent=errorText(data.code);if(['SESSION_INVALID','SESSION_EXPIRED','INVALID_SESSION'].includes(data.code))reauthenticate();return}setSelection(data.selectionType||state.selectionType);state.eventDateTba=data.eventDateTba===true||state.eventDateTba;showDone(false,data.eventDate||state.eventDate)}catch{if(message)message.textContent=t('network')}finally{busy($('submitBtn'),false)}}
  function showPreview(){if(previewStep!=='step2')return;state.accountEmail='preview@muniverse.io';state.nickname='DESIGN PREVIEW';state.eventDate='2026-09-19';if($('contactEmail'))$('contactEmail').value=state.accountEmail;setText('eventDate',`${state.eventDate} · PREVIEW`);showStep2();const note=document.createElement('p');note.className='preview-notice';note.textContent=t('preview');$('step2')?.insertBefore(note,$('step2')?.children[1]||null)}
  $('lang')?.addEventListener('change',applyLanguage);$('consent')?.addEventListener('change',verifyReady);$('email')?.addEventListener('input',verifyReady);$('nickname')?.addEventListener('input',verifyReady);$('verifyBtn')?.addEventListener('click',verify);$('submitBtn')?.addEventListener('click',submit);window.addEventListener('attendee-fields-change',()=>{if($('submitMessage'))$('submitMessage').textContent=''});applyLanguage();verifyReady();showPreview();
})();
