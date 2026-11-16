-- Encrypt existing and future PII with a public key. Postgres has no plaintext
-- private key or key-wrapping credential; the private keyset is stored wrapped.
-- Apply after keyring initialization and compatible Edge readers are deployed.
select pg_advisory_xact_lock(734159285);
create or replace function attendee_privacy.seal(value jsonb, context text)
returns text language plpgsql security definer set search_path='' as $$
declare pub text; begin
 select public_key into strict pub from attendee_privacy.keyring where id='v1';
 return 'pii:v1:'||replace(encode(extensions.pgp_pub_encrypt(jsonb_build_object('v',1,'context',context,'value',value)::text,extensions.dearmor(pub),'cipher-algo=aes256,compress-algo=0'),'base64'),E'\n','');
end $$;
revoke all on function attendee_privacy.seal(jsonb,text) from public,anon,authenticated,service_role;

create or replace function attendee_privacy.encrypt_row()
returns trigger language plpgsql security definer set search_path='' as $$
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
     if j->>'notice_version'='2026-11-13-v2' and not coalesce((j->>'birth_date')::date<=date '2026-11-25' and j->>'contact_email' is not null and j->>'nationality' ~ '^[A-Z]{2}$' and j->>'phone_mode' in ('KR','INTL') and j->>'x_account' ~ '^@[A-Za-z0-9_]{1,15}$',false) then raise exception 'INVALID_REGISTRATION'; end if;
   end if;
   ctx=TG_TABLE_NAME||':'||coalesce(j->>'winner_id',j->>'id');
   new=jsonb_populate_record(new,cleared||jsonb_build_object('pii_box',attendee_privacy.seal(pii,ctx)));
 end if;
 return new;
end $$;
revoke all on function attendee_privacy.encrypt_row() from public,anon,authenticated,service_role;
alter table public.music_core_winner_directory add column if not exists pii_box text;
alter table public.music_core_winner_directory alter column email drop not null;
alter table public.music_core_winner_directory alter column nickname drop not null;
create trigger zz_encrypt_personal_data before insert or update on public.music_core_winner_directory for each row execute function attendee_privacy.encrypt_row('["email", "nickname"]');
alter table public.cover_pick_winner_directory add column if not exists pii_box text;
alter table public.cover_pick_winner_directory alter column email drop not null;
alter table public.cover_pick_winner_directory alter column nickname drop not null;
create trigger zz_encrypt_personal_data before insert or update on public.cover_pick_winner_directory for each row execute function attendee_privacy.encrypt_row('["email", "nickname"]');
alter table public.enhypen_winner_list add column if not exists pii_box text;
alter table public.enhypen_winner_list alter column email drop not null;
alter table public.enhypen_winner_list alter column nickname drop not null;
create trigger zz_encrypt_personal_data before insert or update on public.enhypen_winner_list for each row execute function attendee_privacy.encrypt_row('["email", "nickname"]');
alter table public.music_core_attendees add column if not exists pii_box text;
alter table public.music_core_attendees alter column account_email drop not null;
alter table public.music_core_attendees alter column muniverse_nickname drop not null;
alter table public.music_core_attendees alter column name drop not null;
alter table public.music_core_attendees alter column nationality drop not null;
alter table public.music_core_attendees alter column birth_date drop not null;
alter table public.music_core_attendees alter column phone drop not null;
alter table public.music_core_attendees alter column x_account drop not null;
alter table public.music_core_attendees alter column contact_email drop not null;
create trigger zz_encrypt_personal_data before insert or update on public.music_core_attendees for each row execute function attendee_privacy.encrypt_row('["account_email", "muniverse_nickname", "name", "nationality", "birth_date", "phone", "x_account", "contact_email"]');
alter table public.cover_pick_attendees add column if not exists pii_box text;
alter table public.cover_pick_attendees alter column account_email drop not null;
alter table public.cover_pick_attendees alter column muniverse_nickname drop not null;
alter table public.cover_pick_attendees alter column name drop not null;
alter table public.cover_pick_attendees alter column nationality drop not null;
alter table public.cover_pick_attendees alter column birth_date drop not null;
alter table public.cover_pick_attendees alter column phone drop not null;
alter table public.cover_pick_attendees alter column x_account drop not null;
alter table public.cover_pick_attendees alter column contact_email drop not null;
create trigger zz_encrypt_personal_data before insert or update on public.cover_pick_attendees for each row execute function attendee_privacy.encrypt_row('["account_email", "muniverse_nickname", "name", "nationality", "birth_date", "phone", "x_account", "contact_email"]');
alter table public.enhypen_winner_consent add column if not exists pii_box text;
alter table public.enhypen_winner_consent alter column legal_name drop not null;
alter table public.enhypen_winner_consent alter column phone drop not null;
alter table public.enhypen_winner_consent alter column birth_date drop not null;
alter table public.enhypen_winner_consent alter column contact_email drop not null;
alter table public.enhypen_winner_consent alter column nationality drop not null;
alter table public.enhypen_winner_consent alter column phone_mode drop not null;
alter table public.enhypen_winner_consent alter column x_account drop not null;
create trigger zz_encrypt_personal_data before insert or update on public.enhypen_winner_consent for each row execute function attendee_privacy.encrypt_row('["legal_name", "phone", "birth_date", "contact_email", "nationality", "phone_mode", "x_account"]');
alter table public.music_core_verification_sessions add column if not exists pii_box text;
alter table public.music_core_verification_sessions alter column account_email drop not null;
alter table public.music_core_verification_sessions alter column muniverse_nickname drop not null;
create trigger zz_encrypt_personal_data before insert or update on public.music_core_verification_sessions for each row execute function attendee_privacy.encrypt_row('["account_email", "muniverse_nickname"]');
alter table public.cover_pick_verification_sessions add column if not exists pii_box text;
alter table public.cover_pick_verification_sessions alter column account_email drop not null;
alter table public.cover_pick_verification_sessions alter column muniverse_nickname drop not null;
create trigger zz_encrypt_personal_data before insert or update on public.cover_pick_verification_sessions for each row execute function attendee_privacy.encrypt_row('["account_email", "muniverse_nickname"]');
alter table public.enhypen_winner_consent drop constraint enhypen_consent_v2_fields;
CREATE OR REPLACE FUNCTION public.attendee_round_mutate(p_program text, p_action text, p_data jsonb, p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare r public.attendee_rounds;src public.attendee_rounds;rid uuid;prev uuid;pre text;c jsonb;entry jsonb;wid uuid;d date;n integer=0;submitted boolean;selection text;existing_selection text;outcome jsonb;begin
 if p_program not in ('music_core','fans_pick') then raise exception 'INVALID_PROGRAM';end if;
 perform pg_advisory_xact_lock(hashtextextended('attendee-round:'||p_program,0));
 pre=case when p_program='music_core' then 'music_core' else 'cover_pick' end;
 if p_action='create_round' then
  if length(btrim(coalesce(p_data->>'title',''))) not between 1 and 120 then raise exception 'ROUND_TITLE_REQUIRED';end if;
  c=jsonb_build_object('event_date','','event_date_tba','true','registration_open_at','','registration_close_at','','show_event_date','false','test_mode','false','registration_paused','false');
  if nullif(p_data->>'source_round_id','') is not null then
   select * into src from public.attendee_rounds where id=(p_data->>'source_round_id')::uuid and program=p_program;
   if not found then raise exception 'ROUND_NOT_FOUND';end if;
   c=src.config||jsonb_build_object('test_mode','false','registration_paused','false');
  end if;
  insert into public.attendee_rounds(program,title,config) values(p_program,btrim(p_data->>'title'),c) returning id into rid;
  outcome=jsonb_build_object('ok',true,'round_id',rid);
 else
  rid=nullif(p_data->>'round_id','')::uuid;
  if rid is null then raise exception 'ROUND_REQUIRED';end if;
  select * into r from public.attendee_rounds where id=rid and program=p_program for update;
  if not found then raise exception 'ROUND_NOT_FOUND';end if;
  if r.archived and p_action<>'restore_round' then raise exception 'ROUND_ARCHIVED';end if;
  if p_action in ('save_config','publish_round','archive_round','restore_round') and (p_data->>'expected_version')::integer is distinct from r.version then raise exception 'ROUND_CONFLICT';end if;
  if p_action='save_config' then
   if length(btrim(coalesce(p_data->>'title',''))) not between 1 and 120 then raise exception 'ROUND_TITLE_REQUIRED';end if;
   select jsonb_object_agg(k,p_data->>k) into c from unnest(array['event_date','event_date_tba','registration_open_at','registration_close_at','show_event_date','test_mode','registration_paused']) k;
   perform public.attendee_round_check_config(c,r.is_public);
   d=case when c->>'event_date_tba'='true' then date '2099-12-31' else (c->>'event_date')::date end;
   update public.attendee_rounds set title=btrim(p_data->>'title'),config=c,version=version+1,updated_at=now() where id=rid;
   execute format('update public.%I set event_date=$1 where round_id=$2 and event_date is distinct from $1',pre||'_winners') using d,rid;
   if p_program='music_core' then update public.music_core_attendees a set event_date=d from public.music_core_winners w where a.winner_id=w.id and w.round_id=rid and a.event_date is distinct from d;end if;
   execute format('update public.%I set used=true where not used and winner_id in(select id from public.%I where round_id=$1)',pre||'_verification_sessions',pre||'_winners') using rid;
   perform public.attendee_round_sync_runtime(rid);
   outcome=jsonb_build_object('ok',true,'round_id',rid,'version',r.version+1);
  elsif p_action='publish_round' then
   perform public.attendee_round_check_config(r.config,true);
   select id into prev from public.attendee_rounds where program=p_program and is_public;
   if prev is distinct from rid then
    update public.attendee_rounds set is_public=false,version=version+1,updated_at=now() where program=p_program and is_public;
    update public.attendee_rounds set is_public=true,version=version+1,updated_at=now() where id=rid;
    execute format('update public.%I set used=true where not used',pre||'_verification_sessions');
   end if;
   perform public.attendee_round_sync_runtime(rid);
   outcome=jsonb_build_object('ok',true,'round_id',rid);
  elsif p_action in ('archive_round','restore_round') then
   if r.is_public then raise exception 'PUBLIC_ROUND_CANNOT_ARCHIVE';end if;
   update public.attendee_rounds set archived=(p_action='archive_round'),version=version+1,updated_at=now() where id=rid;
   outcome=jsonb_build_object('ok',true,'round_id',rid);
  elsif p_action='promote_reserve' then
   if p_data->>'confirm' is distinct from 'true' then raise exception 'CONFIRM_REQUIRED';end if;
   wid=(p_data->>'id')::uuid;
   execute format('select selection_type from public.%I where id=$1 and round_id=$2 for update',pre||'_winners') into selection using wid,rid;
   if selection is null then raise exception 'WINNER_NOT_FOUND';end if;
   if selection<>'reserve' then raise exception 'NOT_RESERVE_WINNER';end if;
   execute format('update public.%I set selection_type=''primary'' where id=$1 and round_id=$2',pre||'_winners') using wid,rid;
   outcome=jsonb_build_object('ok',true,'round_id',rid);
  elsif p_action='add_winners' then
   selection=coalesce(p_data->>'selection_type','primary');
   if selection not in ('primary','reserve') then raise exception 'INVALID_SELECTION_TYPE';end if;
   if jsonb_typeof(p_data->'winners')<>'array' or jsonb_array_length(p_data->'winners') not between 1 and 500 then raise exception 'WINNER_LIMIT';end if;
   d=case when r.config->>'event_date_tba'='true' then date '2099-12-31' else (r.config->>'event_date')::date end;
   for entry in select value from jsonb_array_elements(p_data->'winners') loop
    execute format('select id from public.%I where round_id=$1 and identity_hash=$2',pre||'_winners') into wid using rid,entry->>'identity_hash';
    if wid is not null then
     execute format('select selection_type from public.%I where id=$1',pre||'_winners') into existing_selection using wid;
     if existing_selection<>selection then raise exception 'WINNER_LIST_CONFLICT';end if;
    end if;
    if wid is null then
     if p_program='music_core' then insert into public.music_core_winners(round_id,event_date,selection_type,identity_hash,email_hash,nickname_hash) values(rid,d,selection,entry->>'identity_hash',entry->>'email_hash',entry->>'nickname_hash') returning id into wid;
     else insert into public.cover_pick_winners(round_id,event_date,identity_hash,selection_type) values(rid,d,entry->>'identity_hash',selection) returning id into wid;end if;
     n=n+1;
    end if;
    execute format('insert into public.%I(winner_id,email,nickname) values($1,$2,$3) on conflict(winner_id) do update set email=excluded.email,nickname=excluded.nickname,pii_box=excluded.pii_box',pre||'_winner_directory') using wid,entry->>'email',entry->>'nickname';
   end loop;
   outcome=jsonb_build_object('ok',true,'round_id',rid,'added',n,'duplicates',jsonb_array_length(p_data->'winners')-n);
  elsif p_action in ('update_winner','delete_winner') then
   wid=(p_data->>'id')::uuid;
   execute format('select submitted from public.%I where id=$1 and round_id=$2 for update',pre||'_winners') into submitted using wid,rid;
   if submitted is null then raise exception 'WINNER_NOT_FOUND';end if;
   if p_action='delete_winner' then
    if p_data->>'confirm_delete' is distinct from 'true' then raise exception 'CONFIRM_REQUIRED';end if;
    execute format('delete from public.%I where id=$1 and round_id=$2',pre||'_winners') using wid,rid;
   else
    if p_program='music_core' then update public.music_core_winners set identity_hash=p_data->>'identity_hash',email_hash=p_data->>'email_hash',nickname_hash=p_data->>'nickname_hash' where id=wid and round_id=rid;
    else update public.cover_pick_winners set identity_hash=p_data->>'identity_hash' where id=wid and round_id=rid;end if;
    execute format('insert into public.%I(winner_id,email,nickname) values($1,$2,$3) on conflict(winner_id) do update set email=excluded.email,nickname=excluded.nickname,pii_box=excluded.pii_box',pre||'_winner_directory') using wid,p_data->>'email',p_data->>'nickname';
    execute format('update public.%I set used=true where winner_id=$1',pre||'_verification_sessions') using wid;
   end if;
   outcome=jsonb_build_object('ok',true,'round_id',rid,'was_submitted',submitted);
  else raise exception 'INVALID_ACTION';end if;
 end if;
 insert into public.attendee_console_audit(username,program,action,winner_id,detail) values(p_username,p_program,p_action,wid,jsonb_build_object('round_id',rid,'added',n,'selection_type',selection));
 return outcome;
end $function$
;
CREATE OR REPLACE FUNCTION public.attendee_console_mutate(p_program text, p_action text, p_data jsonb, p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare wt text;dt text;atb text;st text;rt text;v_id uuid;existing record;entry jsonb;res jsonb='[]'::jsonb;previous jsonb;d date;old_d date;submitted boolean;changed integer=0;k text;v text;
begin
if p_program not in ('music_core','fans_pick') then raise exception 'INVALID_PROGRAM'; end if;
perform pg_advisory_xact_lock(hashtextextended('attendee-console:'||p_program,0));
wt=case when p_program='music_core' then 'music_core_winners' else 'cover_pick_winners' end;dt=case when p_program='music_core' then 'music_core_winner_directory' else 'cover_pick_winner_directory' end;atb=case when p_program='music_core' then 'music_core_attendees' else 'cover_pick_attendees' end;st=case when p_program='music_core' then 'music_core_verification_sessions' else 'cover_pick_verification_sessions' end;rt=case when p_program='music_core' then 'music_core_runtime_config' else 'cover_pick_runtime_config' end;
if p_action='save_config' then
 execute format('select coalesce(jsonb_object_agg(key,value),''{}''::jsonb) from public.%I where key=any($1)',rt) into previous using array['event_date','event_date_tba'];
 d=case when p_data->>'event_date_tba'='true' then date '2099-12-31' else (p_data->>'event_date')::date end;
 if d is null then raise exception 'DATE_REQUIRED'; end if;
 if (p_data->>'registration_open_at')::timestamptz >= (p_data->>'registration_close_at')::timestamptz then raise exception 'INVALID_WINDOW'; end if;
 foreach k in array array['event_date','event_date_tba','registration_open_at','registration_close_at','show_event_date','registration_paused','test_mode'] loop
  v=p_data->>k;if v is null then raise exception 'CONFIG_REQUIRED';end if;
  execute format('insert into public.%I(key,value,updated_at) values($1,$2,now()) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at',rt) using k,v;
 end loop;
 if p_data->>'move_current_winners'='true' then
  old_d=case when previous->>'event_date_tba'='true' then date '2099-12-31' else nullif(previous->>'event_date','')::date end;
  if old_d is not null and old_d<>d then
   execute format('update public.%I set event_date=$1 where event_date=$2',wt) using d,old_d;get diagnostics changed=row_count;
   if p_program='music_core' then update public.music_core_attendees set event_date=d where event_date=old_d;end if;
   execute format('update public.%I set used=true where winner_id in(select id from public.%I where event_date=$1)',st,wt) using d;
  end if;
 end if;
 insert into public.attendee_console_audit(username,program,action,detail) values(p_username,p_program,p_action,p_data-'password');
 return jsonb_build_object('ok',true,'moved',changed);
elsif p_action='add_winners' then
 for entry in select value from jsonb_array_elements(p_data->'winners') loop
  d=(entry->>'event_date')::date;
  execute format('select id from public.%I where event_date=$1 and identity_hash=$2',wt) into v_id using d,entry->>'identity_hash';
  if v_id is null then
   if p_program='music_core' then insert into public.music_core_winners(identity_hash,email_hash,nickname_hash,event_date) values(entry->>'identity_hash',entry->>'email_hash',entry->>'nickname_hash',d) returning id into v_id;
   else insert into public.cover_pick_winners(identity_hash,event_date) values(entry->>'identity_hash',d) returning id into v_id;end if;
   changed=changed+1;
  end if;
  execute format('insert into public.%I(winner_id,email,nickname) values($1,$2,$3) on conflict(winner_id) do update set email=excluded.email,nickname=excluded.nickname,pii_box=excluded.pii_box',dt) using v_id,entry->>'email',entry->>'nickname';
  res=res||jsonb_build_array(jsonb_build_object('id',v_id));
 end loop;
 insert into public.attendee_console_audit(username,program,action,detail) values(p_username,p_program,p_action,jsonb_build_object('added',changed,'requested',jsonb_array_length(p_data->'winners')));
 return jsonb_build_object('ok',true,'added',changed,'duplicates',jsonb_array_length(p_data->'winners')-changed,'results',res);
elsif p_action in ('update_winner','delete_winner') then
 v_id=(p_data->>'id')::uuid;
 execute format('select submitted from public.%I where id=$1 for update',wt) into submitted using v_id;
 if submitted is null then raise exception 'WINNER_NOT_FOUND';end if;
 if p_action='delete_winner' then
  if p_data->>'confirm_delete'<>'true' then raise exception 'CONFIRM_REQUIRED';end if;
  execute format('delete from public.%I where id=$1',wt) using v_id;
 else
  d=(p_data->>'event_date')::date;
  if p_program='music_core' then update public.music_core_winners set identity_hash=p_data->>'identity_hash',email_hash=p_data->>'email_hash',nickname_hash=p_data->>'nickname_hash',event_date=d where id=v_id;
  else update public.cover_pick_winners set identity_hash=p_data->>'identity_hash',event_date=d where id=v_id;end if;
  execute format('insert into public.%I(winner_id,email,nickname) values($1,$2,$3) on conflict(winner_id) do update set email=excluded.email,nickname=excluded.nickname,pii_box=excluded.pii_box',dt) using v_id,p_data->>'email',p_data->>'nickname';
  execute format('update public.%I set used=true where winner_id=$1',st) using v_id;
 end if;
 insert into public.attendee_console_audit(username,program,action,winner_id,detail) values(p_username,p_program,p_action,v_id,jsonb_build_object('was_submitted',submitted));
 return jsonb_build_object('ok',true,'was_submitted',submitted);
else raise exception 'INVALID_ACTION';end if;end $function$
;
CREATE OR REPLACE FUNCTION public.enhypen_record_consent_v2(p_hash text, p_fields jsonb, p_language text, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  winner public.enhypen_winner_list;
begin
  if not (select is_open from public.enhypen_announcement where id for share) then raise exception 'ANNOUNCEMENT_CLOSED'; end if;
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
$function$
;
CREATE OR REPLACE FUNCTION public.enhypen_record_consent(p_hash text, p_name text, p_phone text, p_language text, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  winner public.enhypen_winner_list;
begin
  if not (select is_open from public.enhypen_announcement where id for share) then raise exception 'ANNOUNCEMENT_CLOSED'; end if;
  select * into winner from public.enhypen_winner_list where identity_hash=p_hash and selection='primary' for share;
  if not found then raise exception 'WINNER_MISSING'; end if;
  if exists (select 1 from public.enhypen_winner_consent where winner_id=winner.id) then return jsonb_build_object('agreed',true); end if;
  if now() >= winner.consent_deadline then raise exception 'CONSENT_DEADLINE'; end if;
  insert into public.enhypen_winner_consent(winner_id,legal_name,phone,language,notice_version)
  values(winner.id,p_name,p_phone,p_language,p_version) on conflict(winner_id) do nothing;
  return jsonb_build_object('agreed',true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.attendee_round_data(p_program text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare pre text; rs jsonb; wl jsonb; active_id uuid;c jsonb;begin
 if p_program not in ('music_core','fans_pick') then raise exception 'INVALID_PROGRAM';end if;
 pre=case when p_program='music_core' then 'music_core' else 'cover_pick' end;
 select coalesce(jsonb_agg(to_jsonb(r) order by is_public desc,archived,created_at desc),'[]'::jsonb) into rs from public.attendee_rounds r where program=p_program;
 select id,config into active_id,c from public.attendee_rounds where program=p_program and is_public;
 execute format('select coalesce(jsonb_agg(z),''[]''::jsonb) from (select w.id,w.round_id,%s selection_type,r.title round_title,w.event_date,d.email,d.nickname,d.pii_box _directory_pii,a.pii_box _registration_pii,(w.submitted or a.id is not null) submitted,w.submitted_at,w.created_at,a.name,a.birth_date,a.nationality,a.phone,a.x_account,a.contact_email,a.account_email registration_email,a.muniverse_nickname registration_nickname,coalesce(w.submitted_at,a.consented_at) registered_at from public.%I w join public.attendee_rounds r on r.id=w.round_id left join public.%I d on d.winner_id=w.id left join public.%I a on a.winner_id=w.id where r.program=$1 order by w.created_at desc) z','w.selection_type',pre||'_winners',pre||'_winner_directory',pre||'_attendees') into wl using p_program;
 return jsonb_build_object('active_round_id',active_id,'config',c,'rounds',rs,'winners',wl);
end $function$
;
CREATE OR REPLACE FUNCTION public.attendee_console_data(p_program text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$ declare wt text;dt text;atb text;rt text;cs jsonb;wl jsonb; begin if p_program not in ('music_core','fans_pick') then raise exception 'INVALID_PROGRAM'; end if; wt=case when p_program='music_core' then 'music_core_winners' else 'cover_pick_winners' end; dt=case when p_program='music_core' then 'music_core_winner_directory' else 'cover_pick_winner_directory' end; atb=case when p_program='music_core' then 'music_core_attendees' else 'cover_pick_attendees' end; rt=case when p_program='music_core' then 'music_core_runtime_config' else 'cover_pick_runtime_config' end;
execute format('select coalesce(jsonb_object_agg(key,value),''{}''::jsonb) from public.%I where key=any($1)',rt) into cs using array['event_date','event_date_tba','registration_open_at','registration_close_at','show_event_date','registration_paused','test_mode'];
execute format('select coalesce(jsonb_agg(z),''[]''::jsonb) from (select w.id,w.event_date,d.email,d.nickname,d.pii_box _directory_pii,(w.submitted or a.id is not null) submitted,w.submitted_at,w.created_at from public.%I w left join public.%I d on d.winner_id=w.id left join public.%I a on a.winner_id=w.id order by w.created_at desc limit 10000) z',wt,dt,atb) into wl;
return jsonb_build_object('config',cs,'winners',wl); end $function$
;
alter table public.cover_pick_attendees disable trigger trg_prevent_cover_pick_attendee_update;
update public.music_core_winner_directory set email=email where pii_box is null;
alter table public.music_core_winner_directory alter column pii_box set not null;
alter table public.music_core_winner_directory add constraint music_core_winner_directory_encrypted_storage check (email is null and nickname is null and (pii_box like 'pii:v1:%'));
update public.cover_pick_winner_directory set email=email where pii_box is null;
alter table public.cover_pick_winner_directory alter column pii_box set not null;
alter table public.cover_pick_winner_directory add constraint cover_pick_winner_directory_encrypted_storage check (email is null and nickname is null and (pii_box like 'pii:v1:%'));
update public.enhypen_winner_list set email=email where pii_box is null;
alter table public.enhypen_winner_list alter column pii_box set not null;
alter table public.enhypen_winner_list add constraint enhypen_winner_list_encrypted_storage check (email is null and nickname is null and (pii_box like 'pii:v1:%'));
update public.music_core_attendees set account_email=account_email where pii_box is null;
alter table public.music_core_attendees alter column pii_box set not null;
alter table public.music_core_attendees add constraint music_core_attendees_encrypted_storage check (account_email is null and muniverse_nickname is null and name is null and nationality is null and birth_date is null and phone is null and x_account is null and contact_email is null and (pii_box like 'pii:v1:%'));
update public.cover_pick_attendees set account_email=account_email where pii_box is null;
alter table public.cover_pick_attendees alter column pii_box set not null;
alter table public.cover_pick_attendees add constraint cover_pick_attendees_encrypted_storage check (account_email is null and muniverse_nickname is null and name is null and nationality is null and birth_date is null and phone is null and x_account is null and contact_email is null and (pii_box like 'pii:v1:%'));
update public.enhypen_winner_consent set legal_name=legal_name where pii_box is null;
alter table public.enhypen_winner_consent alter column pii_box set not null;
alter table public.enhypen_winner_consent add constraint enhypen_winner_consent_encrypted_storage check (legal_name is null and phone is null and birth_date is null and contact_email is null and nationality is null and phone_mode is null and x_account is null and (pii_box like 'pii:v1:%'));
update public.music_core_verification_sessions set account_email=account_email where pii_box is null;
alter table public.music_core_verification_sessions add constraint music_core_verification_sessions_encrypted_storage check (account_email is null and muniverse_nickname is null and (pii_box is null or pii_box like 'pii:v1:%'));
update public.cover_pick_verification_sessions set account_email=account_email where pii_box is null;
alter table public.cover_pick_verification_sessions add constraint cover_pick_verification_sessions_encrypted_storage check (account_email is null and muniverse_nickname is null and (pii_box is null or pii_box like 'pii:v1:%'));
alter table public.cover_pick_attendees enable trigger trg_prevent_cover_pick_attendee_update;

create or replace function attendee_privacy.encrypt_payload()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.payload is not null and not (new.payload ? '__pii') then
  new.payload=jsonb_build_object('__pii',attendee_privacy.seal(new.payload,'attendee_delivery_outbox:'||new.id::text));
 end if;
 return new;
end $$;
revoke all on function attendee_privacy.encrypt_payload() from public,anon,authenticated,service_role;
create trigger zz_encrypt_payload before insert or update on public.attendee_delivery_outbox for each row execute function attendee_privacy.encrypt_payload();
update public.attendee_delivery_outbox set payload=payload;
alter table public.attendee_delivery_outbox add constraint attendee_outbox_encrypted check (payload ? '__pii');
-- Retire unused legacy session RPCs. Current frontends use attendee-public.
revoke execute on function public.attendee_fast_submit(text,text,text,text,text,text,text,date,text,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.attendee_fast_verify(text,text,text,text,text,text,text,timestamptz,text,text,text) from public,anon,authenticated,service_role;
-- PII tables, management RPCs and key metadata are never public APIs.
alter table public.music_core_winner_directory enable row level security;
revoke all on public.music_core_winner_directory from public,anon,authenticated;
alter table public.cover_pick_winner_directory enable row level security;
revoke all on public.cover_pick_winner_directory from public,anon,authenticated;
alter table public.enhypen_winner_list enable row level security;
revoke all on public.enhypen_winner_list from public,anon,authenticated;
alter table public.music_core_attendees enable row level security;
revoke all on public.music_core_attendees from public,anon,authenticated;
alter table public.cover_pick_attendees enable row level security;
revoke all on public.cover_pick_attendees from public,anon,authenticated;
alter table public.enhypen_winner_consent enable row level security;
revoke all on public.enhypen_winner_consent from public,anon,authenticated;
alter table public.music_core_verification_sessions enable row level security;
revoke all on public.music_core_verification_sessions from public,anon,authenticated;
alter table public.cover_pick_verification_sessions enable row level security;
revoke all on public.cover_pick_verification_sessions from public,anon,authenticated;
alter table public.attendee_delivery_outbox enable row level security;
revoke all on public.attendee_delivery_outbox from public,anon,authenticated;
notify pgrst, 'reload schema';
