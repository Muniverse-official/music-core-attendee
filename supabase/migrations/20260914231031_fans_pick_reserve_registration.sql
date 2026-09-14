-- Both programs use reserve pre-registration and administrator record exports.
select pg_advisory_xact_lock(hashtextextended('attendee-round:music_core',0));
select pg_advisory_xact_lock(hashtextextended('attendee-round:fans_pick',0));
alter table public.cover_pick_winners add column selection_type text not null default 'primary' constraint cover_pick_winner_selection_type check (selection_type in ('primary','reserve'));
comment on column public.cover_pick_winners.selection_type is 'primary: selected attendee; reserve: advance registration, final selection notified individually';

CREATE OR REPLACE FUNCTION public.attendee_check_winner(p_program text, p_identity_hash text, p_email_hash text, p_nickname_hash text, p_rate_identity text, p_rate_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  r public.attendee_rounds;
  o timestamptz;
  cl timestamptz;
  d date;
  v_id uuid;
  v_submitted boolean;
  v_selection_type text='primary';
  v_bucket timestamptz;
  n_identity integer;
  n_fingerprint integer;
  v_email_exists boolean := false;
  v_nickname_exists boolean := false;
begin
  if p_program not in ('music_core','fans_pick') then return jsonb_build_object('ok',false,'code','INVALID_PROGRAM'); end if;
  select * into r from public.attendee_rounds where program=p_program and is_public and not archived limit 1;
  if not found then return jsonb_build_object('ok',false,'code','UNAVAILABLE'); end if;
  begin perform public.attendee_round_check_config(r.config,true); exception when others then return jsonb_build_object('ok',false,'code','UNAVAILABLE'); end;
  o=(r.config->>'registration_open_at')::timestamptz;
  cl=(r.config->>'registration_close_at')::timestamptz;
  if r.config->>'registration_paused'='true' then return jsonb_build_object('ok',false,'code','PAUSED'); end if;
  if clock_timestamp()>=cl then return jsonb_build_object('ok',false,'code','CLOSED'); end if;
  if r.config->>'test_mode'<>'true' and clock_timestamp()<o then return jsonb_build_object('ok',false,'code','NOT_OPEN'); end if;
  d=case when r.config->>'event_date_tba'='true' then date '2099-12-31' else (r.config->>'event_date')::date end;

  if p_program='music_core' then
    select id,submitted,selection_type into v_id,v_submitted,v_selection_type from public.music_core_winners
     where round_id=r.id and identity_hash=p_identity_hash and email_hash=p_email_hash and nickname_hash=p_nickname_hash limit 1;
    if v_id is null then
      select exists(select 1 from public.music_core_winners where round_id=r.id and email_hash=p_email_hash) into v_email_exists;
      select exists(select 1 from public.music_core_winners where round_id=r.id and nickname_hash=p_nickname_hash) into v_nickname_exists;
    end if;
  else
    select id,submitted,selection_type into v_id,v_submitted,v_selection_type from public.cover_pick_winners
     where round_id=r.id and identity_hash=p_identity_hash limit 1;
  end if;

  if v_id is null then
    v_bucket=to_timestamp(floor(extract(epoch from clock_timestamp())/600)*600);
    insert into public.attendee_rate_buckets(program,action,rate_key,bucket_start,attempts,updated_at)
    values(p_program,'verify','i:'||p_rate_identity,v_bucket,1,clock_timestamp())
    on conflict(program,action,rate_key,bucket_start) do update set attempts=public.attendee_rate_buckets.attempts+1,updated_at=excluded.updated_at
    returning attempts into n_identity;
    insert into public.attendee_rate_buckets(program,action,rate_key,bucket_start,attempts,updated_at)
    values(p_program,'verify','f:'||p_rate_fingerprint,v_bucket,1,clock_timestamp())
    on conflict(program,action,rate_key,bucket_start) do update set attempts=public.attendee_rate_buckets.attempts+1,updated_at=excluded.updated_at
    returning attempts into n_fingerprint;
    if n_identity>12 or n_fingerprint>100 then return jsonb_build_object('ok',false,'code','TOO_MANY_ATTEMPTS'); end if;
    if p_program='music_core' then
      if v_email_exists or v_nickname_exists then
        return jsonb_build_object('ok',false,'code','WINNER_PARTIAL_MISMATCH');
      end if;
      return jsonb_build_object('ok',false,'code','WINNER_NOT_LISTED');
    end if;
    return jsonb_build_object('ok',false,'code','IDENTITY_MISMATCH');
  end if;

  if v_submitted then return jsonb_build_object('ok',false,'code','ALREADY_SUBMITTED','selection_type',v_selection_type); end if;
  return jsonb_build_object('ok',true,'selection_type',v_selection_type,'winner_id',v_id,'round_id',r.id,'round_title',r.title,'event_date',case when r.config->>'event_date_tba'='true' then null else d::text end,'event_date_tba',r.config->>'event_date_tba'='true','show_event_date',r.config->>'show_event_date'='true');
end
$function$

;

CREATE OR REPLACE FUNCTION public.attendee_commit_registration(p_program text, p_winner_id uuid, p_identity_hash text, p_account_email text, p_nickname text, p_name text, p_nationality text, p_birth_date date, p_phone text, p_x_account text, p_contact_email text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  r public.attendee_rounds;
  o timestamptz;
  cl timestamptz;
  d date;
  w record;
  v_age integer;
  v_now timestamptz=clock_timestamp();
  v_selection_type text='primary';
begin
  if p_program not in ('music_core','fans_pick') then return jsonb_build_object('ok',false,'code','INVALID_PROGRAM'); end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('attendee-round:'||p_program,0));
  select * into r from public.attendee_rounds where program=p_program and is_public and not archived limit 1;
  if not found then return jsonb_build_object('ok',false,'code','UNAVAILABLE'); end if;
  begin perform public.attendee_round_check_config(r.config,true); exception when others then return jsonb_build_object('ok',false,'code','UNAVAILABLE'); end;
  o=(r.config->>'registration_open_at')::timestamptz; cl=(r.config->>'registration_close_at')::timestamptz;
  if r.config->>'registration_paused'='true' then return jsonb_build_object('ok',false,'code','PAUSED'); end if;
  if v_now>=cl then return jsonb_build_object('ok',false,'code','CLOSED'); end if;
  if r.config->>'test_mode'<>'true' and v_now<o then return jsonb_build_object('ok',false,'code','NOT_OPEN'); end if;
  d=case when r.config->>'event_date_tba'='true' then date '2099-12-31' else (r.config->>'event_date')::date end;

  if p_program='music_core' then select * into w from public.music_core_winners where id=p_winner_id for update;
  else select * into w from public.cover_pick_winners where id=p_winner_id for update; end if;
  if not found or w.round_id<>r.id or w.identity_hash<>p_identity_hash or w.event_date<>d then return jsonb_build_object('ok',false,'code','SESSION_INVALID'); end if;
  v_selection_type=w.selection_type;
  if w.submitted then return jsonb_build_object('ok',false,'code','ALREADY_SUBMITTED','selection_type',v_selection_type); end if;
  if coalesce(trim(p_account_email),'')='' or coalesce(trim(p_nickname),'')='' then return jsonb_build_object('ok',false,'code','SESSION_INVALID'); end if;
  if coalesce(trim(p_name),'')='' or p_nationality !~ '^[A-Z]{2}$' or p_phone !~ '^(010-[0-9]{4}-[0-9]{4}|[+][0-9]{8,15})$' or p_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_x_account !~ '^@[A-Za-z0-9_]{1,15}$' then return jsonb_build_object('ok',false,'code','INVALID_FIELDS'); end if;
  v_age=extract(year from age(case when d=date '2099-12-31' then (v_now at time zone 'Asia/Seoul')::date else d end,p_birth_date));
  if v_age<15 then return jsonb_build_object('ok',false,'code','UNDER_15'); end if;
  if v_age>120 then return jsonb_build_object('ok',false,'code','INVALID_FIELDS'); end if;

  begin
    if p_program='music_core' then
      insert into public.music_core_attendees(winner_id,account_email,muniverse_nickname,name,nationality,birth_date,phone,x_account,contact_email,event_date,consent_version,consented_at)
      values(w.id,p_account_email,p_nickname,p_name,p_nationality,p_birth_date,p_phone,p_x_account,p_contact_email,d,'music_core-audience-admin-v5',v_now);
      update public.music_core_winners set submitted=true,submitted_at=v_now where id=w.id;
      insert into public.music_core_audit_log(event,winner_id,ip_hash,metadata) values('submit_success',w.id,p_ip_hash,jsonb_build_object('round_id',r.id,'selection_type',v_selection_type,'delivery_queued',false,'stateless_token',true));
    else
      insert into public.cover_pick_attendees(winner_id,name,nationality,birth_date,phone,contact_email,consent_version,consented_at,account_email,muniverse_nickname,x_account)
      values(w.id,p_name,p_nationality,p_birth_date,p_phone,p_contact_email,'fans_pick-audience-admin-v5',v_now,p_account_email,p_nickname,p_x_account);
      update public.cover_pick_winners set submitted=true,submitted_at=v_now where id=w.id;
      insert into public.cover_pick_register_audit_log(event,metadata) values('attendee_registration_success',jsonb_build_object('winner_id',w.id,'round_id',r.id,'selection_type',v_selection_type,'delivery_queued',false,'stateless_token',true));
    end if;
  exception
    when unique_violation then return jsonb_build_object('ok',false,'code','ALREADY_SUBMITTED','selection_type',v_selection_type);
    when others then
      if sqlerrm like '%REGISTRATION_DEADLINE_EXPIRED%' then return jsonb_build_object('ok',false,'code','CLOSED'); end if;
      if sqlerrm like '%REGISTRATION_NOT_OPEN%' then return jsonb_build_object('ok',false,'code','NOT_OPEN'); end if;
      if sqlerrm like '%REGISTRATION_PAUSED%' then return jsonb_build_object('ok',false,'code','PAUSED'); end if;
      raise;
  end;


  return jsonb_build_object('ok',true,'registered',true,'selection_type',v_selection_type,'round_id',r.id,'round_title',r.title,'event_date',case when r.config->>'event_date_tba'='true' then null else d::text end,'event_date_tba',r.config->>'event_date_tba'='true','show_event_date',r.config->>'show_event_date'='true','delivery_queued',false);
end
$function$

;

CREATE OR REPLACE FUNCTION public.attendee_delivery_claim(p_limit integer DEFAULT 100)
 RETURNS SETOF attendee_delivery_outbox
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if p_limit<1 or p_limit>200 then p_limit=100; end if;
  update public.attendee_delivery_outbox set status='pending',locked_at=null,updated_at=clock_timestamp()
   where status='processing' and locked_at < clock_timestamp()-interval '15 minutes';
  return query
  with picked as (
    select id from public.attendee_delivery_outbox
     where program not in ('music_core','fans_pick') and status='pending' and next_attempt_at<=clock_timestamp()
     order by id
     limit p_limit
     for update skip locked
  )
  update public.attendee_delivery_outbox o
     set status='processing',locked_at=clock_timestamp(),attempts=o.attempts+1,updated_at=clock_timestamp()
    from picked p
   where o.id=p.id
  returning o.*;
end
$function$

;

CREATE OR REPLACE FUNCTION public.attendee_delivery_is_current(p_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists(select 1 from public.attendee_delivery_outbox o where o.id=p_id and o.program not in ('music_core','fans_pick') and o.status='processing'
    and o.locked_at>now()-interval '15 minutes'
    and case when o.program='music_core'
      then exists(select 1 from public.music_core_winners w where w.id=o.winner_id and w.round_id=o.round_id)
      else exists(select 1 from public.cover_pick_winners w where w.id=o.winner_id and w.round_id=o.round_id) end);
$function$

;

CREATE OR REPLACE FUNCTION public.attendee_delivery_retry(p_program text, p_round_id uuid, p_id bigint, p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare job public.attendee_delivery_outbox;
begin
  if p_program not in ('music_core','fans_pick') then raise exception 'INVALID_PROGRAM';end if;
  if p_program in ('music_core','fans_pick') then raise exception 'DELIVERY_DISABLED';end if;
  perform pg_advisory_xact_lock(hashtextextended('attendee-round:'||p_program,0));
  select * into job from public.attendee_delivery_outbox where id=p_id and program=p_program and round_id=p_round_id for update;
  if not found then raise exception 'DELIVERY_NOT_FOUND';end if;
  if job.status<>'failed' then raise exception 'DELIVERY_NOT_RETRYABLE';end if;
  if coalesce(job.last_error,'') like '%EMAIL_STATUS_UNCERTAIN%' then raise exception 'DELIVERY_REVIEW_REQUIRED';end if;
  if (p_program='music_core' and not exists(select 1 from public.music_core_winners where id=job.winner_id and round_id=p_round_id))
    or (p_program='fans_pick' and not exists(select 1 from public.cover_pick_winners where id=job.winner_id and round_id=p_round_id)) then
    raise exception 'WINNER_NOT_FOUND';
  end if;
  update public.attendee_delivery_outbox set status='pending',attempts=0,last_error=null,locked_at=null,next_attempt_at=now(),updated_at=now() where id=p_id;
  insert into public.attendee_console_audit(username,program,action,detail)
    values(p_username,p_program,'retry_delivery',jsonb_build_object('round_id',p_round_id,'delivery_id',p_id));
  return jsonb_build_object('ok',true,'queued',true);
end $function$

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
 execute format('select coalesce(jsonb_agg(z),''[]''::jsonb) from (select w.id,w.round_id,%s selection_type,r.title round_title,w.event_date,d.email,d.nickname,(w.submitted or a.id is not null) submitted,w.submitted_at,w.created_at,a.name,a.birth_date,a.nationality,a.phone,a.x_account,a.contact_email,a.account_email registration_email,a.muniverse_nickname registration_nickname,coalesce(w.submitted_at,a.consented_at) registered_at from public.%I w join public.attendee_rounds r on r.id=w.round_id left join public.%I d on d.winner_id=w.id left join public.%I a on a.winner_id=w.id where r.program=$1 order by w.created_at desc) z','w.selection_type',pre||'_winners',pre||'_winner_directory',pre||'_attendees') into wl using p_program;
 return jsonb_build_object('active_round_id',active_id,'config',c,'rounds',rs,'winners',wl);
end $function$

;

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
    execute format('insert into public.%I(winner_id,email,nickname) values($1,$2,$3) on conflict(winner_id) do update set email=excluded.email,nickname=excluded.nickname',pre||'_winner_directory') using wid,entry->>'email',entry->>'nickname';
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
    execute format('insert into public.%I(winner_id,email,nickname) values($1,$2,$3) on conflict(winner_id) do update set email=excluded.email,nickname=excluded.nickname',pre||'_winner_directory') using wid,p_data->>'email',p_data->>'nickname';
    execute format('update public.%I set used=true where winner_id=$1',pre||'_verification_sessions') using wid;
   end if;
   outcome=jsonb_build_object('ok',true,'round_id',rid,'was_submitted',submitted);
  else raise exception 'INVALID_ACTION';end if;
 end if;
 insert into public.attendee_console_audit(username,program,action,winner_id,detail) values(p_username,p_program,p_action,wid,jsonb_build_object('round_id',rid,'added',n,'selection_type',selection));
 return outcome;
end $function$

;

