/**
 * The quant engine. Pure TypeScript, no I/O, no framework imports — every
 * function here is directly unit-testable and safe to run on either side of the
 * server/client boundary (CLAUDE.md: Single-Language Quant Core).
 *
 * Layering, bottom up:
 *   linalg        dense matrix primitives
 *   distributions Student's t inference
 *   ols           least squares with standard errors and p-values
 *   returns       prices -> return series, portfolio aggregation, alignment
 *   risk          TE, IR, VaR, CVaR, MDD, Sharpe
 *   factorModel   the SKILL.md multi-factor regression
 *   rolling       windowed re-fits for style-drift monitoring
 */

export * from "./distributions";
export * from "./factorModel";
export * from "./linalg";
export * from "./ols";
export * from "./returns";
export * from "./risk";
export * from "./rolling";
