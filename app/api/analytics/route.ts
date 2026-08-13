import { NextResponse } from "next/server";

import { errorResponse, NO_STORE_HEADERS } from "@/app/api/_lib/respond";
import { runPortfolioAnalytics } from "@/lib/analytics/factorEngine";
import { getPortfolio } from "@/lib/api/portfolios";
import {
  LIMITS,
  normalizeHoldings,
  optionalFactors,
  optionalPositiveInt,
  optionalRollingWindow,
  parseJsonBody,
  requireHoldings,
  requireRange,
  requireTicker,
  ValidationError,
} from "@/lib/api/validation";
import type { PortfolioHolding } from "@/types/domain";

/**
 * POST /api/analytics — full style & factor analytics for a portfolio.
 *
 * Serverless configuration:
 *   nodejs runtime   supabase-js needs Node APIs; the Edge runtime buys nothing
 *                    here because the latency floor is the DB round trip, not
 *                    cold start.
 *   hnd1 region      co-located with the Supabase project in Tokyo. A Seoul
 *                    deployment would add ~30ms per round trip (CLAUDE.md).
 *   force-dynamic    the response depends on a POST body and on mutable cache
 *                    state; it must never be statically optimised.
 *   maxDuration 60   two DB round trips plus, at worst, a bounded number of
 *                    provider fetches for uncached tickers.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "hnd1";
export const maxDuration = 60;

interface ParsedRequest {
  holdings: PortfolioHolding[];
  benchmark: string;
  range: { from: string; to: string };
  factors: ReturnType<typeof optionalFactors>;
  rollingWindow: number | undefined;
  rollingStep: number | undefined;
  missingDatePolicy: "strict" | "renormalize";
  allowFetch: boolean;
  maxFetches: number | undefined;
  includePortfolioSeries: boolean;
  portfolioId: string | null;
}

async function parseRequest(body: Record<string, unknown>): Promise<ParsedRequest> {
  const range = requireRange(body);
  const benchmark = requireTicker(body.benchmark ?? "SPY", "benchmark");

  // Either name the holdings inline, or reference a saved portfolio by id.
  const portfolioId = typeof body.portfolioId === "string" ? body.portfolioId : null;
  let holdings: PortfolioHolding[];
  let weightSum: number;

  if (portfolioId) {
    const saved = await getPortfolio(portfolioId);
    if (!saved) {
      throw new ValidationError(`No portfolio with id ${portfolioId}`, "portfolioId");
    }
    const validated = requireHoldings(saved.holdings, "portfolio.holdings");
    holdings = validated.holdings;
    weightSum = validated.weightSum;
  } else {
    const validated = requireHoldings(body.holdings ?? body.weights, "holdings");
    holdings = validated.holdings;
    weightSum = validated.weightSum;
  }

  // The engine renormalises internally and flags it, but doing it here keeps the
  // echoed request honest about what was actually analysed.
  if (Math.abs(weightSum - 1) > LIMITS.weightSumTolerance) {
    holdings = normalizeHoldings(holdings, weightSum);
  }

  const policy = body.missingDatePolicy ?? "strict";
  if (policy !== "strict" && policy !== "renormalize") {
    throw new ValidationError(
      'missingDatePolicy must be "strict" or "renormalize"',
      "missingDatePolicy",
    );
  }

  return {
    holdings,
    benchmark,
    range,
    factors: optionalFactors(body.factors),
    rollingWindow: optionalRollingWindow(body.rollingWindow),
    rollingStep: optionalPositiveInt(body.rollingStep, "rollingStep", 60),
    missingDatePolicy: policy,
    allowFetch: body.allowFetch !== false,
    maxFetches: optionalPositiveInt(body.maxFetches, "maxFetches", LIMITS.maxHoldings),
    includePortfolioSeries: body.includePortfolioSeries === true,
    portfolioId,
  };
}

export async function POST(request: Request) {
  try {
    const parsed = await parseRequest(await parseJsonBody(request));

    const result = await runPortfolioAnalytics({
      holdings: parsed.holdings,
      benchmark: parsed.benchmark,
      range: parsed.range,
      ...(parsed.factors ? { factors: parsed.factors } : {}),
      ...(parsed.rollingWindow !== undefined ? { rollingWindow: parsed.rollingWindow } : {}),
      ...(parsed.rollingStep !== undefined ? { rollingStep: parsed.rollingStep } : {}),
      missingDatePolicy: parsed.missingDatePolicy,
      allowFetch: parsed.allowFetch,
      ...(parsed.maxFetches !== undefined ? { maxFetches: parsed.maxFetches } : {}),
      includePortfolioSeries: parsed.includePortfolioSeries,
      signal: request.signal,
    });

    return NextResponse.json(
      {
        ok: true as const,
        request: {
          portfolioId: parsed.portfolioId,
          holdings: parsed.holdings,
          benchmark: parsed.benchmark,
          range: parsed.range,
        },
        ...result,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
