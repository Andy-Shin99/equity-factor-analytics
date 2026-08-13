import { NextResponse } from "next/server";

import { errorResponse, NO_STORE_HEADERS } from "@/app/api/_lib/respond";
import { createPortfolio, getPortfolio, listPortfolios } from "@/lib/api/portfolios";
import {
  LIMITS,
  normalizeHoldings,
  optionalPositiveInt,
  parseJsonBody,
  requireHoldings,
  requireName,
} from "@/lib/api/validation";

/**
 * GET  /api/portfolios       list saved dummy portfolios (or ?id= for one)
 * POST /api/portfolios       save a new dummy portfolio
 *
 * Both go through the anon client so RLS applies — see lib/api/portfolios.ts.
 * Zero-confidential-data policy (CLAUDE.md): these are user-constructed test
 * portfolios of public tickers, never client holdings.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "hnd1";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (id) {
      const portfolio = await getPortfolio(id);
      if (!portfolio) {
        return NextResponse.json(
          { ok: false as const, error: `No portfolio with id ${id}` },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }
      return NextResponse.json(
        { ok: true as const, portfolio },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    const limit = optionalPositiveInt(url.searchParams.get("limit"), "limit", 1000) ?? 100;
    const portfolios = await listPortfolios(limit);

    return NextResponse.json(
      { ok: true as const, count: portfolios.length, portfolios },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);

    const name = requireName(body.name);
    const normalize = body.normalize === true;

    // Reject a book that does not sum to 1 unless normalisation is explicitly
    // requested. Silently treating a 87%-invested portfolio as fully invested
    // would misstate every return that follows.
    const { holdings, weightSum } = requireHoldings(body.holdings ?? body.weights, "holdings", {
      enforceSumToOne: !normalize,
    });

    const finalHoldings =
      normalize && Math.abs(weightSum - 1) > LIMITS.weightSumTolerance
        ? normalizeHoldings(holdings, weightSum)
        : holdings;

    const portfolio = await createPortfolio(name, finalHoldings);

    return NextResponse.json(
      {
        ok: true as const,
        portfolio,
        normalized: finalHoldings !== holdings,
        weightSum,
      },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
