import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set(["https://muniverse-official.github.io", "http://localhost:5173", "http://127.0.0.1:5173"]);
const CONSENT_VERSION = "music-core-audience-2026-08-v2";
const SESSION_TTL_MS = 15 * 60 * 1000;
const VERIFY_LIMIT = 8;
const SUBMIT_LIMIT = 5;
const BURST_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const BURST_WINDOW_MS = 60 * 1000;
const MAX_BODY_BYTES = 16_384;
const DEFAULT_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx6OzyBhI0OdrTYoRz7b71SsBVpAO1x3hlcMLshIXg__PcpaEDaTL5OSGuKOiBxfnYB/exec";

function responseHeaders(req: Request, extra: Record<string, string> = {}) {
  const origin = req.headers.get("origin") || "";
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-music-core-request, x-request-id",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-site",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Vary": "Origin"
  };
  if (ALLOWED_ORIGINS.has(origin)) base["Access-Control-Allow-Origin"] = origin;
  return { ...base, ...extra };
}
function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(req, extra) });
}
function clean(value: unknown, max = 300) { return String(value ?? "").trim().slice(0, max); }
function normalizeEmail(value: unknown) { return clean(value, 254).normalize("NFKC").toLowerCase(); }
function normalizeNickname(value: unknown) { return clean(value, 80).normalize("NFKC").replace(/\s+/g, " "); }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validNationality(value: string) { return value === "KR" || (/^[A-Z]{2}$/.test(value) && value !== "KR"); }
function validPhone(value: string) { return /^010-\d{4}-\d{4}$/.test(value) || /^\+\d{8,15}$/.test(value); }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  return (forwarded ? forwarded.split(",")[0] : req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown").trim().slice(0, 120);
}
async function clientHashes(req: Request) {
  const salt = Deno.env.get("RATE_LIMIT_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "music-core";
  const ip = clientIp(req); const ua = clean(req.headers.get("user-agent") || "unknown", 500);
  return { ipHash: await sha256(`${salt}:ip:${ip}`), uaHash: await sha256(`${salt}:ua:${ua}`) };
}
function service() {
  const base = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("SUPABASE_ENV_MISSING"); return { base, key };
}
async function db(path: string, init: RequestInit = {}) {
  const { base, key } = service(); const requestHeaders = new Headers(init.headers || {});
  requestHeaders.set("apikey", key); requestHeaders.set("authorization", `Bearer ${key}`);
  if (init.body && !requestHeaders.has("content-type")) requestHeaders.set("content-type", "application/json");
  return await fetch(`${base}/rest/v1/${path}`, { ...init, headers: requestHeaders });
}
async function dbJson(path: string, init: RequestInit = {}) {
  const response = await db(path, init); const text = await response.text();
  if (!response.ok) throw new Error(`DB_${response.status}:${text.slice(0, 400)}`);
  if (!text) return null; try { return JSON.parse(text); } catch { return text; }
}
async function audit(event: string, winnerId: string | null, ipHash: string | null, metadata: Record<string, unknown> = {}) {
  try { await db("music_core_audit_log", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ event, winner_id: winnerId, ip_hash: ipHash, metadata }) }); } catch (_) {}
}
async function recordRate(ipHash: string, action: string, success: boolean) {
  try { await db("music_core_rate_limits", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ ip_hash: ipHash, action, success }) }); } catch (_) {}
}
async function rateExceeded(ipHash: string, action: string, limit: number, windowMs = RATE_WINDOW_MS) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const query = new URLSearchParams({ select: "id", ip_hash: `eq.${ipHash}`, action: `eq.${action}`, created_at: `gte.${since}`, limit: String(limit + 1) });
  const rows = await dbJson(`music_core_rate_limits?${query.toString()}`); return Array.isArray(rows) && rows.length >= limit;
}
async function burstExceeded(ipHash: string) {
  const since = new Date(Date.now() - BURST_WINDOW_MS).toISOString();
  const query = new URLSearchParams({ select: "id", ip_hash: `eq.${ipHash}`, created_at: `gte.${since}`, limit: String(BURST_LIMIT + 1) });
  const rows = await dbJson(`music_core_rate_limits?${query.toString()}`); return Array.isArray(rows) && rows.length >= BURST_LIMIT;
}
function kstDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${map.year}-${map.month}-${map.day}`;
}
function ageOnDate(birthDate: string, eventDate: string) {
  const b = birthDate.split("-").map(Number); const e = eventDate.split("-").map(Number);
  if (b.length !== 3 || e.length !== 3 || [...b, ...e].some((value) => !Number.isFinite(value))) return NaN;
  let age = e[0] - b[0]; if (e[1] < b[1] || (e[1] === b[1] && e[2] < b[2])) age--; return age;
}
async function getWinner(email: string, nickname: string) {
  const emailHash = await sha256(email); const nicknameHash = await sha256(nickname); const identityHash = await sha256(`${email}\n${nickname}`); const today = kstDate();
  const query = new URLSearchParams({ select: "id,event_date,submitted,identity_hash", identity_hash: `eq.${identityHash}`, email_hash: `eq.${emailHash}`, nickname_hash: `eq.${nicknameHash}`, event_date: `gte.${today}`, order: "event_date.asc", limit: "1" });
  const rows = await dbJson(`music_core_winners?${query.toString()}`); return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function hasAttendee(winnerId: string) {
  const query = new URLSearchParams({ select: "id", winner_id: `eq.${winnerId}`, limit: "1" });
  const rows = await dbJson(`music_core_attendees?${query.toString()}`); return Array.isArray(rows) && rows.length > 0;
}
async function getSession(tokenHash: string) {
  const query = new URLSearchParams({ select: "id,winner_id,expires_at,used,ip_hash,user_agent_hash,consent_version,consented_at", token_hash: `eq.${tokenHash}`, limit: "1" });
  const rows = await dbJson(`music_core_verification_sessions?${query.toString()}`); return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function callAppsScript(payload: Record<string, unknown>) {
  const token = Deno.env.get("MUSIC_CORE_WEBHOOK_TOKEN");
  if (!token) return { ok: false, skipped: true, sheetUpdated: false, emailSent: false };
  const url = Deno.env.get("ATTENDEE_APPS_SCRIPT_URL") || DEFAULT_APPS_SCRIPT_URL;
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 5, ts: String(Date.now()), nonce: crypto.randomUUID(), token, kind: "music_core", payload }), redirect: "follow" });
  const text = await response.text(); let data: Record<string, unknown> = {}; try { data = JSON.parse(text); } catch {}
  return { ok: response.ok && data.ok === true, skipped: false, sheetUpdated: data.sheetUpdated === true, emailSent: data.emailSent === true, status: response.status, responseText: text.slice(0, 500) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { ok: false, code: "ORIGIN_DENIED" }, 403);
  if (req.headers.get("x-music-core-request") !== "1") return json(req, { ok: false, code: "BAD_REQUEST" }, 403);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text(); if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(req, { ok: false, code: "PAYLOAD_TOO_LARGE" }, 413); body = JSON.parse(raw);
  } catch { return json(req, { ok: false, code: "INVALID_JSON" }, 400); }

  const { ipHash, uaHash } = await clientHashes(req); const requestId = clean(req.headers.get("x-request-id") || crypto.randomUUID(), 80); const action = new URL(req.url).searchParams.get("action") || "";
  try {
    if (await burstExceeded(ipHash)) { await audit("burst_rate_limited", null, ipHash, { request_id: requestId, action }); return json(req, { ok: false, code: "TOO_MANY_ATTEMPTS" }, 429, { "Retry-After": "60" }); }
    if (clean(body.website, 200)) { await recordRate(ipHash, action || "trap", false); await audit("honeypot_triggered", null, ipHash, { request_id: requestId, action }); await delay(450); return json(req, { ok: false, code: "WINNER_MISMATCH" }, 404); }

    if (action === "verify") {
      if (await rateExceeded(ipHash, "verify", VERIFY_LIMIT)) { await audit("verify_rate_limited", null, ipHash, { request_id: requestId }); return json(req, { ok: false, code: "TOO_MANY_ATTEMPTS" }, 429, { "Retry-After": "600" }); }
      const email = normalizeEmail(body.email); const nickname = normalizeNickname(body.nickname);
      if (!email || !nickname) { await recordRate(ipHash, "verify", false); return json(req, { ok: false, code: "MISSING_FIELDS" }, 400); }
      if (body.privacy_consent !== true) { await recordRate(ipHash, "verify", false); return json(req, { ok: false, code: "CONSENT_REQUIRED" }, 400); }
      if (!validEmail(email)) { await recordRate(ipHash, "verify", false); return json(req, { ok: false, code: "INVALID_EMAIL" }, 400); }
      const winner = await getWinner(email, nickname);
      if (!winner) { await recordRate(ipHash, "verify", false); await audit("verify_mismatch", null, ipHash, { request_id: requestId }); await delay(250 + Math.floor(Math.random() * 250)); return json(req, { ok: false, code: "WINNER_MISMATCH" }, 404); }
      if (winner.submitted === true || await hasAttendee(winner.id)) { await recordRate(ipHash, "verify", true); return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409); }
      const token = randomToken(); const tokenHash = await sha256(token); const consentedAt = new Date().toISOString(); const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      await dbJson("music_core_verification_sessions", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ winner_id: winner.id, token_hash: tokenHash, expires_at: expiresAt, used: false, ip_hash: ipHash, user_agent_hash: uaHash, consent_version: CONSENT_VERSION, consented_at: consentedAt }) });
      await recordRate(ipHash, "verify", true); await audit("verify_success", winner.id, ipHash, { request_id: requestId, event_date: winner.event_date, session_ttl_minutes: 15 });
      return json(req, { ok: true, token, verificationToken: token, eventDate: winner.event_date, expiresAt });
    }

    if (action === "submit") {
      if (await rateExceeded(ipHash, "submit", SUBMIT_LIMIT)) { await audit("submit_rate_limited", null, ipHash, { request_id: requestId }); return json(req, { ok: false, code: "TOO_MANY_ATTEMPTS" }, 429, { "Retry-After": "600" }); }
      if (body.privacy_consent !== true) { await recordRate(ipHash, "submit", false); return json(req, { ok: false, code: "CONSENT_REQUIRED" }, 400); }
      const token = clean(body.token || body.verification_token, 200);
      const payload = { account_email: normalizeEmail(body.account_email), muniverse_nickname: normalizeNickname(body.muniverse_nickname), name: clean(body.name, 100), nationality: clean(body.nationality, 2).toUpperCase(), birth_date: clean(body.birth_date, 10), phone: clean(body.phone, 40), contact_email: normalizeEmail(body.contact_email) };
      if (!token || Object.values(payload).some((value) => !value)) { await recordRate(ipHash, "submit", false); return json(req, { ok: false, code: "MISSING_FIELDS" }, 400); }
      if (!validEmail(payload.account_email) || !validEmail(payload.contact_email) || !validNationality(payload.nationality) || !validPhone(payload.phone) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.birth_date)) { await recordRate(ipHash, "submit", false); return json(req, { ok: false, code: "INVALID_FIELDS" }, 400); }
      const session = await getSession(await sha256(token));
      if (!session || session.used === true || new Date(session.expires_at).getTime() <= Date.now() || session.ip_hash !== ipHash || session.user_agent_hash !== uaHash) { await recordRate(ipHash, "submit", false); return json(req, { ok: false, code: "SESSION_INVALID" }, 401); }
      const winners = await dbJson(`music_core_winners?id=eq.${session.winner_id}&select=id,identity_hash,event_date,submitted&limit=1`); const winner = Array.isArray(winners) && winners.length ? winners[0] : null;
      if (!winner) { await recordRate(ipHash, "submit", false); return json(req, { ok: false, code: "SESSION_INVALID" }, 401); }
      if (winner.submitted === true || await hasAttendee(winner.id)) { await recordRate(ipHash, "submit", true); return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409); }
      if (await sha256(`${payload.account_email}\n${payload.muniverse_nickname}`) !== winner.identity_hash) { await recordRate(ipHash, "submit", false); return json(req, { ok: false, code: "SESSION_INVALID" }, 401); }
      const age = ageOnDate(payload.birth_date, winner.event_date); if (!Number.isFinite(age) || age < 15) { await recordRate(ipHash, "submit", false); return json(req, { ok: false, code: "UNDER_15" }, 400); }
      const now = new Date().toISOString();
      const attendeeResponse = await db("music_core_attendees", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ winner_id: winner.id, ...payload, event_date: winner.event_date, consent_version: session.consent_version || CONSENT_VERSION, consented_at: session.consented_at || now }) });
      if (attendeeResponse.status === 409) return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409);
      if (!attendeeResponse.ok) throw new Error(`ATTENDEE_INSERT_FAILED:${(await attendeeResponse.text()).slice(0, 300)}`);
      await dbJson(`music_core_winners?id=eq.${winner.id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ submitted: true, submitted_at: now }) });
      await dbJson(`music_core_verification_sessions?id=eq.${session.id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ used: true }) });
      let hook: Record<string, unknown> = { ok: false, skipped: true, sheetUpdated: false, emailSent: false };
      try { hook = await callAppsScript({ event_date: winner.event_date, ...payload, age, idempotency_key: `music_core:${winner.id}` }); }
      catch (error) { await audit("sheet_mail_unreachable", winner.id, ipHash, { request_id: requestId, message: String(error).slice(0, 300) }); }
      await recordRate(ipHash, "submit", true); await audit("submit_success", winner.id, ipHash, { request_id: requestId, event_date: winner.event_date, sheet_updated: hook.sheetUpdated === true, email_sent: hook.emailSent === true, hook_skipped: hook.skipped === true });
      return json(req, { ok: true, eventDate: winner.event_date, sheetUpdated: hook.sheetUpdated === true, emailSent: hook.emailSent === true });
    }
    return json(req, { ok: false, code: "NOT_FOUND" }, 404);
  } catch (error) {
    await audit("server_error", null, ipHash, { request_id: requestId, action, message: String(error).slice(0, 500) });
    return json(req, { ok: false, code: "SERVER_ERROR" }, 500);
  }
});
