-- A new disclosure version includes birth date in the data sent to Weverse.
-- Keep v2 records distinct: only v3 consent is eligible for the new export.
alter table public.enhypen_winner_consent drop constraint enhypen_consent_version;
alter table public.enhypen_winner_consent add constraint enhypen_consent_version
  check (notice_version in ('2026-11-13-v1','2026-11-13-v2','2026-11-19-v3'));

-- The current consent row can move to a new notice version. Keep the original
-- notice and agreement time without duplicating any personal information.
create table public.enhypen_winner_consent_history (
  winner_id uuid not null references public.enhypen_winner_list(id) on delete cascade,
  notice_version text not null,
  agreed_at timestamptz not null,
  primary key (winner_id,notice_version)
);
alter table public.enhypen_winner_consent_history enable row level security;
revoke all on public.enhypen_winner_consent_history from public,anon,authenticated;
grant select on public.enhypen_winner_consent_history to service_role;

insert into public.enhypen_winner_consent_history (winner_id,notice_version,agreed_at)
select winner_id,notice_version,agreed_at from public.enhypen_winner_consent;

create function attendee_privacy.record_enhypen_consent_history()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  insert into public.enhypen_winner_consent_history (winner_id,notice_version,agreed_at)
  values (new.winner_id,new.notice_version,new.agreed_at)
  on conflict (winner_id,notice_version) do nothing;
  return new;
end;
$function$;
revoke all on function attendee_privacy.record_enhypen_consent_history()
  from public,anon,authenticated,service_role;
create trigger zzz_record_enhypen_consent_history
  after insert or update on public.enhypen_winner_consent
  for each row execute function attendee_privacy.record_enhypen_consent_history();

create or replace function public.enhypen_record_consent_v2(
  p_hash text, p_fields jsonb, p_language text, p_version text
)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare
  winner public.enhypen_winner_list;
  announcement public.enhypen_announcement;
begin
  select * into announcement from public.enhypen_announcement where id for share;
  if not found or not announcement.is_open
     or (announcement.start_at is not null and clock_timestamp() < announcement.start_at)
     or clock_timestamp() >= announcement.end_at
  then raise exception 'ANNOUNCEMENT_CLOSED'; end if;
  select * into winner from public.enhypen_winner_list
    where identity_hash=p_hash and selection in ('primary','reserve') for share;
  if not found then raise exception 'WINNER_MISSING'; end if;
  if p_version not in ('2026-11-13-v2','2026-11-19-v3') then raise exception 'INVALID_FIELDS'; end if;
  if exists (select 1 from public.enhypen_winner_consent
             where winner_id=winner.id and notice_version=p_version)
  then return jsonb_build_object('agreed',true); end if;
  if now() >= winner.consent_deadline then raise exception 'CONSENT_DEADLINE'; end if;
  if not coalesce(
       (p_fields->>'birthDate')::date <= date '2026-11-25'
       and p_fields->>'contactEmail' is not null
       and p_fields->>'nationality' ~ '^[A-Z]{2}$'
       and p_fields->>'phoneMode' in ('KR','INTL')
       and p_fields->>'xAccount' ~ '^@[A-Za-z0-9_]{1,15}$',
       false
     ) then raise exception 'INVALID_FIELDS'; end if;
  insert into public.enhypen_winner_consent as c
    (winner_id,legal_name,phone,birth_date,contact_email,nationality,phone_mode,x_account,language,notice_version)
  values
    (winner.id,p_fields->>'name',p_fields->>'phone',(p_fields->>'birthDate')::date,
     p_fields->>'contactEmail',p_fields->>'nationality',p_fields->>'phoneMode',
     p_fields->>'xAccount',p_language,p_version)
  on conflict(winner_id) do update
    set legal_name=excluded.legal_name,phone=excluded.phone,birth_date=excluded.birth_date,
        contact_email=excluded.contact_email,nationality=excluded.nationality,
        phone_mode=excluded.phone_mode,x_account=excluded.x_account,
        pii_box=excluded.pii_box,language=excluded.language,
        notice_version=excluded.notice_version,agreed_at=now()
    where (c.notice_version='2026-11-13-v1'
           and excluded.notice_version in ('2026-11-13-v2','2026-11-19-v3'))
       or (c.notice_version='2026-11-13-v2'
           and excluded.notice_version='2026-11-19-v3');
  if not found then
    -- Another request may have just recorded the same version. A lower notice
    -- must not replace a higher one, even if an old Edge deployment calls here.
    if exists (select 1 from public.enhypen_winner_consent
               where winner_id=winner.id and notice_version=p_version)
    then return jsonb_build_object('agreed',true); end if;
    raise exception 'INVALID_FIELDS';
  end if;
  return jsonb_build_object('agreed',true);
end;
$function$;

-- The existing encryption trigger validates v2 registration fields. Apply the
-- same checks to the new version before sealing personal data.
create or replace function attendee_privacy.encrypt_row()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare j jsonb=to_jsonb(new); pii jsonb='{}'; cleared jsonb='{}'; k text; any_plain boolean=false; ctx text;
begin
 for k in select jsonb_array_elements_text(TG_ARGV[0]::jsonb) loop
   pii=pii||jsonb_build_object(k,j->k); cleared=cleared||jsonb_build_object(k,null);
   any_plain=any_plain or (j->k is not null and j->k<>'null'::jsonb);
 end loop;
 if any_plain then
   if TG_TABLE_NAME like '%winner_directory' or TG_TABLE_NAME='enhypen_winner_list' then
     if j->>'email' is null or j->>'nickname' is null then raise exception 'INVALID_IDENTITY'; end if;
   elsif TG_TABLE_NAME in ('music_core_attendees','cover_pick_attendees') then
     if j->>'name' is null or j->>'nationality' is null or j->>'birth_date' is null or j->>'phone' is null or j->>'contact_email' is null or j->>'account_email' is null or j->>'muniverse_nickname' is null then raise exception 'INVALID_REGISTRATION'; end if;
     if TG_TABLE_NAME='cover_pick_attendees' and not (length(j->>'name') between 1 and 100 and length(j->>'nationality')=2 and length(j->>'phone') between 8 and 40 and length(j->>'contact_email') between 3 and 254 and length(j->>'account_email') between 3 and 254 and length(j->>'muniverse_nickname') between 1 and 80) then raise exception 'INVALID_REGISTRATION'; end if;
     if j->>'x_account' is not null and j->>'x_account' !~ '^@[A-Za-z0-9_]{1,15}$' then raise exception 'INVALID_X_ACCOUNT'; end if;
   elsif TG_TABLE_NAME='enhypen_winner_consent' then
     if j->>'legal_name' is null or j->>'phone' is null then raise exception 'INVALID_REGISTRATION'; end if;
     if j->>'notice_version' in ('2026-11-13-v2','2026-11-19-v3') and not coalesce((j->>'birth_date')::date<=date '2026-11-25' and j->>'contact_email' is not null and j->>'nationality' ~ '^[A-Z]{2}$' and j->>'phone_mode' in ('KR','INTL') and j->>'x_account' ~ '^@[A-Za-z0-9_]{1,15}$',false) then raise exception 'INVALID_REGISTRATION'; end if;
   end if;
   ctx=TG_TABLE_NAME||':'||coalesce(j->>'winner_id',j->>'id');
   new=jsonb_populate_record(new,cleared||jsonb_build_object('pii_box',attendee_privacy.seal(pii,ctx)));
 end if;
 return new;
end $function$;

-- CREATE OR REPLACE preserves existing EXECUTE permissions: the consent RPC
-- remains service_role-only and the trigger helper remains inaccessible.
