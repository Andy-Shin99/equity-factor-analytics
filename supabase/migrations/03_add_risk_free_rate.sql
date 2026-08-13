-- =============================================================================
-- 03_add_risk_free_rate.sql
--
-- SKILL.md specifies the regression LHS as (Rp,t - Rf,t), but factor_returns
-- stored no Rf series: market_rf is already an excess return, which does not
-- give the portfolio side anything to subtract. Without Rf the intercept is a
-- raw return, not a risk-adjusted alpha, and labelling it "alpha" overstates
-- skill by roughly the cash rate.
--
-- The factor backfill already prices a T-bill ETF to build market_rf, so the
-- daily risk-free rate comes at no additional data cost.
--
-- Nullable, like low_vol: null means "not collected for this date", and callers
-- must not impute zero.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.factor_returns
    add column if not exists rf numeric;

comment on column public.factor_returns.rf is
    'Daily risk-free rate (decimal fraction), proxied by a 1-3 month T-bill ETF total return. Null = not collected.';
