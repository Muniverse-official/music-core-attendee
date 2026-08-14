import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://muniverse-official.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx6OzyBhI0OdrTYoRz7b71SsBVpAO1x3hlcMLshIXg__PcpaEDaTL5OSGuKOiBxfnYB/exec";

const CONSENT_VERSION = "music-core-audience-v1";
const SESSION_MINUTES = 20;
const VERIFY_LIMIT = 10;
const SUBMIT_LIMIT = 6;
const RATE_WINDOW_MINUTES = 10;

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://muniverse-official.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-music-core-request",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}

function clean(v: unknown, max = 300) {
  return String(v ?? "").trim().slice(0, max);
}

function normalizeEmail(v: unknown) {
  return clean(v, 254).normalize("NFKC").toLowerCase();
}

function normalizeNickname(v: unknown) {
  return clean(v, 80).normalize("NFKC");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

function kstDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function ageOnDate(birthDate: string, eventDate: string) {
  const b = birthDate.split("-").map(Number);
  const e = eventDate.split("-").map(Number);
  if (b.length !== 3 || e.length !== 3 || [...b, ...e].some((n) => !Number.isFinite(n))) return NaN;
  let age = e[0] - b[0];
  if (e[1] < b[1] || (e[1] === b[1] && e[2] < b[2])) age--;
  return age;
}

function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown")
    .split(",")[0].trim().slice(0, 120);
}

async function clientHashes(req: Request) {
  const salt = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "music-core";
  const ip = clientIp(req);
  const ua = clean(req.headers.get("user-agent") || "", 500);
  return {
    ip_hash: await sha256(`${salt}:ip:${ip}`),
    ua_hash: await sha256(`${salt}:ua:${ua}`)
  };
}

async function db(path: string, init: RequestInit = {}) {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("SUPABASE_ENV_MISSING");
  const headers = new Headers(init.headers || {});
  headers.set("apikey", key);
  headers.set("authorization", `Bearer ${key}`);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(`${base}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`DB_${res.status}:${text.slice(0, 500)}`);
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

async function rateExceeded(ipHash: string, action: string, limit: number) {
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString();
  const rows = await db(`music_core_rate_limits?ip_hash=eq.${encodeURIComponent(ipHash)}&action=eq.${encodeURIComponent(action)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${limit + 1}`);
  return Array.isArray(rows) && rows.length >= limit;
}

async function callAppsScript(payload: Record<string, unknown>) {
  const webhookToken = Deno.env.get("MUSIC_CORE_WEBHOOK_TOKEN");
  if (!webhookToken) throw new Error("WEBHOOK_SECRET_MISSING");

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 4,
      ts: String(Date.now()),
      nonce: crypto.randomUUID(),
      token: webhookToken,
      kind: "music_core",
      payload
    }),
    redirect: "follow"
  });

  const responseText = await response.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(responseText); } catch {}

  return {
    ok: response.ok && data.ok === true,
    status: response.status,
    data,
    responseText
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, code: "METHOD_NOT_ALLOWED" }, 405);

  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { ok: false, code: "ORIGIN_DENIED" }, 403);
  if (req.headers.get("x-music-core-request") !== "1") return json(req, { ok: false, code: "BAD_REQUEST" }, 403);
  if (Number(req.headers.get("content-length") || "0") > 16384) return json(req, { ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json(req, { ok: false, code: "INVALID_JSON" }, 400); }

  const { ip_hash, ua_hash } = await clientHashes(req);
  const action = new URL(req.url).searchParams.get("action");

  try {
    if (action === "verify") {
      if (await rateExceeded(ip_hash, "verify", VERIFY_LIMIT)) {
        await audit("verify_rate_limited", null, ip_hash);
        return json(req, { ok: false, code: "TOO_MANY_ATTEMPTS" }, 429);
      }

      const email = normalizeEmail(body.email);
      const nickname = normalizeNickname(body.nickname);
      const consent = body.privacy_consent === true;

      if (!email || !nickname) {
        await recordRate(ip_hash, "verify", false);
        return json(req, { ok: false, code: "MISSING_FIELDS" }, 400);
      }
      if (!consent) {
        await recordRate(ip_hash, "verify", false);
        return json(req, { ok: false, code: "CONSENT_REQUIRED" }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await recordRate(ip_hash, "verify", false);
        return json(req, { ok: false, code: "INVALID_EMAIL" }, 400);
      }

      const emailHash = await sha256(email);
      const nicknameHash = await sha256(nickname);
      const identityHash = await sha256(`${email}\n${nickname}`);
      const today = kstDate();
      const rows = await db(`music_core_winners?identity_hash=eq.${identityHash}&email_hash=eq.${emailHash}&nickname_hash=eq.${nicknameHash}&event_date=gte.${today}&select=id,event_date,submitted&order=event_date.asc&limit=1`);
      const winner = Array.isArray(rows) ? rows[0] : null;

      if (!winner) {
        await recordRate(ip_hash, "verify", false);
        await audit("verify_mismatch", null, ip_hash);
        return json(req, { ok: false, code: "WINNER_MISMATCH" }, 404);
      }

      if (winner.submitted === true) {
        await recordRate(ip_hash, "verify", false);
        await audit("verify_duplicate", winner.id, ip_hash);
        return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409);
      }

      const existing = await db(`music_core_attendees?winner_id=eq.${winner.id}&select=id&limit=1`);
      if (Array.isArray(existing) && existing.length) {
        await recordRate(ip_hash, "verify", false);
        await audit("verify_duplicate_attendee", winner.id, ip_hash);
        return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409);
      }

      const token = randomToken();
      const tokenHash = await sha256(token);
      const consentedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60_000).toISOString();

      await db("music_core_verification_sessions", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          winner_id: winner.id,
          token_hash: tokenHash,
          expires_at: expiresAt,
          used: false,
          ip_hash,
          user_agent_hash: ua_hash,
          consent_version: CONSENT_VERSION,
          consented_at: consentedAt
        })
      });

      await recordRate(ip_hash, "verify", true);
      await audit("verify_success", winner.id, ip_hash, { event_date: winner.event_date });
      return json(req, {
        ok: true,
        token,
        eventDate: winner.event_date,
        expiresInSeconds: SESSION_MINUTES * 60
      });
    }

    if (action === "submit") {
      if (await rateExceeded(ip_hash, "submit", SUBMIT_LIMIT)) {
        await audit("submit_rate_limited", null, ip_hash);
        return json(req, { ok: false, code: "TOO_MANY_ATTEMPTS" }, 429);
      }

      const token = clean(body.token, 200);
      const accountEmail = normalizeEmail(body.account_email);
      const nickname = normalizeNickname(body.muniverse_nickname);
      const name = clean(body.name, 100);
      const nationality = clean(body.nationality, 100);
      const birthDate = clean(body.birth_date, 10);
      const phone = clean(body.phone, 40);
      const contactEmail = normalizeEmail(body.contact_email);

      if (!token || !accountEmail || !nickname || !name || !nationality || !birthDate || !phone || !contactEmail) {
        await recordRate(ip_hash, "submit", false);
        return json(req, { ok: false, code: "MISSING_FIELDS" }, 400);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        await recordRate(ip_hash, "submit", false);
        return json(req, { ok: false, code: "INVALID_BIRTH_DATE" }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        await recordRate(ip_hash, "submit", false);
        return json(req, { ok: false, code: "INVALID_EMAIL" }, 400);
      }

      const tokenHash = await sha256(token);
      const nowIso = new Date().toISOString();
      const sessions = await db(`music_core_verification_sessions?token_hash=eq.${tokenHash}&used=eq.false&expires_at=gt.${encodeURIComponent(nowIso)}&select=id,winner_id,ip_hash,user_agent_hash,consent_version,consented_at&limit=1`);
      const session = Array.isArray(sessions) ? sessions[0] : null;

      if (!session || session.ip_hash !== ip_hash || session.user_agent_hash !== ua_hash) {
        await recordRate(ip_hash, "submit", false);
        await audit("submit_invalid_session", session?.winner_id || null, ip_hash);
        return json(req, { ok: false, code: "SESSION_INVALID" }, 401);
      }

      const winners = await db(`music_core_winners?id=eq.${session.winner_id}&select=id,identity_hash,event_date,submitted&limit=1`);
      const winner = Array.isArray(winners) ? winners[0] : null;
      if (!winner) {
        await recordRate(ip_hash, "submit", false);
        return json(req, { ok: false, code: "SESSION_INVALID" }, 401);
      }

      if (winner.submitted === true) {
        await recordRate(ip_hash, "submit", false);
        return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409);
      }

      const identityHash = await sha256(`${accountEmail}\n${nickname}`);
      if (identityHash !== winner.identity_hash) {
        await recordRate(ip_hash, "submit", false);
        await audit("submit_identity_mismatch", winner.id, ip_hash);
        return json(req, { ok: false, code: "SESSION_INVALID" }, 401);
      }

      const age = ageOnDate(birthDate, winner.event_date);
      if (!Number.isFinite(age) || age < 15) {
        await recordRate(ip_hash, "submit", false);
        return json(req, { ok: false, code: "UNDER_15" }, 400);
      }

      try {
        await db("music_core_attendees", {
          method: "POST",
          headers: { prefer: "return=minimal" },
          body: JSON.stringify({
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
            consented_at: session.consented_at || nowIso
          })
        });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("23505") || msg.includes("duplicate key")) {
          await recordRate(ip_hash, "submit", false);
          return json(req, { ok: false, code: "ALREADY_SUBMITTED" }, 409);
        }
        throw err;
      }

      await db(`music_core_winners?id=eq.${winner.id}`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ submitted: true, submitted_at: nowIso })
      });

      await db(`music_core_verification_sessions?id=eq.${session.id}`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ used: true })
      });

      let sheetUpdated = false;
      let emailSent = false;
      try {
        const hook = await callAppsScript({
          event_date: winner.event_date,
          muniverse_nickname: nickname,
          account_email: accountEmail,
          name,
          age,
          birth_date: birthDate,
          nationality,
          phone,
          contact_email: contactEmail,
          idempotency_key: `music_core:${winner.id}`
        });
        sheetUpdated = hook.ok && hook.data.sheetUpdated === true;
        emailSent = hook.ok && hook.data.emailSent === true;
        if (hook.ok) {
          await audit("sheet_mail_synced", winner.id, ip_hash, {
            event_date: winner.event_date,
            sheet_updated: sheetUpdated,
            email_sent: emailSent,
            duplicate: hook.data.duplicate === true
          });
        } else {
          await audit("sheet_mail_failed", winner.id, ip_hash, {
            event_date: winner.event_date,
            status: hook.status,
            body: hook.responseText.slice(0, 300)
          });
        }
      } catch (err) {
        await audit("sheet_mail_unreachable", winner.id, ip_hash, {
          event_date: winner.event_date,
          message: String(err).slice(0, 300)
        });
      }

      await recordRate(ip_hash, "submit", true);
      await audit("submit_success", winner.id, ip_hash, {
        event_date: winner.event_date,
        sheet_updated: sheetUpdated,
        email_sent: emailSent
      });
      return json(req, { ok: true, eventDate: winner.event_date });
    }

    return json(req, { ok: false, code: "NOT_FOUND" }, 404);
  } catch (err) {
    await audit("server_error", null, ip_hash, { message: String(err).slice(0, 500) });
    return json(req, { ok: false, code: "SERVER_ERROR" }, 500);
  }
});
