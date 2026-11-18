import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = path.resolve(import.meta.dirname, '..');
const host = 'https://muniverse-official.github.io';
const origin = 'https://kkaoerbblpuszptiibvo.supabase.co';
const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
const context = await browser.newContext({acceptDownloads:true});
const page = await context.newPage();
const requests = [], privateRequests = [], pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
const cfg = {event_date:'2026-11-21',event_date_tba:'false',registration_open_at:'2026-11-18T17:30:00+09:00',registration_close_at:'2026-11-19T11:00:00+09:00',show_event_date:'false',test_mode:'false',registration_paused:'false'};
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222', c='33333333-3333-4333-8333-333333333333';
const rounds={music_core:[{id:a,title:'971회차',program:'music_core',config:cfg,is_public:true,archived:false,version:1,primary_count:120,reserve_count:0,registered_count:120},{id:b,title:'972회차',program:'music_core',config:cfg,is_public:false,archived:false,version:1,primary_count:2,reserve_count:0,registered_count:0}],fans_pick:[{id:c,title:'2회차',program:'fans_pick',config:cfg,is_public:true,archived:false,version:1,primary_count:3,reserve_count:0,registered_count:0}]};
const winners={
 [a]:Array.from({length:120},(_,i)=>({id:'winner-'+i,round_id:a,email:`qa${i}@example.invalid`,nickname:`QA-${i}`,selection_type:'primary',submitted:true,name:`Tester ${i}`,x_account:`@qa${i}`,registered_at:'2026-11-18T03:00:00Z'})),
 [b]:Array.from({length:2},(_,i)=>({id:'draft-'+i,round_id:b,email:`draft${i}@example.invalid`,nickname:`DRAFT-${i}`,selection_type:'primary',submitted:false})),
 [c]:Array.from({length:3},(_,i)=>({id:'fan-'+i,round_id:c,email:`fan${i}@example.invalid`,nickname:`FAN-${i}`,selection_type:'primary',submitted:false}))
};
await context.route(host+'/music-core-attendee/admin/**',async route=>{
 const relative=decodeURIComponent(new URL(route.request().url()).pathname.replace('/music-core-attendee/admin/',''))||'index.html';
 const file=path.resolve(base,'site/admin',relative);
 if(!file.startsWith(path.resolve(base,'site/admin')+path.sep))return route.abort();
 try{const body=await readFile(file);return route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'text/plain'});}catch{return route.fulfill({status:404});}
});
await context.route(origin+'/**',route=>route.abort());
await context.route(origin+'/functions/v1/attendee-private-test',route=>{
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':host,'access-control-allow-headers':'authorization,content-type,x-admin-request'}});
 privateRequests.push(route.request().postDataJSON());
 return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':host},body:JSON.stringify({ok:true,title:'3. ENHYPEN',open:false,winners:[]})});
});
await context.route(origin+'/functions/v1/attendee-admin',route=>{
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':host,'access-control-allow-headers':'authorization,content-type,x-admin-request'}});
 const body=route.request().postDataJSON(); requests.push(body);
 if(body.action==='login')return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':host},body:JSON.stringify({ok:true,token:'a'.repeat(64),username:'admin'})});
 assert.equal(body.action,'get_scoped','The UI must not fetch full personal-data history');
 const id=body.round_id||({music_core:a,fans_pick:c})[body.program];
 const response={ok:true,username:'admin',expiresAt:new Date(Date.now()+3600000).toISOString(),serverTime:new Date().toISOString(),history:[],delivery:{}};
 for(const program of ['music_core','fans_pick'])response[program]={active_round_id:program==='music_core'?a:c,config:cfg,rounds:rounds[program],winners:program===body.program?winners[id]:[],loaded_round_id:program===body.program?id:null};
 return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':host},body:JSON.stringify(response)});
});
try{
 await page.goto(host+'/music-core-attendee/admin/');
 await page.fill('#username','admin');await page.fill('#password','mock-only');await page.click('#loginButton');
 await page.locator('#dashboard').waitFor({state:'visible'});await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 assert.deepEqual(requests.filter(r=>r.action==='get_scoped').map(r=>r.program),['music_core']);
 assert.equal(privateRequests.length,0,'ENHYPEN data must not load on login');
 assert.equal(await page.locator('#selectedRoundTitle').textContent(),'971회차');
 assert.match(await page.locator('[data-round-id="'+b+'"] small').textContent(),/본 당첨 2명/);
 await page.click('#winnersTab');
 assert.equal(await page.locator('#winnerRows tr').count(),50);
 assert.equal(await page.locator('#winnerPageLabel').textContent(),'1 / 3');
 await page.click('#winnerNext');assert.equal(await page.locator('#winnerRows tr').count(),50);
 await page.click('#winnerNext');assert.equal(await page.locator('#winnerRows tr').count(),20);
 await page.fill('#search','QA-119');await page.waitForFunction(()=>document.querySelector('#visibleCount')?.textContent==='1명');
 assert.equal(await page.locator('#winnerRows tr').count(),1);
 await page.fill('#search','');await page.waitForFunction(()=>document.querySelector('#visibleCount')?.textContent==='120명');
 const downloaded=page.waitForEvent('download');await page.click('#exportCsv');const csv=await readFile(await (await downloaded).path(),'utf8');
 assert.equal(csv.trim().split('\r\n').length,121,'CSV keeps all filtered winners, across pages');
 await page.click('#attendeesTab');assert.equal(await page.locator('#attendeeRows tr').count(),50);
 await page.click('#attendeeNext');await page.click('#attendeeNext');assert.equal(await page.locator('#attendeeRows tr').count(),20);
 await page.fill('#attendeeSearch','@qa119');await page.waitForFunction(()=>document.querySelector('#attendeeCount')?.textContent==='1명');
 assert.equal(await page.locator('#attendeeRows tr').count(),1);
 await page.fill('#attendeeSearch','');await page.waitForFunction(()=>document.querySelector('#attendeeCount')?.textContent==='120명');
 const attendeeDownload=page.waitForEvent('download');await page.click('#exportAttendeesCsv');const attendeeCsv=await readFile(await (await attendeeDownload).path(),'utf8');
 assert.equal(attendeeCsv.trim().split('\r\n').length,121,'Attendee CSV keeps all filtered registrations, across pages');
 await page.click('[data-round-id="'+b+'"]');await page.waitForFunction(()=>document.querySelector('#selectedRoundTitle')?.textContent==='972회차'&&document.body.getAttribute('aria-busy')==='false');
 assert.equal(requests.filter(r=>r.action==='get_scoped').at(-1).round_id,b);
 await page.click('[data-program="fans_pick"]');await page.waitForFunction(()=>document.querySelector('#selectedRoundTitle')?.textContent==='2회차'&&document.body.getAttribute('aria-busy')==='false');
 assert.equal(requests.filter(r=>r.action==='get_scoped').at(-1).program,'fans_pick');
 assert.equal(privateRequests.length,0);
 await page.getByRole('button',{name:'3. ENHYPEN'}).click();await page.waitForFunction(()=>document.querySelector('#privateTestTitle')?.textContent==='ENHYPEN'&&document.querySelector('#enhypenTestStatus')?.textContent==='미공개');
 assert.equal(privateRequests.length,1,'ENHYPEN data loads only on tab open');
 assert.deepEqual(pageErrors,[]);
 console.log('PASS scoped initial/program/round requests, no ENHYPEN prefetch, winner/attendee 50-row paging, delayed search, full filtered CSV');
}finally{await browser.close()}
