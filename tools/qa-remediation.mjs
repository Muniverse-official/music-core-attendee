import fs from 'node:fs';
import vm from 'node:vm';
const base=import.meta.dirname+'/..';
const results=[];
const check=(name,pass,actual)=>results.push({name,pass,actual});
const source=fs.readFileSync(base+'/site/availability.js','utf8');
async function availability(program,{skew=0,paused=false,testMode=false,fail=false,clockFail=false,stale=false}={}){
 let t=0;let calls=0;let seq=0;const timers=new Map();const listeners={};
 const wall=Date.parse('2026-09-09T17:00:01+09:00');
 class El{constructor(){this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.textContent='';this.dataset={};this.classList={contains:()=>false};}setAttribute(){}addEventListener(n,f){listeners[n]=f}before(){}prepend(){} }
 const elements={}; const el=id=>elements[id]??(elements[id]=new El());
 el('lang').value='ko';el('email').value='qa@example.invalid';el('nickname').value='qa';el('consent').checked=true;
 const cfg={ok:true,program,roundId:'qa-round',openAt:'2026-09-09T17:00:00+09:00',closeAt:'2026-09-10T11:00:00+09:00',paused,testMode,showEventDate:false,eventDateTba:false,publishedAt:new Date(wall-(stale?600000:1000)).toISOString()};
 class ClockDate extends Date{static now(){return wall+t+skew}}
 const document={documentElement:{dataset:{}},body:{dataset:{}},getElementById:el,hidden:false,addEventListener:(n,f)=>{listeners[n]=f}};
 const window={addEventListener:(n,f)=>{listeners[n]=f}};
 const ctx=vm.createContext({window,document,location:{pathname:program==='fans_pick'?'/cover-pick-attendee/':'/music-core-attendee/'},navigator:{onLine:true},Element:El,performance:{now:()=>t},Date:ClockDate,Math,AbortSignal,queueMicrotask,setTimeout:(f,delay)=>{const id=++seq;timers.set(id,{f,due:t+delay});return id},clearTimeout:id=>timers.delete(id),setInterval:()=>0,fetch:async(url)=>{if(String(url).includes('action=clock')){if(clockFail)throw Error('clock unavailable');return {ok:true,json:async()=>({ok:true,serverTime:new Date(wall+t).toISOString()})}}calls++;if(fail)throw Error('offline');return{ok:true,json:async()=>cfg,headers:new Headers({date:new Date(wall+t).toUTCString()})}}});
 vm.runInContext(source,ctx);
 async function tick(to){while(true){const a=[...timers.entries()].sort((a,b)=>a[1].due-b[1].due).find(x=>x[1].due<=to);if(!a)break;t=a[1].due;timers.delete(a[0]);await a[1].f();await new Promise(setImmediate)}t=to;}
 await tick(2000);
 return{state:()=>window.AttendeeAvailability.state(),delay:()=>window.AttendeeAvailability.burstDelay('verify'),tick,calls:()=>calls,document,listeners,cfg};
}
for(const program of ['music_core','fans_pick']){
 let a=await availability(program);check(program+':open_at_start',a.state()==='OPEN',a.state());
 let b=await availability(program,{skew:-86400000});check(program+':device_clock_one_day_slow',b.state()==='OPEN',b.state());
 let c=await availability(program,{skew:86400000});check(program+':device_clock_one_day_fast',c.state()==='OPEN',c.state());
 let d=await availability(program,{paused:true});check(program+':paused',d.state()==='PAUSED',d.state());
 let e=await availability(program,{fail:true});check(program+':network_failure_closes_form',e.state()==='UNAVAILABLE',e.state());
 let stale=await availability(program,{stale:true});check(program+':reject_stale_config_heartbeat',stale.state()==='UNAVAILABLE',stale.state());
 let noClock=await availability(program,{clockFail:true});check(program+':require_server_clock',noClock.state()==='UNAVAILABLE',noClock.state());
 let f=await availability(program);const before=f.calls();f.document.hidden=true;f.listeners.visibilitychange();await f.tick(240000);check(program+':hidden_tab_stops_polling',f.calls()===before,f.calls()-before);
 let g=await availability(program);await g.tick(120000);check(program+':polling_is_bounded',g.calls()<=3,g.calls());
 const delays=Array.from({length:10000},()=>a.delay());let buckets=Array(8).fill(0);for(const ms of delays)buckets[Math.min(7,Math.floor(ms/1000))]++;
 check(program+':ten_thousand_click_spread',true,{simulatedClicks:10000,oneSecondBuckets:buckets,serverBudgetWhenDelayIs8s:20000,pollingRequestsPerSecondAt10000Viewers:10000/60});
}
const gas=fs.readFileSync(base+'/apps-script/Code.gs','utf8');
for(const program of ['music_core','fans_pick'])for(const failFirst of [false,true]){
 const rows=[];let sent=0;let attempts=0;
 const sheet={getName:()=> 'QA회차',getSheetId:()=>1,getLastRow:()=>rows.length+4,hideColumns(){},appendRow:r=>rows.push(r),getRange:(row,col)=>({getValue:()=>rows[row-5]?.[col-1]||'',setValue:v=>{rows[row-5][col-1]=v;},createTextFinder:key=>({matchEntireCell:()=>({findNext:()=>{const i=rows.findIndex(r=>r[col-1]===key);return i<0?null:{getRow:()=>i+5}}})})})};
 const book={getUrl:()=> 'https://example.invalid/sheet'};
 const ctx=vm.createContext({SpreadsheetApp:{flush(){}},Utilities:{formatDate:d=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10)},PropertiesService:{getScriptProperties:()=>({getProperty:()=>''})},MailApp:{sendEmail(){attempts++;if(failFirst&&attempts===1)throw Error('QUOTA');sent++}},Date,Math,Number,isFinite});vm.runInContext(gas,ctx);
 ctx.getFansPickSpreadsheet_=()=>book;ctx.getMusicCoreSpreadsheet_=()=>book;ctx.getOrCreateRoundSheet_=()=>sheet;
 const p={round_id:'qa',round_title:'QA회차',event_date:'2026-09-12',muniverse_nickname:'qa',account_email:'qa@example.invalid',name:'=1+1',birth_date:'2000-01-01',nationality:'KR',phone:'010-1234-5678',x_account:'@qa_test',contact_email:'qa@example.invalid',idempotency_key:'qa-1'};
 const fn=program==='music_core'?ctx.handleMusicCore_:ctx.handleFansPick_;let first;try{first=fn(p)}catch(e){first={error:e.message}}const retry=fn(p);
 check(program+(failFirst?':mail_failure_retry_recovers':':lost_response_retry_reports_success'),retry.emailSent===true&&rows.length===1&&sent===1,{first,retry,rows:rows.length,sent,attempts});
 if(!failFirst){check(program+':spreadsheet_formula_text_escaped',!rows[0].includes('=1+1'),{formulaStoredRaw:rows[0].includes('=1+1')});check(program+':tba_age_uses_current_date',ctx.resolveAge_({...p,event_date:'2099-12-31'},'2099-12-31')===26,ctx.resolveAge_({...p,event_date:'2099-12-31'},'2099-12-31'));}
}

for(const [program,file] of [['music_core',base+'/site/app.js'],['fans_pick',process.env.FANS_PICK_SOURCE||base+'/../cover-pick-attendee/app.js']]){
 const client=fs.readFileSync(file,'utf8'),from=client.indexOf('async function call('),to=client.indexOf('function errorText('),order=[];
 const ctx=vm.createContext({API:'https://example.invalid',window:{AttendeeAvailability:{burstDelay:()=>8000}},AbortController,crypto,JSON,Math,Number,encodeURIComponent,setTimeout:(fn,ms)=>{order.push(ms);if(ms===8000)queueMicrotask(fn);return ms},clearTimeout:()=>{},fetch:async()=>{order.push('fetch');return{ok:true,json:async()=>({ok:true})}}});
 vm.runInContext(client.slice(from,to),ctx);await ctx.call('verify',{});
 check(program+':network_budget_after_admission_wait',JSON.stringify(order)===JSON.stringify([8000,20000,'fetch']),order);
 const elements={};for(const id of ['step1','step2','verifyMessage','name','birthDate','phone','contactEmail'])elements[id]={value:'kept-'+id,textContent:'',classList:{add(){},remove(){}},scrollIntoView(){}};
 const state={token:'expired'},context=vm.createContext({state,$:id=>elements[id],document:{body:{classList:{remove(){}}}},t:()=> 'reauth',setText:(id,v)=>elements[id].textContent=v,verifyReady(){}});
 const fn=client.match(/function reauthenticate\(\)\{[^\n]*\}/);
 if(!fn)throw Error('reauthenticate function missing');vm.runInContext(fn[0]+';reauthenticate();',context);
 check(program+':reauthentication_keeps_personal_inputs',state.token===''&&state.reauthPending===true&&['name','birthDate','phone','contactEmail'].every(id=>elements[id].value==='kept-'+id),{tokenCleared:state.token==='',inputsKept:true});
}
fs.writeFileSync(base+'/tools/qa-remediation-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({total:results.length,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass),loadSimulations:results.filter(x=>x.name.includes('ten_thousand_click_spread'))},null,2));

if(results.some(x=>!x.pass))process.exitCode=1;
