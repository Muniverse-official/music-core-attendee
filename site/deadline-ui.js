(() => {
  'use strict';
  const API='https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/attendee-config?program=music_core';
  const COPY={
    ko:{notOpen:'방청자 당첨 확인 기간이 아닙니다.',closed:'방청자 당첨 확인 및 정보 등록 기간이 종료되었습니다.'},
    en:{notOpen:'Winner verification is not currently available.',closed:'Winner verification and registration have closed.'},
    ja:{notOpen:'現在は当選者確認期間ではありません。',closed:'当選者確認・登録期間は終了しました。'},
    'zh-TW':{notOpen:'目前不在中獎者確認期間。',closed:'中獎確認與登記期間已結束。'},
    'zh-CN':{notOpen:'当前不在中奖者确认期间。',closed:'中奖确认与登记已结束。'}
  };
  let config=null;
  const currentLang=()=>{const v=document.getElementById('lang')?.value||'ko';return COPY[v]?v:'en'};
  const copy=()=>COPY[currentLang()];
  const state=()=>{
    if(!config||config.testMode===true)return'OPEN';
    const n=Date.now(),o=config.openAt?Date.parse(config.openAt):NaN,c=config.closeAt?Date.parse(config.closeAt):NaN;
    if(Number.isFinite(o)&&n<o)return'NOT_OPEN';
    if(Number.isFinite(c)&&n>=c)return'CLOSED';
    return'OPEN';
  };
  function hideSchedule(){
    const text=document.getElementById('registrationDeadlineText');
    const card=text?.closest('.important-note');
    if(card)card.style.display='none';
  }
  function render(){
    hideSchedule();
    const s=state();
    document.body.dataset.registrationClosed=s==='CLOSED'?'true':'false';
    if(s==='OPEN'){
      ['verifyMessage','submitMessage'].forEach(id=>{const el=document.getElementById(id);if(el&&/기간|verification|確認|中奖|中獎/.test(el.textContent||''))el.textContent=''});
      return;
    }
    const m=s==='NOT_OPEN'?copy().notOpen:copy().closed;
    ['verifyBtn','submitBtn'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=true});
    ['verifyMessage','submitMessage'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=m});
  }
  async function load(){try{const r=await fetch(API,{cache:'no-store'}),j=await r.json();if(j.ok){config=j;render()}}catch{hideSchedule()}}
  document.addEventListener('click',(event)=>{if(state()==='OPEN')return;const button=event.target instanceof Element?event.target.closest('#verifyBtn,#submitBtn'):null;if(!button)return;event.preventDefault();event.stopImmediatePropagation();render()},true);
  document.addEventListener('input',()=>{if(state()!=='OPEN')queueMicrotask(render)},true);
  document.addEventListener('change',()=>queueMicrotask(render),true);
  window.addEventListener('mc-language-change',render);
  hideSchedule();
  load();
})();
