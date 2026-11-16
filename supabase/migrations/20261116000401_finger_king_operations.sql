create schema finger_king;
revoke all on schema finger_king from public, anon, authenticated;

create table finger_king.rounds (
  id text primary key,
  title text not null,
  announce_at bigint,
  close_at bigint,
  purge_at bigint,
  territory text check (territory in ('kr', 'world')),
  published_at bigint,
  paused_at bigint,
  completed_at bigint,
  kr_import integer not null default 0 check (kr_import in (0, 1)),
  tw_express integer not null default 0 check (tw_express in (0, 1)),
  created_at bigint not null
);
create table finger_king.winners (
  id text primary key,
  round_id text not null references finger_king.rounds(id),
  account_key text not null,
  match_key text not null,
  identity_box text,
  prize text not null,
  delivery_box text,
  submitted_at bigint,
  shipped_at bigint,
  registration_order bigint generated always as identity,
  unique (round_id, account_key)
);
create index finger_king_winners_round_match on finger_king.winners(round_id, match_key);
create table finger_king.rate_limits (
  bucket text primary key,
  hits integer not null,
  expires_at bigint not null
);
create index finger_king_rate_expiry on finger_king.rate_limits(expires_at);
create table finger_king.configuration (
  singleton boolean primary key default true check (singleton),
  secret text not null
);
insert into finger_king.configuration(secret) values (gen_random_uuid()::text || gen_random_uuid()::text);

alter table finger_king.rounds enable row level security;
alter table finger_king.winners enable row level security;
alter table finger_king.rate_limits enable row level security;
alter table finger_king.configuration enable row level security;
revoke all on all tables in schema finger_king from public, anon, authenticated;
