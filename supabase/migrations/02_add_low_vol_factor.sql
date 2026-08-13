-- =============================================================================
-- 02_add_low_vol_factor.sql
--
-- 01_initial_schema.sql created factor_returns with five factors
-- (market_rf, smb, hml, quality, momentum), but DESIGN.md specifies a
-- five-axis style radar of Value / Momentum / Quality / Low Vol / Size.
-- Low Vol was missing, so the radar could not be rendered as specified.
--
-- Nullable with no default: a null means "not yet collected for this date",
-- which is materially different from a 0% factor return and must not be
-- silently coerced. Consumers filter incomplete observations out of the
-- regression rather than imputing zeros.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.factor_returns
    add column if not exists low_vol numeric;

comment on column public.factor_returns.low_vol is
    'Daily Low Volatility factor return (decimal fraction). Null = not collected.';
