"use client";

import { AlertTriangle } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AXIS_PROPS, CATEGORICAL, CHART_SURFACE, CHROME, MARKS } from "@/lib/charts/theme";
import {
  BENCHMARK_WEIGHTS_AS_OF,
  computeSectorExposure,
  type SectorExposureResult,
} from "@/lib/data/sectors";
import { formatPercent, percentTick } from "@/lib/format";
import type { PortfolioHolding } from "@/types/domain";

import { ChartCard, ChartLegend, TooltipRow, TooltipShell } from "./ChartCard";

/**
 * Sector active exposure: portfolio weight minus benchmark weight.
 *
 * DIVERGING encoding — the quantity has a meaningful zero and two opposite
 * sides, so it takes two hues that read as opposite (blue / orange) with a
 * neutral zero rule. Status red is deliberately NOT used for "underweight": an
 * underweight is a position, not a problem, and status colors carry reserved
 * good/bad meaning.
 */

const OVERWEIGHT = CATEGORICAL[0];
const UNDERWEIGHT = CATEGORICAL[1];

export function SectorExposureChart({
  holdings,
  benchmark,
  stale,
}: {
  holdings: readonly PortfolioHolding[];
  benchmark: string;
  stale?: boolean;
}) {
  const exposure: SectorExposureResult = React.useMemo(
    () => computeSectorExposure(holdings, benchmark),
    [holdings, benchmark],
  );

  const comparable = exposure.benchmarkLabel !== null;
  const data = exposure.rows.map((row) => ({
    sector: row.sector,
    active: row.activeWeight ?? 0,
    portfolio: row.portfolioWeight,
    benchmarkWeight: row.benchmarkWeight,
    tickers: row.tickers,
  }));

  const bound = Math.max(
    0.05,
    ...data.map((d) => Math.abs(d.active)),
  );
  const rounded = Math.ceil(bound * 20) / 20;

  const provenance = (
    <>
      Sector membership and benchmark weights are a{" "}
      <strong>static reference table</strong> in the codebase, not collected data — index
      constituent weights are not held anywhere in this project. Benchmark weights are
      approximate, as of {BENCHMARK_WEIGHTS_AS_OF}, and drift monthly. Treat this as
      directional, not decision-grade. Stock-level active weight is not offered, because
      it would require constituent data that does not exist here.
    </>
  );

  return (
    <ChartCard
      title="Sector active exposure"
      description={
        comparable
          ? `Portfolio minus ${exposure.benchmarkLabel}`
          : `Portfolio allocation · no reference weights for ${benchmark}`
      }
      stale={stale}
      footnote={provenance}
      actions={
        comparable ? (
          <ChartLegend
            className="hidden lg:flex"
            items={[
              { color: OVERWEIGHT, label: "Overweight" },
              { color: UNDERWEIGHT, label: "Underweight" },
            ]}
          />
        ) : null
      }
      chart={
        <div className="space-y-3">
          {exposure.unclassifiedTickers.length > 0 ? (
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-terminal-negative">
              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                Unclassified: {exposure.unclassifiedTickers.join(", ")} — not in the static
                sector map, so {formatPercent(1 - exposure.classifiedWeight)} of portfolio
                weight is bucketed separately rather than guessed.
              </span>
            </p>
          ) : null}

          <div style={{ height: Math.max(200, data.length * 34 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 20, bottom: 4, left: 4 }}
                barCategoryGap="30%"
              >
                {/* Explicit ticks: Recharts' auto-ticks on a symmetric domain
                    come out unevenly spaced and skip zero, which is the one
                    value a diverging axis must show. */}
                <XAxis
                  type="number"
                  domain={comparable ? [-rounded, rounded] : [0, rounded]}
                  ticks={
                    comparable
                      ? [-rounded, -rounded / 2, 0, rounded / 2, rounded]
                      : [0, rounded / 2, rounded]
                  }
                  tickFormatter={percentTick}
                  {...AXIS_PROPS}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="sector"
                  width={132}
                  {...AXIS_PROPS}
                  axisLine={false}
                />
                {/* Neutral zero rule is the diverging midpoint — no hue here. */}
                <ReferenceLine x={0} stroke={CHROME.baseline} strokeWidth={1} />
                <Bar
                  dataKey={comparable ? "active" : "portfolio"}
                  maxBarSize={MARKS.maxBarWidth}
                  radius={MARKS.barRadius}
                  isAnimationActive={false}
                >
                  {data.map((row) => (
                    <Cell
                      key={row.sector}
                      fill={
                        !comparable || row.active >= 0 ? OVERWEIGHT : UNDERWEIGHT
                      }
                      stroke={CHART_SURFACE}
                      strokeWidth={MARKS.surfaceGap}
                    />
                  ))}
                </Bar>
                <Tooltip
                  cursor={{ fill: CHROME.gridline, fillOpacity: 0.4 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const point = payload[0]?.payload as (typeof data)[number] | undefined;
                    if (!point) return null;
                    return (
                      <TooltipShell label={point.sector}>
                        <TooltipRow
                          name="Portfolio"
                          value={formatPercent(point.portfolio)}
                        />
                        {point.benchmarkWeight !== null ? (
                          <>
                            <TooltipRow
                              name="Benchmark"
                              value={formatPercent(point.benchmarkWeight)}
                            />
                            <TooltipRow
                              color={point.active >= 0 ? OVERWEIGHT : UNDERWEIGHT}
                              name="Active"
                              value={formatPercent(point.active, { signed: true })}
                            />
                          </>
                        ) : null}
                        {point.tickers.length > 0 ? (
                          <p className="pt-1 font-mono text-[10px] text-muted-foreground">
                            {point.tickers.join(" · ")}
                          </p>
                        ) : null}
                      </TooltipShell>
                    );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sector</TableHead>
              <TableHead className="text-right">Portfolio</TableHead>
              <TableHead className="text-right">Benchmark</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead>Holdings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exposure.rows.map((row) => (
              <TableRow key={row.sector}>
                <TableCell className="font-medium">{row.sector}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatPercent(row.portfolioWeight)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.benchmarkWeight === null ? "—" : formatPercent(row.benchmarkWeight)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.activeWeight === null ? (
                    "—"
                  ) : (
                    <span
                      className={
                        row.activeWeight >= 0
                          ? "text-terminal-accent"
                          : "text-secondary-foreground"
                      }
                    >
                      {formatPercent(row.activeWeight, { signed: true })}
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">
                  {row.tickers.join(" ") || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right font-mono">
                {formatPercent(
                  exposure.rows.reduce((sum, r) => sum + r.portfolioWeight, 0),
                )}
              </TableCell>
              <TableCell className="text-right font-mono">
                {comparable
                  ? formatPercent(
                      exposure.rows.reduce((sum, r) => sum + (r.benchmarkWeight ?? 0), 0),
                    )
                  : "—"}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      }
    />
  );
}

/** Small provenance badge for the tab header. */
export function StaticDataBadge() {
  return <Badge variant="outline">static reference · {BENCHMARK_WEIGHTS_AS_OF}</Badge>;
}
