-- Delivery safety for both audience programs. Application rows and schedules are preserved.
create table if not exists public.attendee_delivery_health (
  program text primary key check (program in ('music_core','fans_pick')),
  status text not null,
  version integer,
  last_error text,
  checked_at timestamptz not null default now()
);
alter table public.attendee_delivery_health enable row level security;
revoke all on public.attendee_delivery_health from public, anon, authenticated;
grant all on public.attendee_delivery_health to service_role;

create or replace function public.attendee_delete_delivery_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare job record;
begin
  -- Lock the same rows used by claim(), so deletion cannot race a new delivery claim.
  for job in select status,locked_at from public.attendee_delivery_outbox
    where program=TG_ARGV[0] and winner_id=old.id order by id for update
  loop
    if job.status='processing' and (job.locked_at is null or job.locked_at>clock_timestamp()-interval '15 minutes') then
      raise exception 'DELIVERY_IN_PROGRESS';
    end if;
  end loop;
  delete from public.attendee_delivery_outbox where program=TG_ARGV[0] and winner_id=old.id;
  return old;
end $$;
drop trigger if exists attendee_delete_delivery on public.music_core_winners;
create trigger attendee_delete_delivery before delete on public.music_core_winners
  for each row execute function public.attendee_delete_delivery_guard('music_core');
drop trigger if exists attendee_delete_delivery on public.cover_pick_winners;
create trigger attendee_delete_delivery before delete on public.cover_pick_winners
  for each row execute function public.attendee_delete_delivery_guard('fans_pick');

create or replace function public.attendee_delivery_is_current(p_id bigint)
returns boolean language sql stable set search_path=pg_catalog,public as $$
  select exists(select 1 from public.attendee_delivery_outbox o where o.id=p_id and o.status='processing'
    and o.locked_at>now()-interval '15 minutes'
    and case when o.program='music_core'
      then exists(select 1 from public.music_core_winners w where w.id=o.winner_id and w.round_id=o.round_id)
      else exists(select 1 from public.cover_pick_winners w where w.id=o.winner_id and w.round_id=o.round_id) end);
$$;

create or replace function public.attendee_delivery_finish(p_id bigint,p_ok boolean,p_sheet_updated boolean,p_email_sent boolean,p_error text default null)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare job public.attendee_delivery_outbox; sheet_ok boolean; email_ok boolean;
begin
  select * into job from public.attendee_delivery_outbox where id=p_id for update;
  if not found or job.status<>'processing' then return; end if;
  sheet_ok=coalesce(job.sheet_updated,false) or coalesce(p_sheet_updated,false);
  email_ok=coalesce(job.email_sent,false) or coalesce(p_email_sent,false);
  update public.attendee_delivery_outbox set sheet_updated=sheet_ok,email_sent=email_ok,
    status=case when sheet_ok and email_ok then 'done' when job.attempts>=6 or coalesce(p_error,'') like '%EMAIL_STATUS_UNCERTAIN%' then 'failed' else 'pending' end,
    last_error=case when sheet_ok and email_ok then null else left(coalesce(p_error,'delivery failed'),1000) end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^greatest(job.attempts-1,0)))) ,
    locked_at=null,updated_at=clock_timestamp() where id=p_id;
end $$;

create or replace function public.attendee_delivery_console()
returns jsonb language sql stable set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'health',(select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from public.attendee_delivery_health h),
    'jobs',(select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from (
      select id,program,round_id,winner_id,status,attempts,sheet_updated,email_sent,last_error,updated_at
      from public.attendee_delivery_outbox order by id desc limit 2000
    ) j));
$$;

create or replace function public.attendee_delivery_retry(p_program text,p_round_id uuid,p_id bigint,p_username text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare job public.attendee_delivery_outbox;
begin
  if p_program not in ('music_core','fans_pick') then raise exception 'INVALID_PROGRAM';end if;
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
end $$;

revoke all on function public.attendee_delete_delivery_guard() from public,anon,authenticated;
revoke all on function public.attendee_delivery_is_current(bigint) from public,anon,authenticated;
revoke all on function public.attendee_delivery_console() from public,anon,authenticated;
revoke all on function public.attendee_delivery_retry(text,uuid,bigint,text) from public,anon,authenticated;
revoke all on function public.attendee_delivery_finish(bigint,boolean,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.attendee_delete_delivery_guard(),public.attendee_delivery_is_current(bigint),public.attendee_delivery_console(),public.attendee_delivery_retry(text,uuid,bigint,text),public.attendee_delivery_finish(bigint,boolean,boolean,boolean,text) to service_role;

-- Remove only orphaned, inactive payloads left by the old delete path.
delete from public.attendee_delivery_outbox o
where (o.status<>'processing' or o.locked_at<now()-interval '15 minutes')
  and case when o.program='music_core'
    then not exists(select 1 from public.music_core_winners w where w.id=o.winner_id)
    else not exists(select 1 from public.cover_pick_winners w where w.id=o.winner_id) end;

CREATE OR REPLACE FUNCTION public.attendee_round_public_context(p_program text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare r public.attendee_rounds;rt text;h jsonb;begin
 if p_program not in ('music_core','fans_pick') then raise exception 'INVALID_PROGRAM';end if;
 select * into r from public.attendee_rounds where program=p_program and is_public and not archived;
 if not found then return null;end if;
 rt=case when p_program='music_core' then 'music_core_runtime_config' else 'cover_pick_runtime_config' end;
 execute format('select coalesce(jsonb_object_agg(key,value),''{}''::jsonb) from public.%I where key=any($1)',rt) into h using array['webhook_token','apps_script_url'];
 return r.config||h||jsonb_build_object('round_id',r.id,'round_title',r.title,'version',r.version);
end $function$

