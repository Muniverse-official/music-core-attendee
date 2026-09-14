-- Run on the migrated schema. Fixtures and registration/outbox rows are rolled back.
begin;
do $test$
declare rid uuid;other_rid uuid;wid uuid;main_id uuid;fan_id uuid;out jsonb;config jsonb;before_count bigint;entry jsonb;
begin
 config=jsonb_build_object('event_date',((now() at time zone 'Asia/Seoul')::date+7)::text,'event_date_tba','false','registration_open_at',(now()-interval '1 hour')::text,'registration_close_at',(now()+interval '1 hour')::text,'show_event_date','false','test_mode','false','registration_paused','false');
 update public.attendee_rounds set is_public=false where is_public;
 insert into public.attendee_rounds(program,title,config,is_public) values('music_core','RESERVE QA '||gen_random_uuid(),config,true) returning id into rid;
 insert into public.attendee_rounds(program,title,config,is_public) values('music_core','RESERVE QA other '||gen_random_uuid(),config,false) returning id into other_rid;
 entry=jsonb_build_object('email','reserve-qa@example.invalid','nickname','Reserve QA','identity_hash',repeat('a',64),'email_hash',repeat('b',64),'nickname_hash',repeat('c',64));
 out=public.attendee_round_mutate('music_core','add_winners',jsonb_build_object('round_id',rid,'selection_type','reserve','winners',jsonb_build_array(entry)),'qa-local');
 assert (out->>'added')::int=1,'reserve added';
 select id into wid from public.music_core_winners where round_id=rid and identity_hash=repeat('a',64);
 out=public.attendee_check_winner('music_core',repeat('a',64),repeat('b',64),repeat('c',64),'qa-reserve','qa-reserve');
 assert out->>'selection_type'='reserve' and not(out?'winner_id'),'reserve lookup without eligible winner id';
 out=public.attendee_check_winner('music_core',repeat('d',64),repeat('b',64),repeat('f',64),'qa-mismatch','qa-mismatch');
 assert out->>'code'='WINNER_PARTIAL_MISMATCH','reserve partial identity mismatch';
 out=public.attendee_round_data('music_core');
 assert exists(select 1 from jsonb_array_elements(out->'winners') w where w->>'id'=wid::text and w->>'selection_type'='reserve'),'admin reserve list';
 out=public.attendee_commit_registration('music_core',wid,repeat('a',64),'reserve-qa@example.invalid','Reserve QA','QA','KR',date '2000-01-01','010-1234-5678','@qa_test','reserve-qa@example.invalid','qa-ip');
 assert out->>'code'='RESERVE_NOT_ELIGIBLE','reserve registration rejected';
 begin
  insert into public.music_core_attendees(winner_id,account_email,muniverse_nickname,name,nationality,birth_date,phone,x_account,contact_email,event_date,consent_version,consented_at)
  values(wid,'reserve-qa@example.invalid','QA','QA','KR',date '2000-01-01','010-1234-5678','@qa_test','reserve-qa@example.invalid',(config->>'event_date')::date,'qa',now());
  raise exception 'TEST_FAILED legacy direct registration';
 exception when others then if sqlerrm <> 'RESERVE_NOT_ELIGIBLE' then raise;end if;end;
 begin
  perform public.attendee_round_mutate('music_core','add_winners',jsonb_build_object('round_id',rid,'winners',jsonb_build_array(entry)),'qa-local');
  raise exception 'TEST_FAILED expected cross-list conflict';
 exception when others then if sqlerrm <> 'WINNER_LIST_CONFLICT' then raise;end if;end;
 out=public.attendee_round_mutate('music_core','add_winners',jsonb_build_object('round_id',rid,'selection_type','reserve','winners',jsonb_build_array(entry)),'qa-local');
 assert (out->>'duplicates')::int=1 and (out->>'added')::int=0,'same-list deduplication';
 begin
  perform public.attendee_round_mutate('music_core','promote_reserve',jsonb_build_object('round_id',other_rid,'id',wid,'confirm',true),'qa-local');
  raise exception 'TEST_FAILED cross-round promotion';
 exception when others then if sqlerrm <> 'WINNER_NOT_FOUND' then raise;end if;end;
 perform public.attendee_round_mutate('music_core','update_winner',jsonb_build_object('round_id',rid,'id',wid)||entry||jsonb_build_object('nickname','Reserve QA updated'),'qa-local');
 assert (select selection_type='reserve' from public.music_core_winners where id=wid),'editing preserves reserve';
 select count(*) into before_count from public.attendee_delivery_outbox;
 perform public.attendee_round_mutate('music_core','promote_reserve',jsonb_build_object('round_id',rid,'id',wid,'confirm',true),'qa-local');
 assert (select count(*) from public.attendee_delivery_outbox)=before_count,'promotion does not contact recipients';
 out=public.attendee_check_winner('music_core',repeat('a',64),repeat('b',64),repeat('c',64),'qa-promoted','qa-promoted');
 assert out->>'ok'='true' and out->>'winner_id'=wid::text and coalesce(out->>'selection_type','primary')='primary','promoted primary lookup';
 begin
  perform public.attendee_round_mutate('music_core','promote_reserve',jsonb_build_object('round_id',rid,'id',wid,'confirm',true),'qa-local');
  raise exception 'TEST_FAILED repeated promotion';
 exception when others then if sqlerrm <> 'NOT_RESERVE_WINNER' then raise;end if;end;
 out=public.attendee_commit_registration('music_core',wid,repeat('a',64),'reserve-qa@example.invalid','Reserve QA','QA','KR',date '2000-01-01','010-1234-5678','@qa_test','reserve-qa@example.invalid','qa-ip');
 assert out->>'ok'='true' and out->>'registered'='true','promoted winner can register';
 out=public.attendee_check_winner('music_core',repeat('a',64),repeat('b',64),repeat('c',64),'qa-registered','qa-registered');
 assert out->>'code'='ALREADY_SUBMITTED','duplicate registration guard retained';
 entry=entry||jsonb_build_object('identity_hash',repeat('d',64),'email_hash',repeat('e',64),'nickname_hash',repeat('f',64));
 perform public.attendee_round_mutate('music_core','add_winners',jsonb_build_object('round_id',rid,'winners',jsonb_build_array(entry)),'qa-local');
 assert (select selection_type='primary' from public.music_core_winners where round_id=rid and identity_hash=repeat('d',64)),'default remains primary';
 update public.attendee_rounds set config=jsonb_set(attendee_rounds.config,'{registration_close_at}',to_jsonb((now()-interval '1 minute')::text)) where id=rid;
 out=public.attendee_check_winner('music_core',repeat('d',64),repeat('e',64),repeat('f',64),'qa-close','qa-close');
 assert out->>'code'='CLOSED','existing closing deadline enforced';
 insert into public.attendee_rounds(program,title,config,is_public) values('fans_pick','RESERVE QA fans '||gen_random_uuid(),config,true) returning id into fan_id;
 perform public.attendee_round_mutate('fans_pick','add_winners',jsonb_build_object('round_id',fan_id,'winners',jsonb_build_array(entry)),'qa-local');
 out=public.attendee_check_winner('fans_pick',repeat('d',64),repeat('e',64),repeat('f',64),'qa-fans','qa-fans');
 assert out->>'ok'='true' and out?'winner_id','fans pick remains eligible';
 out=public.attendee_round_data('fans_pick');
 assert not exists(select 1 from jsonb_array_elements(out->'winners') w where w->>'selection_type'<>'primary'),'fans pick default list';
end $test$;

rollback;
