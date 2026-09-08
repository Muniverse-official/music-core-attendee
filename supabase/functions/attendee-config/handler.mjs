/** Display-only configuration cache. NEVER use it to authorize registration. */
export const REVISION = '20260908-load-v5';
export const CACHE_TTL_MS = 10_000;
export const ERROR_BACKOFF_MS = 2_000;
const ORIGIN = 'https://muniverse-official.github.io';
const PROGRAMS = new Set(['music_core', 'fans_pick']);

// Each warm Edge worker owns this cache. No global/distributed-cache guarantee.
export function createConfigHandler({fetchFn = fetch, now = Date.now, getEnv}) {
  const entries = new Map();
  const inFlight = new Map();
  const retryAt = new Map();

  async function load(program) {
    const base = getEnv('SUPABASE_URL');
    const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !key) throw new Error('ENV');
    // Read only the published round; avoid loading webhook secrets or winner data.
    const q = new URLSearchParams({
      program: 'eq.' + program, is_public: 'eq.true', archived: 'eq.false',
      select: 'id,config', limit: '1'
    });
    const startedAt = now();
    const r = await fetchFn(base + '/rest/v1/attendee_rounds?' + q, {
      headers: {apikey: key, authorization: 'Bearer ' + key},
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('CONFIG');
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const c = row?.config;
    if (!row?.id || !c) throw new Error('NO_PUBLIC_ROUND');
    const o = Date.parse(c.registration_open_at), cl = Date.parse(c.registration_close_at);
    if (!Number.isFinite(o) || !Number.isFinite(cl) || o >= cl) throw new Error('WINDOW');
    for (const k of ['test_mode','registration_paused','show_event_date','event_date_tba']) {
      if (c[k] !== 'true' && c[k] !== 'false') throw new Error('CONFIG');
    }
    // Explicit allow-list prevents future extra config keys being exposed or cached.
    const value = Object.freeze({
      program, roundId: row.id, openAt: c.registration_open_at, closeAt: c.registration_close_at,
      testMode: c.test_mode === 'true', paused: c.registration_paused === 'true',
      showEventDate: c.show_event_date === 'true', eventDateTba: c.event_date_tba === 'true',
      eventDate: c.show_event_date === 'true' && c.event_date_tba !== 'true' ? c.event_date : null
    });
    const entry = {value, loadedAt: startedAt, expiresAt: startedAt + CACHE_TTL_MS};
    entries.set(program, entry);
    retryAt.delete(program);
    return entry;
  }

  async function get(program) {
    const cached = entries.get(program);
    if (cached && now() < cached.expiresAt) return {entry: cached, cache: 'HIT'};
    const pending = inFlight.get(program);
    if (pending) return {entry: await pending, cache: 'COALESCED'};
    if (now() < (retryAt.get(program) || 0)) throw new Error('BACKOFF');
    const request = load(program).catch(error => {
      entries.delete(program); // Fail closed, rather than return an expired OPEN state.
      retryAt.set(program, now() + ERROR_BACKOFF_MS);
      throw error;
    });
    inFlight.set(program, request);
    try { return {entry: await request, cache: 'MISS'}; }
    finally { if (inFlight.get(program) === request) inFlight.delete(program); }
  }

  return async function handler(req) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0', // serverTime and state are computed per response.
      'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Expose-Headers': 'X-Attendee-Revision,X-Attendee-Cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'X-Attendee-Revision': REVISION
    };
    const origin = req.headers.get('origin');
    if (origin === ORIGIN) headers['Access-Control-Allow-Origin'] = ORIGIN;
    const out = (body, status = 200) => new Response(JSON.stringify(body), {status, headers});
    if (origin && origin !== ORIGIN) return out({ok:false, code:'ORIGIN_DENIED'}, 403);
    if (req.method === 'OPTIONS') return new Response(null, {status:204, headers});
    if (req.method !== 'GET') return out({ok:false}, 405);
    const program = new URL(req.url).searchParams.get('program');
    if (!PROGRAMS.has(program)) return out({ok:false}, 400);
    try {
      const {entry, cache} = await get(program), c = entry.value, time = now();
      // Never cache the clock or the OPEN/CLOSED decision across the time boundary.
      const state = c.paused ? 'PAUSED' : time >= Date.parse(c.closeAt) ? 'CLOSED'
        : c.testMode || time >= Date.parse(c.openAt) ? 'OPEN' : 'NOT_OPEN';
      headers['X-Attendee-Cache'] = cache;
      return out({ok:true, ...c, state, serverTime:new Date(time).toISOString(),
        configAgeMs:Math.max(0,time-entry.loadedAt), pollAfterMs:60_000, revision:REVISION});
    } catch {
      headers['Retry-After'] = '10';
      return out({ok:false, state:'UNAVAILABLE', revision:REVISION}, 503);
    }
  };
}
