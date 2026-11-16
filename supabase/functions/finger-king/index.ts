import postgres from "npm:postgres@3.4.7";
import { ApiError, createService, type Database, type Statement } from "./service.ts";

const siteOrigin = "https://muniverse-official.github.io";
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 8 });
type Parameters = (string | number | null)[];
type Query = (text: string, params: Parameters) => Promise<{ rows: Record<string, unknown>[]; count: number }>;

function database(query: Query): Database {
  function prepare(source: string): Statement {
    let count = 0;
    const text = source.replaceAll("?", () => "$" + ++count);
    function bind(...params: Parameters): Statement {
      const execute = () => query(text, params);
      return {
        bind,
        async first<T>(column?: string) {
          const row = (await execute()).rows[0];
          return (column ? row?.[column] : row) as T ?? null;
        },
        async all<T>() { return { results: (await execute()).rows as T[] }; },
        async run() { return { meta: { changes: (await execute()).count } }; },
      };
    }
    return bind();
  }
  return { prepare, batch: (statements) => Promise.all(statements.map((statement) => statement.run())) };
}

function asQuery(connection: Pick<typeof sql, "unsafe">): Query {
  return async (text, params) => {
    const result = await connection.unsafe(text, params);
    const rows = result.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key, typeof value === "string" && (/^(announce_at|announceAt|close_at|closeAt|purge_at|published_at|paused_at|completed_at|created_at|submitted_at|shipped_at|total|submitted|shipped)$/.test(key)) && /^\d+$/.test(value) ? Number(value) : value,
    ])));
    return { rows, count: result.count };
  };
}

async function requireAdmin(query: Query, request: Request) {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new ApiError("forbidden", 403);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  const hash = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  const { rows } = await query(`
    select 1 as authorized from public.attendee_console_sessions s
    join public.attendee_console_accounts a on a.username = s.username
    where s.token_hash = $1 and s.expires_at > now() and a.active and a.updated_at <= s.created_at
  `, [hash]);
  if (!rows.length) throw new ApiError("forbidden", 403);
}

const headers = {
  "Access-Control-Allow-Origin": siteOrigin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const readOnly = new Set(["status", "lookup", "admin-rounds", "admin-winners", "admin-export"]);

Deno.serve(async (request) => {
  const action = new URL(request.url).searchParams.get("action") ?? "";
  const origin = request.headers.get("origin");
  if (origin !== siteOrigin && !(request.method === "GET" && action === "status" && !origin)) return json({ error: "forbidden" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== (action === "status" ? "GET" : "POST")) return json({ error: "not_found" }, 404);
  try {
    const run = async (query: Query) => {
      if (action.startsWith("admin-")) await requireAdmin(query, request);
      const { rows } = await query("select secret from finger_king.configuration where singleton", []);
      const secret = rows[0]?.secret;
      if (typeof secret !== "string") throw new ApiError("service", 503);
      const service = createService(database(query), secret);
      if (action === "status") return service.releaseState();
      if (action === "lookup") return service.lookup(request, await service.readInput(request));
      if (action === "submit") return service.submit(request, await service.readInput(request));
      const admin = service.adminActions[action];
      if (!admin) throw new ApiError("not_found", 404);
      return admin(await service.readInput(request));
    };
    if (readOnly.has(action)) return json(await run(asQuery(sql)));
    const result = await sql.begin(async (connection) => {
      const query = asQuery(connection as Pick<typeof sql, "unsafe">);
      await query("select pg_advisory_xact_lock(734159285)", []);
      try { return await run(query); }
      catch (error) {
        // Keep public submission rate counters when validation rejects a request.
        if (action === "submit" && error instanceof ApiError) return error;
        throw error;
      }
    });
    return result instanceof ApiError ? json({ error: result.code, detail: result.detail }, result.status) : json(result);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code, detail: error.detail }, error.status);
    console.error("finger-king request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "service" }, 503);
  }
});
