"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  CATEGORICAL,
  CHART_SURFACE,
  CHROME,
  GRID_PROPS,
  MARKS,
  STATUS,
} from "@/lib/charts/theme";
import { formatNumber, formatPercent, percentTick } from "@/lib/format";
import { wealthIndex } from "@/lib/quant/returns";
import type { ReturnSeries } from "@/types/domain";

import { ChartCard, TooltipRow, TooltipShell } from "./ChartCard";

/**
 * Drawdown and VaR views.
 *
 * Both are computed in the browser from the returned portfolio return series,
 * using the SAME pure functions the server uses (`lib/quant`). That is the payoff
 * of the single-language quant core: no second implementation to keep in sync.
 */

/** Underwater curve: percentage below the running peak, always <= 0. */
function drawdownSeries(series: ReturnSeries) {
  const wealth = wealthIndex(series.values);
  let peak = 1;
  return wealth.map((value, i) => {
    if (value > peak) peak = value;
    return { date: series.dates[i] ?? "", drawdown: value / peak - 1, wealth: value };
  });
}

export function DrawdownChart({
  result,
  series,
  stale,
}: {
  result: AnalyticsResult;
  series: ReturnSeries;
  stale?: boolean;
}) {
  const data = React.useMemo(() => drawdownSeries(series), [series]);
  const { maxDrawdown } = result.risk;

  const trough = maxDrawdown.troughDate;
  const worst = Math.min(0, ...data.map((d) => d.drawdown));
  const floor = Math.floor(worst * 20) / 20;

  return (
    <ChartCard
      title="Drawdown"
      description={`Peak-to-trough decline · max ${formatPercent(maxDrawdown.maxDrawdown)}`}
      stale={stale}
      footnote={
        <>
          Measured against the running peak of the compounded path, with the peak starting
          at the first day of the window — so a portfolio that falls immediately still
          records the decline instead of hiding it.
          {maxDrawdown.peakDate === null
            ? " The worst drawdown here runs from the start of the window."
            : ` Worst run: ${maxDrawdown.peakDate} → ${maxDrawdown.troughDate}, ${maxDrawdown.durationDays} trading days.`}
        </>
      }
      chart={
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                  {/* Area fill is a ~10% wash, never a saturated block. */}
                  <stop offset="0%" stopColor={STATUS.negative} stopOpacity={0.02} />
                  <stop offset="100%" stopColor={STATUS.negative} stopOpacity={0.18} />
                </linearGradient>
              </defs>
              <CartesianGridSafe />
              <XAxis dataKey="date" minTickGap={40} {...AXIS_PROPS} />
              <YAxis
                domain={[floor, 0]}
                tickFormatter={percentTick}
                width={52}
                {...AXIS_PROPS}
                axisLine={false}
              />
              <ReferenceLine y={0} stroke={CHROME.baseline} strokeWidth={1} />
              {trough ? (
                <ReferenceLine
                  x={trough}
                  stroke={STATUS.negative}
                  strokeWidth={1}
                  label={{
                    value: `max ${formatPercent(maxDrawdown.maxDrawdown)}`,
                    position: "insideBottomRight",
                    fill: CHROME.secondaryInk,
                    fontSize: 10,
                  }}
                />
              ) : null}
              <Area
                type="monotone"
                dataKey="drawdown"
                stroke={STATUS.negative}
                strokeWidth={MARKS.lineWidth}
                fill="url(#ddFill)"
                activeDot={{
                  r: MARKS.markerRadius,
                  strokeWidth: MARKS.surfaceGap,
                  stroke: CHART_SURFACE,
                }}
                isAnimationActive={false}
              />
              <Tooltip
                cursor={{ stroke: CHROME.baseline, strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0]?.payload as (typeof data)[number] | undefined;
                  if (!point) return null;
                  return (
                    <TooltipShell label={String(label)}>
                      <TooltipRow
                        color={STATUS.negative}
                        name="Drawdown"
                        value={formatPercent(point.drawdown)}
                      />
                      <TooltipRow
                        name="Wealth index"
                        value={formatNumber(point.wealth, { digits: 3 })}
                      />
                    </TooltipShell>
                  );
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Max drawdown</TableCell>
              <TableCell className="text-right font-mono">
                {formatPercent(maxDrawdown.maxDrawdown)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Peak date</TableCell>
              <TableCell className="text-right font-mono">
                {maxDrawdown.peakDate ?? "window start"}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Trough date</TableCell>
              <TableCell className="text-right font-mono">
                {maxDrawdown.troughDate ?? "—"}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Duration (trading days)</TableCell>
              <TableCell className="text-right font-mono">
                {maxDrawdown.durationDays}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Cumulative return</TableCell>
              <TableCell className="text-right font-mono">
                {formatPercent(result.risk.cumulativeReturn, { signed: true })}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      }
    />
  );
}

const BIN_COUNT = 41;

function histogram(values: readonly number[]) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / BIN_COUNT || 1;

  const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
    center: min + width * (i + 0.5),
    lower: min + width * i,
    upper: min + width * (i + 1),
    count: 0,
  }));

  for (const value of values) {
    const index = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((value - min) / width)));
    const bin = bins[index];
    if (bin) bin.count++;
  }
  return bins;
}

/**
 * Daily return distribution with the VaR and CVaR thresholds marked.
 *
 * Bars beyond the VaR quantile take the status color because there they DO mean
 * "loss worse than the threshold" — that is reserved status semantics being used
 * for its reserved purpose, and both thresholds carry visible text labels so the
 * meaning never rests on hue alone.
 */
export function ValueAtRiskChart({
  result,
  series,
  stale,
}: {
  result: AnalyticsResult;
  series: ReturnSeries;
  stale?: boolean;
}) {
  const bins = React.useMemo(() => histogram(series.values), [series.values]);
  const { valueAtRisk95, conditionalValueAtRisk95 } = result.risk;
  const varQuantile = valueAtRisk95.quantile;
  const cvarQuantile = -conditionalValueAtRisk95;

  const tailDays = series.values.filter((v) => v <= varQuantile).length;

  return (
    <ChartCard
      title="Daily return distribution"
      description={`Historical VaR 95% ${formatPercent(valueAtRisk95.valueAtRisk)} · CVaR ${formatPercent(conditionalValueAtRisk95)}`}
      stale={stale}
      footnote={
        <>
          VaR is the 5th percentile of realised daily returns, interpolated between order
          statistics. CVaR is the mean of the {tailDays} days at or beyond it — the answer
          to &ldquo;given a tail day, how bad on average&rdquo;, which VaR alone cannot
          give. Both are historical: they describe this window, not a forecast.
        </>
      }
      chart={
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            {/* Top margin reserves a clear band for the two threshold labels;
                placing either one inside the plot collides with the tail bars. */}
            <BarChart data={bins} margin={{ top: 22, right: 12, bottom: 4, left: 0 }}>
              <CartesianGridSafe />
              <XAxis
                dataKey="center"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={percentTick}
                {...AXIS_PROPS}
              />
              <YAxis width={36} {...AXIS_PROPS} axisLine={false} />
              {/* CVaR sits further into the tail than VaR, so its label is
                  anchored to the left of the line and VaR's to the right —
                  they can never overlap each other. */}
              <ReferenceLine
                x={cvarQuantile}
                stroke={CHROME.mutedInk}
                strokeWidth={1}
                label={{
                  value: "CVaR",
                  position: "top",
                  offset: 8,
                  textAnchor: "end",
                  fill: CHROME.secondaryInk,
                  fontSize: 10,
                }}
              />
              <ReferenceLine
                x={varQuantile}
                stroke={STATUS.negative}
                strokeWidth={1}
                label={{
                  value: "VaR 95%",
                  position: "top",
                  offset: 8,
                  textAnchor: "start",
                  fill: CHROME.secondaryInk,
                  fontSize: 10,
                }}
              />
              <Bar dataKey="count" maxBarSize={MARKS.maxBarWidth} isAnimationActive={false}>
                {bins.map((bin) => (
                  <Cell
                    key={bin.center}
                    fill={bin.upper <= varQuantile ? STATUS.negative : CATEGORICAL[0]}
                  />
                ))}
              </Bar>
              <Tooltip
                cursor={{ fill: CHROME.gridline, fillOpacity: 0.4 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const bin = payload[0]?.payload as (typeof bins)[number] | undefined;
                  if (!bin) return null;
                  return (
                    <TooltipShell
                      label={`${percentTick(bin.lower)} to ${percentTick(bin.upper)}`}
                    >
                      <TooltipRow name="Days" value={String(bin.count)} />
                      <TooltipRow
                        name="Share"
                        value={formatPercent(bin.count / series.values.length)}
                      />
                    </TooltipShell>
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Observations</TableCell>
              <TableCell className="text-right font-mono">{series.values.length}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>VaR 95% (daily loss)</TableCell>
              <TableCell className="text-right font-mono">
                {formatPercent(valueAtRisk95.valueAtRisk)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>CVaR 95% (daily loss)</TableCell>
              <TableCell className="text-right font-mono">
                {formatPercent(conditionalValueAtRisk95)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Days at or beyond VaR</TableCell>
              <TableCell className="text-right font-mono">{tailDays}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Annualised volatility</TableCell>
              <TableCell className="text-right font-mono">
                {formatPercent(result.risk.annualizedVolatility)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Residual (idiosyncratic) volatility</TableCell>
              <TableCell className="text-right font-mono">
                {formatPercent(result.regression.residualVolatilityAnnualized)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      }
    />
  );
}

/**
 * The shared recessive grid. Wrapped so no chart can accidentally ship a dashed
 * or heavyweight grid — dashing reads as "threshold" when it is only a grid.
 */
function CartesianGridSafe() {
  return <CartesianGrid {...GRID_PROPS} />;
}
