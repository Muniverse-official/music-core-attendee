import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.attendee_rounds (
      id uuid primary key, program text, title text, config jsonb,
      is_public boolean, archived boolean, created_at timestamptz
    );
    create table public.music_core_winners (
      id uuid primary key, round_id uuid, selection_type text,
      event_date date, submitted boolean, submitted_at timestamptz,
      created_at timestamptz
    );
    create table public.cover_pick_winners
      (like public.music_core_winners including all);
    create table public.music_core_winner_directory (
      winner_id uuid, email text, nickname text, pii_box text
    );
    create table public.cover_pick_winner_directory
      (like public.music_core_winner_directory including all);
    create table public.music_core_attendees (
      id uuid, winner_id uuid, pii_box text, name text, birth_date date,
      nationality text, phone text, x_account text, contact_email text,
      account_email text, muniverse_nickname text, consented_at timestamptz
    );
    create table public.cover_pick_attendees
      (like public.music_core_attendees including all);
  `);
  const m = '00000000-0000-4000-8000-000000000001';
  const old = '00000000-0000-4000-8000-000000000002';
  const f = '00000000-0000-4000-8000-000000000003';
  const primary = '10000000-0000-4000-8000-000000000001';
  const reserve = '10000000-0000-4000-8000-000000000002';
  const earlier = '10000000-0000-4000-8000-000000000003';
  const fan = '10000000-0000-4000-8000-000000000004';
  await db.exec(`
    insert into public.attendee_rounds values
      ('${m}','music_core','971회차','{}',true,false,'2026-11-18'),
      ('${old}','music_core','970회차','{}',false,false,'2026-11-11'),
      ('${f}','fans_pick','1회차','{}',true,false,'2026-11-10');
    insert into public.music_core_winners values
      ('${primary}','${m}','primary','2026-11-21',true,'2026-11-18','2026-11-18'),
      ('${reserve}','${m}','reserve','2026-11-21',false,null,'2026-11-18'),
      ('${earlier}','${old}','primary','2026-11-14',false,null,'2026-11-11');
    insert into public.cover_pick_winners values
      ('${fan}','${f}','primary','2026-11-21',false,null,'2026-11-10');
    insert into public.music_core_winner_directory values
      ('${primary}',null,null,'encrypted-active'),
      ('${reserve}',null,null,'encrypted-reserve'),
      ('${earlier}',null,null,'encrypted-old');
    insert into public.cover_pick_winner_directory values
      ('${fan}',null,null,'encrypted-fans');
    insert into public.music_core_attendees(id,winner_id,pii_box)
      values ('20000000-0000-4000-8000-000000000001','${primary}','encrypted-registration');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261118090000_admin_scoped_round_data.sql', import.meta.url), 'utf8'));

  const query = async (program, roundId, include) =>
    (await db.query('select public.attendee_round_data_scoped($1,$2,$3) as value', [program, roundId, include])).rows[0].value;
  const active = await query('music_core', null, true);
  assert.equal(active.loaded_round_id, m);
  assert.deepEqual(active.winners.map(w => w.id).sort(), [primary, reserve].sort());
  assert.equal(active.rounds.length, 2);
  assert.equal(active.rounds.find(r => r.id === m).primary_count, 1);
  assert.equal(active.rounds.find(r => r.id === m).reserve_count, 1);
  assert.equal(active.rounds.find(r => r.id === m).registered_count, 1);
  assert.equal(active.rounds.find(r => r.id === old).primary_count, 1);

  const metadataOnly = await query('fans_pick', null, false);
  assert.equal(metadataOnly.loaded_round_id, null);
  assert.deepEqual(metadataOnly.winners, []);
  assert.equal(metadataOnly.rounds[0].primary_count, 1);
  const previous = await query('music_core', old, true);
  assert.deepEqual(previous.winners.map(w => w.id), [earlier]);
  await assert.rejects(query('fans_pick', m, true), /ROUND_NOT_FOUND/);
  assert.equal((await db.query(`select has_function_privilege('anon','public.attendee_round_data_scoped(text,uuid,boolean)','execute') as allowed`)).rows[0].allowed, false);
  console.log('PASS scoped admin: active round, historical round, metadata counts, data isolation, role permissions');

  let handler;
  const requests = [];
  const source = (await readFile(new URL('../supabase/functions/attendee-admin/index.ts', import.meta.url), 'utf8'))
    .replace("import { revealRows } from '../_shared/privacy.ts';\n", '');
  vm.runInNewContext(stripTypeScriptTypes(source, { mode: 'transform' }), {
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://mock.invalid' : 'test-key' }, serve: fn => { handler = fn; } },
    revealRows: async value => value,
    crypto, Date, URL, Headers, Request, Response, AbortSignal, TextEncoder, Uint8Array, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      const body = init?.body ? JSON.parse(init.body) : null;
      requests.push({ path, body });
      let value;
      if (path.endsWith('/attendee_console_sessions')) value = [{ token_hash: 'a'.repeat(64), username: 'qa', created_at: '2026-11-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }];
      else if (path.endsWith('/attendee_console_accounts')) value = [{ active: true, updated_at: '2026-01-01T00:00:00Z' }];
      else if (path.endsWith('/rpc/attendee_console_throttle')) value = true;
      else if (path.endsWith('/attendee_console_audit')) value = body ? null : [];
      else if (path.endsWith('/rpc/attendee_round_data_scoped')) {
        const selected = body.p_include_winners;
        value = { active_round_id: body.p_program === 'music_core' ? m : f,
          loaded_round_id: selected ? body.p_round_id || (body.p_program === 'music_core' ? m : f) : null,
          config: {}, rounds: [{ id: body.p_program === 'music_core' ? m : f, primary_count: 1, reserve_count: 0, registered_count: 0 }],
          winners: selected ? [{ id: primary }] : [] };
      } else throw Error(`Unexpected backend request: ${path}`);
      return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    }
  });
  const request = new Request('https://mock.invalid/functions/v1/attendee-admin', {
    method: 'POST', headers: { origin: 'https://muniverse-official.github.io', authorization: `Bearer ${'a'.repeat(64)}`,
      'content-type': 'application/json', 'x-admin-request': '1' },
    body: JSON.stringify({ action: 'get_scoped', program: 'music_core' })
  });
  const response = await handler(request);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.music_core.winners.map(w => w.id), [primary]);
  assert.deepEqual(payload.fans_pick.winners, []);
  assert.equal(payload.music_core.loaded_round_id, m);
  assert.equal(requests.filter(r => r.path.endsWith('/rpc/attendee_round_data_scoped')).length, 2);
  assert.equal(requests.some(r => r.path.endsWith('/rpc/attendee_round_data')), false);
  assert.equal(requests.some(r => r.path.endsWith('/rpc/attendee_delivery_console')), false);
  console.log('PASS scoped edge: authenticated request loads one round without legacy full-data RPC');
} finally {
  await db.close();
}
