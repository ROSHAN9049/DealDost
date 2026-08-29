create extension if not exists pgcrypto;
create table if not exists public.tokens (
 id uuid primary key default gen_random_uuid(), mint text unique not null, name text, symbol text, uri text, creator text,
 status text not null default 'unknown' check(status in ('new','bonding','graduated','unknown')),
 first_seen_at timestamptz default now(), last_seen_at timestamptz default now(), price_sol numeric default 0,
 market_cap_sol numeric default 0, liquidity_sol numeric default 0, volume_5m_sol numeric default 0,
 buys_5m int default 0, sells_5m int default 0, holders int, score numeric default 0,
 risk_flags jsonb default '[]'::jsonb, raw jsonb default '{}'::jsonb, updated_at timestamptz default now()
);
create index if not exists tokens_score_idx on public.tokens(score desc);
create table if not exists public.token_events (
 id bigint generated always as identity primary key, mint text not null references public.tokens(mint) on delete cascade,
 signature text, slot bigint, event_type text not null, side text, trader text, sol_amount numeric,
 token_amount numeric, price_sol numeric, event_at timestamptz default now(), raw jsonb default '{}'::jsonb
);
create index if not exists token_events_mint_time_idx on public.token_events(mint,event_at desc);
create table if not exists public.alerts (
 id bigint generated always as identity primary key, mint text not null, alert_type text not null,
 score numeric not null, message text not null, sent_to text, sent_at timestamptz default now(),
 dedupe_key text unique, metadata jsonb default '{}'::jsonb
);
create table if not exists public.scanner_heartbeats (
 id int primary key default 1 check(id=1), status text default 'starting', events_seen bigint default 0,
 last_event_time timestamptz, updated_at timestamptz default now()
);
insert into public.scanner_heartbeats(id) values(1) on conflict do nothing;
alter table public.tokens enable row level security;
alter table public.token_events enable row level security;
alter table public.alerts enable row level security;
alter table public.scanner_heartbeats enable row level security;
create policy if not exists "read tokens" on public.tokens for select to anon,authenticated using(true);
create policy if not exists "read events" on public.token_events for select to anon,authenticated using(true);
create policy if not exists "read alerts" on public.alerts for select to anon,authenticated using(true);
create policy if not exists "read heartbeat" on public.scanner_heartbeats for select to anon,authenticated using(true);
alter publication supabase_realtime add table public.tokens;
alter publication supabase_realtime add table public.alerts;
