(() => {
  'use strict';
  const API='https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/attendee-config?program=music_core';
  const COPY={
    ko:{open:'오픈',close:'마감',notOpen:'아직 방청자 당첨 확인 기간이 시작되지 않았습니다.',closed:'방청자 당첨 확인 및 정보 등록 기간이 종료되었습니다.',tba:'방청일은 추후 별도 안내됩니다.'},
    en:{open:'Open',close:'Close',notOpen:'Winner verification has not opened yet.',closed:'Winner verification and registration have closed.',tba:'The attendance date will be announced separately.'},
    ja:{open:'開始',close:'締切',notOpen:'当選者確認期間はまだ開始していません。',closed:'当選者確認・登録期間は終了しました。',tba:'観覧日は後日別途ご案内します。'},
    'zh-TW':{open:'開始',close:'截止',notOpen:'中獎者確認尚未開始。',closed:'中獎確認與登記期間已結束。',tba:'觀眾活動日期將另行通知。'},
    'zh-CN':{open:'开始',close:'截止',notOpen:'中奖者确认尚未开始。',closed:'中奖确认与登记已结束。',tba:'观众活动日期将另行通知。'}
  };
  let config=null;
  const currentLang=()=>{const v=document.getElementById('lang')?.value||'ko';return COPY[v]?v:'en'};
  const copy=()=>COPY[currentLang()];
  const fmt=(v)=>{if(!v)return'-';try{return new Intl.DateTimeFormat(currentLang()==='ko'?'ko-KR':'en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v))+' KST'}catch{return v}};
  const state=()=>{if(!config)return'OPEN';const n=Date.now(),o=config.openAt?Date.parse(config.openAt):NaN,c=config.closeAt?Date.parse(config.closeAt):NaN;if(Number.isFinite(o)&&n<o)return'NOT_OPEN';if(Number.isFinite(c)&&n>=c)return'CLOSED';return'OPEN'};
  function render(){if(!config)return;const text=document.getElementById('registrationDeadlineText');if(text)text.innerHTML=`<strong>${copy().open}</strong> ${fmt(config.openAt)}<br><strong>${copy().close}</strong> ${fmt(config.closeAt)}${config.eventDateTba?`<br><strong>${copy().tba}</strong>`:''}`;const s=state();document.body.dataset.registrationClosed=s==='CLOSED'?'true':'false';if(s==='OPEN')return;const m=s==='NOT_OPEN'?copy().notOpen:copy().closed;['verifyBtn','submitBtn'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=true});['verifyMessage','submitMessage'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=m})}
  async function load(){try{const r=await fetch(API,{cache:'no-store'}),j=await r.json();if(j.ok){config=j;render()}}catch{}}
  document.addEventListener('click',(event)=>{if(state()==='OPEN')return;const button=event.target instanceof Element?event.target.closest('#verifyBtn,#submitBtn'):null;if(!button)return;event.preventDefault();event.stopImmediatePropagation();render()},true);
  document.addEventListener('input',()=>{if(state()!=='OPEN')queueMicrotask(render)},true);document.addEventListener('change',()=>queueMicrotask(render),true);window.addEventListener('mc-language-change',render);load();
})();
