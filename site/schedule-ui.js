(() => {
  'use strict';
  const API='https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/attendee-config?program=music_core';
  const $=id=>document.getElementById(id); let c=null;
  const lang=()=>document.getElementById('lang')?.value||'ko';
  const text={ko:{tba:'방청일은 추후 별도 안내됩니다.',notOpen:'아직 방청자 당첨 확인 기간이 시작되지 않았습니다.',closed:'방청자 당첨 확인 및 정보 등록 기간이 종료되었습니다.',open:'오픈',close:'마감'},en:{tba:'The attendance date will be announced separately.',notOpen:'Winner verification has not opened yet.',closed:'Winner verification and registration have closed.',open:'Open',close:'Close'},ja:{tba:'観覧日は後日別途ご案内します。',notOpen:'当選者確認期間はまだ開始していません。',closed:'当選者確認・登録期間は終了しました。',open:'開始',close:'締切'},'zh-TW':{tba:'觀眾活動日期將另行通知。',notOpen:'中獎者確認尚未開始。',closed:'中獎確認與登記期間已結束。',open:'開始',close:'截止'},'zh-CN':{tba:'观众活动日期将另行通知。',notOpen:'中奖者确认尚未开始。',closed:'中奖确认与登记已结束。',open:'开始',close:'截止'}};
  const tr=k=>(text[lang()]||text.en)[k];
  const fmt=v=>{if(!v)return'-';try{return new Intl.DateTimeFormat(lang()==='ko'?'ko-KR':'en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v))+' KST'}catch{return v}};
  function stateCard(message){['step1','step2','done','already'].forEach(id=>$(id)?.classList.add('hidden'));let card=$('scheduleStateCard');if(!card){card=document.createElement('section');card.id='scheduleStateCard';card.className='panel done-panel';document.querySelector('.hero')?.insertAdjacentElement('afterend',card)}card.innerHTML='<div class="done-content"><div><strong>'+message+'</strong><p>Muniverse</p></div></div>'}
  function apply(){if(!c)return;const note=$('registrationDeadlineText');if(note)note.innerHTML='<strong>'+tr('open')+'</strong> '+fmt(c.openAt)+'<br><strong>'+tr('close')+'</strong> '+fmt(c.closeAt)+(c.eventDateTba?'<br><strong>'+tr('tba')+'</strong>':'');const now=Date.now(),o=c.openAt?Date.parse(c.openAt):NaN,cl=c.closeAt?Date.parse(c.closeAt):NaN;if(Number.isFinite(o)&&now<o)return stateCard(tr('notOpen'));if(Number.isFinite(cl)&&now>=cl)return stateCard(tr('closed'));$('scheduleStateCard')?.remove();$('step1')?.classList.remove('hidden')}
  async function load(){try{const r=await fetch(API,{cache:'no-store'}),j=await r.json();if(j.ok){c=j;apply()}}catch{}}
  $('lang')?.addEventListener('change',apply);load();
})();
