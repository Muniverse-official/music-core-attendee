const BUCKET='attendee-public-config',REV='20260908-cdn-v3';
type O=Record<string,any>;
function env(){const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!base||!key)throw new Error('ENV');return{base,key};}
async function db(path:string,init:RequestInit={}){
 const{base,key}=env(),h=new Headers(init.headers);h.set('apikey',key);h.set('authorization',`Bearer ${key}`);if(init.body)h.set('content-type','application/json');
 const r=await fetch(`${base}/rest/v1/${path}`,{...init,headers:h,signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('DB');const text=await r.text();return text?JSON.parse(text):null;
}
const rpc=(name:string,body:O)=>db('rpc/'+name,{method:'POST',body:JSON.stringify(body)});
async function secret(){const rows=await db('attendee_internal_secrets?name=eq.config_sync&select=secret&limit=1');return rows?.[0]?.secret||'';}
function eq(a:string,b:string){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
async function sync(program:string){
 const c=await rpc('attendee_round_public_context',{p_program:program});if(!c?.round_id)throw new Error('NO_PUBLIC');
 const body={ok:true,program,roundId:c.round_id,roundTitle:c.round_title,configVersion:Number(c.version||1),openAt:c.registration_open_at,closeAt:c.registration_close_at,testMode:c.test_mode==='true',paused:c.registration_paused==='true',showEventDate:c.show_event_date==='true',eventDate:c.show_event_date==='true'&&c.event_date_tba!=='true'?c.event_date:null,eventDateTba:c.event_date_tba==='true',revision:REV,publishedAt:new Date().toISOString()};
 const{base,key}=env();
 // Raw Storage HTTP needs a full directive, not the SDK's seconds string.
 // Heartbeats continue even when the selected round's settings are unchanged.
 const r=await fetch(`${base}/storage/v1/object/${BUCKET}/${program}.json`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json','cache-control':'max-age=30, must-revalidate','x-upsert':'true'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error('UPLOAD');return{program,changed:true,roundId:body.roundId,configVersion:body.configVersion};
}
Deno.serve(async r=>{
 try{
  const expected=await secret();if(r.method!=='POST'||!expected||!eq(expected,r.headers.get('x-sync-secret')||''))return new Response('forbidden',{status:403});
  const[music_core,fans_pick]=await Promise.all([sync('music_core'),sync('fans_pick')]);
  return new Response(JSON.stringify({ok:true,music_core,fans_pick,revision:REV}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
 }catch{return new Response(JSON.stringify({ok:false,error:'sync_failed',revision:REV}),{status:500,headers:{'content-type':'application/json','cache-control':'no-store'}});}
});
