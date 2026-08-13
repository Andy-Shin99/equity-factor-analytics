import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Single entry point for every Supabase client in the app.
 *
 * Three clients, three trust levels:
 *   getSupabaseBrowserClient()   anon key, runs in the browser, RLS enforced
 *   getSupabaseServerClient()    anon key, runs on the server, RLS enforced
 *   getSupabaseAdminClient()     service role, server ONLY, RLS BYPASSED
 *
 * The admin client is the only one that can write to daily_prices /
 * factor_returns — see the RLS policies in
 * supabase/migrations/01_initial_schema.sql.
 */

export type TypedSupabaseClient = SupabaseClient<Database>;

/** No session handling anywhere: this app authenticates nothing yet. */
const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

let browserClient: TypedSupabaseClient | undefined;
let serverClient: TypedSupabaseClient | undefined;
let adminClient: TypedSupabaseClient | undefined;

/**
 * Browser client, memoized. Creating more than one instance per page triggers
 * duplicate-client warnings from supabase-js, so never call createClient
 * directly from a component.
 */
export function getSupabaseBrowserClient(): TypedSupabaseClient {
  browserClient ??= createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    CLIENT_OPTIONS,
  );
  return browserClient;
}

/**
 * Server-side reader. Uses the anon key on purpose: read paths should be
 * provably unable to mutate the cache, so an accidental `.insert()` in a read
 * handler fails loudly under RLS instead of corrupting price history.
 */
export function getSupabaseServerClient(): TypedSupabaseClient {
  serverClient ??= createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    CLIENT_OPTIONS,
  );
  return serverClient;
}

/**
 * Service-role client for collection routes that upsert market data.
 *
 * This key bypasses RLS entirely. It is read from a non-`NEXT_PUBLIC_` variable,
 * so Next.js leaves it `undefined` in client bundles and the guard below turns
 * an accidental client-side import into an immediate, obvious failure rather
 * than a silent one.
 */
export function getSupabaseAdminClient(): TypedSupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdminClient() was called in the browser. The service role key must never reach the client.",
    );
  }
  adminClient ??= createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    CLIENT_OPTIONS,
  );
  return adminClient;
}
