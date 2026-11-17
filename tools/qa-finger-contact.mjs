// In-memory Postgres and synthetic data only; never connects to production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const db = new PGlite();
const secret = crypto.randomUUID() + crypto.randomUUID();
await db.exec(`create role anon; create role authenticated;
  create table public.attendee_console_accounts (username text primary key, active boolean, updated_at timestamptz);
  create table public.attendee_console_sessions (token_hash text primary key, username text, expires_at timestamptz, created_at timestamptz);`);
await db.exec(await readFile(new URL('supabase/migrations/20261116000401_finger_king_operations.sql', root), 'utf8'));
const adminToken = 'a'.repeat(64);
const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(adminToken))).toString('hex');
await db.query("insert into public.attendee_console_accounts values ('local-qa',true,now()-interval '1 hour')");
await db.query("insert into public.attendee_console_sessions values ($1,'local-qa',now()+interval '1 hour',now())", [digest]);
const connection = {
  async unsafe(query, args) {
    const result = await db.query(query, args);
    return Object.assign(result.rows, { count: result.affectedRows });
  },
  async begin(callback) {
    await db.exec('begin');
    try { const result = await callback(connection); await db.exec('commit'); return result; }
    catch (error) { await db.exec('rollback'); throw error; }
  },
};
globalThis.fingerTestDatabase = () => connection;
globalThis.fingerTestKeyset = async () => ({ fingerSecret: secret });
let handler;
globalThis.Deno = { env: { get: () => 'local-test-only' }, serve: fn => { handler = fn; } };
const source = (await readFile(new URL('supabase/functions/finger-king/index.ts', root), 'utf8'))
  .replace("import { keyset } from '../_shared/privacy.ts';", 'const keyset = globalThis.fingerTestKeyset;')
  .replace('import postgres from "npm:postgres@3.4.7";', 'const postgres = globalThis.fingerTestDatabase;')
  .replace('"./service.ts"', JSON.stringify(new URL('supabase/functions/finger-king/service.ts', root).href));
await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64'));
let requests = 0;
async function call(action, input = {}, expected = 200, authenticated = action.startsWith('admin-')) {
  const headers = { origin: 'https://muniverse-official.github.io', 'content-type': 'application/json', 'x-real-ip': '192.0.2.' + ++requests,
    ...(authenticated ? { authorization: 'Bearer ' + adminToken } : {}) };
  const request = new Request('https://local.invalid/?action=' + action,
    action === 'status' ? { headers } : { method: 'POST', headers, body: JSON.stringify(input) });
  const response = await handler(request), body = await response.json();
  assert.equal(response.status, expected, action + ': ' + JSON.stringify(body));
  return body;
}
const encoder = new TextEncoder();
const aes = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode('ifk-aes-v1:' + secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function plaintext(row) {
  const [iv, ciphertext] = row.delivery_box.split('.').map(s => Buffer.from(s, 'base64url'));
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('delivery:' + row.id) }, aes, ciphertext)));
}
try {
  await call('admin-export', {}, 403, false);
  await call('admin-winners', {}, 403, false);
  const kst = offset => new Date(Date.now() + 32400000 + offset).toISOString().slice(0, 16);
  const { id } = await call('admin-save', { title: 'Contact fields QA', announce: kst(-240000), close: kst(3600000) });
  const roster = ['blank', 'with-x', 'no-at', 'legacy', 'unsubmitted'].map(name => [name + '@example.invalid', name, 'Synthetic prize']);
  await call('admin-import', { id, rows: roster });
  await call('admin-publish', { id });
  const tokens = {};
  for (const [account, nickname] of roster) {
    const { result } = await call('lookup', { groupId: id, account, nickname });
    tokens[nickname] = result.token;
    assert(!('contactEmail' in result) && !('xAccount' in result));
  }
  const fields = { consent: true, recipient: 'Contact QA', phone: '010-1234-5678', country: 'KR', postal: '04524', address1: 'Synthetic address' };
  for (const value of [undefined, '', 'missing-at', 'person@', 'person@example', 'line\nbreak@example.invalid']) {
    assert.equal((await call('submit', { ...fields, token: tokens.blank, contactEmail: value }, 400)).error, 'contact_email');
  }
  for (const value of ['@', 'bad handle', '@toolongusername16', 'https://x.com/test', '한글', 123]) {
    assert.equal((await call('submit', { ...fields, token: tokens.blank, contactEmail: 'contact@example.invalid', xAccount: value }, 400)).error, 'x_account');
  }
  assert.equal((await db.query('select count(*)::int n from finger_king.winners where delivery_box is not null')).rows[0].n, 0);
  await call('submit', { ...fields, token: tokens.blank, contactEmail: ' contact@example.invalid ' });
  await call('submit', { ...fields, token: tokens['with-x'], contactEmail: 'with-x-contact@example.invalid', xAccount: '@qa_contact' });
  await call('submit', { ...fields, token: tokens['no-at'], contactEmail: 'no-at-contact@example.invalid', xAccount: 'qa_no_at' });
  await call('submit', { ...fields, token: tokens.legacy, contactEmail: 'legacy-contact@example.invalid', xAccount: '   ' });
  assert.equal((await call('submit', { ...fields, token: tokens.blank, contactEmail: 'contact@example.invalid' }, 409)).error, 'duplicate');
  const saved = (await db.query('select id, delivery_box from finger_king.winners where delivery_box is not null order by registration_order')).rows;
  const decoded = await Promise.all(saved.map(plaintext));
  assert.equal(decoded[0].contactEmail, 'contact@example.invalid');
  assert.equal(decoded[0].xAccount, '');
  assert.equal(decoded[1].xAccount, '@qa_contact');
  assert.equal(decoded[2].xAccount, '@qa_no_at');
  assert.equal(decoded[3].xAccount, '');
  assert(decoded.every(value => value.consentVersion === 3));
  assert(saved.every(row => !row.delivery_box.includes('contact@example.invalid') && !row.delivery_box.includes('@qa_contact')));
  let winners = (await call('admin-winners', { id })).winners;
  assert.equal(winners.find(row => row.nickname === 'blank').contactEmail, 'contact@example.invalid');
  assert.equal(winners.find(row => row.nickname === 'with-x').xAccount, '@qa_contact');
  const csv = (await call('admin-export', { id })).csv;
  assert(!csv.includes('발송 시각'));
  assert(csv.includes('"연락 가능한 이메일","X(트위터) 계정"'));
  assert(csv.includes('"contact@example.invalid",""'));
  assert(csv.includes('"with-x-contact@example.invalid","\'@qa_contact"'));
  // Existing v2 submissions must still be readable without invented contact data.
  const old = { ...decoded[3], consentVersion: 2 };
  delete old.contactEmail; delete old.xAccount;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('delivery:' + saved[3].id) }, aes, encoder.encode(JSON.stringify(old)));
  await db.query('update finger_king.winners set delivery_box=$1 where id=$2', [Buffer.from(iv).toString('base64url') + '.' + Buffer.from(ciphertext).toString('base64url'), saved[3].id]);
  winners = (await call('admin-winners', { id })).winners;
  assert.equal(winners.find(row => row.nickname === 'legacy').contactEmail, '');
  assert.equal(winners.find(row => row.nickname === 'legacy').xAccount, '');
  await call('admin-export', { id });
  await call('admin-ship', { id: saved[1].id, shipped: true }, 404);
  await call('admin-delivered', { id: saved[1].id }, 404);
  await call('admin-delete-personal-data', { id: saved[1].id, confirm: true }, 403, false);
  assert.equal((await call('admin-delete-personal-data', { id: saved[1].id }, 400)).error, 'confirm');
  assert((await call('admin-winners', { id })).winners.find(row => row.id === saved[1].id).hasPersonalData);
  await call('admin-delete-personal-data', { id: saved[1].id, confirm: true });
  await call('admin-delete-personal-data', { id: saved[1].id, confirm: true }, 409);
  assert(!(await call('admin-export', { id })).csv.includes('with-x-contact@example.invalid'));
  const purged = (await call('admin-winners', { id })).winners.find(row => row.id === saved[1].id);
  assert.equal(purged.contactEmail, ''); assert.equal(purged.xAccount, '');
  assert.equal(purged.account, ''); assert.equal(purged.nickname, '');
  assert.equal(purged.hasPersonalData, false); assert.equal(purged.hasDelivery, false);
  const other = (await call('admin-winners', { id })).winners.find(row => row.nickname === 'blank');
  assert.equal(other.contactEmail, 'contact@example.invalid');
  const pending = (await call('admin-winners', { id })).winners.find(row => row.nickname === 'unsubmitted');
  await call('admin-delete-personal-data', { id: pending.id, confirm: true });
  assert.equal((await call('lookup', { groupId: id, account: 'unsubmitted@example.invalid', nickname: 'unsubmitted' })).result, null);
  assert.equal((await call('submit', { ...fields, token: tokens.unsubmitted, contactEmail: 'blocked@example.invalid' }, 409)).error, 'closed');
  const pendingRecord = (await db.query('select identity_box, delivery_box, account_key, match_key from finger_king.winners where id=$1', [pending.id])).rows[0];
  assert.equal(pendingRecord.identity_box, null); assert.equal(pendingRecord.delivery_box, null);
  assert.equal(pendingRecord.account_key, pending.id); assert.equal(pendingRecord.match_key, pending.id);
  await db.query('delete from public.attendee_console_sessions where token_hash=$1', [digest]);
  await call('admin-winners', { id }, 403);
  await call('admin-delete-personal-data', { id: saved[0].id, confirm: true }, 403);
  console.log('PASS contact validation/encryption, CSV, legacy records, explicit scoped deletion, retired shipping actions, stale claim rejection and authorization');
} finally {
  await db.close();
  delete globalThis.fingerTestDatabase;
  delete globalThis.fingerTestKeyset;
  delete globalThis.Deno;
}
