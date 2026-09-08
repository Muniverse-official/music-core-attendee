import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('qa-screenshots',{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1400,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));

const host='https://muniverse-official.github.io';
const cfg={event_date:'2026-09-12',event_date_tba:'false',registration_open_at:'2026-09-09T17:00:00+09:00',registration_close_at:'2026-09-10T11:00:00+09:00',show_event_date:'false',test_mode:'false',registration_paused:'false'};
const round=(id,title,program,is_public,event_date)=>({id,title,program,is_public,archived:false,version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),config:{...cfg,event_date}});
const music963=round('11111111-1111-4111-8111-111111111111','963회차','music_core',true,'2026-09-12');
const music964=round('22222222-2222-4222-8222-222222222222','964회차','music_core',false,'2026-09-19');
const fans1=round('33333333-3333-4333-8333-333333333333','1회차','fans_pick',true,'2026-09-14');
const fans2=round('44444444-4444-4444-8444-444444444444','2회차','fans_pick',false,'2026-09-21');
const payload={
  ok:true,username:'admin',expiresAt:new Date(Date.now()+7200000).toISOString(),serverTime:new Date().toISOString(),history:[],
  music_core:{active_round_id:music963.id,rounds:[music963,music964],winners:[]},
  fans_pick:{active_round_id:fans1.id,rounds:[fans1,fans2],winners:[]}
};

await page.route('**/functions/v1/attendee-admin',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':host}});
  const body=route.request().postDataJSON();
  const response=body.action==='login'?{ok:true,token:'a'.repeat(64),username:'admin'}:body.action==='get'?payload:{ok:true};
  return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':host},body:JSON.stringify(response)});
});

try{
  await page.goto(host+'/music-core-attendee/admin/?qa=blackfix-'+Date.now(),{waitUntil:'networkidle'});
  await page.fill('#username','admin');
  await page.fill('#password','mock-only');
  await page.click('#loginButton');
  await page.locator('#dashboard').waitFor({state:'visible',timeout:10000});
  await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false',{timeout:10000});
  await page.waitForTimeout(300);

  assert.equal(await page.locator('#selectedRoundTitle').textContent(),'964회차');
  assert.deepEqual(await page.locator('#roundList .round-item strong').allTextContents(),['964회차','963회차']);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.roundOrder),'latest-first-safe');

  await page.click('[data-program="fans_pick"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#selectedRoundTitle').textContent(),'2회차');
  assert.deepEqual(await page.locator('#roundList .round-item strong').allTextContents(),['2회차','1회차']);
  assert.deepEqual(errors,[]);

  await page.screenshot({path:'qa-screenshots/admin-blackfix.png',fullPage:true});
  console.log('PASS admin login: dashboard visible, no page errors, latest round first/selected for both programs');
} catch(error){
  await page.screenshot({path:'qa-screenshots/admin-blackfix-failure.png',fullPage:true});
  console.error('PAGE ERRORS',errors);
  throw error;
} finally {
  await browser.close();
}
