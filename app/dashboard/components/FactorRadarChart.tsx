"use client";

import * as React from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
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
import { CATEGORICAL, CHROME, MARKS } from "@/lib/charts/theme";
import { formatNumber, formatPValue } from "@/lib/format";

import { ChartCard, TooltipRow, TooltipShell } from "./ChartCard";

/**
 * Multi-factor exposure radar over the five style axes in DESIGN.md order
 * (Value, Momentum, Quality, Low Vol, Size).
 *
 * ONE series, so there is no legend box — the title says what is plotted. Slot 1
 * is the only hue used, which also keeps this inside the 3-series cap that
 * all-pairs forms carry.
 *
 * The radius axis is NOT auto-scaled to the data: a radar whose domain moves
 * with the portfolio makes two portfolios impossible to compare by eye, which is
 * the whole point of the shape. It is pinned symmetrically about zero so a
 * negative loading reads as a dent rather than silently clipping to the centre.
 */

const SERIES_COLOR = CATEGORICAL[0];

/** Round the domain out to a clean step so the rings stay readable. */
function radarDomain(values: number[]): [number, number] {
  const peak = Math.max(0.5, ...values.map((v) => Math.abs(v)));
  const step = peak <= 0.5 ? 0.25 : peak <= 1 ? 0.5 : 1;
  const bound = Math.ceil(peak / step) * step;
  return [-bound, bound];
}

export function FactorRadarChart({
  result,
  stale,
}: {
  result: AnalyticsResult;
  stale?: boolean;
}) {
  const data = result.styleExposure.map((exposure) => ({
    label: exposure.label,
    beta: exposure.beta,
    tStat: exposure.tStat,
    pValue: exposure.pValue,
    significant: exposure.significant,
    // Constant-zero series drawn as a reference ring, not a data series.
    zero: 0,
  }));

  const domain = radarDomain(data.map((d) => d.beta));

  return (
    <ChartCard
      title="Style factor exposure"
      description={`Regression betas on the five style axes · axis ±${domain[1].toFixed(2)}, grey ring = 0 · ${result.regression.observations} observations`}
      stale={stale}
      footnote={
        <>
          Betas are measured against <strong>investable ETF proxy spreads</strong>, not
          academic Fama-French factors, so they are not directly comparable to published
          FF loadings. Axis range is fixed symmetrically about zero so portfolios can be
          compared by shape.
        </>
      }
      chart={
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="72%">
              <PolarGrid stroke={CHROME.gridline} strokeWidth={1} />
              <PolarAngleAxis
                dataKey="label"
                tick={{ fill: CHROME.secondaryInk, fontSize: 11 }}
              />
              {/* Radius tick labels are suppressed on purpose: on a radar they
                  all stack along one spoke and collide into an illegible clump
                  near the centre. The domain is stated in the subtitle instead,
                  and exact values live in the tooltip and the table view, so
                  nothing is gated. */}
              <PolarRadiusAxis
                domain={domain}
                tick={false}
                axisLine={false}
                stroke={CHROME.gridline}
              />
              {/* Zero ring — the reference a loading is read against. Without it
                  a negative beta just looks like a small positive one. */}
              <Radar
                dataKey="zero"
                stroke={CHROME.baseline}
                strokeWidth={1}
                fill="none"
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
              <Radar
                name="Beta"
                dataKey="beta"
                stroke={SERIES_COLOR}
                strokeWidth={MARKS.lineWidth}
                fill={SERIES_COLOR}
                fillOpacity={MARKS.areaOpacity}
                // Markers >= 8px so the hover target is not pinpoint.
                dot={{ r: MARKS.markerRadius, fill: SERIES_COLOR, strokeWidth: 0 }}
                isAnimationActive={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0]?.payload as (typeof data)[number] | undefined;
                  if (!point) return null;
                  return (
                    <TooltipShell label={point.label}>
                      <TooltipRow
                        color={SERIES_COLOR}
                        name="Beta"
                        value={formatNumber(point.beta, { digits: 3, signed: true })}
                      />
                      <TooltipRow name="t-stat" value={formatNumber(point.tStat)} />
                      <TooltipRow name="p-value" value={formatPValue(point.pValue)} />
                    </TooltipShell>
                  );
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Factor</TableHead>
              <TableHead className="text-right">Beta</TableHead>
              <TableHead className="text-right">t-stat</TableHead>
              <TableHead className="text-right">p-value</TableHead>
              <TableHead className="text-right">5% sig.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatNumber(row.beta, { digits: 3, signed: true })}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatNumber(row.tStat)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatPValue(row.pValue)}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={row.significant ? "accent" : "outline"}>
                    {row.significant ? "yes" : "no"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}
