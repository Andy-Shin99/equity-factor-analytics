# Equity Factor Analytics Dashboard

Institutional-style equity portfolio **style & factor attribution**: factor exposures,
60-day rolling betas for style-drift monitoring, and risk decomposition — built on
public market data only.

> **Data policy.** Public market data (Yahoo Finance) and user-entered dummy weights
> only. No client holdings, no proprietary data, no confidential positions.

---

## What it does

| Tab | Contents |
|---|---|
| **Factor Exposure & Style** | 5 KPI tiles (Alpha, Active Return, Tracking Error, Sharpe, Beta) · style-exposure radar · factor-beta bars shaded by \|t-statistic\| |
| **Style Drift Monitoring** | 60-day rolling factor betas — exposure change over time, not a blended average |
| **Risk & Return Decomposition** | Sector active exposure vs benchmark · drawdown path · daily return distribution with VaR / CVaR |

The regression is the multi-factor model
`R_p,t − R_f,t = α + Σ βᵢ·Fᵢ,t + ε_t`, reported with standard errors,
t-statistics, two-sided p-values and adjusted R².

## Stack

- **Next.js 15** (App Router) · React 19 · TypeScript (strict) · Tailwind 3.4 · Shadcn UI · **Recharts 3**
- **Supabase** PostgreSQL as the primary price/factor cache, with RLS
- **Quant engine in pure TypeScript** (`lib/quant/`) — no Python, no second implementation
- Deploy target: Vercel (`hnd1`, co-located with Supabase in Tokyo)

## Architecture

```
lib/quant/       pure math, zero I/O — OLS, Student's t, TE/IR/VaR/CVaR/MDD, rolling betas
lib/api/         data access — cache-first prices, factor reads, paginated Supabase I/O
lib/analytics/   composition — pulls data, runs the engine, returns one dashboard payload
app/api/         route handlers (analytics, portfolios, scheduled factor backfill)
app/dashboard/   the UI
supabase/        migrations + seed
```

Three ideas carry most of the design:

**The database is the cache.** Reads hit `daily_prices` / `factor_returns` first;
the external API is called only to fill a detected gap, never on a hot path.
Supabase clamps responses to 1000 rows, so reads take the exact row count on the
first page and fetch the rest concurrently.

**Every formula exists once.** All financial math is a pure TypeScript function
with a unit test. The browser computes the drawdown and VaR views with the *same*
functions the server uses.

**Degraded analytics announce themselves.** The API returns a machine-readable
`warnings[]` — missing history, dropped dates, a raw (not risk-adjusted) intercept,
a degenerate regression — and the UI renders them above the charts. A silently
wrong number is worse than no number.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in Supabase URL + keys
npm run dev                     # http://localhost:3000 → /dashboard
```

Apply the migrations in `supabase/migrations/` in order (Supabase Dashboard →
SQL Editor, or `npx supabase db push` against a linked project), then optionally
run `supabase/seed.sql` for two demo portfolios.

Populate the factor table once via the backfill route (needs `CRON_SECRET` set):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/factors/backfill
```

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint 9 (flat config) |
| `npm test` | Vitest — 227 tests |

## Known limitations

These are design boundaries, not bugs — each is surfaced in the UI where it matters.

- **Factors are ETF proxy spreads, not academic Fama-French factors.** Value is
  `VTV − VUG`, Quality is `QUAL − SPY`, and so on (`lib/api/factorDefinitions.ts`).
  Fama-French publishes no Quality or Low Volatility series, and these legs are
  investable. The trade-off: each carries an expense ratio and tracking difference,
  so a beta here is a beta against an *investable implementation* of the style and
  is **not numerically comparable to a published FF loading**.
- **One factor universe.** `factor_returns` is keyed on `date` alone, so it holds a
  single (currently US) factor set. A KOSPI factor set needs `region` in the primary key.
- **Sector data is a static reference table.** Index constituent weights are not held
  anywhere in this project, so sector membership and benchmark weights are
  hand-entered approximations (`lib/data/sectors.ts`). Sector exposure is directional,
  not decision-grade. Stock-level active weight is deliberately **not** offered rather
  than fabricated.
- **Returns assume daily rebalancing** to target weights, the standard convention for
  factor attribution. It is not buy-and-hold; weights do not drift.
- **Mixed US/KRX portfolios drop non-shared trading days** under the default strict
  policy. The count of dropped dates is reported.

## License

MIT
