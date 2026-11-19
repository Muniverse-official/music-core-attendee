-- Keep the existing published state and the former November 26 show cutoff.
-- The published switch and the time window must both allow public access.
alter table public.enhypen_announcement
  add column start_at timestamptz,
  add column end_at timestamptz not null default '2026-11-26 00:00:00+09:00'::timestamptz,
  add constraint enhypen_announcement_window_check
    check (start_at is null or start_at < end_at);

create or replace function public.enhypen_winner_manage(p_action text, p_data jsonb)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare
  target public.enhypen_winner_list;
  item jsonb;
  kind text;
  total integer;
  allowed integer;
  added integer := 0;
  is_open boolean;
  scheduled_start timestamptz;
  scheduled_end timestamptz;
begin
  -- This lock serializes schedule and visibility changes with consent reads.
  select a.is_open into is_open from public.enhypen_announcement a where a.id for update;
  if p_action = 'visibility' then
    if (p_data->>'open')::boolean and not exists (select 1 from public.enhypen_winner_list where selection = 'primary') then
      raise exception 'NO_PRIMARY';
    end if;
    update public.enhypen_announcement set is_open = (p_data->>'open')::boolean where id;
  elsif p_action = 'schedule' then
    if jsonb_typeof(p_data->'startAt') is distinct from 'string'
       or jsonb_typeof(p_data->'endAt') is distinct from 'string'
       or (p_data->>'startAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:00[+]09:00$'
       or (p_data->>'endAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:00[+]09:00$'
    then
      raise exception 'INVALID_WINDOW';
    end if;
    scheduled_start := (p_data->>'startAt')::timestamptz;
    scheduled_end := (p_data->>'endAt')::timestamptz;
    if scheduled_start >= scheduled_end then raise exception 'INVALID_WINDOW'; end if;
    update public.enhypen_announcement
       set start_at = scheduled_start, end_at = scheduled_end
     where id;
  elsif p_action = 'import' then
    kind := p_data->>'selection';
    select count(*) into total from public.enhypen_winner_list where selection = kind;
    allowed := case kind when 'primary' then 50 when 'reserve' then 30 else 0 end;
    for item in select * from jsonb_array_elements(p_data->'rows') loop
      insert into public.enhypen_winner_list(email,nickname,identity_hash,selection,winner_number)
      values (item->>'email',item->>'nickname',item->>'hash',kind,item->>'number');
      added := added + 1;
    end loop;
    if total + added > allowed then raise exception 'CAPACITY'; end if;
  else
    select * into target from public.enhypen_winner_list where id = (p_data->>'id')::uuid;
    if not found then raise exception 'WINNER_MISSING'; end if;
    if p_action = 'promote' and target.selection = 'reserve' then
      if (select count(*) from public.enhypen_winner_list where selection = 'primary') >= 50 then
        raise exception 'CAPACITY';
      end if;
      update public.enhypen_winner_list set selection = 'primary', winner_number = p_data->>'number',
        consent_deadline = coalesce((p_data->>'deadline')::timestamptz, target.consent_deadline) where id = target.id;
    elsif p_action = 'number' and target.selection = 'primary' then
      update public.enhypen_winner_list set winner_number = p_data->>'number' where id = target.id;
    elsif p_action = 'withdraw' and target.selection = 'primary' then
      update public.enhypen_winner_list set selection = 'withdrawn' where id = target.id;
    elsif p_action = 'remove' and not is_open then
      delete from public.enhypen_winner_list where id = target.id;
    else
      raise exception 'INVALID_TRANSITION';
    end if;
  end if;
  return jsonb_build_object('added', added);
exception when unique_violation then
  if sqlerrm like '%winner_number_key%' then raise exception 'DUPLICATE_NUMBER'; end if;
  raise exception 'DUPLICATE_WINNER';
end;
$function$;

create or replace function public.enhypen_record_consent_v2(p_hash text, p_fields jsonb, p_language text, p_version text)
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
  select * into winner from public.enhypen_winner_list where identity_hash=p_hash and selection in ('primary','reserve') for share;
  if not found then raise exception 'WINNER_MISSING'; end if;
  if p_version <> '2026-11-13-v2' then raise exception 'INVALID_FIELDS'; end if;
  if exists (select 1 from public.enhypen_winner_consent where winner_id=winner.id and notice_version=p_version) then return jsonb_build_object('agreed',true); end if;
  if now() >= winner.consent_deadline then raise exception 'CONSENT_DEADLINE'; end if;
  insert into public.enhypen_winner_consent as c(winner_id,legal_name,phone,birth_date,contact_email,nationality,phone_mode,x_account,language,notice_version)
  values(winner.id,p_fields->>'name',p_fields->>'phone',(p_fields->>'birthDate')::date,p_fields->>'contactEmail',p_fields->>'nationality',p_fields->>'phoneMode',p_fields->>'xAccount',p_language,p_version)
  on conflict(winner_id) do update set legal_name=excluded.legal_name,phone=excluded.phone,birth_date=excluded.birth_date,
    contact_email=excluded.contact_email,nationality=excluded.nationality,phone_mode=excluded.phone_mode,x_account=excluded.x_account,
    pii_box=excluded.pii_box,language=excluded.language,notice_version=excluded.notice_version,agreed_at=now()
  where c.notice_version <> excluded.notice_version;
  return jsonb_build_object('agreed',true);
end;
$function$;

-- Keep the legacy RPC gated as well, even if the current page uses v2.
create or replace function public.enhypen_record_consent(p_hash text, p_name text, p_phone text, p_language text, p_version text)
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
  select * into winner from public.enhypen_winner_list where identity_hash=p_hash and selection='primary' for share;
  if not found then raise exception 'WINNER_MISSING'; end if;
  if exists (select 1 from public.enhypen_winner_consent where winner_id=winner.id) then return jsonb_build_object('agreed',true); end if;
  if now() >= winner.consent_deadline then raise exception 'CONSENT_DEADLINE'; end if;
  insert into public.enhypen_winner_consent(winner_id,legal_name,phone,language,notice_version)
  values(winner.id,p_name,p_phone,p_language,p_version) on conflict(winner_id) do nothing;
  return jsonb_build_object('agreed',true);
end;
$function$;

-- CREATE OR REPLACE preserves the existing service_role-only EXECUTE grants.
-- No direct anon/authenticated table access or RLS policy is added.
