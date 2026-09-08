(() => {
'use strict';
const p=location.pathname.includes('/cover-pick-attendee/')?'fans_pick':'music_core';
const CDN='https://kkaoerbblpuszptiibvo.supabase.co/storage/v1/object/public/attendee-public-config/'+p+'.json';
const root=document.documentElement, $=id=>document.getElementById(id);
const words={
ko:{loading:['확인 중입니다.','잠시만 기다려 주세요.'],before:['방청자 당첨 확인 기간이 아닙니다.','당첨자 발표 시작 후 다시 확인해 주세요.'],closed:['방청 발표가 마감되었습니다.',p==='fans_pick'?'다가오는 다음 팬즈픽을 기대해주세요!':'다음 쇼! 음악중심 방청자 발표를 기다려 주세요.'],paused:['방청자 당첨 확인이 잠시 중단되었습니다.','잠시 후 다시 확인해 주세요.'],error:['지금은 페이지를 확인할 수 없습니다.','잠시 후 다시 시도해 주세요.'],tba:'방청일은 추후 별도 안내됩니다.',date:'방청일',hero:'방청 당첨 확인'},
en:{loading:['Checking availability','Please wait a moment.'],before:['Winner verification has not opened yet.','Please return after the announcement opens.'],closed:['The winner announcement has closed.',p==='fans_pick'?'Stay tuned for the next FANS PICK!':'Stay tuned for the next Show! Music Core audience announcement.'],paused:['Winner verification is temporarily unavailable.','Please try again later.'],error:['This page is temporarily unavailable.','Please try again shortly.'],tba:'The attendance date will be announced separately.',date:'Attendance date',hero:'Audience winner announcement'},
ja:{loading:['確認中です。','しばらくお待ちください。'],before:['観覧当選者の確認期間はまだ始まっていません。','当選発表の開始後にご確認ください。'],closed:['観覧当選発表は終了しました。',p==='fans_pick'?'次回のFANS PICKをお楽しみに！':'次回のショー！音楽中心の観覧当選発表をお待ちください。'],paused:['観覧当選者の確認を一時停止しています。','しばらくしてから再度ご確認ください。'],error:['現在ページを表示できません。','しばらくしてから再度お試しください。'],tba:'観覧日は後日別途ご案内します。',date:'観覧日',hero:'観覧当選確認'},
'zh-TW':{loading:['確認中','請稍候。'],before:['觀眾中獎確認尚未開始。','請於中獎公告開始後再次確認。'],closed:['觀眾中獎公告已結束。',p==='fans_pick'?'敬請期待下一次 FANS PICK！':'敬請期待下一次《Show! 音樂中心》觀眾中獎公告。'],paused:['觀眾中獎確認暫時停止。','請稍後再次確認。'],error:['目前無法開啟此頁面。','請稍後再試。'],tba:'觀眾活動日期將另行通知。',date:'觀眾活動日期',hero:'觀眾中獎確認'},
'zh-CN':{loading:['确认中','请稍候。'],before:['观众中奖确认尚未开始。','请于中奖公告开始后再次确认。'],closed:['观众中奖公告已结束。',p==='fans_pick'?'敬请期待下一次 FANS PICK！':'敬请期待下一次《Show! 音乐中心》观众中奖公告。'],paused:['观众中奖确认暂时停止。','请稍后再次确认。'],error:['目前无法打开此页面。','请稍后重试。'],tba:'观众活动日期将另行通知。',date:'观众活动日期',hero:'观众中奖确认'}
};
const REVISION='20260908-cdn-v8';
const POLL_MS=60000, JITTER_MS=6000, MAX_CONFIG_AGE_MS=90000;
const MIN_REFRESH_MS=54000, MAX_RETRY_MS=300000;
let cfg=null,clockBase=0,loadedAt=0,failed=false,loading=false,previous='LOADING';
let timer=null,wakeTimer=null,nextDue=0,lastAttempt=-Infinity,failures=0,suspended=false;
const mono=()=>performance.now();
const lang=()=>words[$('lang')?.value]?$('lang').value:'ko',copy=()=>words[lang()];
function nowMs(){return clockBase+(mono()-loadedAt)}
function state(){
  if(!cfg)return failed?'UNAVAILABLE':'LOADING';
  if(mono()-loadedAt>MAX_CONFIG_AGE_MS)return'UNAVAILABLE';
  const n=nowMs(),o=Date.parse(cfg.openAt),c=Date.parse(cfg.closeAt);
  if(!Number.isFinite(o)||!Number.isFinite(c))return'UNAVAILABLE';
  if(cfg.paused)return'PAUSED';
  if(n>=c)return'CLOSED';
  if(cfg.testMode||n>=o)return'OPEN';
  return'NOT_OPEN';
}
function burstDelay(action){
  if(action!=='verify'||!cfg||cfg.testMode||state()!=='OPEN')return 0;
  const o=Date.parse(cfg.openAt),n=nowMs();
  if(!Number.isFinite(o)||n<o||n>=o+300000)return 0;
  return Math.random()*8000;
}
function ensure(){
  document.body.dataset.attendeeProgram=p;
  if(!$('closedCard')){
    const panel=document.createElement('section');panel.id='closedCard';panel.className='panel closed-card';
    panel.setAttribute('aria-live','polite');panel.setAttribute('aria-labelledby','closedTitle');
    panel.innerHTML='<div class="closed-content"><svg class="closed-icon" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34"></circle><path d="M25 40l10 10 20-21"></path></svg><h1 id="closedTitle"></h1><p class="closed-lead" id="closedDesc"></p></div>';
    $('step1')?.before(panel);
  }
  if(!$('availabilityDate')){
    const note=document.createElement('p');note.id='availabilityDate';note.className='availability-date';note.hidden=true;$('step1')?.prepend(note);
  }
}
function render(){
  ensure();
  const s=state(),open=s==='OPEN',changed=s!==previous;
  root.dataset.availability=open?'open':'blocked';root.dataset.pageState=open?'open':'closed';
  document.body.dataset.registrationClosed=open?'false':'true';
  const panel=$('closedCard');if(panel)panel.hidden=open;
  if(!open){
    const key=s==='NOT_OPEN'?'before':s==='CLOSED'?'closed':s==='PAUSED'?'paused':s==='LOADING'?'loading':'error';
    $('closedTitle').textContent=copy()[key][0];$('closedDesc').textContent=copy()[key][1];
    if(p==='fans_pick'&&$('heroTitle'))$('heroTitle').textContent=copy().hero;
    ['verifyBtn','submitBtn'].forEach(id=>{if($(id))$(id).disabled=true});
  }else if(changed){
    const v=$('verifyBtn');if(v&&!v.classList.contains('busy'))v.disabled=!($('email')?.value.trim()&&$('nickname')?.value.trim()&&$('consent')?.checked);
    const b=$('submitBtn');if(b&&!b.classList.contains('busy'))b.disabled=false;
    for(const id of ['verifyMessage','submitMessage']){const e=$(id);if(e&&/기간|시작|마감|registration|verification/i.test(e.textContent))e.textContent=''}
  }
  const show=open&&cfg?.showEventDate===true,text=cfg?.eventDateTba?copy().tba:copy().date+': '+(cfg?.eventDate||'');
  const note=$('availabilityDate');if(note){note.hidden=!show;note.textContent=show?text:''}
  root.dataset.showEventDate=show?'true':'false';
  for(const id of ['eventDate','doneEventDate']){const e=$(id);if(e&&show)e.textContent=cfg.eventDateTba?copy().tba:cfg.eventDate}
  previous=s;
}
function active(){return !suspended&&!document.hidden&&navigator.onLine!==false}
function arm(delay){clearTimeout(timer);timer=null;nextDue=mono()+delay;if(active())timer=setTimeout(()=>{timer=null;void refresh()},Math.max(0,delay))}
function pollDelay(){const base=failures?Math.min(MAX_RETRY_MS,POLL_MS*2**Math.min(failures-1,3)):POLL_MS;return base+(Math.random()*2-1)*JITTER_MS}
function valid(j){
  if(!j||j.ok!==true||j.program!==p||!Number.isFinite(Date.parse(j.openAt))||!Number.isFinite(Date.parse(j.closeAt))||Date.parse(j.openAt)>=Date.parse(j.closeAt))return false;
  for(const k of ['paused','testMode','showEventDate','eventDateTba'])if(typeof j[k]!=='boolean')return false;
  return true;
}
async function refresh(){
  if(loading||!active())return;
  const wait=Math.max(lastAttempt+MIN_REFRESH_MS,nextDue)-mono();
  if(wait>0){if(timer===null)arm(wait);return}
  clearTimeout(timer);timer=null;clearTimeout(wakeTimer);wakeTimer=null;
  loading=true;lastAttempt=mono();const started=lastAttempt;
  try{
    const r=await fetch(CDN,{credentials:'omit',signal:AbortSignal.timeout(5000)}),j=await r.json(),received=mono();
    if(!r.ok||!valid(j))throw new Error('CDN_CONFIG');
    cfg=j;loadedAt=received;clockBase=Date.now()+(received-started)/2;failures=0;failed=false;
  }catch{failed=true;failures=Math.min(failures+1,8)}
  finally{loading=false;render();arm(pollDelay())}
}
function wake(){
  render();if(!active()||loading)return;
  const wait=Math.max(nextDue,lastAttempt+MIN_REFRESH_MS)-mono();
  if(wait>0){if(timer===null)arm(wait);return}
  if(wakeTimer===null)wakeTimer=setTimeout(()=>{wakeTimer=null;void refresh()},Math.random()*2000);
}
document.addEventListener('click',e=>{const b=e.target instanceof Element?e.target.closest('#verifyBtn,#submitBtn'):null;if(b&&state()!=='OPEN'){e.preventDefault();e.stopImmediatePropagation();render();wake()}},true);
for(const ev of ['mc-language-change','attendee-language-change'])window.addEventListener(ev,render);
$('lang')?.addEventListener('change',()=>queueMicrotask(render));
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);timer=null;clearTimeout(wakeTimer);wakeTimer=null}else wake()});
window.addEventListener('pagehide',()=>{suspended=true;clearTimeout(timer);timer=null;clearTimeout(wakeTimer);wakeTimer=null});
window.addEventListener('pageshow',()=>{suspended=false;wake()});
window.addEventListener('offline',()=>{clearTimeout(timer);timer=null});
window.addEventListener('online',wake);window.addEventListener('focus',wake);
Object.defineProperty(window,'AttendeeAvailability',{value:Object.freeze({refresh,state,burstDelay,revision:REVISION}),writable:false});
render();arm(Math.random()*1500);setInterval(()=>{if(!document.hidden&&!suspended)render()},1000);
})();
