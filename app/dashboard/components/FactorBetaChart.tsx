"use client";

import * as React from "react";
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

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AnalyticsResult } from "@/lib/analytics/factorEngine";
import {
  AXIS_PROPS,
  CHART_SURFACE,
  CHROME,
  MARKS,
  T_STAT_BUCKETS,
  tStatColor,
} from "@/lib/charts/theme";
import { betaTick, formatNumber, formatPValue } from "@/lib/format";

import { ChartCard, TooltipRow, TooltipShell } from "./ChartCard";

/**
 * Factor betas as horizontal bars, shaded by |t-statistic|.
 *
 * The color is doing legitimate work here: bar length carries the beta, and the
 * fill carries statistical significance — a *second* measure, not a re-encoding
 * of the length. That is why an ordinal one-hue ramp is correct and a
 * value-ramp-on-nominal-categories would not be.
 *
 * The ramp is validated (`--ordinal`: monotone L, adjacent dL >= 0.06, light end
 * 2.19:1 on this surface) and shipped with the discrete key below, because a
 * reader cannot infer bucket boundaries from a gradient.
 */

export function FactorBetaChart({
  result,
  stale,
}: {
  result: AnalyticsResult;
  stale?: boolean;
}) {
  const data = result.regression.betas.map((beta) => ({
    label: beta.label,
    beta: beta.estimate,
    tStat: beta.tStat,
    pValue: beta.pValue,
    standardError: beta.standardError,
  }));

  const peak = Math.max(1, ...data.map((d) => Math.abs(d.beta) + d.standardError));
  const bound = Math.ceil(peak * 4) / 4;

  return (
    <ChartCard
      title="Factor betas"
      description="Bar length is the loading; fill shade is |t-statistic|"
      stale={stale}
      footnote={
        <>
          Shade encodes statistical significance, not magnitude — a long bar in the
          darkest shade is a large but unreliable loading. Exact values are in the table
          view.
        </>
      }
      chart={
        <div className="space-y-3">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
                barCategoryGap="28%"
              >
                <XAxis
                  type="number"
                  domain={[-bound, bound]}
                  tickFormatter={betaTick}
                  {...AXIS_PROPS}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={78}
                  {...AXIS_PROPS}
                  axisLine={false}
                />
                {/* Solid hairline zero rule — bars grow from this single baseline. */}
                <ReferenceLine x={0} stroke={CHROME.baseline} strokeWidth={1} />
                <Bar
                  dataKey="beta"
                  maxBarSize={MARKS.maxBarWidth}
                  // Rounded data-end, square at the baseline. Sign decides which
                  // end is the data-end.
                  radius={MARKS.barRadius}
                  isAnimationActive={false}
                >
                  {data.map((row) => (
                    <Cell
                      key={row.label}
                      fill={tStatColor(row.tStat)}
                      // The 2px separation is the surface color, never a stroke
                      // that adds non-data ink.
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
                      <TooltipShell label={point.label}>
                        <TooltipRow
                          color={tStatColor(point.tStat)}
                          name="Beta"
                          value={formatNumber(point.beta, { digits: 3, signed: true })}
                        />
                        <TooltipRow
                          name="Std. error"
                          value={formatNumber(point.standardError, { digits: 3 })}
                        />
                        <TooltipRow name="t-stat" value={formatNumber(point.tStat)} />
                        <TooltipRow name="p-value" value={formatPValue(point.pValue)} />
                      </TooltipShell>
                    );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Discrete key for the ordinal fill — bucket edges are not guessable. */}
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {T_STAT_BUCKETS.map((bucket) => (
              <li key={bucket.label} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: bucket.color }}
                  aria-hidden
                />
                <span className="text-[11px] text-secondary-foreground">{bucket.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {bucket.sublabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Factor</TableHead>
              <TableHead className="text-right">Beta</TableHead>
              <TableHead className="text-right">Std. error</TableHead>
              <TableHead className="text-right">t-stat</TableHead>
              <TableHead className="text-right">p-value</TableHead>
              <TableHead className="text-right">Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => {
              const magnitude = Math.abs(row.tStat);
              const bucket = [...T_STAT_BUCKETS].reverse().find((b) => magnitude >= b.min);
              return (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(row.beta, { digits: 3, signed: true })}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(row.standardError, { digits: 3 })}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(row.tStat)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatPValue(row.pValue)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={magnitude >= 1.96 ? "accent" : "outline"}>
                      {bucket?.label ?? "—"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      }
    />
  );
}
