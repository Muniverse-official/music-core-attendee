import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('qa-screenshots',{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1000,height:850},timezoneId:'America/Los_Angeles'});
const page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
const host='https://muniverse-official.github.io';const now=Date.now();const config={event_date:'2026-09-12',event_date_tba:'false',registration_open_at:'2026-09-09T17:00:00+09:00',registration_close_at:'2026-09-10T11:00:00+09:00',show_event_date:'false',test_mode:'true',registration_paused:'false'};
const store={music_core:{config:{...config},winners:[]},fans_pick:{config:{...config,event_date:'2026-09-14'},winners:[]}};
const mockHeaders={'access-control-allow-origin':host,'access-control-allow-headers':'authorization,content-type,x-admin-request','access-control-allow-methods':'POST,OPTIONS'};let saved=null;
await page.route('**/functions/v1/attendee-admin',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:mockHeaders});const b=route.request().postDataJSON();let result={ok:true};if(b.action==='login')result={ok:true,token:'a'.repeat(64),username:'admin'};else if(b.action==='get')result={ok:true,username:'admin',expiresAt:new Date(now+7200000).toISOString(),serverTime:new Date().toISOString(),history:[],...store};else if(b.action==='save_config'){saved=b;for(const k of Object.keys(config))store[b.program].config[k]=String(b[k]);}else if(b.action==='add_winners'){for(const w of b.winners)store[b.program].winners.push({...w,id:crypto.randomUUID(),event_date:store[b.program].config.event_date,submitted:false});result={ok:true,added:b.winners.length,duplicates:0};}else if(b.action==='update_winner'){Object.assign(store[b.program].winners.find(w=>w.id===b.id),b);}else if(b.action==='delete_winner'){store[b.program].winners=store[b.program].winners.filter(w=>w.id!==b.id);}return route.fulfill({status:200,contentType:'application/json',headers:mockHeaders,body:JSON.stringify(result)});});
try {
 await page.goto(host+'/music-core-attendee/admin/?qa=3',{waitUntil:'networkidle'});
 assert.equal(await page.title(),'Muniverse 방청 통합 관리자');assert(await page.locator('#loginPanel').isVisible());
 await page.fill('#username','admin');await page.fill('#password','mock-browser-test-only');await page.click('#loginButton');await page.locator('#dashboard').waitFor({state:'visible'});
 assert.equal(await page.inputValue('#openAt'),'2026-09-09T17:00');
 await page.check('#showEventDate');await page.click('#saveSettings');await page.waitForFunction(()=>document.querySelector('#settingsMessage').textContent.includes('저장했습니다'));
 assert(saved.registration_open_at.endsWith('+09:00'));assert.equal(saved.show_event_date,true);
 for(const program of ['music_core','fans_pick']){
  await page.click('[data-program="'+program+'"]');await page.fill('#winnerInput','ui-test@example.com, UI 점검');await page.click('#addButton');await page.getByText('UI 점검',{exact:true}).waitFor();
  await page.locator('#winnerRows button').filter({hasText:'수정'}).click();await page.fill('#editNickname','UI 수정');await page.locator('#editForm button[type="submit"]').click();await page.getByText('UI 수정',{exact:true}).waitFor();
  page.once('dialog',d=>d.accept());await page.locator('#winnerRows button').filter({hasText:'삭제'}).click();await page.waitForFunction(()=>document.querySelector('#winnerRows').children.length===0);
 }
 await page.screenshot({path:'qa-screenshots/admin.png',fullPage:true});
 console.log('PASS admin UTF-8 rendering, mocked login, tabs, KST values, add/edit/delete controls');
 await page.unroute('**/functions/v1/attendee-admin');
 for(const program of ['fans_pick','music_core'])for(const state of ['NOT_OPEN','OPEN','CLOSED']){
  const at=Date.now(),open=state==='NOT_OPEN'?at+3600000:at-3600000,close=state==='CLOSED'?at-1000:at+7200000;
  await page.route('**/functions/v1/attendee-config?program=*',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':host},body:JSON.stringify({ok:true,program,state,serverTime:new Date(at).toISOString(),openAt:new Date(open).toISOString(),closeAt:new Date(close).toISOString(),testMode:false,paused:false,showEventDate:false,eventDate:null,eventDateTba:false})}));
  await page.goto(host+(program==='fans_pick'?'/cover-pick-attendee/':'/music-core-attendee/')+'?qa='+state,{waitUntil:'networkidle'});
  await page.waitForFunction(expected=>window.AttendeeAvailability?.state()===expected,state);
  assert.equal(await page.locator('#step1').isVisible(),state==='OPEN');assert.equal(await page.locator('#closedCard').isVisible(),state!=='OPEN');
  if(state==='CLOSED')assert((await page.locator('#closedTitle').textContent()).includes('마감'));
  if(state==='NOT_OPEN')assert((await page.locator('#closedTitle').textContent()).includes('아직'));
  await page.screenshot({path:'qa-screenshots/'+program+'-'+state+'.png',fullPage:true});
  await page.unroute('**/functions/v1/attendee-config?program=*');console.log('PASS public '+program+' '+state);
 }
 assert.deepEqual(pageErrors,[],'No uncaught browser JavaScript errors');
 console.log('PASS all browser smoke tests. Login/API payloads were mocked; no live winner data was changed.');
} catch(error){await page.screenshot({path:'qa-screenshots/failure.png',fullPage:true});console.error('PAGE ERRORS',pageErrors);throw error;}finally{await browser.close();}
