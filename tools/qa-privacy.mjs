import fs from 'node:fs'; import assert from 'node:assert/strict'; import vm from 'node:vm'; import {stripTypeScriptTypes} from 'node:module';
import * as pgp from 'openpgp';
const root=new URL('..',import.meta.url).pathname;
const temp=fs.mkdtempSync(root+'/tools/.privacy-qa-');
let source=fs.readFileSync(root+'/supabase/functions/_shared/privacy.ts','utf8').replace("'npm:openpgp@6.3.2'","'openpgp'").replace("'https://cdn.jsdelivr.net/npm/openpgp@6.3.2/dist/openpgp.min.mjs'",JSON.stringify(new URL('../node_modules/openpgp/dist/openpgp.min.mjs',import.meta.url).href));
fs.writeFileSync(temp+'/privacy-local.ts',source);
const env={SUPABASE_DB_URL:'postgres://postgres:qa-only-password@invalid/postgres',SUPABASE_SERVICE_ROLE_KEY:'qa-only-service-role'};
globalThis.Deno={env:{get:k=>env[k]}};
const mod=await import(temp+'/privacy-local.ts');
const keypair=await pgp.generateKey({type:'rsa',rsaBits:3072,userIDs:[{name:'Synthetic QA',email:'qa@example.invalid'}],format:'armored'});
const box=await mod.wrapKeyset({privateKey:keypair.privateKey,fingerSecret:'synthetic-only-secret'.repeat(3)});
await mod.keyset(box);
const clear={name:'Privacy QA',birth_date:'2000-01-01',x_account:'@privacy_qa',account_email:'privacy-fixture@example.invalid',muniverse_nickname:'Privacy Fixture'};
async function seal(value,context='synthetic'){
 const encrypted=await pgp.encrypt({message:await pgp.createMessage({text:JSON.stringify({v:1,context,value})}),encryptionKeys:await pgp.readKey({armoredKey:keypair.publicKey}),format:'binary',config:{preferredSymmetricAlgorithm:pgp.enums.symmetric.aes256,aeadProtect:false}});
 return 'pii:v1:'+Buffer.from(encrypted).toString('base64');
}
const fixtures={synthetic_boxes:[{id:'fixture',pii_box:await seal(clear)}]};
for(const row of fixtures.synthetic_boxes){const clear=await mod.revealRows(row);assert.equal(clear.name||clear.legal_name,'Privacy QA');assert.equal(clear.birth_date,'2000-01-01');assert.equal(clear.x_account,'@privacy_qa');assert(!JSON.stringify(clear).includes('pii:v1:'));}
await assert.rejects(()=>mod.revealBox(fixtures.synthetic_boxes[0].pii_box,'wrong-context'));
const raw=Buffer.from(fixtures.synthetic_boxes[0].pii_box.slice(7),'base64');raw[raw.length-20]^=1;await assert.rejects(()=>mod.revealBox('pii:v1:'+raw.toString('base64')));
env.SUPABASE_DB_URL='postgres://postgres:wrong-password@invalid/postgres';await assert.rejects(()=>mod.unwrapKeyset(box));env.SUPABASE_DB_URL='postgres://postgres:qa-only-password@invalid/postgres';
const encrypted=await pgp.encrypt({message:await pgp.createMessage({text:JSON.stringify({v:1,context:'synthetic',value:{email:'privacy-fixture@example.invalid',nickname:'Privacy Fixture'}})}),encryptionKeys:await pgp.readKey({armoredKey:keypair.publicKey}),format:'binary',config:{preferredSymmetricAlgorithm:pgp.enums.symmetric.aes256,aeadProtect:false}});
const directory='pii:v1:'+Buffer.from(encrypted).toString('base64');
const rows=await mod.revealRows([{id:'synthetic',_directory_pii:directory,_registration_pii:fixtures.synthetic_boxes[0].pii_box,name:null}]);
assert.equal(rows[0].email,'privacy-fixture@example.invalid');assert.equal(rows[0].registration_email,'privacy-fixture@example.invalid');assert.equal(rows[0].name,'Privacy QA');assert(!('_directory_pii' in rows[0]));
let handler, readCount=0, expired=false;
const apiSource=stripTypeScriptTypes(fs.readFileSync(root+'/supabase/functions/attendee-admin/index.ts','utf8').replace("import { revealRows } from '../_shared/privacy.ts';\n",''),{mode:'transform'});
const context=vm.createContext({Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.invalid':'qa-service'},serve:fn=>handler=fn},revealRows:mod.revealRows,Headers,Request,Response,URL,AbortSignal,Date,crypto,TextEncoder,Uint8Array,setTimeout,fetch:async(u,init={})=>{
let value=null;
if(u.includes('attendee_console_sessions'))value=[{token_hash:'fake',username:'qa-local-only',expires_at:new Date(Date.now()+(expired?-1000:60000)).toISOString(),created_at:new Date().toISOString()}];
else if(u.includes('attendee_console_accounts'))value=[{active:true,updated_at:new Date(Date.now()-10000).toISOString()}];
else if(u.includes('attendee_console_throttle'))value=true;
else if(u.includes('attendee_round_data')){readCount++;value={winners:[{id:'fixture',_directory_pii:directory,_registration_pii:fixtures.synthetic_boxes[0].pii_box}]};}
else if(u.includes('attendee_console_audit'))value=[];
else if(u.includes('attendee_delivery_console'))value={};
else throw Error('Unexpected fixture path');
return new Response(JSON.stringify(value));
}});
vm.runInContext(apiSource,context);
const request=(token)=>new Request('https://test.invalid',{method:'POST',headers:{origin:'https://muniverse-official.github.io','content-type':'application/json','x-admin-request':'1',...(token?{authorization:'Bearer '+token}:{})},body:'{"action":"get"}'});
let res=await handler(request());assert.equal(res.status,401);assert.equal(readCount,0);
res=await handler(request('a'.repeat(64)));assert.equal(res.status,200);const body=await res.json();assert.equal(body.music_core.winners[0].name,'Privacy QA');assert.equal(body.fans_pick.winners[0].email,'privacy-fixture@example.invalid');assert(!JSON.stringify(body).includes('pii:v1:'));
expired=true;readCount=0;res=await handler(request('a'.repeat(64)));assert.equal(res.status,401);assert.equal(readCount,0);
console.log(JSON.stringify({syntheticDecryption:true,wrongKeyRejected:true,tamperRejected:true,wrongContextRejected:true,adminFixtureDecode:true,unauthorizedAndExpiredRejected:true}));
fs.rmSync(temp,{recursive:true,force:true});
