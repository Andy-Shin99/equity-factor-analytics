# Equity Factor Analytics Dashboard Guidelines

## Project Overview
- **Goal:** Institutional-grade Equity Portfolio Style & Factor Analytics Dashboard for Equity Portfolio Managers and Quantitative Analysts.
- **Tech Stack:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, Shadcn UI, Recharts, Supabase (PostgreSQL). Quant engine is pure TypeScript in `lib/quant/`, invoked from Next.js API Routes. Price collection uses direct Yahoo Finance HTTP endpoints via `fetch` — no Python, no `yfinance`.
- **Deployment Target:** Vercel (Frontend, API Routes, Cron) + Supabase (PostgreSQL). Deno Scheduled Edge Functions / `pg_cron` are reserved for bulk backfill only, never for analytics computation.
- **Pinned majors:** Next 15 (App Router) · React 19 · Tailwind 3.4 · **Recharts 3** · ESLint 9 (flat config, `eslint.config.mjs`) · Supabase CLI 2. Note Recharts 3 — do not copy v2-era chart snippets; several props and the `Customized`/animation APIs changed in v3.

## Code Style & Architecture
- **Type Safety:** Strict TypeScript interfaces for all Factor Models, Portfolios, and Price Data.
- **Data Caching:** Use Supabase PostgreSQL (`daily_prices`, `factor_returns`) as primary cache to avoid external API rate-limits and reduce latency below 100ms.
- **Region Co-location:** The Supabase project lives in **Northeast Asia (Tokyo, `ap-northeast-1`)**. Vercel functions MUST be deployed to **`hnd1` (Tokyo)** to match — a Seoul (`icn1`) deployment adds ~30ms per DB round trip, which alone blows the 100ms budget after three sequential queries. Set `export const preferredRegion = "hnd1"` on Route Handlers that touch the database.
- **Round-Trip Discipline:** The 100ms budget is spent on round trips, not on SQL. Fetch a portfolio's full price panel in one query (`in` on tickers + a date range), never one query per ticker in a loop. Independent reads (prices vs factors) must run under `Promise.all`, not sequentially.
- **Pagination:** Supabase clamps every response to **1000 rows** (`db-max-rows`) no matter what range is requested — measured, not assumed. An 11-ticker × 4-year panel is therefore ~13 requests. Always read through `readAllPages` in `lib/api/pagination.ts`: it takes an exact count on the first page, fetches the rest concurrently, and dedupes by primary key. Never write a page loop that terminates on `rows.length < pageSize` — that silently truncates the moment a page size above the server cap is requested.
- **Financial Precision:** High accuracy in OLS regression calculations (Alpha, Beta, t-stat, R-squared, Tracking Error, MDD, VaR).
- **Zero Confidential Data:** Always use public market data (S&P 500, KOSPI 200, Yahoo Finance) or user-input dummy portfolio weights. Never hardcode proprietary or client credentials.
- **Single-Language Quant Core:** Every financial formula (OLS, rolling beta, TE, IR, VaR, MDD) is implemented exactly once, as a pure TypeScript function in `lib/quant/`. Never reimplement a formula in a second language or inline it into a component — a duplicated formula doubles the verification surface and is this project's primary bug risk. Pure functions also make each formula directly unit-testable.
- **Ingestion Boundary:** Request-path handlers never bulk-collect. On cache miss, fetch only the missing ticker/date range and upsert. Bulk backfill runs as chunked batches (N tickers per invocation) via Vercel Cron, or is offloaded to `pg_cron` + a Deno Scheduled Edge Function — this is how the Vercel serverless duration limit is respected.
- **Charting:** Recharts only. Radar, Line/Area, Bar, and Scatter are all natively supported and align with the Shadcn `chart.tsx` wrapper. For a correlation heatmap, hand-roll CSS Grid with a color scale rather than adding a library.

- **Factor Provenance:** `factor_returns` holds ETF-proxy long/short spreads defined in `lib/api/factorDefinitions.ts` (e.g. Value = VTV − VUG), not academic Fama-French factors — FF publishes no Quality or Low Vol series, which DESIGN.md's radar requires. Betas measured against these are betas against an *investable* style implementation and are NOT numerically comparable to published FF betas; show the provenance wherever betas are displayed. `rf` is the risk-free rate, not a factor: it belongs in (Rp − Rf) on the LHS and must stay out of `FACTOR_KEYS`.
- **One Factor Universe Only:** `factor_returns` is keyed on `date` alone, so it can hold exactly one factor universe — currently US (S&P 500). A KOSPI 200 factor set requires adding `region` to the primary key plus matching changes in `lib/api/factorData.ts`.

## Reference Documents
- `DESIGN.md` — theme palette, typography, and required UI components/charts.
- `.claude/skills/equity-factor-quant-skills/SKILL.md` — canonical financial formula specifications. Single source of truth; do not duplicate it to the project root.

## Common Commands
- `npm run dev`: Run local development server.
- `npm run build`: Production build check.
- `npm run typecheck`: `tsc --noEmit`. Run before declaring any change done.
- `npm run lint`: ESLint 9 flat config. Note: `next lint` is deprecated in Next 15 — this script calls `eslint .` directly.
- `npm test`: Vitest. Every formula in `lib/quant/` needs a test here.
- `npx supabase db push`: Apply `supabase/migrations/` to the linked hosted project. This is the primary schema workflow.
- `npx supabase status`: Local stack only — **requires Docker**. Not used in the hosted workflow.
