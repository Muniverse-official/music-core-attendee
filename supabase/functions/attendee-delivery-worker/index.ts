const REV='20260909-delivery-v4-legacy-bridge';
type O=Record<string,any>;
function env(){const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!base||!key)throw new Error('ENV');return{base,key};}
async function req(path:string,init:RequestInit={}){
  const{base,key}=env(),h=new Headers(init.headers);h.set('apikey',key);h.set('authorization',`Bearer ${key}`);if(init.body)h.set('content-type','application/json');
  const r=await fetch(`${base}/rest/v1/${path}`,{...init,headers:h,signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error('DB_'+r.status);const t=await r.text();return t?JSON.parse(t):null;
}
const rpc=(name:string,body:O)=>req('rpc/'+name,{method:'POST',body:JSON.stringify(body)});
let cachedSecret='',secretAt=0;
async function secret(){if(!cachedSecret||Date.now()-secretAt>60000){const rows=await req('attendee_internal_secrets?name=eq.delivery_worker&select=secret&limit=1');cachedSecret=rows?.[0]?.secret||'';secretAt=Date.now();}return cachedSecret;}
function eq(a:string,b:string){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
async function config(program:string){
  const table=program==='music_core'?'music_core_runtime_config':'cover_pick_runtime_config';
  const rows=await req(`${table}?key=in.(webhook_token,apps_script_url)&select=key,value`);
  return Object.fromEntries((rows||[]).map((x:O)=>[x.key,x.value]));
}
async function health(program:string,c:O){
  let status='unreachable',version:number|null=null,error='DELIVERY_CONFIG_MISSING',mode='none';
  if(c.apps_script_url&&c.webhook_token){try{
    const r=await fetch(c.apps_script_url,{cache:'no-store',signal:AbortSignal.timeout(12000)}),j=await r.json();
    version=Number.isInteger(j.version)?j.version:null;
    const v9=r.ok&&j.ok===true&&j.service==='muniverse-attendee-dispatcher'&&j.version>=9&&j.sheetMode==='round-tabs'&&j.deliveryState==='per-row-v1'&&j.textCells===true;
    const musicCoreV2=program==='music_core'&&r.ok&&j.ok===true&&j.service==='muniverse-attendee-dispatcher'&&j.version===2;
    if(v9){status='contract_ready';mode='round_v9';error='';}
    else if(musicCoreV2){status='legacy_bridge_ready';mode='music_core_v2_bridge';error='';}
    else{status='upgrade_required';error='APPS_SCRIPT_UPGRADE_REQUIRED';}
  }catch{error='APPS_SCRIPT_UNREACHABLE';}}
  await req('attendee_delivery_health?on_conflict=program',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({program,status,version,last_error:error||null,checked_at:new Date().toISOString()})});
  return{ready:status==='contract_ready'||status==='legacy_bridge_ready',error,mode,version,status};
}
async function deliver(row:O,c:O,h:O){
  // Deletion locks/refuses active claims. Recheck before any external transmission as well.
  if(await rpc('attendee_delivery_is_current',{p_id:row.id})!==true)return{ok:false,sheet:false,email:false,error:'DELIVERY_CANCELLED'};
  const legacy=h.mode==='music_core_v2_bridge';
  const version=legacy?2:9;
  const r=await fetch(c.apps_script_url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version,ts:String(Date.now()),nonce:crypto.randomUUID(),token:c.webhook_token,kind:row.program,payload:row.payload}),signal:AbortSignal.timeout(20000)});
  let j:O={};try{j=await r.json();}catch{}
  const sheet=r.ok&&j.sheetUpdated===true;
  if(legacy){
    // The verified v2 Music Core deployment writes to the hidden compatibility source tab.
    // Its idempotency key prevents duplicate rows. Internal notification email is not a
    // completion requirement; a confirmed sheet write (including duplicate:true) closes the job.
    const ok=r.ok&&j.ok===true&&sheet;
    return{ok,sheet,email:ok,error:ok?'':`HTTP_${r.status}:${String(j.code||'LEGACY_DELIVERY_FAILED').slice(0,120)}`,busy:j.code==='BUSY'};
  }
  // v9 keeps partial sheet/email completion semantics.
  const email=r.ok&&j.emailSent===true,ok=r.ok&&j.ok===true&&sheet&&email;
  return{ok,sheet,email,error:ok?'':`HTTP_${r.status}:${String(j.code||'DELIVERY_FAILED').slice(0,120)}`,busy:j.code==='BUSY'};
}
function response(body:O,status=200){return new Response(JSON.stringify({...body,revision:REV}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});}
Deno.serve(async r=>{
  try{
    const expected=await secret();if(r.method!=='POST'||!expected||!eq(expected,r.headers.get('x-delivery-secret')||''))return response({ok:false},403);
    const programs=['music_core','fans_pick'],configs:Record<string,O>={},healths:Record<string,O>={};
    await Promise.all(programs.map(async p=>{configs[p]=await config(p);healths[p]=await health(p,configs[p]);}));
    const rows=await rpc('attendee_delivery_claim',{p_limit:20}) as O[];
    let done=0,failed=0,deferred=0;const deadline=performance.now()+45000;
    // One serial queue per Apps Script URL; distinct script deployments can progress together.
    const groups=new Map<string,O[]>();for(const row of rows){const url=configs[row.program].apps_script_url||row.program;groups.set(url,[...(groups.get(url)||[]),row]);}
    await Promise.all([...groups.values()].map(async items=>{
      for(const row of items){
        if(!healths[row.program].ready||performance.now()>deadline){
          await rpc('attendee_delivery_defer',{p_id:row.id,p_error:healths[row.program].error||'WORKER_TIME_BUDGET',p_seconds:60});deferred++;continue;
        }
        try{
          const d=await deliver(row,configs[row.program],healths[row.program]);
          if(d.busy){await rpc('attendee_delivery_defer',{p_id:row.id,p_error:'APPS_SCRIPT_BUSY',p_seconds:60});deferred++;continue;}
          await rpc('attendee_delivery_finish',{p_id:row.id,p_ok:d.ok,p_sheet_updated:d.sheet,p_email_sent:d.email,p_error:d.error||null});
          d.ok?done++:failed++;
        }catch(e){failed++;await rpc('attendee_delivery_finish',{p_id:row.id,p_ok:false,p_sheet_updated:false,p_email_sent:false,p_error:e instanceof Error?e.name:'TRANSPORT_ERROR'}).catch(()=>{});}
      }
    }));
    return response({ok:true,claimed:rows.length,done,failed,deferred,health:healths});
  }catch{return response({ok:false,error:'WORKER_FAILED'},500);}
});
