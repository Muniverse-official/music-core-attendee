// Local-only contract test for the ENHYPEN announcement window. No production calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../', import.meta.url);
const source = stripTypeScriptTypes(fs.readFileSync(new URL('supabase/functions/attendee-private-test/index.ts', root), 'utf8')
  .replace("import { revealRows } from '../_shared/privacy.ts';", 'const revealRows = async rows => rows;')
  .replace("import { banner } from './banner.ts';", "const banner = 'banner';")
  .replace("import { wideBanner } from './wide-banner.ts';", "const wideBanner = 'wide-banner';")
  .replace("import { countryCodes } from './registration-countries.ts';", "const countryCodes = ['KR'];"), {mode:'transform'});

let handler;
let now = Date.parse('2026-11-19T09:00:00Z');
const token = 'a'.repeat(64);
const announcement = {id:true, is_open:true, start_at:null, end_at:null};
const winner = {id:'11111111-1111-4111-8111-111111111111', selection:'primary', winner_number:'M1', consent_deadline:'2026-11-23T00:00:00Z', email:'fan@example.invalid', nickname:'Fan'};
const calls = [];
class Clock extends Date { static now() { return now; } }
const dbFetch = async (url, options) => {
  const path = new URL(url).pathname.split('/rest/v1/')[1];
  const payload = options.body && JSON.parse(options.body);
  calls.push({path, payload});
  let response;
  if (path === 'enhypen_announcement') response = [announcement];
  else if (path === 'enhypen_winner_list') response = [winner];
  else if (path === 'enhypen_winner_consent') response = [];
  else if (path === 'attendee_console_sessions') response = [{username:'qa',created_at:'2026-11-18T00:00:00Z',expires_at:'2026-12-01T00:00:00Z'}];
  else if (path === 'attendee_console_accounts') response = [{active:true,updated_at:'2026-11-17T00:00:00Z'}];
  else if (path === 'rpc/attendee_console_throttle') response = true;
  else if (path === 'rpc/enhypen_winner_manage') {
    if (payload.p_action === 'schedule') Object.assign(announcement,{start_at:payload.p_data.startAt,end_at:payload.p_data.endAt});
    if (payload.p_action === 'visibility') announcement.is_open = payload.p_data.open;
    response = {open:announcement.is_open};
  } else if (path === 'rpc/enhypen_record_consent_v2') response = {agreed:true};
  else throw new Error('Unexpected database request: ' + path);
  return new Response(JSON.stringify(response), {headers:{'content-type':'application/json'}});
};
vm.runInContext(source, vm.createContext({
  Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://db.invalid':key==='SUPABASE_SERVICE_ROLE_KEY'?'local-test-secret':null},serve:fn=>{handler=fn}},
  Date:Clock, crypto, TextEncoder, TextDecoder, Uint8Array, Request, Response, Headers, URL, AbortSignal, atob, btoa, fetch:dbFetch,
}));

async function call(body, admin=false, status=200, code) {
  const response = await handler(new Request('https://db.invalid/functions/v1/attendee-private-test',{
    method:'POST', headers:{origin:'https://muniverse-official.github.io','content-type':'application/json','x-admin-request':'1',...(admin?{authorization:'Bearer '+token}:{})},
    body:JSON.stringify(body),
  }));
  const result = await response.json();
  assert.equal(response.status,status,JSON.stringify(result));
  if (code) assert.equal(result.code,code);
  return result;
}

// The migration leaves the existing active announcement immediate, with the old cutoff as fallback.
assert.equal((await call({action:'preview'})).open,true);
let state = await call({action:'state'},true);
assert.equal(state.published,true);
assert.equal(state.open,true);
assert.equal(state.startAt,null);
assert.equal(Date.parse(state.endAt),Date.parse('2026-11-26T00:00:00+09:00'));

// A published announcement can be scheduled for the future without opening early.
const startAt='2026-11-20T09:00:00+09:00', endAt='2026-11-21T09:00:00+09:00';
await call({action:'schedule',startAt,endAt},true);
state = await call({action:'state'},true);
assert.deepEqual([state.published,state.open,Date.parse(state.startAt),Date.parse(state.endAt)],
  [true,false,Date.parse(startAt),Date.parse(endAt)]);
assert.equal((await call({action:'preview'})).open,false);
assert.equal((await call({action:'preview'},true)).preview,true);
await call({action:'lookup',email:winner.email,nickname:winner.nickname},false,403,'ANNOUNCEMENT_CLOSED');

now = Date.parse('2026-11-20T09:00:00+09:00');
assert.equal((await call({action:'preview'})).open,true);
const result = await call({action:'lookup',email:winner.email,nickname:winner.nickname});
assert.equal(result.number,'M1');
assert(result.ticket);

// An existing lookup ticket cannot submit after the cutoff or while private.
now = Date.parse(endAt);
assert.equal((await call({action:'preview'})).open,false);
await call({action:'lookup',email:winner.email,nickname:winner.nickname},false,403,'ANNOUNCEMENT_CLOSED');
await call({action:'consent',ticket:result.ticket,agreed:true,collectionAgreed:true,version:'2026-11-13-v2',language:'ko'},false,403,'ANNOUNCEMENT_CLOSED');
now = Date.parse('2026-11-20T09:10:00+09:00');
await call({action:'visibility',open:false},true);
state = await call({action:'state'},true);
assert.equal(state.published,false);
assert.equal(state.open,false);
await call({action:'registration',ticket:result.ticket},false,403,'ANNOUNCEMENT_CLOSED');

// Bad schedules fail before touching the database.
const before = calls.filter(item=>item.path==='rpc/enhypen_winner_manage').length;
await call({action:'schedule',startAt:endAt,endAt:startAt},true,400,'INVALID_WINDOW');
await call({action:'schedule',startAt:'',endAt},true,400,'INVALID_WINDOW');
assert.equal(calls.filter(item=>item.path==='rpc/enhypen_winner_manage').length,before);
console.log('PASS ENHYPEN announcement schedule, visibility, and public access gates');
