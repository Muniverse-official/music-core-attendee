import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const root=import.meta.dirname+'/..',results=[];
const check=(name,pass,actual)=>results.push({name,pass,actual});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const code=name=>stripTypeScriptTypes(fs.readFileSync(root+'/supabase/functions/'+name+'/index.ts','utf8'),{mode:'transform'});
function runtime(source,fetch){let handler;const ctx=vm.createContext({Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://db.invalid':k==='SUPABASE_SERVICE_ROLE_KEY'?'test-only-secret':null},serve:h=>handler=h},fetch,Headers,Request,Response,URL,AbortSignal,Date,performance,crypto,TextEncoder,TextDecoder,Uint8Array,Map,Set,setTimeout,clearTimeout});vm.runInContext(source,ctx);return handler;}
const jobs=['music_core','fans_pick'].map((program,i)=>({id:i+1,program,round_id:'11111111-1111-4111-8111-111111111111',winner_id:'22222222-2222-4222-8222-222222222222',payload:{name:'QA'}}));
async function worker(mode,authorized=true){
 const calls=[],finished=[],deferred=[],health=[],posts=[];
 const handler=runtime(code('attendee-delivery-worker'),async(u,init={})=>{
  const url=new URL(u),path=url.pathname,body=init.body?JSON.parse(init.body):null;calls.push(path);
  if(path.includes('attendee_internal_secrets'))return json([{secret:'qa-worker'}]);
  if(path.endsWith('_runtime_config'))return json([{key:'apps_script_url',value:'https://script.invalid/'+(path.includes('music_core')?'music':'fans')},{key:'webhook_token',value:'qa-hook'}]);
  if(path.endsWith('/attendee_delivery_health')){health.push(body);return json(null);}
  if(path.endsWith('/attendee_delivery_claim'))return json(jobs);
  if(path.endsWith('/attendee_delivery_is_current'))return json(mode!=='deleted');
  if(path.endsWith('/attendee_delivery_finish')){finished.push(body);return json(null);}
  if(path.endsWith('/attendee_delivery_defer')){deferred.push(body);return json(null);}
  if(url.hostname==='script.invalid'&&init.method!=='POST')return json(mode==='outdated'?{ok:true,version:2}:{ok:true,version:9,service:'muniverse-attendee-dispatcher',sheetMode:'round-tabs',deliveryState:'per-row-v1',textCells:true});
  if(url.hostname==='script.invalid'){posts.push(body);return json(mode==='busy'?{ok:false,code:'BUSY'}:mode==='partial'?{ok:false,sheetUpdated:true,emailSent:false,code:'EMAIL_SEND_FAILED'}:{ok:true,sheetUpdated:true,emailSent:true});}
  throw Error('Unexpected mock request '+path);
 });
 const response=await handler(new Request('https://db.invalid/functions/v1/attendee-delivery-worker',{method:'POST',headers:{'x-delivery-secret':authorized?'qa-worker':'wrong'}}));
 return{status:response.status,body:await response.json(),calls,finished,deferred,health,posts};
}
let r=await worker('success');check('worker_completes_both_programs',r.body.done===2&&r.posts.length===2,r.body);
check('worker_persists_both_success_flags',r.finished.every(x=>x.p_sheet_updated&&x.p_email_sent&&x.p_ok),r.finished);
r=await worker('partial');check('worker_preserves_sheet_success_on_webhook_failure',r.finished.length===2&&r.finished.every(x=>x.p_sheet_updated&&!x.p_email_sent&&!x.p_ok),r.finished);
r=await worker('busy');check('worker_busy_defers_without_finishing',r.deferred.length===2&&r.finished.length===0,r.body);
r=await worker('deleted');check('worker_cancelled_winner_never_transmitted',r.posts.length===0&&r.finished.every(x=>x.p_error==='DELIVERY_CANCELLED'),r.body);
r=await worker('outdated');check('worker_old_deployment_keeps_jobs_queued',r.posts.length===0&&r.deferred.length===2,r.body);
check('worker_old_deployment_visible_in_health',r.health.every(x=>x.status==='upgrade_required'&&x.version===2),r.health);
r=await worker('success',false);check('worker_rejects_unauthorized',r.status===403&&!r.calls.some(x=>x.includes('attendee_delivery_claim')),r.status);

const uploads=[];
const sync=runtime(code('attendee-config-sync'),async(u,init={})=>{
 const path=new URL(u).pathname,body=init.body?JSON.parse(init.body):null;
 if(path.endsWith('/attendee_internal_secrets'))return json([{secret:'qa-sync'}]);
 if(path.endsWith('/attendee_round_public_context'))return json({round_id:'qa-round',round_title:'QA회차',version:7,registration_open_at:'2026-09-09T08:00:00Z',registration_close_at:'2026-09-10T02:00:00Z',show_event_date:'false',event_date:'2026-09-12',webhook_token:'never-publish-this',apps_script_url:'never-publish-this'});
 if(path.startsWith('/storage/')){uploads.push({body,headers:init.headers});return json({});}
 throw Error('Unexpected sync request');
});
for(let i=0;i<2;i++)await sync(new Request('https://db.invalid/functions/v1/attendee-config-sync',{method:'POST',headers:{'x-sync-secret':'qa-sync'}}));
check('sync_republishes_heartbeat_without_setting_changes',uploads.length===4,uploads.length);
check('sync_uses_valid_cache_control',uploads.every(x=>x.headers['cache-control']==='max-age=30, must-revalidate'));
check('sync_never_publishes_delivery_secrets',uploads.every(x=>!('webhook_token'in x.body)&&!('apps_script_url'in x.body)&&x.body.eventDate===null&&x.body.configVersion===7));

async function admin(action,syncFails=false){
 const handler=runtime(code('attendee-admin'),async(u,init={})=>{
  const path=new URL(u).pathname,body=init.body?JSON.parse(init.body):null;
  if(path.endsWith('/attendee_console_sessions'))return json([{username:'qa-admin',created_at:'2026-09-01',expires_at:'2099-01-01'}]);
  if(path.endsWith('/attendee_console_accounts'))return json([{active:true,updated_at:'2026-08-01'}]);
  if(path.endsWith('/attendee_console_throttle'))return json(true);
  if(path.endsWith('/attendee_round_data'))return json({rounds:[],winners:[]});
  if(path.endsWith('/attendee_console_audit'))return json([]);
  if(path.endsWith('/attendee_delivery_console'))return json({health:[],jobs:[]});
  if(path.endsWith('/attendee_round_mutate'))return json({ok:true});
  if(path.endsWith('/attendee_internal_secrets'))return json([{secret:'qa-sync'}]);
  if(path.endsWith('/attendee-config-sync'))return json({ok:!syncFails},syncFails?503:200);
  throw Error('Unexpected admin request '+path);
 });
 const body=action==='get'?{action}:{action,program:'music_core',round_id:'11111111-1111-4111-8111-111111111111',expected_version:1,title:'QA',event_date_tba:true,registration_open_at:'',registration_close_at:'',show_event_date:false,test_mode:false,registration_paused:false};
 const response=await handler(new Request('https://db.invalid/functions/v1/attendee-admin',{method:'POST',headers:{origin:'https://muniverse-official.github.io','x-admin-request':'1','content-type':'application/json',authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify(body)}));return{status:response.status,body:await response.json()};
}
r=await admin('get');check('admin_get_includes_delivery_status',r.status===200&&Array.isArray(r.body.delivery?.jobs),r.body);
r=await admin('save_config');check('admin_save_confirms_publication',r.status===200&&r.body.configPublished===true,r.body);
r=await admin('save_config',true);check('admin_reports_saved_but_publication_pending',r.status===200&&r.body.ok===true&&r.body.configPublished===false,r.body);

const gas=fs.readFileSync(root+'/apps-script/Code.gs','utf8');
for(const program of ['music_core','fans_pick']){
 const rows=[];let sent=0;
 const sheet={getName:()=> 'QA',getSheetId:()=>1,getLastRow:()=>rows.length+4,hideColumns(){},appendRow:r=>rows.push(r),getRange:(row,col)=>({getValue:()=>rows[row-5]?.[col-1]||'',setValue:value=>{if(String(value).startsWith('SENT:'))throw Error('write lost');rows[row-5][col-1]=value},createTextFinder:key=>({matchEntireCell:()=>({findNext:()=>{const i=rows.findIndex(r=>r[col-1]===key);return i<0?null:{getRow:()=>i+5}}})})})};
 const book={getUrl:()=> 'https://example.invalid/sheet'},ctx=vm.createContext({SpreadsheetApp:{flush(){}},PropertiesService:{getScriptProperties:()=>({getProperty:()=>''})},MailApp:{sendEmail(){sent++}},Date,Math,Number,isFinite});vm.runInContext(gas,ctx);
 ctx.getFansPickSpreadsheet_=()=>book;ctx.getMusicCoreSpreadsheet_=()=>book;ctx.getOrCreateRoundSheet_=()=>sheet;
 const p={round_id:'qa',round_title:'QA',event_date:'2026-09-12',muniverse_nickname:'qa',account_email:'qa@example.invalid',name:'QA',birth_date:'2000-01-01',nationality:'KR',phone:'010-1234-5678',x_account:'@qa',contact_email:'qa@example.invalid',idempotency_key:'qa-key'};
 const fn=program==='music_core'?ctx.handleMusicCore_:ctx.handleFansPick_;fn(p);const retry=fn(p);
 check(program+':uncertain_mail_is_not_sent_twice',sent===1&&rows.length===1&&retry.code==='EMAIL_STATUS_UNCERTAIN',{sent,rows:rows.length,code:retry.code});
}
fs.writeFileSync(root+'/tools/qa-worker-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({total:results.length,passed:results.filter(x=>x.pass).length,failures:results.filter(x=>!x.pass)},null,2));
if(results.some(x=>!x.pass))process.exitCode=1;
