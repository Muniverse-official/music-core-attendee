-- Keep the legacy attendee_round_data response available while the admin UI rolls out.
-- The scoped API returns all round metadata but decrypts only the selected round.
create function public.attendee_round_data_scoped(
  p_program text,
  p_round_id uuid,
  p_include_winners boolean
) returns jsonb
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  pre text;
  rs jsonb;
  wl jsonb := '[]'::jsonb;
  active_id uuid;
  loaded_id uuid;
  c jsonb;
begin
  if p_program not in ('music_core', 'fans_pick') then
    raise exception 'INVALID_PROGRAM';
  end if;
  pre := case when p_program = 'music_core' then 'music_core' else 'cover_pick' end;

  select id, config into active_id, c
    from public.attendee_rounds
   where program = p_program and is_public and not archived
   limit 1;

  if p_include_winners then
    loaded_id := coalesce(
      p_round_id,
      active_id,
      (select id from public.attendee_rounds
        where program = p_program and not archived
        order by created_at desc limit 1),
      (select id from public.attendee_rounds
        where program = p_program
        order by created_at desc limit 1)
    );
    if loaded_id is not null and not exists (
      select 1 from public.attendee_rounds
       where id = loaded_id and program = p_program
    ) then
      raise exception 'ROUND_NOT_FOUND';
    end if;
  end if;

  execute format($sql$
    select coalesce(jsonb_agg(
      to_jsonb(r) || jsonb_build_object(
        'primary_count', counts.primary_count,
        'reserve_count', counts.reserve_count,
        'registered_count', counts.registered_count
      ) order by r.is_public desc, r.archived, r.created_at desc
    ), '[]'::jsonb)
      from public.attendee_rounds r
      cross join lateral (
        select count(*) filter (where w.selection_type = 'primary') as primary_count,
               count(*) filter (where w.selection_type = 'reserve') as reserve_count,
               count(*) filter (where w.submitted or a.id is not null) as registered_count
          from public.%I w
          left join public.%I a on a.winner_id = w.id
         where w.round_id = r.id
      ) counts
     where r.program = $1
  $sql$, pre || '_winners', pre || '_attendees') into rs using p_program;

  if loaded_id is not null then
    execute format($sql$
      select coalesce(jsonb_agg(z), '[]'::jsonb)
        from (
          select w.id, w.round_id, w.selection_type, r.title round_title,
                 w.event_date, d.email, d.nickname,
                 d.pii_box _directory_pii, a.pii_box _registration_pii,
                 (w.submitted or a.id is not null) submitted,
                 w.submitted_at, w.created_at,
                 a.name, a.birth_date, a.nationality, a.phone,
                 a.x_account, a.contact_email,
                 a.account_email registration_email,
                 a.muniverse_nickname registration_nickname,
                 coalesce(w.submitted_at, a.consented_at) registered_at
            from public.%I w
            join public.attendee_rounds r on r.id = w.round_id
            left join public.%I d on d.winner_id = w.id
            left join public.%I a on a.winner_id = w.id
           where r.program = $1 and w.round_id = $2
           order by w.created_at desc
        ) z
    $sql$, pre || '_winners', pre || '_winner_directory', pre || '_attendees')
      into wl using p_program, loaded_id;
  end if;

  return jsonb_build_object(
    'active_round_id', active_id,
    'loaded_round_id', loaded_id,
    'config', c,
    'rounds', rs,
    'winners', wl
  );
end;
$function$;

revoke all on function public.attendee_round_data_scoped(text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.attendee_round_data_scoped(text, uuid, boolean)
  to service_role;
