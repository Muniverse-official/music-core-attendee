-- Application-layer security indexes and access hardening for SHOW! MUSIC CORE.
create unique index if not exists music_core_winner_event_identity_uq on public.music_core_winners(event_date, identity_hash);
create unique index if not exists music_core_sessions_token_uq on public.music_core_verification_sessions(token_hash);
create unique index if not exists music_core_attendees_winner_uq on public.music_core_attendees(winner_id);
create index if not exists music_core_rate_lookup_idx on public.music_core_rate_limits(ip_hash, action, created_at desc);
create index if not exists music_core_rate_burst_idx on public.music_core_rate_limits(ip_hash, created_at desc);

alter table public.music_core_winners enable row level security;
alter table public.music_core_attendees enable row level security;
alter table public.music_core_verification_sessions enable row level security;
alter table public.music_core_rate_limits enable row level security;
alter table public.music_core_audit_log enable row level security;

revoke all on public.music_core_winners from anon, authenticated;
revoke all on public.music_core_attendees from anon, authenticated;
revoke all on public.music_core_verification_sessions from anon, authenticated;
revoke all on public.music_core_rate_limits from anon, authenticated;
revoke all on public.music_core_audit_log from anon, authenticated;
