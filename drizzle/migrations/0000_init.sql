-- SBL 2026 — initial schema (PRD §5 + profiles substitution for Supabase Auth)
-- Apply via Supabase MCP `apply_migration`. Idempotent guards are intentionally absent;
-- this migration runs once on a clean database.

create extension if not exists "pgcrypto";

-- ─── reference data ────────────────────────────────────────────────────────────

create table public.categories (
  id            text primary key,
  name          text not null,
  group_format  text not null,
  ko_format     text not null default 'bo3_21_cap30'
);

create table public.groups (
  id          text primary key,
  category_id text not null references public.categories(id),
  label       text not null,
  team_count  integer not null
);

create table public.companies (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  group_id    text not null references public.groups(id),
  seed        integer not null,
  name        text not null,
  players     text not null,
  company_id  uuid references public.companies(id)
);
create unique index teams_group_seed_uniq on public.teams (group_id, seed);
create unique index teams_group_name_uniq on public.teams (group_id, name);

create table public.courts (
  id   text primary key,
  name text not null
);

-- ─── matches (PRD §5) ──────────────────────────────────────────────────────────

create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  external_key    text not null unique,
  category_id     text not null references public.categories(id),
  stage           text not null,
  group_id        text references public.groups(id),
  round_label     text,
  slot_number     integer,
  scheduled_time  text not null,
  scheduled_start timestamptz,
  court_id        text not null references public.courts(id),
  team_a_id       uuid references public.teams(id),
  team_b_id       uuid references public.teams(id),
  team_a_source   text,
  team_b_source   text,
  status          text not null default 'scheduled',
  started_at      timestamptz,
  ended_at        timestamptz,
  winner_team_id  uuid references public.teams(id),
  games           jsonb not null default '[]'::jsonb,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint matches_status_chk check (status in ('scheduled','live','completed','walkover','void')),
  constraint matches_stage_chk  check (stage  in ('group','qf','sf','final'))
);
create index matches_court_time_idx on public.matches (court_id, scheduled_start);
create index matches_status_idx     on public.matches (status);
create index matches_group_idx      on public.matches (group_id) where group_id is not null;

-- ─── identity (Supabase Auth substitution) ─────────────────────────────────────

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text not null unique,
  display_name    text not null,
  role            text not null default 'scorer',
  is_active       boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  constraint profiles_role_chk check (role in ('scorer','admin'))
);

create table public.scorer_courts (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  court_id text not null references public.courts(id),
  primary key (user_id, court_id)
);

-- ─── audit + overrides + standings cache (PRD §5) ──────────────────────────────

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id),
  match_id    uuid references public.matches(id),
  action      text not null,
  before_json jsonb,
  after_json  jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_match_idx on public.audit_log (match_id, created_at desc);

create table public.group_qualifier_overrides (
  group_id           text primary key references public.groups(id),
  winner_team_id     uuid references public.teams(id),
  runner_up_team_id  uuid references public.teams(id),
  set_by_user_id     uuid references public.profiles(id),
  set_at             timestamptz not null default now(),
  reason             text
);

create table public.group_standings (
  group_id        text not null references public.groups(id),
  team_id         uuid not null references public.teams(id),
  played          integer not null default 0,
  wins            integer not null default 0,
  losses          integer not null default 0,
  points          integer not null default 0,
  sets_won        integer not null default 0,
  sets_lost       integer not null default 0,
  pts_scored      integer not null default 0,
  pts_conceded    integer not null default 0,
  rank            integer,
  is_qualifier    boolean not null default false,
  qualifier_role  text,
  updated_at      timestamptz not null default now(),
  primary key (group_id, team_id)
);

-- ─── auto-update matches.updated_at on every UPDATE ────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger matches_touch_updated_at
  before update on public.matches
  for each row execute function public.touch_updated_at();

-- ─── RLS: enable on every public table ─────────────────────────────────────────

alter table public.categories                enable row level security;
alter table public.groups                    enable row level security;
alter table public.companies                 enable row level security;
alter table public.teams                     enable row level security;
alter table public.courts                    enable row level security;
alter table public.matches                   enable row level security;
alter table public.profiles                  enable row level security;
alter table public.scorer_courts             enable row level security;
alter table public.audit_log                 enable row level security;
alter table public.group_qualifier_overrides enable row level security;
alter table public.group_standings           enable row level security;

-- ─── RLS: public-readable spectator tables ─────────────────────────────────────

create policy "public read categories"      on public.categories      for select to anon, authenticated using (true);
create policy "public read groups"          on public.groups          for select to anon, authenticated using (true);
create policy "public read companies"       on public.companies       for select to anon, authenticated using (true);
create policy "public read teams"           on public.teams           for select to anon, authenticated using (true);
create policy "public read courts"          on public.courts          for select to anon, authenticated using (true);
create policy "public read matches"         on public.matches         for select to anon, authenticated using (true);
create policy "public read group_standings" on public.group_standings for select to anon, authenticated using (true);

-- ─── RLS: profiles — authenticated users see their own row ─────────────────────

create policy "self read profile" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "self read scorer_courts" on public.scorer_courts
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- audit_log, group_qualifier_overrides: no anon / authenticated policies.
-- All writes + privileged reads go through server actions using the service role
-- (bypasses RLS) or admin-elevated session checks layered in Phase 2/4.
