-- Synthetic fixtures are rolled back within the exception block. No public
-- configuration, winner, submission, or delivery survives this test.
create or replace function pg_temp.privacy_regression() returns jsonb
language plpgsql as $test$
declare p text; rid uuid; wid uuid; h text; out jsonb; checks jsonb='[]'; boxes jsonb='[]'; v integer; before_counts jsonb; after_counts jsonb;
begin
 select jsonb_build_array((select count(*) from attendee_rounds),(select count(*) from music_core_winners),(select count(*) from cover_pick_winners),(select count(*) from enhypen_winner_list)) into before_counts;
 begin
 foreach p in array array['music_core','fans_pick'] loop
  h=encode(extensions.digest('privacy-fixture:'||p,'sha256'),'hex');
  out=attendee_round_mutate(p,'create_round',jsonb_build_object('title','Privacy rollback fixture'),'SECURITY_QA');rid=(out->>'round_id')::uuid;
  perform attendee_round_mutate(p,'save_config',jsonb_build_object('round_id',rid,'title','Privacy rollback fixture','expected_version',1,'event_date',(current_date+7)::text,'event_date_tba',false,'registration_open_at',(now()-interval '1 hour')::text,'registration_close_at',(now()+interval '1 hour')::text,'show_event_date',true,'test_mode',false,'registration_paused',false),'SECURITY_QA');
  perform attendee_round_mutate(p,'add_winners',jsonb_build_object('round_id',rid,'winners',jsonb_build_array(jsonb_build_object('email','privacy-fixture@example.invalid','nickname','Privacy Fixture','identity_hash',h,'email_hash',repeat('a',64),'nickname_hash',repeat('b',64)))),'SECURITY_QA');
  perform attendee_round_mutate(p,'publish_round',jsonb_build_object('round_id',rid,'expected_version',2),'SECURITY_QA');
  out=attendee_check_winner(p,h,repeat('a',64),repeat('b',64),'fixture','fixture');wid=(out->>'winner_id')::uuid;
  checks=checks||jsonb_build_array(jsonb_build_object('case',p||':lookup','pass',out->>'ok'='true'));
  out=attendee_commit_registration(p,wid,h,'privacy-fixture@example.invalid','Privacy Fixture','Privacy QA','KR',date '2000-01-01','010-0000-0000','@privacy_qa','privacy-fixture@example.invalid','fixture');
  checks=checks||jsonb_build_array(jsonb_build_object('case',p||':submit','pass',out->>'ok'='true','code',out->>'code'));
  if p='music_core' then
   select jsonb_build_object('pii_box',pii_box) into out from music_core_attendees where winner_id=wid;
   checks=checks||jsonb_build_array(jsonb_build_object('case',p||':ciphertext_only','pass',(select name is null and phone is null and birth_date is null and pii_box like 'pii:v1:%' from music_core_attendees where winner_id=wid)));
  else
   select jsonb_build_object('pii_box',pii_box) into out from cover_pick_attendees where winner_id=wid;
   checks=checks||jsonb_build_array(jsonb_build_object('case',p||':ciphertext_only','pass',(select name is null and phone is null and birth_date is null and pii_box like 'pii:v1:%' from cover_pick_attendees where winner_id=wid)));
  end if;
  boxes=boxes||jsonb_build_array(out);
  out=attendee_commit_registration(p,wid,h,'privacy-fixture@example.invalid','Privacy Fixture','Privacy QA','KR',date '2000-01-01','010-0000-0000','@privacy_qa','privacy-fixture@example.invalid','fixture');
  checks=checks||jsonb_build_array(jsonb_build_object('case',p||':duplicate','pass',out->>'code'='ALREADY_SUBMITTED'));
  out=attendee_round_data(p);
  checks=checks||jsonb_build_array(jsonb_build_object('case',p||':admin_ciphertext_contract','pass',exists(select 1 from jsonb_array_elements(out->'winners') w where w->>'id'=wid::text and w->>'_directory_pii' like 'pii:v1:%' and w->>'_registration_pii' like 'pii:v1:%')));
  insert into attendee_delivery_outbox(program,winner_id,round_id,payload) values(p,wid,rid,jsonb_build_object('name','Privacy QA','phone','010-0000-0000'));
  checks=checks||jsonb_build_array(jsonb_build_object('case',p||':outbox_encrypted','pass',(select payload ? '__pii' and not (payload ? 'name') from attendee_delivery_outbox where winner_id=wid)));
 end loop;
 h=encode(extensions.digest('privacy-fixture:enhypen','sha256'),'hex');
 insert into enhypen_winner_list(email,nickname,identity_hash,selection,consent_deadline) values('privacy-fixture@example.invalid','Privacy Fixture',h,'reserve',now()+interval '1 hour') returning id into wid;
 update enhypen_announcement set is_open=true where id;
 out=enhypen_record_consent_v2(h,jsonb_build_object('name','Privacy QA','phone','01000000000','birthDate','2000-01-01','contactEmail','privacy-fixture@example.invalid','nationality','KR','phoneMode','KR','xAccount','@privacy_qa'),'ko','2026-11-13-v2');
 checks=checks||jsonb_build_array(jsonb_build_object('case','enhypen:submit','pass',out->>'agreed'='true'));
 checks=checks||jsonb_build_array(jsonb_build_object('case','enhypen:ciphertext_only','pass',(select legal_name is null and phone is null and birth_date is null and pii_box like 'pii:v1:%' from enhypen_winner_consent where winner_id=wid)));
 select boxes||jsonb_build_array(jsonb_build_object('pii_box',pii_box)) into boxes from enhypen_winner_consent where winner_id=wid;
 raise exception using errcode='ZQ001',message='ROLLBACK_SYNTHETIC_FIXTURES';
 exception when sqlstate 'ZQ001' then null;
 end;
 select jsonb_build_array((select count(*) from attendee_rounds),(select count(*) from music_core_winners),(select count(*) from cover_pick_winners),(select count(*) from enhypen_winner_list)) into after_counts;
 return jsonb_build_object('checks',checks,'synthetic_boxes',boxes,'rollback_verified',before_counts=after_counts);
end $test$;
select pg_temp.privacy_regression();
