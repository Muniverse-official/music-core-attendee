import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PROD_ORIGIN = "https://muniverse-official.github.io";
const LOCAL_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const CONSENT_VERSION = "music-core-audience-2026-09-v3-x-account";
const SESSION_TTL_MS = 15 * 60 * 1000;
const VERIFY_LIMIT = 8;
const BURST_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const BURST_WINDOW_MS = 60 * 1000;
const MAX_BODY_BYTES = 16_384;

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

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

function kstDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function getWinner(email: string, nickname: string) {
  const emailHash = await sha256(email);
  const nicknameHash = await sha256(nickname);
  const identityHash = await sha256(`${email}\n${nickname}`);
  const today = kstDate();
  const query = new URLSearchParams({
    select: "id,event_date,submitted,identity_hash",
    identity_hash: `eq.${identityHash}`,
    email_hash: `eq.${emailHash}`,
    nickname_hash: `eq.${nicknameHash}`,
    event_date: `gte.${today}`,
    order: "event_date.asc",
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
    if (await burstExceeded(ipHash) || await rateExceeded(ipHash, "verify", VERIFY_LIMIT)) {
      await audit("verify_rate_limited", null, ipHash, { request_id: requestId });
      return json(req, { ok: false, code: "TOO_MANY_ATTEMPTS" }, 429, { "Retry-After": "600" });
    }
    if (clean(body.website, 200)) {
      await recordRate(ipHash, "verify", false);
      await delay(450);
      return json(req, { ok: false, code: "WINNER_MISMATCH" }, 404);
    }

    const email = normalizeEmail(body.email);
    const nickname = normalizeNickname(body.nickname);
    if (!email || !nickname) {
      await recordRate(ipHash, "verify", false);
      return json(req, { ok: false, code: "MISSING_FIELDS" }, 400);
    }
    if (body.privacy_consent !== true) {
      await recordRate(ipHash, "verify", false);
      return json(req, { ok: false, code: "CONSENT_REQUIRED" }, 400);
    }
    if (!validEmail(email)) {
      await recordRate(ipHash, "verify", false);
      return json(req, { ok: false, code: "INVALID_EMAIL" }, 400);
    }

    const winner = await getWinner(email, nickname);
    if (!winner) {
      await recordRate(ipHash, "verify", false);
      await audit("verify_mismatch", null, ipHash, { request_id: requestId });
      await delay(250 + Math.floor(Math.random() * 250));
      return json(req, { ok: false, code: "WINNER_MISMATCH" }, 404);
    }
    if (winner.submitted === true || await hasAttendee(winner.id)) {
      await recordRate(ipHash, "verify", true);
      return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409);
    }

    const token = randomToken();
    const tokenHash = await sha256(token);
    const consentedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await dbJson("music_core_verification_sessions", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        winner_id: winner.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        used: false,
        ip_hash: ipHash,
        user_agent_hash: uaHash,
        consent_version: CONSENT_VERSION,
        consented_at: consentedAt
      })
    });

    await recordRate(ipHash, "verify", true);
    await audit("verify_success", winner.id, ipHash, {
      request_id: requestId,
      event_date: winner.event_date,
      session_ttl_minutes: 15
    });
    return json(req, { ok: true, token, verificationToken: token, eventDate: winner.event_date, expiresAt });
  } catch (error) {
    await audit("verify_server_error", null, ipHash, { request_id: requestId, message: String(error).slice(0, 500) });
    return json(req, { ok: false, code: "SERVER_ERROR" }, 500);
  }
});
