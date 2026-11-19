// Browser-only smoke test. Every API response and identity is synthetic.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const playwrightPath = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const { chromium } = await import(playwrightPath ? path.join(playwrightPath, 'playwright/index.mjs') : 'playwright');
const base = path.resolve(import.meta.dirname, '..');
const host = 'https://muniverse-official.github.io';
const origin = 'https://kkaoerbblpuszptiibvo.supabase.co';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({headless:true, executablePath});
const context = await browser.newContext({acceptDownloads:true});
const page = await context.newPage();
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
await page.clock.setFixedTime(new Date('2026-11-19T09:00:00Z'));

const current = {
  published:false,
  startAt:'2026-11-20T09:00:00+09:00',
  endAt:'2026-11-22T09:00:00+09:00',
};
const winners = [{id:'11111111-1111-4111-8111-111111111111',email:'synthetic@example.invalid',nickname:'Synthetic',selection:'primary',winner_number:'M1',consent:null}];
const fixedNow = Date.parse('2026-11-19T09:00:00Z');
const respond = (route, body) => route.fulfill({status:200, contentType:'application/json',headers:{'access-control-allow-origin':host},body:JSON.stringify(body)});
const preflight = route => route.fulfill({status:204,headers:{'access-control-allow-origin':host,'access-control-allow-headers':'authorization,content-type,x-admin-request','access-control-allow-methods':'POST,OPTIONS'}});

// Browser never reaches the live APIs or a user-facing page.
await context.route('**/*', route => route.abort());
await context.route(host+'/music-core-attendee/admin/**', async route => {
  const relative = decodeURIComponent(new URL(route.request().url()).pathname.replace('/music-core-attendee/admin/','')) || 'index.html';
  const file = path.resolve(base,'site/admin',relative);
  if (!file.startsWith(path.resolve(base,'site/admin')+path.sep)) return route.abort();
  try {
    const body = await readFile(file);
    return route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)] || 'text/plain'});
  } catch { return route.fulfill({status:404}); }
});
await context.route(origin+'/functions/v1/attendee-admin', route => {
  if (route.request().method()==='OPTIONS') return preflight(route);
  const body=route.request().postDataJSON();
  if (body.action==='login') return respond(route,{ok:true,token:'a'.repeat(64),username:'synthetic-admin'});
  assert.equal(body.action,'get_scoped');
  const empty={rounds:[],winners:[],loaded_round_id:null,active_round_id:null};
  return respond(route,{ok:true,username:'synthetic-admin',expiresAt:'2026-11-20T00:00:00Z',serverTime:'2026-11-19T09:00:00Z',history:[],music_core:empty,fans_pick:empty});
});
await context.route(origin+'/functions/v1/attendee-private-test', route => {
  if (route.request().method()==='OPTIONS') return preflight(route);
  const body=route.request().postDataJSON();
  requests.push(body);
  if (body.action==='schedule') {
    current.startAt=body.startAt;
    current.endAt=body.endAt;
    return respond(route,{ok:true});
  }
  if (body.action==='visibility') {
    current.published=body.open;
    return respond(route,{ok:true});
  }
  assert.equal(body.action,'state');
  const open=current.published && fixedNow >= Date.parse(current.startAt) && fixedNow < Date.parse(current.endAt);
  return respond(route,{ok:true,open,published:current.published,startAt:current.startAt,endAt:current.endAt,winners});
});

const actions = action => requests.filter(request => request.action===action);
const status = async value => page.waitForFunction(text=>document.querySelector('#enhypenTestStatus')?.textContent===text,value);
const settled = () => page.waitForFunction(()=>!document.querySelector('#enhypenScheduleSave')?.disabled);

try {
  await page.goto(host+'/music-core-attendee/admin/');
  await page.fill('#username','synthetic-admin');
  await page.fill('#password','synthetic-password');
  await page.click('#loginButton');
  await page.getByRole('button',{name:'3. ENHYPEN'}).click();
  await status('비공개');
  assert.equal(await page.locator('#enhypenPrimaryCount').textContent(),'1');
  assert.equal(await page.locator('#enhypenReserveCount').textContent(),'0');
  assert.doesNotMatch(await page.locator('[data-enhypen-kind="primary"]').textContent(),/\/50/);
  assert.equal(await page.locator('#enhypenStartAt').inputValue(),'2026-11-20T09:00');
  assert.equal(await page.locator('#enhypenEndAt').inputValue(),'2026-11-22T09:00');
  assert.equal(await page.locator('#enhypenTestPause').textContent(),'공개로 전환');

  // Invalid window must stay local; changing a date must block the visibility action.
  await page.fill('#enhypenStartAt','2026-11-23T10:00');
  await page.click('#enhypenScheduleSave');
  assert.match(await page.locator('#enhypenScheduleMessage').textContent(),/마감시간/);
  assert.equal(actions('schedule').length,0);
  await page.click('#enhypenTestPause');
  assert.match(await page.locator('#enhypenScheduleMessage').textContent(),/먼저 저장/);
  assert.equal(actions('visibility').length,0);

  // Tab and refresh must guard against losing unsaved values.
  page.once('dialog',async dialog=>{assert.match(dialog.message(),/저장하지 않은/);await dialog.dismiss();});
  await page.click('[data-program="music_core"]');
  assert.equal(await page.locator('#enhypenSchedule').isVisible(),true);
  page.once('dialog',async dialog=>{assert.match(dialog.message(),/새로고침/);await dialog.dismiss();});
  await page.click('#enhypenTestRefresh');
  assert.equal(await page.locator('#enhypenStartAt').inputValue(),'2026-11-23T10:00');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#enhypenTestRefresh');
  await page.waitForFunction(()=>document.querySelector('#enhypenStartAt')?.value==='2026-11-20T09:00');

  // Saving KST dates does not alter the publication flag.
  await page.fill('#enhypenStartAt','2026-11-19T12:30');
  await page.fill('#enhypenEndAt','2026-11-21T11:00');
  await page.click('#enhypenScheduleSave');
  await settled();
  assert.deepEqual(actions('schedule').at(-1),{action:'schedule',startAt:'2026-11-19T12:30:00+09:00',endAt:'2026-11-21T11:00:00+09:00'});
  assert.equal(actions('visibility').length,0);
  await status('비공개');
  page.once('dialog',async dialog=>{assert.match(dialog.message(),/공개로 전환/);await dialog.accept();});
  await page.click('#enhypenTestPause');
  await status('공개 중');
  assert.deepEqual(actions('visibility').at(-1),{action:'visibility',open:true});

  await page.fill('#enhypenStartAt','2026-11-20T10:00');
  await page.click('#enhypenScheduleSave');
  await status('공개 예약 · 시작 전');
  assert.equal(current.published,true);
  await page.fill('#enhypenStartAt','2026-11-18T10:00');
  await page.fill('#enhypenEndAt','2026-11-19T17:00');
  await page.click('#enhypenScheduleSave');
  await status('마감');
  await page.click('#enhypenTestPause');
  await status('비공개');
  assert.deepEqual(actions('visibility').at(-1),{action:'visibility',open:false});

  // The Weverse handoff includes birth date only for consenting primary winners.
  winners.push({id:'22222222-2222-4222-8222-222222222222',email:'consented@example.invalid',nickname:'Consented',selection:'primary',winner_number:'M2',consent:{legal_name:'Synthetic Name',birth_date:'2001-02-03',phone:'01012345678'}});
  winners.push({id:'33333333-3333-4333-8333-333333333333',email:'reserve@example.invalid',nickname:'Reserve',selection:'reserve',winner_number:null,consent:{legal_name:'Reserve Name',birth_date:'2002-03-04',phone:'01087654321'}});
  await page.click('#enhypenTestRefresh');
  await page.waitForFunction(()=>document.querySelector('#enhypenPrimaryCount')?.textContent==='2');
  const downloaded=page.waitForEvent('download');
  await page.click('#enhypenWeverseCsv');
  const csv=await readFile(await (await downloaded).path(),'utf8');
  assert.match(csv,/"이름","생년월일","연락처","개인 당첨 번호"/);
  assert.match(csv,/"Synthetic Name","2001-02-03","01012345678","M2"/);
  assert.doesNotMatch(csv,/Reserve Name|synthetic@example.invalid/);
  assert.deepEqual(errors,[]);
  console.log('PASS ENHYPEN admin KST schedule, separate publication, status transitions, unsaved guard');
} finally {
  await browser.close();
}
