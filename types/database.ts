/**
 * Row shapes exactly as stored in Supabase PostgreSQL (snake_case, nullability
 * mirroring the DDL in supabase/migrations/).
 *
 * Keep this file mechanically in sync with the migrations. Domain-level types
 * (camelCase, richer invariants) live in types/domain.ts — never let a raw row
 * type leak into the quant engine.
 *
 * IMPORTANT: everything here is declared with `type`, not `interface`.
 * supabase-js constrains a table's Row/Insert/Update to `Record<string, unknown>`,
 * and TypeScript only grants implicit index signatures to type aliases — an
 * `interface` fails that constraint, which makes every query's inferred row type
 * silently collapse to `never`.
 *
 * NOTE ON `numeric`: postgres `numeric` is returned by supabase-js as a JS
 * `number` for the magnitudes used here (returns and prices). Precision is
 * ample — do not switch these to `string` without updating every consumer.
 */

/** ticker -> portfolio weight, expressed as a decimal fraction (0.05 = 5%). */
export type WeightsJson = Record<string, number>;

export type PortfolioRow = {
  id: string;
  /** Nullable: dummy/anonymous portfolios are supported by design. */
  user_id: string | null;
  name: string;
  weights_json: WeightsJson;
  created_at: string;
};

export type DailyPriceRow = {
  ticker: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  adj_close: number;
  volume: number | null;
};

export type FactorReturnRow = {
  /** ISO date, `YYYY-MM-DD`. Primary key. */
  date: string;
  market_rf: number;
  smb: number;
  hml: number;
  quality: number;
  momentum: number;
  /**
   * Added in migration 02. Nullable: null means "not yet collected for this
   * date", which is NOT the same as a 0% return and must never be imputed as
   * zero — incomplete observations are dropped from the regression instead.
   */
  low_vol: number | null;
  /**
   * Daily risk-free rate, added in migration 03. NOT a factor — it is the Rf in
   * (Rp - Rf) on the regression's left-hand side, so it is deliberately absent
   * from FACTOR_KEYS and never enters the design matrix.
   */
  rf: number | null;
};

/**
 * Shape must match what supabase-js expects of a generated schema type.
 * `Relationships` is not optional: without it a table fails to satisfy
 * `GenericTable`. The empty-mapped-type idiom (`{ [_ in never]: never }`) is
 * what the generator emits for unused schema sections.
 */
export type Database = {
  public: {
    Tables: {
      portfolios: {
        Row: PortfolioRow;
        Insert: Omit<PortfolioRow, "id" | "created_at"> &
          Partial<Pick<PortfolioRow, "id" | "created_at">>;
        Update: Partial<PortfolioRow>;
        Relationships: [];
      };
      daily_prices: {
        Row: DailyPriceRow;
        Insert: DailyPriceRow;
        Update: Partial<DailyPriceRow>;
        Relationships: [];
      };
      factor_returns: {
        Row: FactorReturnRow;
        Insert: FactorReturnRow;
        Update: Partial<FactorReturnRow>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
