import { NextResponse } from "next/server";

import { backfillFactorReturns } from "@/lib/api/factorBackfill";
import { FACTOR_HISTORY_START } from "@/lib/api/factorDefinitions";
import { isoToday } from "@/lib/api/marketData";

/**
 * Scheduled factor backfill.
 *
 * NOT a request-path route: it writes with the service role and prices eight
 * ETFs, so it is gated on CRON_SECRET and intended to be driven by Vercel Cron
 * (see vercel.json). Co-located with Supabase in Tokyo per CLAUDE.md.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "hnd1";
/**
 * 60s is the Vercel Hobby ceiling, so this stays portable across plans. The
 * measured full 13-year backfill is ~8s cold and ~5s warm against a populated
 * price cache, leaving ample headroom. If the window ever grows past this,
 * chunk the range with the `from`/`to` query parameters rather than raising it —
 * that keeps the route deployable on any plan.
 */
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: without a configured secret the route stays unavailable rather
  // than exposing a service-role write path to the internet.
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? FACTOR_HISTORY_START;
  const to = url.searchParams.get("to") ?? isoToday();
  const dryRun = url.searchParams.get("dryRun") === "true";

  try {
    const result = await backfillFactorReturns({ range: { from, to }, dryRun });

    return NextResponse.json(
      {
        ok: true,
        range: result.range,
        datesComputed: result.datesComputed,
        datesSkipped: result.datesSkipped.length,
        rowsUpserted: result.rowsUpserted,
        first: result.first,
        last: result.last,
        dryRun: result.dryRun,
        elapsedMs: result.elapsedMs,
        priceMeta: {
          servedFromCache: result.priceMeta.servedFromCache,
          fetched: result.priceMeta.fetched,
          failed: result.priceMeta.failed,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Vercel Cron issues GET requests. */
export const GET = run;
/** POST for manual triggering with the same guard. */
export const POST = run;
