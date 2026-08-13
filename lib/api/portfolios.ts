import { getSupabaseServerClient } from "@/lib/supabase";
import type { PortfolioRow, WeightsJson } from "@/types/database";
import type { Portfolio, PortfolioHolding } from "@/types/domain";

/**
 * Read/write access to saved dummy portfolios.
 *
 * Deliberately uses the ANON server client, not the service role: portfolio
 * writes must pass through the RLS policies in migration 01. A service-role
 * write here would bypass the `user_id is null or user_id = auth.uid()` check and
 * make the policy decorative.
 */

/** PostgREST default page size; a long portfolio list would otherwise truncate. */
const PAGE_SIZE = 1000;

export function rowToPortfolio(row: PortfolioRow): Portfolio {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    holdings: weightsToHoldings(row.weights_json),
    createdAt: row.created_at,
  };
}

export function weightsToHoldings(weights: WeightsJson): PortfolioHolding[] {
  return Object.entries(weights ?? {})
    .map(([ticker, weight]) => ({ ticker, weight: Number(weight) }))
    .filter((h) => Number.isFinite(h.weight))
    // Descending weight: largest positions first is how a PM reads a book.
    .sort((a, b) => b.weight - a.weight || a.ticker.localeCompare(b.ticker));
}

export function holdingsToWeights(holdings: readonly PortfolioHolding[]): WeightsJson {
  const weights: WeightsJson = {};
  for (const holding of holdings) weights[holding.ticker] = holding.weight;
  return weights;
}

export async function listPortfolios(limit = 100): Promise<Portfolio[]> {
  const client = getSupabaseServerClient();
  const capped = Math.min(limit, PAGE_SIZE);

  const { data, error } = await client
    .from("portfolios")
    .select("id, user_id, name, weights_json, created_at")
    .order("created_at", { ascending: false })
    .limit(capped);

  if (error) throw new Error(`Failed to list portfolios: ${error.message}`);
  return (data ?? []).map(rowToPortfolio);
}

export async function getPortfolio(id: string): Promise<Portfolio | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("portfolios")
    .select("id, user_id, name, weights_json, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load portfolio ${id}: ${error.message}`);
  return data ? rowToPortfolio(data) : null;
}

export async function createPortfolio(
  name: string,
  holdings: readonly PortfolioHolding[],
): Promise<Portfolio> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("portfolios")
    // user_id stays null: these are anonymous dummy portfolios by design, and
    // RLS permits an anonymous insert only when user_id is null.
    .insert({ user_id: null, name, weights_json: holdingsToWeights(holdings) })
    .select("id, user_id, name, weights_json, created_at")
    .single();

  if (error) throw new Error(`Failed to create portfolio: ${error.message}`);
  return rowToPortfolio(data);
}
