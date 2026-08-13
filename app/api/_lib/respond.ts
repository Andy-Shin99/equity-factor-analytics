import { NextResponse } from "next/server";

import { AnalyticsError } from "@/lib/analytics/factorEngine";
import { ValidationError } from "@/lib/api/validation";

/**
 * One place that decides how an error becomes a status code, so the routes stay
 * thin and no handler accidentally leaks an internal message as a 200.
 */

export interface ErrorBody {
  ok: false;
  error: string;
  field?: string;
}

export function errorResponse(error: unknown): NextResponse<ErrorBody> {
  if (error instanceof ValidationError) {
    return NextResponse.json(
      { ok: false as const, error: error.message, ...(error.field ? { field: error.field } : {}) },
      { status: 400 },
    );
  }

  // A request the client could fix (unknown benchmark, empty factor window) is a
  // 422 rather than a 500: the server is fine, the inputs are not satisfiable.
  if (error instanceof AnalyticsError) {
    return NextResponse.json({ ok: false as const, error: error.message }, { status: 422 });
  }

  const message = error instanceof Error ? error.message : String(error);
  // Deliberately logged: a 500 here means a bug or an outage, and the payload
  // that caused it is not otherwise recoverable from a serverless log.
  console.error("[api] unhandled error:", message);
  return NextResponse.json({ ok: false as const, error: message }, { status: 500 });
}

/** Analytics responses are user-specific and cheap to recompute; never cache. */
export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
