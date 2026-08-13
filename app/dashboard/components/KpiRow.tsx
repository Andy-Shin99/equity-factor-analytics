"use client";

import { AlertTriangle } from "lucide-react";
import * as React from "react";

import { Card } from "@/components/ui/card";
import type { AnalyticsResult } from "@/lib/analytics/factorEngine";
import { deltaTone, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The five KPI cards from DESIGN.md: Alpha, Active Return, Tracking Error,
 * Sharpe, Portfolio Beta.
 *
 * Each is a stat tile, so the number is the chart — no one-bar bar charts here.
 * `higherIsBetter` is stated per metric because it is not inferable: a rising
 * tracking error is not good news the way a rising information ratio is.
 */

interface Kpi {
  label: string;
  value: string;
  hint: string;
  tone: "positive" | "negative" | "neutral";
  /** Shown when the figure needs a caveat before it is trusted. */
  caveat?: string;
}

function buildKpis(result: AnalyticsResult): Kpi[] {
  const { regression, risk } = result;
  const marketBeta = regression.betas.find((b) => b.factor === "market_rf");

  return [
    {
      label: "Alpha (ann.)",
      value: formatPercent(regression.alpha.annualized, { signed: true }),
      hint: `t = ${formatNumber(regression.alpha.tStat)} · p = ${
        Number.isFinite(regression.alpha.pValue)
          ? regression.alpha.pValue < 0.0001
            ? regression.alpha.pValue.toExponential(1)
            : regression.alpha.pValue.toFixed(4)
          : "—"
      }`,
      tone: deltaTone(regression.alpha.annualized, true),
      ...(regression.riskAdjusted
        ? {}
        : { caveat: "Raw intercept — no risk-free rate applied" }),
    },
    {
      label: "Active return (ann.)",
      value: formatPercent(risk.activeReturn, { signed: true }),
      hint: `vs ${result.benchmark}`,
      tone: deltaTone(risk.activeReturn, true),
    },
    {
      label: "Tracking error",
      value: formatPercent(risk.trackingError),
      hint: `IR = ${formatNumber(risk.informationRatio)}`,
      // Lower tracking error is not automatically "good" — it is a budget, not a
      // score — so this tile stays neutral rather than coloring a value judgement.
      tone: "neutral",
    },
    {
      label: "Sharpe ratio",
      value: formatNumber(risk.sharpeRatio),
      hint: `vol ${formatPercent(risk.annualizedVolatility)}`,
      tone: deltaTone(risk.sharpeRatio, true),
    },
    {
      label: "Portfolio beta",
      value: formatNumber(marketBeta?.estimate),
      hint: `t = ${formatNumber(marketBeta?.tStat)} · R² ${formatNumber(regression.rSquared, { digits: 3 })}`,
      tone: "neutral",
    },
  ];
}

export function KpiRow({
  result,
  stale = false,
}: {
  result: AnalyticsResult;
  stale?: boolean;
}) {
  const kpis = buildKpis(result);

  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
        "transition-opacity",
        stale && "opacity-40",
      )}
    >
      {kpis.map((kpi) => (
        <Card key={kpi.label} className="p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {kpi.label}
          </p>
          {/* Mono per DESIGN.md's terminal aesthetic, which asks for JetBrains
              Mono on metrics. */}
          <p
            className={cn(
              "mt-2 font-mono text-2xl font-semibold leading-none",
              kpi.tone === "positive" && "text-terminal-positive",
              kpi.tone === "negative" && "text-terminal-negative",
              kpi.tone === "neutral" && "text-foreground",
            )}
          >
            {kpi.value}
          </p>
          <p className="mt-2 font-mono text-[10px] tabular-nums text-muted-foreground">
            {kpi.hint}
          </p>
          {kpi.caveat ? (
            <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-snug text-terminal-negative">
              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
              <span>{kpi.caveat}</span>
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
