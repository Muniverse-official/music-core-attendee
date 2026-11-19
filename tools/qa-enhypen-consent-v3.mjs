// Synthetic, in-memory consent migration check. No production connection or user records.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const oldVersion = '2026-11-13-v2';
const newVersion = '2026-11-19-v3';
const oldAgreedAt = '2026-11-18T00:00:00.000Z';
const unsealSynthetic = box => JSON.parse(Buffer.from(box.slice('pii:v1:'.length),'base64').toString());
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema attendee_privacy;
    create table public.enhypen_announcement (
      id boolean primary key, is_open boolean not null,
      start_at timestamptz, end_at timestamptz not null
    );
    insert into public.enhypen_announcement values
      (true,true,now()-interval '1 day',now()+interval '1 day');
    create table public.enhypen_winner_list (
      id uuid primary key, identity_hash text unique, selection text,
      consent_deadline timestamptz
    );
    insert into public.enhypen_winner_list values
      ('11111111-1111-4111-8111-111111111111','synthetic-hash','primary',now()+interval '1 day'),
      ('22222222-2222-4222-8222-222222222222','synthetic-direct','primary',now()+interval '1 day');
    create table public.enhypen_winner_consent (
      winner_id uuid primary key references public.enhypen_winner_list(id) on delete cascade,
      legal_name text, phone text, birth_date date, contact_email text,
      nationality text, phone_mode text, x_account text, language text,
      notice_version text not null, pii_box text not null, agreed_at timestamptz not null default now(),
      constraint enhypen_consent_version check (notice_version in ('2026-11-13-v1','2026-11-13-v2')),
      constraint enhypen_winner_consent_encrypted_storage
        check (legal_name is null and phone is null and birth_date is null and contact_email is null
          and nationality is null and phone_mode is null and x_account is null and pii_box like 'pii:v1:%')
    );
    -- The synthetic cipher is reversible only in this local in-memory test.
    create function attendee_privacy.seal(value jsonb,context text) returns text
      language sql as $$select 'pii:v1:'||encode(convert_to(value::text,'UTF8'),'base64')$$;
  `);
  const folder = new URL('../supabase/migrations/',import.meta.url);
  const oldEncryption = await readFile(new URL('20261116112132_encrypt_attendee_personal_data.sql',folder),'utf8');
  const oldTriggerFunction = oldEncryption.match(/create or replace function attendee_privacy\.encrypt_row\(\)[\s\S]*?end \$\$;/i);
  assert(oldTriggerFunction,'the original encryption trigger is present');
  await db.exec(oldTriggerFunction[0]);
  await db.exec(`
    create trigger zz_encrypt_personal_data before insert or update
      on public.enhypen_winner_consent for each row
      execute function attendee_privacy.encrypt_row(
        '["legal_name","phone","birth_date","contact_email","nationality","phone_mode","x_account"]');
    insert into public.enhypen_winner_consent
      (winner_id,legal_name,phone,birth_date,contact_email,nationality,phone_mode,x_account,language,notice_version,agreed_at)
    values ('11111111-1111-4111-8111-111111111111','Original Winner','01011112222',date '1999-05-10',
            'old@example.invalid','KR','KR','@oldhandle','ko','2026-11-13-v2',
            timestamptz '2026-11-18T00:00:00Z');
  `);
  const oldRow = (await db.query('select * from public.enhypen_winner_consent')).rows[0];
  assert.equal(oldRow.birth_date,null,'the old consent was encrypted before migration');
  assert.equal(unsealSynthetic(oldRow.pii_box).birth_date,'1999-05-10');

  const matches = (await readdir(folder)).filter(name=>name.endsWith('_enhypen_weverse_birthdate_consent.sql'));
  assert.equal(matches.length,1);
  await db.exec(await readFile(new URL(matches[0],folder),'utf8'));
  const oldHistory = (await db.query('select * from public.enhypen_winner_consent_history')).rows[0];
  assert.equal(oldHistory.notice_version,oldVersion);
  assert.equal(oldHistory.agreed_at.toISOString(),oldAgreedAt,'migration preserved the original consent time');

  const fields = {name:'Updated Winner',phone:'01012345678',birthDate:'2000-01-01',
    contactEmail:'new@example.invalid',nationality:'KR',phoneMode:'KR',xAccount:'@newhandle'};
  const consent = (version,payload=fields) => db.query(
    "select public.enhypen_record_consent_v2('synthetic-hash',$1::jsonb,'ko',$2) as result",
    [JSON.stringify(payload),version],
  );
  await assert.rejects(consent(newVersion,{...fields,birthDate:null}),/INVALID_FIELDS/);
  assert.equal((await consent(newVersion)).rows[0].result.agreed,true);
  const record = (await db.query('select * from public.enhypen_winner_consent')).rows.find(row=>row.winner_id==='11111111-1111-4111-8111-111111111111');
  assert.equal(record.notice_version,newVersion);
  assert.equal(record.birth_date,null,'the updated consent remains encrypted');
  assert.equal(record.legal_name,null);
  assert.deepEqual(unsealSynthetic(record.pii_box),{
    legal_name:'Updated Winner',phone:'01012345678',birth_date:'2000-01-01',
    contact_email:'new@example.invalid',nationality:'KR',phone_mode:'KR',x_account:'@newhandle',
  });
  const history = (await db.query(
    'select notice_version,agreed_at from public.enhypen_winner_consent_history order by agreed_at',
  )).rows;
  assert.deepEqual(history.map(row=>row.notice_version),[oldVersion,newVersion]);
  assert.equal(history[0].agreed_at.toISOString(),oldAgreedAt);
  assert.equal(history[1].agreed_at.toISOString(),record.agreed_at.toISOString());
  await assert.rejects(consent(oldVersion),/INVALID_FIELDS/,'old Edge cannot downgrade v3 consent');
  assert.equal((await db.query('select notice_version from public.enhypen_winner_consent')).rows[0].notice_version,newVersion);
  assert.equal((await db.query('select count(*)::integer as n from public.enhypen_winner_consent_history')).rows[0].n,2);
  await assert.rejects(consent('unrecognized'),/INVALID_FIELDS/);

  await assert.rejects(db.query(`
    insert into public.enhypen_winner_consent
      (winner_id,legal_name,phone,language,notice_version)
    values ('22222222-2222-4222-8222-222222222222','Invalid','01012345678','ko','2026-11-19-v3')
  `),/INVALID_REGISTRATION/);
  await db.exec(`
    insert into public.enhypen_winner_consent
      (winner_id,legal_name,phone,birth_date,contact_email,nationality,phone_mode,x_account,language,notice_version)
    values ('22222222-2222-4222-8222-222222222222','Valid','01012345678',date '2000-01-01',
            'synthetic@example.invalid','KR','KR','@synthetic','ko','2026-11-19-v3');
  `);
  const direct = (await db.query(
    "select birth_date,pii_box from public.enhypen_winner_consent where winner_id='22222222-2222-4222-8222-222222222222'",
  )).rows[0];
  assert.equal(direct.birth_date,null);
  assert.equal(unsealSynthetic(direct.pii_box).birth_date,'2000-01-01');
  await db.exec("delete from public.enhypen_winner_list where id='22222222-2222-4222-8222-222222222222'");
  assert.equal((await db.query('select count(*)::integer as n from public.enhypen_winner_consent_history')).rows[0].n,2,
    'winner deletion also removes its consent history');
  console.log('PASS ENHYPEN encrypted v2 to v3 reconsent, history, and downgrade guard');
} finally {
  await db.close();
}
