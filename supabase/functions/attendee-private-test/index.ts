import { revealRows } from '../_shared/privacy.ts';
import { banner } from './banner.ts';
import { wideBanner } from './wide-banner.ts';
import { countryCodes } from './registration-countries.ts';

const origin = 'https://muniverse-official.github.io';
const revision = 'enhypen-primary-capacity-1';
const noticeVersion = '2026-11-13-v2';
const languages = ['ko','en','ja','zh-TW','zh-CN'];
const legacyShowEnd = '2026-11-26T00:00:00+09:00';

class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function respond(req: Request, body: unknown, status = 200) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
  });
  if (req.headers.get('origin') === origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'authorization, content-type, x-admin-request');
  }
  return new Response(body === null ? null : JSON.stringify(body), {headers, status});
}

async function db(path: string, body?: unknown) {
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new RequestError(503, 'SERVICE_UNAVAILABLE');
  const result = await fetch(`${base}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {apikey: key, authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!result.ok) {
    const error = await result.json().catch(() => ({}));
    const expected = ['NO_PRIMARY','CAPACITY','WINNER_MISSING','INVALID_TRANSITION','DUPLICATE_NUMBER','DUPLICATE_WINNER','CONSENT_DEADLINE','ANNOUNCEMENT_CLOSED'];
    if (expected.includes(error.message)) throw new RequestError(409, error.message);
    throw new RequestError(502, 'DATABASE_ERROR');
  }
  return await revealRows(await result.json());
}

async function authorize(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!/^[0-9a-f]{64}$/.test(token)) throw new RequestError(401, 'UNAUTHORIZED');
  const hash = await sha(token);
  const [session] = await db(`attendee_console_sessions?token_hash=eq.${hash}&select=username,expires_at,created_at&limit=1`);
  if (!session || Date.parse(session.expires_at) <= Date.now()) throw new RequestError(401, 'SESSION_EXPIRED');
  const [account] = await db(`attendee_console_accounts?username=eq.${encodeURIComponent(session.username)}&select=active,updated_at&limit=1`);
  if (!account?.active || Date.parse(account.updated_at) > Date.parse(session.created_at)) throw new RequestError(401, 'SESSION_EXPIRED');
  if (!await db('rpc/attendee_console_throttle', {p_key: `private-test:${hash}`, p_limit: 120, p_seconds: 60})) throw new RequestError(429, 'RATE_LIMITED');
}

async function sha(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function clean(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max * 2) throw new RequestError(400,'INVALID_FIELDS');
  const text = value.normalize('NFKC').trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new RequestError(400,'INVALID_FIELDS');
  return text;
}

async function identity(row: Record<string, unknown>) {
  const email = clean(row?.email, 254).toLowerCase();
  const nickname = clean(row?.nickname, 80).replace(/\s+/g,' ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError(400,'INVALID_FIELDS');
  return {email, nickname, hash:await sha(`${email}\n${nickname.toLowerCase()}`)};
}

function winnerNumber(value: unknown) {
  const number = clean(value, 16).toUpperCase();
  if (!/^[A-Z0-9]{1,16}$/.test(number)) throw new RequestError(400,'INVALID_NUMBER');
  return number;
}

async function announcement() {
  const [row] = await db('enhypen_announcement?id=eq.true&select=is_open,start_at,end_at');
  const startAt = row?.start_at ?? null;
  const endAt = row?.end_at ?? legacyShowEnd;
  const published = row?.is_open === true;
  const now = Date.now();
  return {startAt, endAt, published, open:published && (!startAt || now >= Date.parse(startAt)) && now < Date.parse(endAt)};
}

async function openStatus() {
  return (await announcement()).open;
}

function scheduleTime(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:00\+09:00$/.test(value)) throw new RequestError(400,'INVALID_WINDOW');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time + 9 * 3600000).toISOString().slice(0,19) !== value.slice(0,19)) throw new RequestError(400,'INVALID_WINDOW');
  return value;
}

async function lookup(req: Request, body: Record<string, unknown>) {
  const preview = !await openStatus();
  if (preview) {
    if (!req.headers.has('authorization')) throw new RequestError(403, 'ANNOUNCEMENT_CLOSED');
    await authorize(req);
  }
  const {hash} = await identity(body);
  if (!preview) await throttle(req);
  const result = await resultFor(hash, preview);
  if (result.selection === 'none') return result;
  const payload = `${hash}.${Math.floor(Date.now()/1000)+1800}.${preview ? '1' : '0'}`;
  return {...result, ticket:`${payload}.${await ticketSignature(payload)}`};
}

async function resultFor(hash: string, preview: boolean, includeEmail = false) {
  const [record] = await db(`enhypen_winner_list?identity_hash=eq.${hash}&selection=in.(primary,reserve)&select=id,selection,winner_number,consent_deadline${includeEmail ? ',email,pii_box' : ''}&limit=1`);
  if (!record) return {selection:'none', preview};
  const [consent] = await db(`enhypen_winner_consent?winner_id=eq.${record.id}&notice_version=eq.${noticeVersion}&select=agreed_at`);
  return {selection:record.selection, ...(record.selection === 'primary' ? {number:record.winner_number} : {}), agreed:Boolean(consent), deadline:record.consent_deadline, expired:Date.parse(record.consent_deadline) <= Date.now(), preview,...(includeEmail && !consent ? {contactEmail:record.email} : {})};
}

async function ticketKey() {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw new RequestError(503,'SERVICE_UNAVAILABLE');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(`enhypen-ticket-v1:${secret}`), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}

async function ticketSignature(payload: string) {
  const result = await crypto.subtle.sign('HMAC', await ticketKey(), new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2,'0')).join('');
}

async function registrationTicket(req: Request, input: unknown) {
  const match = typeof input === 'string' && /^([a-f0-9]{64})\.(\d{10})\.([01])\.([a-f0-9]{64})$/.exec(input);
  if (!match) throw new RequestError(401,'SESSION_EXPIRED');
  const [,hash,expires,mode,signature] = match;
  if (Date.now() >= Number(expires)*1000) throw new RequestError(401,'SESSION_EXPIRED');
  const signatureBytes = Uint8Array.from(signature.match(/../g)!, hex=>parseInt(hex,16));
  const valid = await crypto.subtle.verify('HMAC',await ticketKey(),signatureBytes,new TextEncoder().encode(`${hash}.${expires}.${mode}`));
  if (!valid) throw new RequestError(401,'SESSION_EXPIRED');
  if (mode === '1') await authorize(req);
  else if (!await openStatus()) throw new RequestError(403,'ANNOUNCEMENT_CLOSED');
  return {hash,preview:mode==='1'};
}

async function throttle(req: Request) {
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
  const key = await sha(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') + ':enhypen:' + ip);
  if (!await db('rpc/attendee_console_throttle', {p_key:key, p_limit:24, p_seconds:300})) throw new RequestError(429,'RATE_LIMITED');
}

async function consent(req: Request, body: Record<string, unknown>) {
  if (!await openStatus()) throw new RequestError(403,'ANNOUNCEMENT_CLOSED');
  if (body.agreed !== true || body.collectionAgreed !== true || body.version !== noticeVersion || !languages.includes(String(body.language))) throw new RequestError(400,'INVALID_FIELDS');
  const {hash,preview} = await registrationTicket(req,body.ticket);
  if (preview) throw new RequestError(403,'ANNOUNCEMENT_CLOSED');
  const name = clean(body.name, 100);
  const phoneMode = body.phoneMode;
  const phone = clean(body.phone, 40).replace(/[\s().-]/g,'');
  if (phoneMode === 'KR' ? !/^010\d{8}$/.test(phone) : phoneMode !== 'INTL' || !/^\+[1-9]\d{7,14}$/.test(phone)) throw new RequestError(400,'INVALID_PHONE');
  const birthDate = clean(body.birthDate, 10);
  const date = new Date(`${birthDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== birthDate || birthDate < '1900-01-01' || birthDate > '2026-11-25') throw new RequestError(400,'INVALID_FIELDS');
  const nationality = clean(body.nationality, 2);
  const contactEmail = clean(body.contactEmail, 254);
  if (!countryCodes.includes(nationality) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new RequestError(400,'INVALID_FIELDS');
  const xAccount = clean(body.xAccount, 100).replace(/^https?:\/\/(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\//i,'').split(/[/?#]/u)[0].replace(/^@+/u,'');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(xAccount)) throw new RequestError(400,'INVALID_X');
  await throttle(req);
  return db('rpc/enhypen_record_consent_v2',{p_hash:hash,p_fields:{name,phone,phoneMode,birthDate,nationality,contactEmail,xAccount:`@${xAccount}`},p_language:body.language,p_version:noticeVersion});
}

Deno.serve(async req => {
  if (req.method === 'GET') return respond(req, {ok: true, revision});
  if (req.headers.get('origin') !== origin) return respond(req, {ok: false, code: 'ORIGIN_DENIED'}, 403);
  if (req.method === 'OPTIONS') return respond(req, null, 204);
  if (req.method !== 'POST' || req.headers.get('x-admin-request') !== '1' || !req.headers.get('content-type')?.startsWith('application/json')) return respond(req, {ok: false, code: 'INVALID_REQUEST'}, 400);
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > 65536) throw new RequestError(413, 'PAYLOAD_TOO_LARGE');
    let body;
    try { body = JSON.parse(text); } catch { throw new RequestError(400, 'INVALID_REQUEST'); }
    const action = body?.action;
    if (action === 'preview') {
      const {open:isOpen} = await announcement();
      const preview = !isOpen && req.headers.has('authorization');
      if (preview) await authorize(req);
      return respond(req, {ok:true, open:isOpen, preview, ...(isOpen || preview ? {banner:body.artwork === 'wide' ? wideBanner : banner} : {})});
    }
    if (action === 'lookup') return respond(req, {ok:true, ...(await lookup(req, body))});
    if (action === 'registration') {
      const {hash,preview} = await registrationTicket(req,body.ticket);
      const result = await resultFor(hash,preview,true);
      if (result.selection === 'none') throw new RequestError(403,'WINNER_MISSING');
      return respond(req,{ok:true,...result});
    }
    if (action === 'consent') return respond(req, {ok:true, ...(await consent(req, body))});

    await authorize(req);
    if (action === 'state') {
      const [status, rows, consents] = await Promise.all([announcement(), db('enhypen_winner_list?select=id,email,nickname,pii_box,selection,winner_number,consent_deadline&order=created_at.asc,id.asc'),db(`enhypen_winner_consent?notice_version=eq.${noticeVersion}&select=winner_id,pii_box,legal_name,phone,agreed_at,birth_date,contact_email,nationality,phone_mode,x_account`)]);
      const byWinner = new Map(consents.map((row:Record<string, unknown>) => [row.winner_id,row]));
      const winners = rows.map((row:Record<string, unknown>) => ({...row,consent:byWinner.get(row.id) ?? null}));
      return respond(req, {ok:true, ...status, winners, title:'3. 엔하이픈 특집쇼'});
    }

    let data;
    if (action === 'import') {
      const limit = body.selection === 'primary' ? 500 : body.selection === 'reserve' ? 30 : 0;
      if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > limit) throw new RequestError(400,'CAPACITY');
      const rows = await Promise.all(body.rows.map(async (row:Record<string, unknown>) => ({...await identity(row), number:body.selection === 'primary' ? winnerNumber(row.number) : null})));
      data = {selection:body.selection, rows};
    } else if (action === 'visibility' && typeof body.open === 'boolean') {
      data = {open:body.open};
    } else if (action === 'schedule') {
      const startAt = scheduleTime(body.startAt);
      const endAt = scheduleTime(body.endAt);
      if (Date.parse(startAt) >= Date.parse(endAt)) throw new RequestError(400,'INVALID_WINDOW');
      data = {startAt, endAt};
    } else if (['promote','number','withdraw','remove'].includes(action)) {
      const id = clean(body.id, 36);
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new RequestError(400,'INVALID_FIELDS');
      data = {id, number:['number','promote'].includes(action) ? winnerNumber(body.number) : null};
      if (action === 'promote' && body.deadline) {
        const deadline = clean(body.deadline, 40);
        const time = Date.parse(deadline);
        if (!/^2026-11-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(deadline) || !Number.isFinite(time) || time <= Date.now() || time >= Date.parse(legacyShowEnd)) throw new RequestError(400,'INVALID_DEADLINE');
        data = {...data, deadline};
      }
    } else {
      throw new RequestError(400,'INVALID_ACTION');
    }
    return respond(req, {ok:true, ...(await db('rpc/enhypen_winner_manage', {p_action:action,p_data:data}))});
  } catch (error) {
    const failure = error instanceof RequestError ? error : new RequestError(500, 'SERVER_ERROR');
    return respond(req, {ok:false, code:failure.code}, failure.status);
  }
});
