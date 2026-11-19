// Synthetic, in-memory database check. No production connection or user records.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`
    create table public.enhypen_announcement (
      id boolean primary key, is_open boolean not null,
      start_at timestamptz, end_at timestamptz not null
    );
    insert into public.enhypen_announcement values (true, false, null, '2026-11-26 00:00+09');
    create table public.enhypen_winner_list (
      id uuid primary key default gen_random_uuid(),
      email text not null, nickname text not null, identity_hash text not null unique,
      selection text not null check (selection in ('primary','reserve','withdrawn')),
      winner_number text unique, consent_deadline timestamptz default now() + interval '2 days'
    );
    insert into public.enhypen_winner_list(email,nickname,identity_hash,selection,winner_number)
      select 'fan' || n || '@example.invalid', 'Fan ' || n, 'synthetic-hash-' || n,
             'primary', 'M' || n
      from generate_series(1,50) n;
  `);

  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  const matches = (await readdir(migrationDir)).filter(name => name.endsWith('_enhypen_remove_primary_winner_cap.sql'));
  assert.equal(matches.length,1,'exactly one primary-cap migration is present');
  const migration = await readFile(new URL(matches[0], migrationDir), 'utf8');
  await db.exec(migration);

  const importRows = (selection, rows) => db.query(
    "select public.enhypen_winner_manage('import', $1::jsonb) as result",
    [JSON.stringify({selection,rows})],
  );
  const count = async selection => Number((await db.query(
    'select count(*)::integer as n from public.enhypen_winner_list where selection=$1',[selection],
  )).rows[0].n);

  await importRows('primary', [{email:'fan51@example.invalid',nickname:'Fan 51',hash:'synthetic-hash-51',number:'M51'}]);
  assert.equal(await count('primary'),51,'the 51st primary winner is accepted');

  const reserveId='11111111-1111-4111-8111-111111111111';
  await db.query(`insert into public.enhypen_winner_list
    (id,email,nickname,identity_hash,selection)
    values ($1,'reserve@example.invalid','Reserve','synthetic-reserve','reserve')`,[reserveId]);
  await db.query("select public.enhypen_winner_manage('promote', $1::jsonb)",
    [JSON.stringify({id:reserveId,number:'M52'})]);
  assert.equal(await count('primary'),52,'reserve promotion works beyond 50 primary winners');

  const reserveRows = Array.from({length:30},(_,i)=>({
    email:`reserve${i}@example.invalid`,nickname:`Reserve ${i}`,hash:`synthetic-reserve-${i}`,number:null,
  }));
  await importRows('reserve',reserveRows);
  assert.equal(await count('reserve'),30);
  await assert.rejects(importRows('reserve',[{
    email:'reserve-extra@example.invalid',nickname:'Reserve Extra',hash:'synthetic-reserve-extra',number:null,
  }]),/CAPACITY/);
  assert.equal(await count('reserve'),30,'the 31st reserve winner is rejected');
  console.log('PASS ENHYPEN primary list exceeds 50; reserve remains capped at 30');
} finally {
  await db.close();
}
