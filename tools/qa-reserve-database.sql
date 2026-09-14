-- Run on the migrated schema. Fixtures and registration/outbox rows are rolled back.
begin;
do $test$
declare rid uuid;other_rid uuid;wid uuid;main_id uuid;fan_id uuid;out jsonb;config jsonb;before_count bigint;entry jsonb;legacy_job bigint;fan_winner uuid;
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
 assert out->>'selection_type'='reserve' and out->>'winner_id'=wid::text,'reserve lookup with registration identity';
 out=public.attendee_check_winner('music_core',repeat('d',64),repeat('b',64),repeat('f',64),'qa-mismatch','qa-mismatch');
 assert out->>'code'='WINNER_PARTIAL_MISMATCH','reserve partial identity mismatch';
 out=public.attendee_round_data('music_core');
 assert exists(select 1 from jsonb_array_elements(out->'winners') w where w->>'id'=wid::text and w->>'selection_type'='reserve'),'admin reserve list';
 out=public.attendee_commit_registration('music_core',wid,repeat('a',64),'reserve-qa@example.invalid','Reserve QA','QA','KR',date '2000-01-01','010-1234-5678','@qa_test','reserve-qa@example.invalid','qa-ip');
 assert out->>'ok'='true' and out->>'selection_type'='reserve' and out->>'delivery_queued'='false','reserve registration without primary delivery';
 assert (select submitted and selection_type='reserve' from public.music_core_winners where id=wid),'registration preserves reserve classification';
 assert (select count(*)=1 from public.music_core_attendees where winner_id=wid and name='QA' and birth_date=date '2000-01-01' and nationality='KR' and phone='010-1234-5678' and x_account='@qa_test' and contact_email='reserve-qa@example.invalid'),'same personal fields stored';
 assert not exists(select 1 from public.attendee_delivery_outbox where winner_id=wid),'reserve omitted from primary delivery';
 out=public.attendee_round_data('music_core');
 assert exists(select 1 from jsonb_array_elements(out->'winners') w where w->>'id'=wid::text and w->>'selection_type'='reserve' and w->>'submitted'='true' and w->>'phone'='010-1234-5678' and w->>'birth_date'='2000-01-01' and w->>'nationality'='KR'),'admin can retrieve registered reserve info';
 out=public.attendee_check_winner('music_core',repeat('a',64),repeat('b',64),repeat('c',64),'qa-registered','qa-registered');
 assert out->>'code'='ALREADY_SUBMITTED' and out->>'selection_type'='reserve','reserve duplicate lookup';
 out=public.attendee_commit_registration('music_core',wid,repeat('a',64),'reserve-qa@example.invalid','Reserve QA','QA','KR',date '2000-01-01','010-1234-5678','@qa_test','reserve-qa@example.invalid','qa-ip');
 assert out->>'code'='ALREADY_SUBMITTED' and out->>'selection_type'='reserve','reserve duplicate submission';
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
 assert (select count(*) from public.attendee_delivery_outbox)=before_count,'promotion does not enqueue sheet or mail delivery';
 out=public.attendee_check_winner('music_core',repeat('a',64),repeat('b',64),repeat('c',64),'qa-promoted','qa-promoted');
 assert out->>'code'='ALREADY_SUBMITTED' and out->>'selection_type'='primary','promoted winner does not register again';
 begin
  perform public.attendee_round_mutate('music_core','promote_reserve',jsonb_build_object('round_id',rid,'id',wid,'confirm',true),'qa-local');
  raise exception 'TEST_FAILED repeated promotion';
 exception when others then if sqlerrm <> 'NOT_RESERVE_WINNER' then raise;end if;end;
 out=public.attendee_commit_registration('music_core',wid,repeat('a',64),'reserve-qa@example.invalid','Reserve QA','QA','KR',date '2000-01-01','010-1234-5678','@qa_test','reserve-qa@example.invalid','qa-ip');
 assert out->>'code'='ALREADY_SUBMITTED','promoted registration remains complete';
 assert (select count(*)=1 from public.music_core_attendees where winner_id=wid),'single registration retained';
 assert not exists(select 1 from public.attendee_delivery_outbox where winner_id=wid),'promotion retains server records without exporting';
 out=public.attendee_check_winner('music_core',repeat('a',64),repeat('b',64),repeat('c',64),'qa-registered','qa-registered');
 assert out->>'code'='ALREADY_SUBMITTED','duplicate registration guard retained';
 entry=entry||jsonb_build_object('identity_hash',repeat('d',64),'email_hash',repeat('e',64),'nickname_hash',repeat('f',64));
 perform public.attendee_round_mutate('music_core','add_winners',jsonb_build_object('round_id',rid,'winners',jsonb_build_array(entry)),'qa-local');
 assert (select selection_type='primary' from public.music_core_winners where round_id=rid and identity_hash=repeat('d',64)),'default remains primary';
 select id into main_id from public.music_core_winners where round_id=rid and identity_hash=repeat('d',64);
 out=public.attendee_commit_registration('music_core',main_id,repeat('d',64),'primary-qa@example.invalid','Primary QA','Primary QA','KR',date '2000-01-01','010-1234-5678','@qa_test','primary-qa@example.invalid','qa-ip');
 assert out->>'ok'='true' and out->>'delivery_queued'='false','primary registration saved without sheet delivery';
 assert not exists(select 1 from public.attendee_delivery_outbox where winner_id=main_id),'no primary delivery queued';
 out=public.attendee_round_data('music_core');
 assert exists(select 1 from jsonb_array_elements(out->'winners') w where w->>'id'=main_id::text and w->>'registration_email'='primary-qa@example.invalid' and w->>'registration_nickname'='Primary QA' and w->>'registered_at' is not null),'registered record has original identity and time';
 insert into public.attendee_delivery_outbox(program,winner_id,round_id,payload) values('music_core',main_id,rid,'{}') returning id into legacy_job;
 assert not exists(select 1 from public.attendee_delivery_claim(200) where id=legacy_job),'legacy music jobs are excluded from dispatch';
 update public.attendee_delivery_outbox set status='processing',locked_at=now() where id=legacy_job;
 assert public.attendee_delivery_is_current(legacy_job)=false,'in-flight music recheck rejects external delivery';
 update public.attendee_delivery_outbox set status='failed',locked_at=null where id=legacy_job;
 begin
  perform public.attendee_delivery_retry('music_core',rid,legacy_job,'qa-local');
  raise exception 'TEST_FAILED music delivery retry accepted';
 exception when others then if sqlerrm <> 'DELIVERY_DISABLED' then raise;end if;end;
 update public.attendee_rounds set config=jsonb_set(attendee_rounds.config,'{registration_close_at}',to_jsonb((now()-interval '1 minute')::text)) where id=rid;
 out=public.attendee_check_winner('music_core',repeat('d',64),repeat('e',64),repeat('f',64),'qa-close','qa-close');
 assert out->>'code'='CLOSED','existing closing deadline enforced';
end $test$;
rollback;

-- Repeat the same contract for FANS PICK.
-- Run on the migrated schema. Fixtures and registration/outbox rows are rolled back.
begin;
do $test$
declare rid uuid;other_rid uuid;wid uuid;main_id uuid;fan_id uuid;out jsonb;config jsonb;before_count bigint;entry jsonb;legacy_job bigint;fan_winner uuid;
begin
 config=jsonb_build_object('event_date',((now() at time zone 'Asia/Seoul')::date+7)::text,'event_date_tba','false','registration_open_at',(now()-interval '1 hour')::text,'registration_close_at',(now()+interval '1 hour')::text,'show_event_date','false','test_mode','false','registration_paused','false');
 update public.attendee_rounds set is_public=false where is_public;
 insert into public.attendee_rounds(program,title,config,is_public) values('fans_pick','RESERVE QA '||gen_random_uuid(),config,true) returning id into rid;
 insert into public.attendee_rounds(program,title,config,is_public) values('fans_pick','RESERVE QA other '||gen_random_uuid(),config,false) returning id into other_rid;
 perform public.attendee_round_sync_runtime(rid);
 entry=jsonb_build_object('email','reserve-qa@example.invalid','nickname','Reserve QA','identity_hash',repeat('a',64),'email_hash',repeat('b',64),'nickname_hash',repeat('c',64));
 out=public.attendee_round_mutate('fans_pick','add_winners',jsonb_build_object('round_id',rid,'selection_type','reserve','winners',jsonb_build_array(entry)),'qa-local');
 assert (out->>'added')::int=1,'reserve added';
 select id into wid from public.cover_pick_winners where round_id=rid and identity_hash=repeat('a',64);
 out=public.attendee_check_winner('fans_pick',repeat('a',64),repeat('b',64),repeat('c',64),'qa-reserve','qa-reserve');
 assert out->>'selection_type'='reserve' and out->>'winner_id'=wid::text,'reserve lookup with registration identity';
 out=public.attendee_check_winner('fans_pick',repeat('d',64),repeat('b',64),repeat('f',64),'qa-mismatch','qa-mismatch');
 assert out->>'code'='IDENTITY_MISMATCH','reserve partial identity mismatch';
 out=public.attendee_round_data('fans_pick');
 assert exists(select 1 from jsonb_array_elements(out->'winners') w where w->>'id'=wid::text and w->>'selection_type'='reserve'),'admin reserve list';
 out=public.attendee_commit_registration('fans_pick',wid,repeat('a',64),'reserve-qa@example.invalid','Reserve QA','QA','KR',date '2000-01-01','010-1234-5678','@qa_test','reserve-qa@example.invalid','qa-ip');
 assert out->>'ok'='true' and out->>'selection_type'='reserve' and out->>'delivery_queued'='false','reserve registration without primary delivery';
 assert (select submitted and selection_type='reserve' from public.cover_pick_winners where id=wid),'registration preserves reserve classification';
 assert (select count(*)=1 from public.cover_pick_attendees where winner_id=wid and name='QA' and birth_date=date '2000-01-01' and nationality='KR' and phone='010-1234-5678' and x_account='@qa_test' and contact_email='reserve-qa@example.invalid'),'same personal fields stored';
 assert not exists(select 1 from public.attendee_delivery_outbox where winner_id=wid),'reserve omitted from primary delivery';
 out=public.attendee_round_data('fans_pick');
 assert exists(select 1 from jsonb_array_elements(out->'winners') w where w->>'id'=wid::text and w->>'selection_type'='reserve' and w->>'submitted'='true' and w->>'phone'='010-1234-5678' and w->>'birth_date'='2000-01-01' and w->>'nationality'='KR'),'admin can retrieve registered reserve info';
 out=public.attendee_check_winner('fans_pick',repeat('a',64),repeat('b',64),repeat('c',64),'qa-registered','qa-registered');
 assert out->>'code'='ALREADY_SUBMITTED' and out->>'selection_type'='reserve','reserve duplicate lookup';
 out=public.attendee_commit_registration('fans_pick',wid,repeat('a',64),'reserve-qa@example.invalid','Reserve QA','QA','KR',date '2000-01-01','010-1234-5678','@qa_test','reserve-qa@example.invalid','qa-ip');
 assert out->>'code'='ALREADY_SUBMITTED' and out->>'selection_type'='reserve','reserve duplicate submission';
 begin
  perform public.attendee_round_mutate('fans_pick','add_winners',jsonb_build_object('round_id',rid,'winners',jsonb_build_array(entry)),'qa-local');
  raise exception 'TEST_FAILED expected cross-list conflict';
 exception when others then if sqlerrm <> 'WINNER_LIST_CONFLICT' then raise;end if;end;
 out=public.attendee_round_mutate('fans_pick','add_winners',jsonb_build_object('round_id',rid,'selection_type','reserve','winners',jsonb_build_array(entry)),'qa-local');
 assert (out->>'duplicates')::int=1 and (out->>'added')::int=0,'same-list deduplication';
 begin
  perform public.attendee_round_mutate('fans_pick','promote_reserve',jsonb_build_object('round_id',other_rid,'id',wid,'confirm',true),'qa-local');
  raise exception 'TEST_FAILED cross-round promotion';
 exception when others then if sqlerrm <> 'WINNER_NOT_FOUND' then raise;end if;end;
 perform public.attendee_round_mutate('fans_pick','update_winner',jsonb_build_object('round_id',rid,'id',wid)||entry||jsonb_build_object('nickname','Reserve QA updated'),'qa-local');
 assert (select selection_type='reserve' from public.cover_pick_winners where id=wid),'editing preserves reserve';
 select count(*) into before_count from public.attendee_delivery_outbox;
 perform public.attendee_round_mutate('fans_pick','promote_reserve',jsonb_build_object('round_id',rid,'id',wid,'confirm',true),'qa-local');
 assert (select count(*) from public.attendee_delivery_outbox)=before_count,'promotion does not enqueue sheet or mail delivery';
 out=public.attendee_check_winner('fans_pick',repeat('a',64),repeat('b',64),repeat('c',64),'qa-promoted','qa-promoted');
 assert out->>'code'='ALREADY_SUBMITTED' and out->>'selection_type'='primary','promoted winner does not register again';
 begin
  perform public.attendee_round_mutate('fans_pick','promote_reserve',jsonb_build_object('round_id',rid,'id',wid,'confirm',true),'qa-local');
  raise exception 'TEST_FAILED repeated promotion';
 exception when others then if sqlerrm <> 'NOT_RESERVE_WINNER' then raise;end if;end;
 out=public.attendee_commit_registration('fans_pick',wid,repeat('a',64),'reserve-qa@example.invalid','Reserve QA','QA','KR',date '2000-01-01','010-1234-5678','@qa_test','reserve-qa@example.invalid','qa-ip');
 assert out->>'code'='ALREADY_SUBMITTED','promoted registration remains complete';
 assert (select count(*)=1 from public.cover_pick_attendees where winner_id=wid),'single registration retained';
 assert not exists(select 1 from public.attendee_delivery_outbox where winner_id=wid),'promotion retains server records without exporting';
 out=public.attendee_check_winner('fans_pick',repeat('a',64),repeat('b',64),repeat('c',64),'qa-registered','qa-registered');
 assert out->>'code'='ALREADY_SUBMITTED','duplicate registration guard retained';
 entry=entry||jsonb_build_object('identity_hash',repeat('d',64),'email_hash',repeat('e',64),'nickname_hash',repeat('f',64));
 perform public.attendee_round_mutate('fans_pick','add_winners',jsonb_build_object('round_id',rid,'winners',jsonb_build_array(entry)),'qa-local');
 assert (select selection_type='primary' from public.cover_pick_winners where round_id=rid and identity_hash=repeat('d',64)),'default remains primary';
 select id into main_id from public.cover_pick_winners where round_id=rid and identity_hash=repeat('d',64);
 out=public.attendee_commit_registration('fans_pick',main_id,repeat('d',64),'primary-qa@example.invalid','Primary QA','Primary QA','KR',date '2000-01-01','010-1234-5678','@qa_test','primary-qa@example.invalid','qa-ip');
 assert out->>'ok'='true' and out->>'delivery_queued'='false','primary registration saved without sheet delivery';
 assert not exists(select 1 from public.attendee_delivery_outbox where winner_id=main_id),'no primary delivery queued';
 out=public.attendee_round_data('fans_pick');
 assert exists(select 1 from jsonb_array_elements(out->'winners') w where w->>'id'=main_id::text and w->>'registration_email'='primary-qa@example.invalid' and w->>'registration_nickname'='Primary QA' and w->>'registered_at' is not null),'registered record has original identity and time';
 insert into public.attendee_delivery_outbox(program,winner_id,round_id,payload) values('fans_pick',main_id,rid,'{}') returning id into legacy_job;
 assert not exists(select 1 from public.attendee_delivery_claim(200) where id=legacy_job),'legacy music jobs are excluded from dispatch';
 update public.attendee_delivery_outbox set status='processing',locked_at=now() where id=legacy_job;
 assert public.attendee_delivery_is_current(legacy_job)=false,'in-flight music recheck rejects external delivery';
 update public.attendee_delivery_outbox set status='failed',locked_at=null where id=legacy_job;
 begin
  perform public.attendee_delivery_retry('fans_pick',rid,legacy_job,'qa-local');
  raise exception 'TEST_FAILED music delivery retry accepted';
 exception when others then if sqlerrm <> 'DELIVERY_DISABLED' then raise;end if;end;
 update public.attendee_rounds set config=jsonb_set(attendee_rounds.config,'{registration_close_at}',to_jsonb((now()-interval '1 minute')::text)) where id=rid;
 out=public.attendee_check_winner('fans_pick',repeat('d',64),repeat('e',64),repeat('f',64),'qa-close','qa-close');
 assert out->>'code'='CLOSED','existing closing deadline enforced';
end $test$;
rollback;
