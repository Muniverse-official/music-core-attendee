alter table public.music_core_winner_directory add column if not exists pii_box text;
alter table public.cover_pick_winner_directory add column if not exists pii_box text;
alter table public.enhypen_winner_list add column if not exists pii_box text;
alter table public.music_core_attendees add column if not exists pii_box text;
alter table public.cover_pick_attendees add column if not exists pii_box text;
alter table public.enhypen_winner_consent add column if not exists pii_box text;
alter table public.music_core_verification_sessions add column if not exists pii_box text;
alter table public.cover_pick_verification_sessions add column if not exists pii_box text;
notify pgrst, 'reload schema';
