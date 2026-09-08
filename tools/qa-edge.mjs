import vm from 'node:vm';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const base=import.meta.dirname+'/..';
const source=stripTypeScriptTypes(fs.readFileSync(base+'/supabase/functions/attendee-public/index.ts','utf8'),{mode:'transform'});
let handler;const calls=[];let at=Date.parse('2026-09-09T08:05:00Z');
class MockDate extends Date{static now(){return at}}
const ctx=vm.createContext({Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.invalid':k==='SUPABASE_SERVICE_ROLE_KEY'?'local-test-key':null},serve:h=>handler=h},Date:MockDate,crypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,AbortSignal,atob,btoa,fetch:async(u,init)=>{const b=JSON.parse(init.body);calls.push({u,b});return new Response(JSON.stringify(u.endsWith('attendee_check_winner')?{ok:true,winner_id:'11111111-1111-4111-8111-111111111111',round_id:'22222222-2222-4222-8222-222222222222',event_date:'2026-09-12',event_date_tba:false,show_event_date:false}:{ok:true,round_id:'22222222-2222-4222-8222-222222222222',event_date:'2026-09-12',delivery_queued:true}),{headers:{'content-type':'application/json'}})}});
vm.runInContext(source,ctx);
const results=[];
function req(p,action,b,headers={},method='POST') {return new Request('https://example.invalid/functions/v1/attendee-public?program='+p+'&action='+action,{method,headers:{origin:'https://muniverse-official.github.io','content-type':'application/json',[p==='music_core'?'x-music-core-request':'x-cover-pick-request']:'1','user-agent':'qa-agent','x-real-ip':'192.0.2.1',...headers},body:method==='POST'?(typeof b==='string'?b:JSON.stringify(b)):undefined});}
async function test(name,request,expected,expectedCode){let r=await handler(request),j;try{j=await r.json()}catch{}results.push({name,pass:r.status===expected&&(!expectedCode||j?.code===expectedCode),status:r.status,code:j?.code});return j;}
for(const p of ['music_core','fans_pick']){
 const v={email:'qa@example.invalid',nickname:'qa',privacy_consent:true};
 const beforeClock=calls.length;await test(p+':clock_without_database',req(p,'clock',{}, {},'GET'),200);results.push({name:p+':clock_does_not_read_database',pass:calls.length===beforeClock});await test(p+':clock_rejects_other_origin',req(p,'clock',{}, {origin:'https://other.invalid'},'GET'),403,'ORIGIN_DENIED');
 await test(p+':reject_origin',req(p,'verify',v,{origin:'https://other.invalid'}),403,'ORIGIN_DENIED');
 await test(p+':cors_preflight',req(p,'verify',{}, {},'OPTIONS'),204);
 await test(p+':reject_method',req(p,'verify',{}, {},'GET'),405);
 await test(p+':reject_json',req(p,'verify','{'),400,'INVALID_JSON');
 await test(p+':reject_no_consent',req(p,'verify',{...v,privacy_consent:false}),400,'CONSENT_REQUIRED');
 await test(p+':reject_honeypot',req(p,'verify',{...v,website:'bot'}),404,p==='music_core'?'WINNER_MISMATCH':'IDENTITY_MISMATCH');
 await test(p+':reject_missing_identity',req(p,'verify',{...v,nickname:''}),400,'MISSING_FIELDS');
 const verified=await test(p+':issue_verification_token',req(p,'verify',v),200);
 const submission={privacy_consent:true,token:verified.token,account_email:v.email,muniverse_nickname:v.nickname,name:'QA',nationality:'KR',birth_date:'2000-01-01',phone:'010-1234-5678',x_account:'https://x.com/qa_test',contact_email:v.email};
 await test(p+':reject_tampered_token',req(p,'submit',{...submission,token:verified.token+'x'}),401,'SESSION_INVALID');
 await test(p+':reject_changed_ip',req(p,'submit',submission,{'x-real-ip':'192.0.2.2'}),401,'SESSION_INVALID');
 await test(p+':reject_changed_user_agent',req(p,'submit',submission,{'user-agent':'other-agent'}),401,'SESSION_INVALID');
 await test(p+':reject_changed_identity',req(p,'submit',{...submission,account_email:'other@example.invalid'}),401,'SESSION_INVALID');
 await test(p+':reject_invalid_date',req(p,'submit',{...submission,birth_date:'2000-02-30'}),400,'INVALID_FIELDS');
 await test(p+':reject_invalid_x',req(p,'submit',{...submission,x_account:'invalid account'}),400,'INVALID_X_ACCOUNT');
 await test(p+':submit_contract',req(p,'submit',submission),200);
 const last=calls.at(-1);results.push({name:p+':normalizes_x_url',pass:last.b.p_x_account==='@qa_test'});
 at+=900001;await test(p+':reject_expired_token',req(p,'submit',submission),401,'SESSION_INVALID');at-=900001;
}
fs.writeFileSync(base+'/tools/qa-edge-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({total:results.length,pass:results.filter(x=>x.pass).length,failures:results.filter(x=>!x.pass)},null,2));

if(results.some(x=>!x.pass))process.exitCode=1;
