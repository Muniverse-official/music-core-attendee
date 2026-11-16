import { claimStatus, countryCodes, formatKst, fromKstInput, receiptRef, roundPhase, shippingFields, type AdminWinner, type Delivery, type LookupGroup, type Round, type Territory, type WinnerMatch } from "./finger.ts";

type Input = Record<string, unknown>;
type Winner = {
  id: string;
  round_id: string;
  prize: string;
  identity_box: string | null;
  delivery_box: string | null;
  submitted_at: number | null;
  shipped_at: number | null;
};
type JoinedWinner = Winner & {
  title: string;
  announce_at: number;
  close_at: number;
  purge_at: number | null;
  territory: Territory;
  kr_import: number;
  tw_express: number;
};

export class ApiError extends Error {
  constructor(public code: string, public status = 400, public detail?: string) {
    super(code);
  }
}

export type Statement = {
  bind(...params: (string | number | null)[]): Statement;
  first<T>(column?: string): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
};
export type Database = { prepare(query: string): Statement; batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]> };

export function createService(database: Database, secret: string) {
function db() {
  return database;
}

const encoder = new TextEncoder();
let keyset: Promise<{ hmac: CryptoKey; aes: CryptoKey }> | undefined;

function keys() {
  if (secret.length < 32) throw new ApiError("service", 503);
  return keyset ??= (async () => {
    const [hashRoot, boxRoot] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode("ifk-hmac-v1:" + secret)),
      crypto.subtle.digest("SHA-256", encoder.encode("ifk-aes-v1:" + secret)),
    ]);
    return {
      hmac: await crypto.subtle.importKey("raw", hashRoot, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
      aes: await crypto.subtle.importKey("raw", boxRoot, "AES-GCM", false, ["encrypt", "decrypt"]),
    };
  })();
}

function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unbase64(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (x) => x.charCodeAt(0));
}

async function hash(value: string) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", (await keys()).hmac, encoder.encode(value)));
}

async function seal(value: unknown, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const box = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(context) }, (await keys()).aes, encoder.encode(JSON.stringify(value)));
  return base64(iv) + "." + base64(new Uint8Array(box));
}

async function reveal<T>(box: string, context: string): Promise<T> {
  const [iv, content] = box.split(".");
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv), additionalData: encoder.encode(context) }, (await keys()).aes, unbase64(content));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function matchingKey(account: string, nickname: string) {
  return base64(await hash("match:" + JSON.stringify([account, nickname])));
}

async function shippingCode(winnerId: string) {
  return Array.from((await hash("shipping-code:" + winnerId)).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function equalCode(expected: string, received: string) {
  if (expected.length !== received.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return difference === 0;
}

async function claimToken(id: string, now: number) {
  const payload = id + "." + (now + 30 * 60 * 1000);
  return payload + "." + base64(await hash("claim:" + payload));
}

async function tokenId(token: string) {
  const parts = /^([0-9a-f-]{36})\.(\d{13})\.([0-9a-zA-Z_-]{43})$/.exec(token);
  if (!parts || Number(parts[2]) <= Date.now()) throw new ApiError("token", 409);
  const verified = await crypto.subtle.verify("HMAC", (await keys()).hmac, unbase64(parts[3]), encoder.encode("claim:" + parts[1] + "." + parts[2]));
  if (!verified) throw new ApiError("token", 409);
  return parts[1];
}

function clean(value: unknown, max: number, optional = false) {
  if (typeof value !== "string") throw new ApiError("input");
  const result = value.trim().normalize("NFC");
  if ((!optional && !result) || result.length > max || /[\x00-\x1f\x7f]/.test(result)) throw new ApiError("input");
  return result;
}

function accountEmail(value: unknown) {
  const email = clean(value, 254);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError("input");
  return email;
}

function selectedId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value)) throw new ApiError("input");
  return value;
}

async function readInput(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body) throw new ApiError("input");
  const reader = request.body.getReader();
  let raw = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 192_000) {
      void reader.cancel();
      throw new ApiError("size", 413);
    }
    raw += decoder.decode(chunk.value, { stream: true });
  }
  raw += decoder.decode();
  try {
    const value = JSON.parse(raw);
    if (value && !Array.isArray(value) && typeof value === "object") return value as Input;
  } catch {
    // The same response covers malformed JSON and invalid input shapes.
  }
  throw new ApiError("input");
}

const WINDOW = 5 * 60 * 1000;

async function rateLimit(request: Request, scope: string, now: number, max: number, fallback: string) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || fallback;
  const expiresAt = (Math.floor(now / WINDOW) + 1) * WINDOW;
  const bucket = base64(await hash(JSON.stringify(["limit", scope, ip, expiresAt])));
  const count = await db().prepare(`
    INSERT INTO finger_king.rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET hits = rate_limits.hits + 1 WHERE rate_limits.hits < ?
    RETURNING hits
  `).bind(bucket, expiresAt, max).first<number>("hits");
  if (count === null) throw new ApiError("rate", 429);
  if (count === 1) await db().prepare("DELETE FROM finger_king.rate_limits WHERE expires_at <= ?").bind(now).run();
}

// Keep the public list and direct lookup on the same announcement rules.
const visibleRound = `r.published_at IS NOT NULL AND r.paused_at IS NULL AND r.completed_at IS NULL AND LEAST(r.close_at, r.purge_at) > ?`;

const winnerJoin = `
  SELECT w.id, w.round_id, w.prize, w.submitted_at, w.shipped_at, r.title, r.announce_at, r.close_at, r.purge_at, r.territory, r.kr_import, r.tw_express
  FROM finger_king.winners w JOIN finger_king.rounds r ON w.round_id = r.id
`;

async function releaseState() {
  const now = Date.now();
  await purgeExpired(now);
  const groups = await db().prepare(`
    SELECT id, title AS name, announce_at AS "announceAt", close_at AS "closeAt"
    FROM finger_king.rounds r WHERE ${visibleRound}
    ORDER BY announce_at, lower(title), id
  `).bind(now).all<LookupGroup>();
  return { groups: groups.results };
}

async function lookup(request: Request, input: Input) {
  const now = Date.now();
  const groupId = selectedId(input.groupId);
  const account = accountEmail(input.account).toLowerCase();
  const nickname = clean(input.nickname, 100);
  const match = await matchingKey(account, nickname);
  await rateLimit(request, "lookup", now, 18, match);
  const row = await db().prepare(`
    SELECT w.id, w.prize, w.submitted_at, w.shipped_at, r.title, r.announce_at, r.close_at, r.purge_at, r.territory, r.kr_import, r.tw_express
    FROM finger_king.rounds r LEFT JOIN finger_king.winners w ON w.round_id = r.id AND w.match_key = ?
    WHERE r.id = ? AND ${visibleRound}
  `).bind(match, groupId, now).first<Pick<JoinedWinner, "title" | "announce_at" | "close_at" | "purge_at" | "territory" | "kr_import" | "tw_express" | "prize" | "submitted_at" | "shipped_at"> & { id: string | null }>();
  if (!row) throw new ApiError("group_unavailable", 409);
  if (row.announce_at > now) throw new ApiError("group_pending", 409);
  if (!row.id) return { result: null };

  const status = claimStatus(row.submitted_at, row.shipped_at, row.close_at, now);
  const result: WinnerMatch = {
    round: row.title, prize: row.prize, closeAt: row.close_at, purgeAt: row.purge_at,
    territory: "world", krImport: row.kr_import === 1, twExpress: true, status,
    ...(status === "open" ? { token: await claimToken(row.id, now) } : {}),
  };
  return { result };
}

function parseDelivery(input: Input, round: JoinedWinner): Delivery {
  const country = clean(input.country, 2);
  if (!countryCodes.includes(country)) throw new ApiError("delivery");
  const fields = shippingFields(country, round.kr_import === 1);
  if (fields.suspended) throw new ApiError("shipping_unavailable");
  const recipient = clean(input.recipient, 100);
  const phone = clean(input.phone, 38);
  const digits = phone.replace(/\D/g, "");
  if (!/^\+?[\d ()-]+$/.test(phone) || digits.length < 7 || digits.length > 15) throw new ApiError("phone");
  const postal = clean(input.postal ?? "", 22, true);
  if ((fields.postalRequired && !postal) || (fields.domestic && !/^\d{5}$/.test(postal)) ||
      (country === "JP" && !/^\d{3}-?\d{4}$/.test(postal))) throw new ApiError("postal");
  const clearanceCode = fields.koreanClearance ? clean(input.clearanceCode ?? "", 13, true).toUpperCase() : "";
  if ((fields.koreanClearance && !/^P\d{12}$/.test(clearanceCode)) ||
      (fields.taiwanEzWay && input.ezWay !== "on")) throw new ApiError("customs");
  if (postal && !/^[\p{L}\p{N} -]+$/u.test(postal)) throw new ApiError("postal");
  return {
    country, recipient, phone, postal,
    region: fields.domestic ? "" : clean(input.region ?? "", 110, !fields.regionRequired),
    city: country === "KR" ? "" : clean(input.city, 110),
    address1: clean(input.address1, 200),
    address2: clean(input.address2 ?? "", 160, true),
    ...(fields.koreanClearance ? { clearanceCode } : {}),
    ...(fields.taiwanEzWay ? { ezWayConfirmed: true } : {}),
  };
}

async function submit(request: Request, input: Input) {
  const now = Date.now();
  const id = await tokenId(clean(input.token, 130));
  await rateLimit(request, "submit", now, 8, id);
  const row = await db().prepare(winnerJoin + `
    WHERE w.id = ? AND ${visibleRound} AND r.announce_at <= ?
  `).bind(id, now, now).first<JoinedWinner>();
  if (!row || row.close_at <= now) throw new ApiError("closed", 409);
  if (row.submitted_at) throw new ApiError("duplicate", 409);
  const code = clean(input.code, 30).replace(/[ -]/g, "").toUpperCase();
  if (!equalCode(await shippingCode(id), code)) throw new ApiError("code");
  if (input.consent !== true) throw new ApiError("consent");
  const delivery = parseDelivery(input, row);
  const box = await seal({ ...delivery, consentVersion: 2 }, "delivery:" + id);
  const submittedAt = Date.now();
  const saved = await db().prepare(`
    UPDATE finger_king.winners SET delivery_box = ?, submitted_at = ? WHERE id = ? AND submitted_at IS NULL
      AND EXISTS (SELECT 1 FROM finger_king.rounds r WHERE r.id = winners.round_id AND r.close_at > ?
        AND r.announce_at <= ? AND r.published_at IS NOT NULL AND r.paused_at IS NULL AND r.completed_at IS NULL AND (r.purge_at IS NULL OR r.purge_at > ?))
    RETURNING submitted_at
  `).bind(box, submittedAt, id, submittedAt, submittedAt, submittedAt).first<number>("submitted_at");
  if (saved === null) throw new ApiError("changed", 409);
  return { submittedAt: saved };
}

async function purgeExpired(now = Date.now()) {
  return db().prepare(`
    UPDATE finger_king.winners SET delivery_box = NULL, identity_box = NULL, account_key = id, match_key = id
    WHERE (delivery_box IS NOT NULL OR identity_box IS NOT NULL) AND EXISTS (
      SELECT 1 FROM finger_king.rounds r WHERE r.id = winners.round_id AND r.published_at IS NOT NULL
      AND (r.purge_at <= ? OR (r.purge_at IS NULL AND winners.submitted_at IS NULL
        AND (r.close_at <= ? OR r.completed_at IS NOT NULL)))
    )
  `).bind(now, now).run();
}

async function loadRound(id: string) {
  const row = await db().prepare("SELECT * FROM finger_king.rounds WHERE id = ?").bind(id).first<Round>();
  if (!row) throw new ApiError("round", 404, "투표를 찾을 수 없습니다.");
  return row;
}

async function listRounds() {
  const now = Date.now();
  await purgeExpired(now);
  const rows = await db().prepare(`
    SELECT r.*, COUNT(w.id) AS total, COUNT(w.submitted_at) AS submitted, COUNT(w.shipped_at) AS shipped
    FROM finger_king.rounds r LEFT JOIN finger_king.winners w ON w.round_id = r.id GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all<Round & { total: number; submitted: number; shipped: number }>();
  return { rounds: rows.results.map((row) => ({ ...row, phase: roundPhase(row, now) })) };
}

async function saveRound(input: Input) {
  const title = input.title;
  if (typeof title !== "string" || !title.trim() || title.length > 100 || /[\x00-\x1f\x7f]/.test(title)) throw new ApiError("input");
  const announce = input.announce ? fromKstInput(clean(input.announce, 16)) : null;
  const close = input.close ? fromKstInput(clean(input.close, 16)) : null;
  const purge = null;
  const territory = "world";
  const krImport = 0;
  const twExpress = 1;
  const now = Date.now();
  if ((input.announce && !announce) || (input.close && !close)) throw new ApiError("date", 400, "일정을 한국 시간으로 정확히 입력해 주세요.");
  if (announce && close && announce >= close) {
    throw new ApiError("date", 400, "배송지 입력 마감을 발표 시각보다 뒤로 설정해 주세요.");
  }
  if (input.id) {
    const id = selectedId(input.id);
    const result = await db().prepare(`
      UPDATE finger_king.rounds SET title = ?, announce_at = ?, close_at = ?, purge_at = ?, territory = ?, kr_import = ?, tw_express = ?
      WHERE id = ? AND published_at IS NULL AND (title = ? OR NOT EXISTS (
        SELECT 1 FROM finger_king.rounds AS other WHERE lower(trim(other.title)) = lower(trim(?)) AND other.id != ?
          AND other.completed_at IS NULL AND (other.close_at IS NULL OR other.close_at > ?)
      )) RETURNING id
    `).bind(title, announce, close, purge, territory, krImport, twExpress, id, title, title, id, now).first<string>("id");
    if (!result) {
      if ((await loadRound(id)).published_at) throw new ApiError("locked", 409, "발표가 설정된 투표입니다.");
      throw new ApiError("group_name", 409, "이미 등록된 투표명입니다.");
    }
    return { id };
  }
  const id = crypto.randomUUID();
  const inserted = await db().prepare(`
    INSERT INTO finger_king.rounds (id, title, announce_at, close_at, purge_at, territory, kr_import, tw_express, created_at)
    SELECT ?::text, ?::text, ?::bigint, ?::bigint, ?::bigint, ?::text, ?::integer, ?::integer, ?::bigint WHERE NOT EXISTS (SELECT 1 FROM finger_king.rounds WHERE lower(trim(title)) = lower(trim(?))
      AND completed_at IS NULL AND (close_at IS NULL OR close_at > ?))
    RETURNING id
  `).bind(id, title, announce, close, purge, territory, krImport, twExpress, now, title, now).first<string>("id");
  if (!inserted) throw new ApiError("group_name", 409, "이미 등록된 투표명입니다.");
  return { id };
}

async function publishRound(input: Input) {
  const id = selectedId(input.id);
  const result = await db().prepare(`
    UPDATE finger_king.rounds SET published_at = ? WHERE id = ? AND published_at IS NULL
      AND announce_at < close_at AND close_at > ? AND (purge_at IS NULL OR purge_at > close_at)
      AND EXISTS (SELECT 1 FROM finger_king.winners WHERE round_id = rounds.id)
    RETURNING id
  `).bind(Date.now(), id, Date.now()).first<string>("id");
  if (!result) throw new ApiError("publish", 409, "발표 시각, 배송지 입력 마감과 당첨자 명단을 확인해 주세요.");
  return { id };
}

async function pauseRound(input: Input) {
  const id = selectedId(input.id);
  if (typeof input.paused !== "boolean") throw new ApiError("input");
  const result = await db().prepare("UPDATE finger_king.rounds SET paused_at = ? WHERE id = ? AND published_at IS NOT NULL AND completed_at IS NULL AND close_at > ? RETURNING id")
    .bind(input.paused ? Date.now() : null, id, Date.now()).first<string>("id");
  if (!result) throw new ApiError("round", 404);
  return { id };
}

async function completeRound(input: Input) {
  const id = selectedId(input.id);
  const result = await db().prepare(`
    UPDATE finger_king.rounds SET completed_at = ? WHERE id = ? AND published_at IS NOT NULL AND completed_at IS NULL
    RETURNING id
  `).bind(Date.now(), id).first<string>("id");
  if (!result) throw new ApiError("round", 409, "이미 발표가 종료되었거나 발표 전인 투표입니다.");
  return { id };
}

async function listWinners(input: Input) {
  const id = selectedId(input.id);
  await loadRound(id);
  await purgeExpired();
  const data = await db().prepare(`
    SELECT id, prize, identity_box, submitted_at, shipped_at, delivery_box IS NOT NULL AS has_delivery
    FROM finger_king.winners WHERE round_id = ? ORDER BY submitted_at DESC NULLS LAST, registration_order LIMIT 1000
  `).bind(id).all<Winner & { has_delivery: number }>();
  const winners: AdminWinner[] = await Promise.all(data.results.map(async (row) => {
    const [account, nickname] = row.identity_box ? await reveal<string[]>(row.identity_box, "identity:" + row.id) : ["", ""];
    return { id: row.id, prize: row.prize, account, nickname, submittedAt: row.submitted_at, shippedAt: row.shipped_at, hasDelivery: Boolean(row.has_delivery) };
  }));
  return { winners };
}

async function importWinners(input: Input) {
  const roundId = selectedId(input.id);
  const round = await loadRound(roundId);
  if (round.published_at) throw new ApiError("locked", 409, "발표 전에 당첨자 명단을 등록해 주세요.");
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 500) {
    throw new ApiError("rows", 400, "1회에 1~500명의 당첨자를 등록할 수 있습니다.");
  }
  const rows = input.rows.map((raw, index) => {
    try {
      if (!Array.isArray(raw) || raw.length !== 3) throw new Error();
      const account = accountEmail(raw[0]);
      const nickname = clean(raw[1], 100);
      const prize = clean(raw[2], 120);
      return { account, normalized: account.toLowerCase(), nickname, prize };
    } catch {
      throw new ApiError("rows", 400, `명단 ${index + 1}번째 줄의 뮤니버스 가입 이메일, 닉네임, 경품명을 확인해 주세요.`);
    }
  });
  const currentCount = await db().prepare("SELECT COUNT(*) AS total FROM finger_king.winners WHERE round_id = ?").bind(roundId).first<number>("total");
  if ((currentCount ?? 0) + rows.length > 1_000) throw new ApiError("rows", 400, "투표별 최대 1,000명까지 등록할 수 있습니다.");
  const encoded = await Promise.all(rows.map(async (row) => {
    const id = crypto.randomUUID();
    const [accountKey, matchKey, identity] = await Promise.all([
      hash("account:" + row.normalized),
      matchingKey(row.normalized, row.nickname),
      seal([row.account, row.nickname], "identity:" + id),
    ]);
    return [id, roundId, base64(accountKey), matchKey, identity, row.prize];
  }));
  const inserts: Statement[] = [];
  for (let offset = 0; offset < encoded.length; offset += 12) {
    const group = encoded.slice(offset, offset + 12);
    const values = group.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    inserts.push(db().prepare(`
      WITH candidates (id, round_id, account_key, match_key, identity_box, prize) AS (VALUES ${values})
      INSERT INTO finger_king.winners (id, round_id, account_key, match_key, identity_box, prize)
      SELECT * FROM candidates WHERE EXISTS (
        SELECT 1 FROM finger_king.rounds WHERE id = ? AND published_at IS NULL
      ) AND (SELECT COUNT(*) FROM finger_king.winners WHERE round_id = ?) + ? <= 1000
      ON CONFLICT (round_id, account_key) DO NOTHING
    `).bind(...group.flat(), roundId, roundId, group.length));
  }
  const results = await db().batch(inserts);
  const inserted = results.reduce((total, result) => total + result.meta.changes, 0);
  if (!inserted && (await loadRound(roundId)).published_at) throw new ApiError("locked", 409, "발표가 설정되어 현재 명단을 수정할 수 없습니다.");
  return { inserted, skipped: rows.length - inserted };
}

async function removeWinner(input: Input) {
  const id = selectedId(input.id);
  const removed = await db().prepare(`
    DELETE FROM finger_king.winners WHERE id = ? AND EXISTS (SELECT 1 FROM finger_king.rounds WHERE id = winners.round_id AND published_at IS NULL)
    RETURNING id
  `).bind(id).first<string>("id");
  if (!removed) throw new ApiError("locked", 409, "삭제할 당첨자를 찾을 수 없거나 이미 발표를 설정했습니다.");
  return { id };
}

async function markShipped(input: Input) {
  const id = selectedId(input.id);
  if (typeof input.shipped !== "boolean") throw new ApiError("input");
  const now = Date.now();
  const shipped = await db().prepare(`
    UPDATE finger_king.winners SET shipped_at = ? WHERE id = ? AND submitted_at IS NOT NULL
      AND delivery_box IS NOT NULL AND EXISTS (SELECT 1 FROM finger_king.rounds WHERE id = winners.round_id AND (purge_at IS NULL OR purge_at > ?))
    RETURNING id
  `).bind(input.shipped ? now : null, id, now).first<string>("id");
  if (!shipped) throw new ApiError("expired", 409, "접수 건이 없거나 배송지 보유 기한이 지났습니다.");
  return { id };
}

async function markDelivered(input: Input) {
  const id = selectedId(input.id);
  const delivered = await db().prepare(`
    UPDATE finger_king.winners
    SET delivery_box = NULL, identity_box = NULL, account_key = id, match_key = id
    WHERE id = ? AND shipped_at IS NOT NULL AND delivery_box IS NOT NULL
    RETURNING id
  `).bind(id).first<string>("id");
  if (!delivered) throw new ApiError("expired", 409, "파기할 배송 정보가 없습니다.");
  return { id };
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const guarded = /^[\s\ufeff]*[=+\-@]/u.test(text) ? "'" + text : text;
  return '"' + guarded.replaceAll('"', '""') + '"';
}

function csv(rows: unknown[][]) {
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

async function exportCodes(input: Input) {
  const id = selectedId(input.id);
  await loadRound(id);
  await purgeExpired();
  const data = await db().prepare(`
    SELECT id, prize, identity_box FROM finger_king.winners
    WHERE round_id = ? AND identity_box IS NOT NULL AND submitted_at IS NULL ORDER BY registration_order
  `).bind(id).all<Winner>();
  const rows = await Promise.all(data.results.map(async (row) => {
    const [identity, code] = await Promise.all([reveal<string[]>(row.identity_box!, "identity:" + row.id), shippingCode(row.id)]);
    return [...identity, row.prize, code.match(/.{4}/g)!.join("-")];
  }));
  return { csv: csv([["뮤니버스 가입 이메일", "닉네임", "경품명", "배송 접수 확인 코드"], ...rows]) };
}

async function exportDelivery(input: Input) {
  const id = selectedId(input.id);
  const now = Date.now();
  const round = await loadRound(id);
  await purgeExpired(now);
  if (round.purge_at !== null && round.purge_at <= now) throw new ApiError("expired", 409, "배송지 보유 기한이 지났습니다.");
  const data = await db().prepare(`
    SELECT id, prize, delivery_box, submitted_at, shipped_at FROM finger_king.winners
    WHERE round_id = ? AND delivery_box IS NOT NULL AND (? = 0 OR shipped_at IS NULL)
    ORDER BY submitted_at
  `).bind(id, input.waiting === true ? 1 : 0).all<Winner>();
  const rows = await Promise.all(data.results.map(async (row) => {
    const d = await reveal<Delivery>(row.delivery_box!, "delivery:" + row.id);
    return [receiptRef(row.id), row.prize, d.recipient, d.phone, d.country, d.postal, d.region, d.city, d.address1, d.address2,
      formatKst(row.submitted_at!), row.shipped_at ? formatKst(row.shipped_at) : "", d.clearanceCode, d.ezWayConfirmed ? "확인" : ""];
  }));
  return { csv: csv([["접수번호", "경품명", "수령인", "연락처", "국가코드", "우편번호", "주·도", "도시", "기본주소", "상세주소", "접수 시각", "발송 시각", "개인통관고유부호", "EZ WAY 준비 확인"], ...rows]) };
}

const adminActions: Record<string, (input: Input) => Promise<unknown>> = Object.freeze(Object.assign(Object.create(null), {
  "admin-rounds": listRounds,
  "admin-save": saveRound,
  "admin-publish": publishRound,
  "admin-pause": pauseRound,
  "admin-complete": completeRound,
  "admin-winners": listWinners,
  "admin-import": importWinners,
  "admin-remove": removeWinner,
  "admin-ship": markShipped,
  "admin-delivered": markDelivered,
  "admin-codes": exportCodes,
  "admin-export": exportDelivery,
}));
return { readInput, releaseState, lookup, submit, adminActions };
}
