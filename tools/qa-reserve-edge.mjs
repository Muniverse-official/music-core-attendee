import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const base=import.meta.dirname+'/..';
let handler,reserve=true,commits=0;
const context=vm.createContext({Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.invalid':k==='SUPABASE_SERVICE_ROLE_KEY'?'local-test-only':null},serve:h=>handler=h},Date,crypto,TextEncoder,TextDecoder,Uint8Array,Request,Response,Headers,URL,AbortSignal,atob,btoa,
 fetch:async(u,init)=>{const body=JSON.parse(init.body);let result;
 if(u.endsWith('attendee_check_winner'))result=reserve&&body.p_program==='music_core'?{ok:true,selection_type:'reserve',round_id:'test-round'}:{ok:true,winner_id:'test-winner',round_id:'test-round'};
 else{commits++;result=reserve?{ok:false,code:'RESERVE_NOT_ELIGIBLE'}:{ok:true,registered:true}};
 return Response.json(result);
 }});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(base+'/supabase/functions/attendee-public/index.ts','utf8'),{mode:'transform'}),context);
function req(program,action,body){return new Request('https://example.invalid/?program='+program+'&action='+action,{method:'POST',headers:{origin:'https://muniverse-official.github.io','content-type':'application/json',[program==='music_core'?'x-music-core-request':'x-cover-pick-request']:'1','user-agent':'qa','x-real-ip':'192.0.2.1'},body:JSON.stringify(body)})}
const identity={email:'qa@example.invalid',nickname:'QA',privacy_consent:true};
let response=await handler(req('music_core','verify',identity)),out=await response.json();
assert.equal(response.status,200);assert.equal(out.selectionType,'reserve');
assert.ok(!out.token&&!out.verificationToken&&!out.winner_id);assert.equal(commits,0);
response=await handler(req('music_core','submit',{...identity,token:'forged'}));assert.equal(response.status,401);assert.equal(commits,0);
out=await (await handler(req('fans_pick','verify',identity))).json();assert.ok(out.token);assert.ok(!out.selectionType);
reserve=false;out=await (await handler(req('music_core','verify',identity))).json();assert.ok(out.token);
const submission={privacy_consent:true,token:out.token,account_email:identity.email,muniverse_nickname:identity.nickname,name:'QA',nationality:'KR',birth_date:'2000-01-01',phone:'010-1234-5678',x_account:'@qa',contact_email:identity.email};
response=await handler(req('music_core','submit',submission));assert.equal(response.status,200);
reserve=true;response=await handler(req('music_core','submit',submission));assert.equal(response.status,403);assert.equal((await response.json()).code,'RESERVE_NOT_ELIGIBLE');
console.log('PASS reserve result without token, forged registration rejected, promoted registration, database eligibility recheck, FANS PICK compatibility');
