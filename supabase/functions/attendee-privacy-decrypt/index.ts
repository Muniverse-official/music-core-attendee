import { revealBox, keyset } from '../_shared/privacy.ts';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
function equal(a:string,b:string){if(a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;}
Deno.serve(async request=>{
 try {
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(request.method!=='POST'||!key||!equal(request.headers.get('authorization')||'',`Bearer ${key}`))return response({ok:false},403);
  const raw=await request.text();
  if(raw.length>131072)return response({ok:false},413);
  const body=JSON.parse(raw);
  if(!Array.isArray(body.boxes)||body.boxes.length>20||body.boxes.some((x:unknown)=>typeof x!=='string'||x.length>24000||!x.startsWith('pii:v1:')))return response({ok:false},400);
  if(typeof body.wrapped_keyset!=='string'||body.wrapped_keyset.length>24000)return response({ok:false},400);
  await keyset(body.wrapped_keyset);
  const values=[];
  for(const box of body.boxes)values.push(await revealBox(box));
  return response({values});
 }catch{return response({ok:false},503);}
});
