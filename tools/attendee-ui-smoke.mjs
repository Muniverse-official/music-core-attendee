import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('qa-screenshots',{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1360,height:950},timezoneId:'America/Los_Angeles'});
const page=await context.newPage(),pageErrors=[];
page.on('pageerror',e=>pageErrors.push(e.message));
const host='https://muniverse-official.github.io',now=Date.now();
const config={event_date:'2026-09-12',event_date_tba:'false',registration_open_at:'2026-09-09T17:00:00+09:00',registration_close_at:'2026-09-10T11:00:00+09:00',show_event_date:'false',test_mode:'true',registration_paused:'false'};
const blank={event_date:'',event_date_tba:'true',registration_open_at:'',registration_close_at:'',show_event_date:'false',test_mode:'false',registration_paused:'false'};
const store={},hist=[],requests=[];
for(const p of ['music_core','fans_pick']){
 const a=crypto.randomUUID(),b=crypto.randomUUID(),cfg={...config,event_date:p==='music_core'?'2026-09-12':'2026-09-14'};
 store[p]={active_round_id:a,config:cfg,rounds:[{id:a,title:p==='music_core'?'963회차':'1회차',program:p,config:{...cfg},version:1,is_public:true,archived:false},{id:b,title:'별도 준비 회차',program:p,config:{...cfg},version:1,is_public:false,archived:false}],winners:[{id:crypto.randomUUID(),round_id:a,email:'shared@example.com',nickname:'현재명단',event_date:cfg.event_date,submitted:true},{id:crypto.randomUUID(),round_id:b,email:'shared@example.com',nickname:'다른명단',event_date:cfg.event_date,submitted:false}]};
}
const mockHeaders={'access-control-allow-origin':host,'access-control-allow-headers':'authorization,content-type,x-admin-request','access-control-allow-methods':'POST,OPTIONS'};
await page.route('**/functions/v1/attendee-admin',async route=>{
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:mockHeaders});
 const b=route.request().postDataJSON();requests.push(b);let result={ok:true};const s=store[b.program],r=s?.rounds.find(x=>x.id===b.round_id);
 if(b.action==='login')result={ok:true,token:'a'.repeat(64),username:'admin'};
 else if(b.action==='get')result={ok:true,username:'admin',expiresAt:new Date(now+7200000).toISOString(),serverTime:new Date().toISOString(),history:hist,...store};
 else if(b.action==='create_round'){const id=crypto.randomUUID(),src=s.rounds.find(x=>x.id===b.source_round_id);s.rounds.unshift({id,title:b.title,program:b.program,config:src?{...src.config,test_mode:'false',registration_paused:'false'}:{...blank},version:1,is_public:false,archived:false});result={ok:true,round_id:id};}
 else if(b.action==='save_config'){assert(r,'Save must identify its owning round');assert.equal(b.expected_version,r.version);for(const k of Object.keys(config))r.config[k]=String(b[k]);r.title=b.title;r.version++;if(r.is_public)s.config={...r.config};}
 else if(b.action==='add_winners'){assert(r);for(const w of b.winners)s.winners.push({...w,id:crypto.randomUUID(),round_id:r.id,event_date:r.config.event_date,submitted:false});result={ok:true,added:b.winners.length,duplicates:0};}
 else if(b.action==='update_winner'){assert(r);const w=s.winners.find(w=>w.id===b.id&&w.round_id===r.id);assert(w);Object.assign(w,{email:b.email,nickname:b.nickname});}
 else if(b.action==='delete_winner'){assert(r);assert(s.winners.some(w=>w.id===b.id&&w.round_id===r.id));s.winners=s.winners.filter(w=>!(w.id===b.id&&w.round_id===r.id));}
 else if(b.action==='publish_round'){assert(r);assert.equal(b.confirm,true);s.rounds.forEach(x=>{if(x.is_public||x.id===r.id)x.version++;x.is_public=x.id===r.id});s.active_round_id=r.id;s.config={...r.config};}
 else if(['archive_round','restore_round'].includes(b.action)){assert(r);assert(!r.is_public);r.archived=b.action==='archive_round';r.version++;}
 else assert.fail('Unexpected mock action '+b.action);
 if(s&&b.action!=='get')hist.unshift({program:b.program,action:b.action,detail:{round_id:b.round_id||result.round_id},created_at:new Date().toISOString()});
 return route.fulfill({status:200,contentType:'application/json',headers:mockHeaders,body:JSON.stringify(result)});
});
const settle=()=>page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
const choose=async id=>{await page.locator('[data-round-id="'+id+'"]').click();await settle()};
try{
 // Wait for the exact admin generation rather than testing an older CDN copy.
 for(let n=0;n<12;n++){await page.goto(host+'/music-core-attendee/admin/?qa=rounds5-'+n,{waitUntil:'networkidle'});if(await page.evaluate(()=>document.documentElement.dataset.adminBuild==='rounds-v5'))break;await page.waitForTimeout(5000)}
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.adminBuild),'rounds-v5');
 assert.equal(await page.title(),'Muniverse 방청 통합 관리자');
 await page.fill('#username','admin');await page.fill('#password','mock-browser-test-only');await page.click('#loginButton');await page.locator('#dashboard').waitFor({state:'visible'});await settle();
 for(const p of ['music_core','fans_pick']){
  await page.click('[data-program="'+p+'"]');await settle();const s=store[p],first=s.active_round_id,other=s.rounds.find(r=>r.id!==first).id;
  assert.equal(await page.locator('#selectedRoundTitle').textContent(),p==='music_core'?'963회차':'1회차');
  assert.equal(await page.inputValue('#openAt'),'2026-09-09T17:00','KST must not depend on browser timezone');
  assert.equal(await page.locator('#totalCount').textContent(),'1');
  await page.check('#showEventDate');await page.click('#saveSettings');await settle();
  const save=requests.findLast(x=>x.action==='save_config');assert.equal(save.round_id,first);assert(save.registration_open_at.endsWith('+09:00'));
  const original=structuredClone(s.rounds.find(r=>r.id===first).config);
  await page.click('[data-pane="winners"]');assert.equal(await page.locator('#winnerRows tr').count(),1);assert((await page.locator('#winnerRows').textContent()).includes('현재명단'));assert(!(await page.locator('#winnerRows').textContent()).includes('다른명단'));
  await page.fill('#winnerInput','ui-test@example.com, UI 점검');await page.click('#addButton');await settle();
  let row=page.locator('#winnerRows tr').filter({hasText:'UI 점검'});await row.getByRole('button',{name:'수정',exact:true}).click();await page.fill('#editNickname','UI 수정');await page.locator('#editForm button[type="submit"]').click();await settle();
  row=page.locator('#winnerRows tr').filter({hasText:'UI 수정'});page.once('dialog',d=>d.accept());await row.getByRole('button',{name:'삭제',exact:true}).click();await settle();assert.equal(await page.locator('#winnerRows tr').count(),1);
  await choose(other);await page.click('[data-pane="winners"]');assert.equal(await page.locator('#winnerRows tr').count(),1);assert((await page.locator('#winnerRows').textContent()).includes('다른명단'));
  await choose(first);await page.click('#createRound');assert.equal(await page.inputValue('#newRoundTitle'),p==='music_core'?'964회차':'2회차');await page.locator('#createForm button[type="submit"]').click();await settle();
  const next=s.rounds[0];assert.equal(s.active_round_id,first,'Creating a draft must not publish it');assert.equal(await page.locator('#totalCount').textContent(),'0','Winner records must not be copied');
  await page.uncheck('#eventTba');await page.fill('#eventDate','2026-09-19');await page.fill('#openAt','2026-09-16T17:00');await page.fill('#closeAt','2026-09-17T11:00');await page.click('#saveSettings');await settle();assert.deepEqual(s.rounds.find(r=>r.id===first).config,original,'Draft settings must not overwrite previous episode');
  await page.click('[data-pane="winners"]');await page.fill('#winnerInput','shared@example.com, 다음회차명단');await page.click('#addButton');await settle();assert.equal(await page.locator('#winnerRows tr').count(),1);assert.equal(s.winners.find(w=>w.round_id===first).submitted,true,'Previous registration remains completed');
  page.once('dialog',d=>d.accept());await page.click('#publishRound');await settle();assert.equal(s.active_round_id,next.id);assert.equal(s.rounds.filter(r=>r.is_public).length,1);
  await choose(first);page.once('dialog',d=>d.accept());await page.click('#archiveRound');await settle();assert(s.rounds.find(r=>r.id===first).archived);assert(await page.locator('#saveSettings').isDisabled());
  page.once('dialog',d=>d.accept());await page.click('#archiveRound');await settle();assert(!s.rounds.find(r=>r.id===first).archived);assert.equal(s.winners.find(w=>w.round_id===first).submitted,true);
  await choose(next);await page.screenshot({path:'qa-screenshots/admin-'+p+'-rounds.png',fullPage:true});
  console.log('PASS '+p+': episode hierarchy, KST settings, same-date isolation, winner CRUD, next number, draft creation, explicit publish, archive and restore');
 }
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'qa-screenshots/admin-rounds-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No mobile horizontal page overflow');await page.setViewportSize({width:1000,height:850});
 await page.unroute('**/functions/v1/attendee-admin');
 for(const program of ['fans_pick','music_core'])for(const state of ['NOT_OPEN','OPEN','CLOSED']){
  const at=Date.now(),open=state==='NOT_OPEN'?at+3600000:at-3600000,close=state==='CLOSED'?at-1000:at+7200000;
  await page.route('**/functions/v1/attendee-config?program=*',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':host},body:JSON.stringify({ok:true,program,state,serverTime:new Date(at).toISOString(),openAt:new Date(open).toISOString(),closeAt:new Date(close).toISOString(),testMode:false,paused:false,showEventDate:false,eventDate:null,eventDateTba:false})}));
  await page.goto(host+(program==='fans_pick'?'/cover-pick-attendee/':'/music-core-attendee/')+'?qa=rounds5-'+state,{waitUntil:'networkidle'});await page.waitForFunction(expected=>window.AttendeeAvailability?.state()===expected,state);
  assert.equal(await page.locator('#step1').isVisible(),state==='OPEN');assert.equal(await page.locator('#closedCard').isVisible(),state!=='OPEN');if(state==='CLOSED')assert((await page.locator('#closedTitle').textContent()).includes('마감'));if(state==='NOT_OPEN')assert((await page.locator('#closedTitle').textContent()).includes('아직'));
  await page.screenshot({path:'qa-screenshots/'+program+'-'+state+'.png',fullPage:true});await page.unroute('**/functions/v1/attendee-config?program=*');console.log('PASS public '+program+' '+state);
 }
 assert.deepEqual(pageErrors,[]);console.log('PASS all browser checks. Admin authentication and mutations were mocked; no live winner data was changed.');
}catch(error){await page.screenshot({path:'qa-screenshots/failure.png',fullPage:true});console.error('PAGE ERRORS',pageErrors);throw error}finally{await browser.close()}
