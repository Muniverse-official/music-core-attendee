import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PROD_ORIGIN = "https://muniverse-official.github.io";
const LOCAL_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const CONSENT_VERSION = "music-core-audience-2026-09-v3-x-account";
const RATE_WINDOW_MS = 10 * 60 * 1000;
const BURST_WINDOW_MS = 60 * 1000;
const SUBMIT_LIMIT = 5;
const BURST_LIMIT = 30;
const MAX_BODY_BYTES = 16_384;
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const DEFAULT_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx6OzyBhI0OdrTYoRz7b71SsBVpAO1x3hlcMLshIXg__PcpaEDaTL5OSGuKOiBxfnYB/exec";

function allowLocalDev() {
  return Deno.env.get("ALLOW_LOCAL_DEV") === "true";
}

function allowedOrigin(origin: string) {
  return origin === PROD_ORIGIN || (allowLocalDev() && LOCAL_ORIGINS.has(origin));
}

function responseHeaders(req: Request, extra: Record<string, string> = {}) {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-music-core-request, x-request-id",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Vary": "Origin"
  };
  if (allowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return { ...headers, ...extra };
}

function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(req, extra) });
}

function clean(value: unknown, max = 300) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function normalizeEmail(value: unknown) {
  return clean(value, 254).toLowerCase();
}

function normalizeNickname(value: unknown) {
  return clean(value, 80).replace(/\s+/g, " ");
}

function normalizeXAccount(value: unknown) {
  let raw = clean(value, 100);
  raw = raw.replace(/^https?:\/\/(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\//i, "");
  raw = raw.split(/[/?#]/u)[0].replace(/^@+/u, "");
  if (!X_HANDLE_PATTERN.test(raw)) return null;
  return `@${raw}`;
}

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validNationality(value: string) {
  return /^[A-Z]{2}$/.test(value);
}

function validPhone(value: string) {
  return /^010-\d{4}-\d{4}$/.test(value) || /^\+\d{8,15}$/.test(value);
}

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function ageOnDate(birthDate: string, eventDate: string) {
  if (!validCalendarDate(birthDate) || !validCalendarDate(eventDate)) return NaN;
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [eventYear, eventMonth, eventDay] = eventDate.split("-").map(Number);
  let age = eventYear - birthYear;
  if (eventMonth < birthMonth || (eventMonth === birthMonth && eventDay < birthDay)) age--;
  return age;
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request) {
  const cloudflare = req.headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare.slice(0, 120);
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 120);
  const forwarded = req.headers.get("x-forwarded-for") || "";
  return (forwarded.split(",").map((part) => part.trim()).filter(Boolean).at(-1) || "unknown").slice(0, 120);
}

async function clientHashes(req: Request) {
  const salt = Deno.env.get("RATE_LIMIT_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "music-core";
  const ip = clientIp(req);
  const ua = clean(req.headers.get("user-agent") || "unknown", 500);
  return {
    ipHash: await sha256(`${salt}:ip:${ip}`),
    uaHash: await sha256(`${salt}:ua:${ua}`)
  };
}

function service() {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("SUPABASE_ENV_MISSING");
  return { base, key };
}

async function db(path: string, init: RequestInit = {}) {
  const { base, key } = service();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", key);
  headers.set("authorization", `Bearer ${key}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return await fetch(`${base}/rest/v1/${path}`, { ...init, headers });
}

async function dbJson(path: string, init: RequestInit = {}) {
  const response = await db(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`DB_${response.status}:${text.slice(0, 400)}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function audit(event: string, winnerId: string | null, ipHash: string | null, metadata: Record<string, unknown> = {}) {
  try {
    await db("music_core_audit_log", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ event, winner_id: winnerId, ip_hash: ipHash, metadata })
    });
  } catch (_) {}
}

async function persistXFallback(winnerId: string, ipHash: string, xAccount: string, eventDate: string) {
  const response = await db("music_core_audit_log", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      event: "attendee_x_account_fallback",
      winner_id: winnerId,
      ip_hash: ipHash,
      metadata: {
        x_account: xAccount,
        event_date: eventDate,
        consent_version: CONSENT_VERSION,
        storage_reason: "attendees_x_account_column_unavailable"
      }
    })
  });
  if (!response.ok) throw new Error(`X_FALLBACK_PERSIST_FAILED:${(await response.text()).slice(0, 300)}`);
}

async function recordRate(ipHash: string, action: string, success: boolean) {
  try {
    await db("music_core_rate_limits", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ ip_hash: ipHash, action, success })
    });
  } catch (_) {}
}

async function rateExceeded(ipHash: string, action: string, limit: number, windowMs = RATE_WINDOW_MS) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const query = new URLSearchParams({
    select: "id",
    ip_hash: `eq.${ipHash}`,
    action: `eq.${action}`,
    created_at: `gte.${since}`,
    limit: String(limit + 1)
  });
  const rows = await dbJson(`music_core_rate_limits?${query.toString()}`);
  return Array.isArray(rows) && rows.length >= limit;
}

async function burstExceeded(ipHash: string) {
  const since = new Date(Date.now() - BURST_WINDOW_MS).toISOString();
  const query = new URLSearchParams({
    select: "id",
    ip_hash: `eq.${ipHash}`,
    created_at: `gte.${since}`,
    limit: String(BURST_LIMIT + 1)
  });
  const rows = await dbJson(`music_core_rate_limits?${query.toString()}`);
  return Array.isArray(rows) && rows.length >= BURST_LIMIT;
}

async function getSession(tokenHash: string) {
  const query = new URLSearchParams({
    select: "id,winner_id,expires_at,used,ip_hash,user_agent_hash,consent_version,consented_at",
    token_hash: `eq.${tokenHash}`,
    limit: "1"
  });
  const rows = await dbJson(`music_core_verification_sessions?${query.toString()}`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function getWinner(winnerId: string) {
  const query = new URLSearchParams({
    select: "id,identity_hash,event_date,submitted",
    id: `eq.${winnerId}`,
    limit: "1"
  });
  const rows = await dbJson(`music_core_winners?${query.toString()}`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function hasAttendee(winnerId: string) {
  const query = new URLSearchParams({ select: "id", winner_id: `eq.${winnerId}`, limit: "1" });
  const rows = await dbJson(`music_core_attendees?${query.toString()}`);
  return Array.isArray(rows) && rows.length > 0;
}

function isMissingXColumn(status: number, text: string) {
  if (status !== 400) return false;
  const lowered = text.toLowerCase();
  return lowered.includes("x_account") && (lowered.includes("schema cache") || lowered.includes("column") || lowered.includes("pgrst204"));
}

async function insertAttendee(row: Record<string, unknown>, winnerId: string, ipHash: string, xAccount: string, eventDate: string) {
  const withX = await db("music_core_attendees", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ ...row, x_account: xAccount })
  });
  if (withX.ok) return { canonicalX: true };

  const withXText = await withX.text();
  if (withX.status === 409 || withXText.includes("23505") || withXText.toLowerCase().includes("duplicate key")) {
    return { duplicate: true, canonicalX: false };
  }
  if (!isMissingXColumn(withX.status, withXText)) {
    throw new Error(`ATTENDEE_INSERT_FAILED:${withX.status}:${withXText.slice(0, 300)}`);
  }

  await persistXFallback(winnerId, ipHash, xAccount, eventDate);
  const withoutX = await db("music_core_attendees", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(row)
  });
  if (withoutX.ok) return { canonicalX: false };
  const withoutXText = await withoutX.text();
  if (withoutX.status === 409 || withoutXText.includes("23505") || withoutXText.toLowerCase().includes("duplicate key")) {
    return { duplicate: true, canonicalX: false };
  }
  throw new Error(`ATTENDEE_INSERT_FALLBACK_FAILED:${withoutX.status}:${withoutXText.slice(0, 300)}`);
}

async function callAppsScript(payload: Record<string, unknown>) {
  const token = Deno.env.get("MUSIC_CORE_WEBHOOK_TOKEN");
  if (!token) return { ok: false, skipped: true, sheetUpdated: false, emailSent: false };
  const url = Deno.env.get("ATTENDEE_APPS_SCRIPT_URL") || DEFAULT_APPS_SCRIPT_URL;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 6,
      ts: String(Date.now()),
      nonce: crypto.randomUUID(),
      token,
      kind: "music_core",
      payload
    }),
    redirect: "follow",
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch {}
  return {
    ok: response.ok && data.ok === true,
    skipped: false,
    sheetUpdated: data.sheetUpdated === true,
    emailSent: data.emailSent === true,
    status: response.status,
    responseText: text.slice(0, 500)
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") || "";
    if (!allowedOrigin(origin)) return json(req, { ok: false, code: "ORIGIN_DENIED" }, 403);
    return new Response(null, { status: 204, headers: responseHeaders(req) });
  }
  if (req.method !== "POST") return json(req, { ok: false, code: "METHOD_NOT_ALLOWED" }, 405);

  const origin = req.headers.get("origin") || "";
  if (!allowedOrigin(origin)) return json(req, { ok: false, code: "ORIGIN_DENIED" }, 403);
  if (req.headers.get("x-music-core-request")?.trim() !== "1") return json(req, { ok: false, code: "BAD_REQUEST" }, 403);
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) return json(req, { ok: false, code: "UNSUPPORTED_MEDIA_TYPE" }, 415);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(req, { ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(req, { ok: false, code: "INVALID_JSON" }, 400);
    body = parsed;
  } catch {
    return json(req, { ok: false, code: "INVALID_JSON" }, 400);
  }

  const { ipHash, uaHash } = await clientHashes(req);
  const requestId = clean(req.headers.get("x-request-id") || crypto.randomUUID(), 80);

  try {
    if (await burstExceeded(ipHash) || await rateExceeded(ipHash, "submit", SUBMIT_LIMIT)) {
      await audit("submit_rate_limited", null, ipHash, { request_id: requestId });
      return json(req, { ok: false, code: "TOO_MANY_ATTEMPTS" }, 429, { "Retry-After": "600" });
    }
    if (clean(body.website, 200)) {
      await recordRate(ipHash, "submit", false);
      return json(req, { ok: false, code: "SESSION_INVALID" }, 401);
    }
    if (body.privacy_consent !== true) {
      await recordRate(ipHash, "submit", false);
      return json(req, { ok: false, code: "CONSENT_REQUIRED" }, 400);
    }

    const token = clean(body.token || body.verification_token, 200);
    const accountEmail = normalizeEmail(body.account_email);
    const nickname = normalizeNickname(body.muniverse_nickname);
    const name = clean(body.name, 100);
    const nationality = clean(body.nationality, 2).toUpperCase();
    const birthDate = clean(body.birth_date, 10);
    const phone = clean(body.phone, 40);
    const contactEmail = normalizeEmail(body.contact_email);
    const xAccount = normalizeXAccount(body.x_account);

    if (!token || !accountEmail || !nickname || !name || !nationality || !birthDate || !phone || !contactEmail || !clean(body.x_account, 100)) {
      await recordRate(ipHash, "submit", false);
      return json(req, { ok: false, code: "MISSING_FIELDS" }, 400);
    }
    if (!xAccount) {
      await recordRate(ipHash, "submit", false);
      return json(req, { ok: false, code: "INVALID_X_ACCOUNT" }, 400);
    }
    if (!validEmail(accountEmail) || !validEmail(contactEmail) || !validNationality(nationality) || !validPhone(phone) || !validCalendarDate(birthDate)) {
      await recordRate(ipHash, "submit", false);
      return json(req, { ok: false, code: "INVALID_FIELDS" }, 400);
    }

    const session = await getSession(await sha256(token));
    if (!session || session.used === true || new Date(session.expires_at).getTime() <= Date.now() || session.ip_hash !== ipHash || session.user_agent_hash !== uaHash) {
      await recordRate(ipHash, "submit", false);
      return json(req, { ok: false, code: "SESSION_INVALID" }, 401);
    }

    const winner = await getWinner(session.winner_id);
    if (!winner) {
      await recordRate(ipHash, "submit", false);
      return json(req, { ok: false, code: "SESSION_INVALID" }, 401);
    }
    if (winner.submitted === true || await hasAttendee(winner.id)) {
      await recordRate(ipHash, "submit", true);
      return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409);
    }
    if (await sha256(`${accountEmail}\n${nickname}`) !== winner.identity_hash) {
      await recordRate(ipHash, "submit", false);
      return json(req, { ok: false, code: "SESSION_INVALID" }, 401);
    }

    const age = ageOnDate(birthDate, winner.event_date);
    if (!Number.isFinite(age) || age < 15 || age > 120) {
      await recordRate(ipHash, "submit", false);
      return json(req, { ok: false, code: age < 15 ? "UNDER_15" : "INVALID_FIELDS" }, 400);
    }

    const now = new Date().toISOString();
    const attendeeRow = {
      winner_id: winner.id,
      account_email: accountEmail,
      muniverse_nickname: nickname,
      name,
      nationality,
      birth_date: birthDate,
      phone,
      contact_email: contactEmail,
      event_date: winner.event_date,
      consent_version: session.consent_version || CONSENT_VERSION,
      consented_at: session.consented_at || now
    };

    const inserted = await insertAttendee(attendeeRow, winner.id, ipHash, xAccount, winner.event_date);
    if (inserted.duplicate === true) {
      await recordRate(ipHash, "submit", true);
      return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409);
    }

    await dbJson(`music_core_winners?id=eq.${winner.id}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ submitted: true, submitted_at: now })
    });
    await dbJson(`music_core_verification_sessions?id=eq.${session.id}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ used: true })
    });

    const outbound = {
      event_date: winner.event_date,
      muniverse_nickname: nickname,
      account_email: accountEmail,
      name,
      age,
      birth_date: birthDate,
      nationality,
      phone,
      x_account: xAccount,
      contact_email: contactEmail,
      idempotency_key: `music_core:${winner.id}`
    };

    let hook: Record<string, unknown> = { ok: false, skipped: true, sheetUpdated: false, emailSent: false };
    try {
      hook = await callAppsScript(outbound);
    } catch (error) {
      await audit("sheet_mail_unreachable", winner.id, ipHash, { request_id: requestId, message: String(error).slice(0, 300) });
    }

    await recordRate(ipHash, "submit", true);
    await audit("submit_success", winner.id, ipHash, {
      request_id: requestId,
      event_date: winner.event_date,
      x_account_collected: true,
      x_account_canonical_column: inserted.canonicalX === true,
      sheet_updated: hook.sheetUpdated === true,
      email_sent: hook.emailSent === true,
      hook_skipped: hook.skipped === true
    });

    return json(req, {
      ok: true,
      registered: true,
      eventDate: winner.event_date,
      sheetUpdated: hook.sheetUpdated === true,
      emailSent: hook.emailSent === true
    });
  } catch (error) {
    await audit("register_server_error", null, ipHash, { request_id: requestId, message: String(error).slice(0, 500) });
    return json(req, { ok: false, code: "SERVER_ERROR" }, 500);
  }
});
