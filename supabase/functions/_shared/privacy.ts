import { readPrivateKey, readMessage as readNativeMessage, decryptSessionKeys } from 'npm:openpgp@6.3.2';
import { readMessage, decrypt } from 'https://cdn.jsdelivr.net/npm/openpgp@6.3.2/dist/openpgp.min.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();
export const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));
export const un64 = (v: string) => Uint8Array.from(atob(v), c => c.charCodeAt(0));

// The wrapping material is injected by Supabase into Edge Functions. It is never
// passed to Postgres or persisted in Git. Both existing credentials are required.
// Rewrap the keyset BEFORE rotating either credential; see SECURITY.md.
async function wrappingKey() {
  const url = Deno.env.get('SUPABASE_DB_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) throw new Error('PRIVACY_KEY_UNAVAILABLE');
  const password = new URL(url).password;
  if (!password) throw new Error('PRIVACY_KEY_UNAVAILABLE');
  const material = await crypto.subtle.importKey('raw', enc.encode(JSON.stringify([password,service])), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('muniverse:privacy:wrap:v1'),info:enc.encode('keyset')}, material, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}
export async function wrapKeyset(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('attendee-privacy:v1')},await wrappingKey(),enc.encode(JSON.stringify(value)));
  return b64(iv)+'.'+b64(new Uint8Array(ciphertext));
}
export async function unwrapKeyset(box: string) {
  const [iv,body] = box.split('.');
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(iv),additionalData:enc.encode('attendee-privacy:v1')},await wrappingKey(),un64(body))));
}
let cached: Promise<any> | undefined;
export function keyset(providedWrapped?: string) {
  return cached ??= (async () => {
    const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const response=providedWrapped?null:await fetch(`${base}/rest/v1/rpc/attendee_privacy_keyring`,{method:'POST',headers:{apikey:key!,authorization:`Bearer ${key}`,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(8000)});
    if(response && !response.ok)throw new Error('PRIVACY_KEY_UNAVAILABLE');
    const row=providedWrapped?{wrapped_keyset:providedWrapped}:await response!.json();
    if(!row?.wrapped_keyset)throw new Error('PRIVACY_KEY_UNAVAILABLE');
    const keys=await unwrapKeyset(row.wrapped_keyset);
    return {...keys,wrapped_keyset:row.wrapped_keyset,privateKey:await readPrivateKey({armoredKey:keys.privateKey})};
  })().catch(error=>{cached=undefined;throw error;});
}
export async function revealBox(box: string, expectedContext?: string): Promise<any> {
  if(!box.startsWith('pii:v1:'))throw new Error('PRIVACY_FORMAT');
  const bytes=un64(box.slice(7));
  // Native RSA avoids Edge CPU limits; browser AES-CFB works around Deno's
  // advertised-but-unavailable node:crypto AES-CFB implementation.
  const sessionKeys=await decryptSessionKeys({message:await readNativeMessage({binaryMessage:bytes}),decryptionKeys:(await keyset()).privateKey});
  const {data}=await decrypt({message:await readMessage({binaryMessage:bytes}),sessionKeys,format:'utf8'});
  const value=JSON.parse(String(data));
  if(value.v!==1 || (expectedContext && value.context!==expectedContext))throw new Error('PRIVACY_CONTEXT');
  return value.value;
}

// Called only after the caller's existing authorization/registration-ticket check.
// Does not return ciphertext or keys to browser clients.
async function reconstruct(value: any, decoded: Map<string,any>): Promise<any> {
  if(Array.isArray(value)) {
    const out=[];
    for(const row of value)out.push(await reconstruct(row,decoded));
    return out;
  }
  if(!value || typeof value!=='object')return value;
  const out:any={};
  for(const [k,v] of Object.entries(value)) {
    if(!['pii_box','_directory_pii','_registration_pii'].includes(k))out[k]=await reconstruct(v,decoded);
  }
  if(value.pii_box)Object.assign(out,decoded.get(value.pii_box));
  if(value._directory_pii)Object.assign(out,decoded.get(value._directory_pii));
  if(value._registration_pii) {
    const pii=decoded.get(value._registration_pii);
    const {account_email,muniverse_nickname,...fields}=pii;
    Object.assign(out,fields,{registration_email:account_email,registration_nickname:muniverse_nickname});
  }
  if(typeof out.__pii==='string')return decoded.get(out.__pii);
  return out;
}

export async function revealRows(value: any): Promise<any> {
  const boxes=new Set<string>();
  function collect(x:any) {
    if(!x || typeof x!=='object')return;
    for(const [k,v] of Object.entries(x)) {
      if(['pii_box','_directory_pii','_registration_pii','__pii'].includes(k) && typeof v==='string')boxes.add(v);
      else collect(v);
    }
  }
  collect(value);
  const decoded=new Map<string,any>();
  const all=[...boxes];
  if(all.length<=4) {
    for(const box of all)decoded.set(box,await revealBox(box));
  } else {
    // Keep each decrypt request below the hosted Edge CPU budget. No browser can
    // call this service-only endpoint. Responses and requests are never logged.
    const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const wrapped_keyset=(await keyset()).wrapped_keyset;
    const chunks=[];
    for(let i=0;i<all.length;i+=20)chunks.push(all.slice(i,i+20));
    for(let i=0;i<chunks.length;i+=2) {
      await Promise.all(chunks.slice(i,i+2).map(async chunk=>{
        const response=await fetch(`${base}/functions/v1/attendee-privacy-decrypt`,{method:'POST',headers:{apikey:key!,authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({boxes:chunk,wrapped_keyset}),signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error('PRIVACY_DECRYPT_UNAVAILABLE:'+response.status);
        const result=await response.json();
        if(!Array.isArray(result.values)||result.values.length!==chunk.length)throw new Error('PRIVACY_DECRYPT_INVALID');
        chunk.forEach((box,j)=>decoded.set(box,result.values[j]));
      }));
    }
  }
  return reconstruct(value,decoded);
}
