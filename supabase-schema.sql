-- ═══════════════════════════════════════════════════════════════════
--  SENTINEL — Complete Supabase Schema
--  Paste this entire file into Supabase → SQL Editor → Run
--
--  Creates all tables, indexes, RLS policies, and the vote RPC
--  that api.mjs expects. Safe to re-run (uses IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════

-- ── Enable UUID generation ──────────────────────────────────────
create extension if not exists "pgcrypto";

-- ══════════════════════════════════════════════════════════════════
--  TABLES
-- ══════════════════════════════════════════════════════════════════

-- ── posts ───────────────────────────────────────────────────────
create table if not exists posts (
  id              text primary key,
  title           text        not null default '',
  content         text        not null default '',
  category        text        not null default 'other',
  urgency         text        not null default 'low',
  officials       text                 default '',
  location        text                 default '',
  tags            jsonb                default '[]',
  media           jsonb                default '[]',
  anonymous       boolean     not null default false,
  author          text        not null default 'Anonymous',
  display_name    text                 default '',
  author_username text,
  votes           integer     not null default 0,
  status          text        not null default 'unverified',
  pinned          boolean     not null default false,
  locked          boolean     not null default false,
  status_history  jsonb                default '[]',
  from_tip        boolean              default false,
  claimed_full    boolean              default false,
  co_claimed      boolean              default false,
  co_claimed_by   text,
  edited_by_admin boolean              default false,
  edited_at       timestamptz,
  -- AI triage fields
  ai_urgency      text,
  ai_credibility  integer,
  ai_summary      text,
  ai_flags        jsonb                default '[]',
  timestamp       timestamptz not null default now()
);

create index if not exists posts_status_idx     on posts(status);
create index if not exists posts_category_idx   on posts(category);
create index if not exists posts_pinned_ts_idx  on posts(pinned desc, timestamp desc);
create index if not exists posts_author_idx     on posts(author_username);
create index if not exists posts_urgency_idx    on posts(urgency);

-- ── comments ────────────────────────────────────────────────────
create table if not exists comments (
  id              text primary key,
  post_id         text        not null references posts(id) on delete cascade,
  text            text        not null default '',
  anonymous       boolean     not null default false,
  author          text        not null default 'Anonymous',
  display_name    text                 default '',
  author_username text,
  timestamp       timestamptz not null default now()
);

create index if not exists comments_post_idx on comments(post_id);
create index if not exists comments_ts_idx   on comments(timestamp);

-- ── users ────────────────────────────────────────────────────────
create table if not exists users (
  username             text primary key,
  display_name         text        not null default '',
  password_hash        text        not null,
  role                 text        not null default 'citizen',
  avatar_emoji         text                 default '👤',
  avatar_image         text,
  avatar_url           text,
  bio                  text                 default '',
  banner_color         text                 default '#0d4a6b',
  approved             boolean     not null default true,
  needs_profile_update boolean              default false,
  created_at           timestamptz not null default now()
);

create index if not exists users_role_idx on users(role);

-- ── pending_users ────────────────────────────────────────────────
create table if not exists pending_users (
  username      text primary key,
  display_name  text        not null default '',
  password_hash text        not null,
  reason        text                 default '',
  real_name     text                 default '',
  avatar_emoji  text                 default '👤',
  created_at    timestamptz not null default now()
);

-- ── tips ─────────────────────────────────────────────────────────
create table if not exists tips (
  id             text primary key,
  title          text        not null default '',
  description    text        not null default '',
  category       text        not null default 'other',
  urgency        text        not null default 'low',
  contact        text                 default '',
  status         text        not null default 'pending',
  -- AI triage results
  ai_urgency     text,
  ai_credibility integer,
  ai_summary     text,
  ai_flags       jsonb                default '[]',
  ai_recommended text,
  timestamp      timestamptz not null default now()
);

create index if not exists tips_status_idx on tips(status);
create index if not exists tips_ts_idx     on tips(timestamp desc);

-- ── reactions ────────────────────────────────────────────────────
create table if not exists reactions (
  id       bigint generated always as identity primary key,
  post_id  text not null references posts(id) on delete cascade,
  username text not null,
  emoji    text not null,
  unique(post_id, username)   -- one reaction per user per post
);

create index if not exists reactions_post_idx on reactions(post_id);

-- ── announcements ────────────────────────────────────────────────
create table if not exists announcements (
  id        uuid        primary key default gen_random_uuid(),
  title     text        not null default '',
  content   text        not null default '',
  timestamp timestamptz not null default now()
);

-- ── categories ───────────────────────────────────────────────────
create table if not exists categories (
  id         text primary key,
  label      text    not null default '',
  icon       text             default '📋',
  sort_order integer not null default 0
);

-- Seed default categories (safe to re-run)
insert into categories (id, label, icon, sort_order) values
  ('government', 'GOVERNMENT',       '🏛', 0),
  ('police',     'LAW ENFORCEMENT',  '🚔', 1),
  ('barangay',   'BARANGAY / LOCAL', '🏘', 2),
  ('election',   'ELECTION / VOTING','🗳', 3),
  ('budget',     'BUDGET / FUNDS',   '💰', 4),
  ('other',      'OTHER',            '📋', 5)
on conflict (id) do nothing;

-- ── settings ─────────────────────────────────────────────────────
create table if not exists settings (
  key        text primary key,
  value      jsonb       not null default '{}',
  updated_at timestamptz not null default now()
);

-- ── activity_log ─────────────────────────────────────────────────
create table if not exists activity_log (
  id        bigint generated always as identity primary key,
  action    text        not null default '',
  detail    text                 default '',
  timestamp timestamptz not null default now()
);

create index if not exists activity_log_ts_idx on activity_log(timestamp desc);

-- ══════════════════════════════════════════════════════════════════
--  STORED PROCEDURE — sentinel_vote
--  Atomically increments/decrements votes to prevent race conditions
-- ══════════════════════════════════════════════════════════════════
create or replace function sentinel_vote(p_post_id text, p_delta integer)
returns integer
language plpgsql
as $$
declare
  new_votes integer;
begin
  update posts
  set votes = greatest(0, votes + p_delta)
  where id = p_post_id
  returning votes into new_votes;
  return coalesce(new_votes, 0);
end;
$$;

-- ══════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
--  Enable on all tables. The API uses the service key (bypasses RLS)
--  but this protects against direct DB access.
-- ══════════════════════════════════════════════════════════════════
alter table posts         enable row level security;
alter table comments      enable row level security;
alter table users         enable row level security;
alter table pending_users enable row level security;
alter table tips          enable row level security;
alter table reactions     enable row level security;
alter table announcements enable row level security;
alter table categories    enable row level security;
alter table settings      enable row level security;
alter table activity_log  enable row level security;

-- Public read on posts, comments, categories, announcements, reactions
create policy if not exists "public_read_posts"
  on posts for select using (true);

create policy if not exists "public_read_comments"
  on comments for select using (true);

create policy if not exists "public_read_categories"
  on categories for select using (true);

create policy if not exists "public_read_announcements"
  on announcements for select using (true);

create policy if not exists "public_read_reactions"
  on reactions for select using (true);

-- Everything else: service role only (API key has full access,
-- anonymous Supabase JS client is blocked from sensitive tables)
-- Note: Your Netlify function uses SUPABASE_KEY = service_role key,
-- which bypasses RLS by design. These policies protect the anon key.

-- ══════════════════════════════════════════════════════════════════
--  REALTIME
--  Enable Supabase Realtime on the tables the frontend subscribes to.
--  After running this SQL, also go to:
--    Supabase → Database → Replication → enable for posts, comments
-- ══════════════════════════════════════════════════════════════════
-- (Realtime is enabled via the Supabase dashboard, not SQL,
--  but the publication below wires it up programmatically)

drop publication if exists sentinel_realtime;
create publication sentinel_realtime for table posts, comments, announcements, reactions;

-- ══════════════════════════════════════════════════════════════════
--  DONE
--  After running:
--  1. Set SUPABASE_URL and SUPABASE_KEY in Netlify env vars
--  2. Set SENTINEL_DEV_PASSKEY in Netlify env vars
--  3. Set ANTHROPIC_API_KEY in Netlify env vars (for AI triage)
--  4. Set ALLOWED_ORIGIN to your Netlify domain in env vars
--  5. Run the import script: node import-to-supabase.mjs
-- ══════════════════════════════════════════════════════════════════
