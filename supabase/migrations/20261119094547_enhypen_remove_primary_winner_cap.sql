-- Remove the seat-allocation count from administrator list management.
-- Reserve import remains limited to 30 entries; number uniqueness stays enforced.
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
    allowed := case kind when 'reserve' then 30 when 'primary' then null else 0 end;
    for item in select * from jsonb_array_elements(p_data->'rows') loop
      insert into public.enhypen_winner_list(email,nickname,identity_hash,selection,winner_number)
      values (item->>'email',item->>'nickname',item->>'hash',kind,item->>'number');
      added := added + 1;
    end loop;
    if allowed is not null and total + added > allowed then raise exception 'CAPACITY'; end if;
  else
    select * into target from public.enhypen_winner_list where id = (p_data->>'id')::uuid;
    if not found then raise exception 'WINNER_MISSING'; end if;
    if p_action = 'promote' and target.selection = 'reserve' then
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

