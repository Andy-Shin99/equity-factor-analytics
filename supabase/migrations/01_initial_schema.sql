-- =============================================================================
-- 01_initial_schema.sql
-- Equity Factor Analytics Dashboard — initial schema.
--
-- Design intent (CLAUDE.md): these tables ARE the primary cache. The read path
-- must be satisfied from PostgreSQL alone so p95 stays under 100ms; external
-- collection only ever fills gaps.
--
-- Data policy: public market data and user-supplied dummy weights only.
-- No client or proprietary data is ever stored here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- portfolios
-- -----------------------------------------------------------------------------
create table if not exists public.portfolios (
    id           uuid        primary key default gen_random_uuid(),
    -- Nullable by design: anonymous / dummy portfolios need no auth.
    user_id      uuid        references auth.users (id) on delete cascade,
    name         text        not null check (length(trim(name)) > 0),
    -- { "AAPL": 0.12, "MSFT": 0.08, ... } — decimal fractions, not percents.
    weights_json jsonb       not null default '{}'::jsonb,
    created_at   timestamptz not null default now()
);

comment on table public.portfolios is
    'User-defined dummy portfolios. weights_json maps ticker -> decimal weight.';

create index if not exists idx_portfolios_user_id
    on public.portfolios (user_id)
    where user_id is not null;

-- -----------------------------------------------------------------------------
-- daily_prices  (cache of adjusted closes)
-- -----------------------------------------------------------------------------
create table if not exists public.daily_prices (
    ticker    text    not null,
    date      date    not null,
    -- Split/dividend-adjusted close. Returns are always derived from this.
    adj_close numeric not null check (adj_close > 0),
    volume    numeric,
    primary key (ticker, date)
);

comment on table public.daily_prices is
    'Primary price cache. Upserted on (ticker, date) by the collection route.';

-- The (ticker, date) PK already covers equality-on-ticker range scans, but the
-- hot query is "latest N bars for a ticker" — a DESC index lets that be an
-- ordered scan with no sort node.
create index if not exists idx_daily_prices_ticker_date_desc
    on public.daily_prices (ticker, date desc);

-- -----------------------------------------------------------------------------
-- factor_returns  (daily factor return series)
-- -----------------------------------------------------------------------------
create table if not exists public.factor_returns (
    date      date    primary key,
    -- All values are daily simple returns as decimal fractions.
    market_rf numeric not null,
    smb       numeric not null,
    hml       numeric not null,
    quality   numeric not null,
    momentum  numeric not null
);

comment on table public.factor_returns is
    'Daily factor returns (decimal fractions) forming the regression RHS.';

-- =============================================================================
-- Row Level Security
--
-- The anon key ships to the browser, so RLS is mandatory: without it anyone
-- could rewrite the price cache. Market data is world-readable; all writes are
-- reserved for the service role used by server-side API Routes.
-- =============================================================================
alter table public.portfolios     enable row level security;
alter table public.daily_prices   enable row level security;
alter table public.factor_returns enable row level security;

-- PostgreSQL has no `create policy if not exists`, so each policy is dropped
-- first. This keeps the whole file re-runnable — it can be pasted into the
-- Dashboard SQL Editor repeatedly, or replayed by `supabase db push`, without
-- failing on "policy already exists".

-- Market data: read-only to the world, writable only via service role.
drop policy if exists "daily_prices are publicly readable" on public.daily_prices;
create policy "daily_prices are publicly readable"
    on public.daily_prices for select
    using (true);

drop policy if exists "factor_returns are publicly readable" on public.factor_returns;
create policy "factor_returns are publicly readable"
    on public.factor_returns for select
    using (true);

-- Portfolios: an owned portfolio is private to its owner; a portfolio with a
-- null user_id is an anonymous dummy and is shared.
drop policy if exists "portfolios are readable by owner or anonymous" on public.portfolios;
create policy "portfolios are readable by owner or anonymous"
    on public.portfolios for select
    using (user_id is null or user_id = auth.uid());

drop policy if exists "portfolios are insertable as own or anonymous" on public.portfolios;
create policy "portfolios are insertable as own or anonymous"
    on public.portfolios for insert
    with check (user_id is null or user_id = auth.uid());

drop policy if exists "portfolios are updatable by owner" on public.portfolios;
create policy "portfolios are updatable by owner"
    on public.portfolios for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists "portfolios are deletable by owner" on public.portfolios;
create policy "portfolios are deletable by owner"
    on public.portfolios for delete
    using (user_id = auth.uid());
