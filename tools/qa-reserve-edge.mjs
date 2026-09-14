import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const base=import.meta.dirname+'/..';
let handler,reserve=true,commits=0,submitted=false,lastCommit;
const context=vm.createContext({Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.invalid':k==='SUPABASE_SERVICE_ROLE_KEY'?'local-test-only':null},serve:h=>handler=h},Date,crypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,AbortSignal,atob,btoa,
 fetch:async(u,init)=>{const body=JSON.parse(init.body);let result;
 const type=reserve?'reserve':'primary';
 if(u.endsWith('attendee_check_winner'))result=submitted?{ok:false,code:'ALREADY_SUBMITTED',selection_type:type}:{ok:true,selection_type:type,winner_id:'test-winner',round_id:'test-round',event_date:'2026-09-19'};
 else{commits++;lastCommit=body;result=submitted?{ok:false,code:'ALREADY_SUBMITTED',selection_type:type}:{ok:true,registered:true,selection_type:type,delivery_queued:false}};
 return Response.json(result);
 }});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(base+'/supabase/functions/attendee-public/index.ts','utf8'),{mode:'transform'}),context);
function req(program,action,body){return new Request('https://example.invalid/?program='+program+'&action='+action,{method:'POST',headers:{origin:'https://muniverse-official.github.io','content-type':'application/json',[program==='music_core'?'x-music-core-request':'x-cover-pick-request']:'1','user-agent':'qa','x-real-ip':'192.0.2.1'},body:JSON.stringify(body)})}
const identity={email:'qa@example.invalid',nickname:'QA',privacy_consent:true};
for(const program of ['music_core','fans_pick']){
submitted=false;reserve=true;commits=0;
let response=await handler(req(program,'verify',identity)),out=await response.json();
assert.equal(response.status,200);assert.equal(out.selectionType,'reserve');assert.ok(out.token&&!out.winner_id);
const submission={privacy_consent:true,token:out.token,account_email:identity.email,muniverse_nickname:identity.nickname,name:'QA',nationality:'KR',birth_date:'2000-01-01',phone:'010-1234-5678',x_account:'@qa',contact_email:identity.email};
response=await handler(req(program,'submit',{...submission,token:'forged'}));assert.equal(response.status,401);
response=await handler(req(program==='music_core'?'fans_pick':'music_core','submit',submission));assert.equal(response.status,401);
for(const field of ['name','nationality','birth_date','phone','x_account','contact_email']){response=await handler(req(program,'submit',{...submission,[field]:''}));assert.equal(response.status,400,field+' required');}assert.equal(commits,0);
response=await handler(req(program,'submit',submission));out=await response.json();assert.equal(response.status,200);assert.equal(out.selectionType,'reserve');assert.equal(out.deliveryQueued,false);
for(const field of ['name','nationality','birth_date','phone','x_account','contact_email'])assert.equal(lastCommit['p_'+field],submission[field]);
submitted=true;out=await (await handler(req(program,'verify',identity))).json();assert.equal(out.code,'ALREADY_SUBMITTED');assert.equal(out.selectionType,'reserve');assert.ok(!out.token);
out=await (await handler(req(program,'submit',submission))).json();assert.equal(out.code,'ALREADY_SUBMITTED');assert.equal(out.selectionType,'reserve');
submitted=false;reserve=false;out=await (await handler(req(program,'submit',submission))).json();assert.equal(out.selectionType,'primary');assert.equal(out.deliveryQueued,false);
}
console.log('PASS both programs: reserve token, required fields, cross-program isolation, admin-only delivery, duplicates and promotion');
