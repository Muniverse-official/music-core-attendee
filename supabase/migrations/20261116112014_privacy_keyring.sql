-- Public encryption key only; the private keyset is wrapped outside Postgres.
create schema if not exists attendee_privacy;
revoke all on schema attendee_privacy from public, anon, authenticated;
create table attendee_privacy.keyring (
  id text primary key,
  public_key text not null,
  wrapped_keyset text not null,
  created_at timestamptz not null default now()
);
alter table attendee_privacy.keyring enable row level security;
revoke all on attendee_privacy.keyring from public, anon, authenticated, service_role;
create or replace function public.attendee_privacy_keyring()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('id',id,'public_key',public_key,'wrapped_keyset',wrapped_keyset)
  from attendee_privacy.keyring where id='v1';
$$;
revoke all on function public.attendee_privacy_keyring() from public, anon, authenticated;
grant execute on function public.attendee_privacy_keyring() to service_role;
