-- =============================================================================
-- seed.sql — applied automatically after migrations on `supabase db reset`.
--
-- Contains ONLY dummy portfolio weights, per the zero-confidential-data policy
-- in CLAUDE.md. No price or factor rows are seeded: those are collected from
-- public market data into daily_prices / factor_returns at runtime.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- Fixed UUIDs so local links/bookmarks survive a db reset.
insert into public.portfolios (id, user_id, name, weights_json)
values
    (
        '00000000-0000-4000-8000-000000000001',
        null,
        'Demo · US Large Cap Core',
        '{
            "AAPL":  0.14,
            "MSFT":  0.13,
            "NVDA":  0.12,
            "AMZN":  0.10,
            "GOOGL": 0.10,
            "JPM":   0.09,
            "META":  0.08,
            "XOM":   0.08,
            "JNJ":   0.08,
            "PG":    0.08
        }'::jsonb
    ),
    (
        '00000000-0000-4000-8000-000000000002',
        null,
        'Demo · KOSPI 200 Core',
        '{
            "005930.KS": 0.300,
            "000660.KS": 0.150,
            "373220.KS": 0.100,
            "207940.KS": 0.100,
            "005380.KS": 0.100,
            "035420.KS": 0.100,
            "051910.KS": 0.075,
            "006400.KS": 0.075
        }'::jsonb
    )
on conflict (id) do update
    set name         = excluded.name,
        weights_json = excluded.weights_json;

-- Sanity check: every seeded portfolio must have weights summing to 1.0
-- (tolerance 1e-6). A silently mis-weighted portfolio would corrupt every
-- downstream return calculation.
do $$
declare
    bad record;
begin
    for bad in
        select p.id,
               p.name,
               sum((w.value)::numeric) as total
        from public.portfolios p
        cross join lateral jsonb_each(p.weights_json) as w(key, value)
        group by p.id, p.name
        having abs(sum((w.value)::numeric) - 1) > 1e-6
    loop
        raise exception 'Seed portfolio "%" (%) has weights summing to %, expected 1.0',
            bad.name, bad.id, bad.total;
    end loop;
end $$;
