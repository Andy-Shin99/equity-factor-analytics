"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AnalyticsResult } from "@/lib/analytics/factorEngine";
import { AXIS_PROPS, CHROME, FACTOR_COLORS, GRID_PROPS, MARKS } from "@/lib/charts/theme";
import { betaTick, formatNumber } from "@/lib/format";
import { FACTOR_LABELS, type FactorKey } from "@/types/domain";

import { ChartCard, ChartLegend, TooltipRow, TooltipShell } from "./ChartCard";

/**
 * Rolling factor beta over time — the style-drift monitor.
 *
 * All series are betas, so they share ONE y-axis. There is no second scale here
 * and there must never be: a dual axis would invent a relationship between two
 * factors that the data does not contain.
 *
 * Six converging lines is past the point where direct end-labels work (they
 * detach from their lines and read as noise), so identity comes from the legend
 * plus a crosshair tooltip. Colors are bound to the FACTOR, so toggling a series
 * off never repaints the survivors.
 */

const ALL_FACTORS: readonly FactorKey[] = [
  "market_rf",
  "hml",
  "momentum",
  "quality",
  "low_vol",
  "smb",
];

/** Thin the x-axis ticks; one label per point would collide immediately. */
function tickInterval(pointCount: number): number {
  return Math.max(0, Math.floor(pointCount / 8) - 1);
}

export function StyleDriftChart({
  result,
  stale,
}: {
  result: AnalyticsResult;
  stale?: boolean;
}) {
  const available = ALL_FACTORS.filter((key) => result.factors.includes(key));
  const [hidden, setHidden] = React.useState<Set<FactorKey>>(new Set());

  const data = React.useMemo(
    () =>
      result.rolling.points.map((point) => {
        const row: Record<string, string | number> = { date: point.date };
        for (const key of available) {
          const value = point.betas[key];
          if (value !== undefined && Number.isFinite(value)) row[key] = value;
        }
        return row;
      }),
    [result.rolling.points, available],
  );

  const visible = available.filter((key) => !hidden.has(key));

  const toggle = (key: FactorKey) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      // Never let the reader hide everything — an empty plot is not a state.
      else if (next.size < available.length - 1) next.add(key);
      return next;
    });
  };

  if (data.length === 0) {
    return (
      <ChartCard
        title="Rolling factor beta"
        description={`${result.rolling.window}-day window`}
        stale={stale}
        chart={
          <div className="flex h-[340px] items-center justify-center rounded-md border border-dashed">
            <p className="max-w-sm text-center text-xs text-muted-foreground">
              Not enough overlapping observations for a {result.rolling.window}-day window.
              Widen the analysis period or reduce the window.
            </p>
          </div>
        }
      />
    );
  }

  return (
    <ChartCard
      title="Rolling factor beta"
      description={`${result.rolling.window}-day window, step ${result.rolling.step} · ${data.length} windows`}
      stale={stale}
      footnote={
        <>
          Each point re-fits the whole model on the trailing {result.rolling.window}{" "}
          observations, so a line that trends is a genuine change in exposure rather than
          noise around an average. Where one factor breaks sharply, the other lines in that
          window are biased by the misspecification — read them together, not in isolation.
        </>
      }
      chart={
        <div className="space-y-3">
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              {/* The right margin has to clear half a date label, or the final
                  tick renders clipped ("2026-08-"). */}
              <LineChart data={data} margin={{ top: 4, right: 44, bottom: 4, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis
                  dataKey="date"
                  interval={tickInterval(data.length)}
                  minTickGap={40}
                  {...AXIS_PROPS}
                />
                <YAxis tickFormatter={betaTick} width={44} {...AXIS_PROPS} axisLine={false} />
                {/* Zero is the reference a beta is read against. */}
                <ReferenceLine y={0} stroke={CHROME.baseline} strokeWidth={1} />
                {visible.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={FACTOR_LABELS[key]}
                    stroke={FACTOR_COLORS[key]}
                    strokeWidth={MARKS.lineWidth}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    dot={false}
                    // Hover marker carries a surface ring so it stays legible
                    // where lines cross.
                    activeDot={{
                      r: MARKS.markerRadius,
                      strokeWidth: MARKS.surfaceGap,
                      stroke: "#121826",
                    }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
                <Tooltip
                  cursor={{ stroke: CHROME.baseline, strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <TooltipShell label={String(label)}>
                        {[...payload]
                          .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
                          .map((entry) => (
                            <TooltipRow
                              key={String(entry.dataKey)}
                              color={entry.color}
                              name={String(entry.name)}
                              value={formatNumber(Number(entry.value), {
                                digits: 3,
                                signed: true,
                              })}
                            />
                          ))}
                      </TooltipShell>
                    );
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Legend is always present for >= 2 series, and doubles as the series
              filter. Hue is bound to the factor, so hiding one does not recolor
              the rest. */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            {available.map((key) => {
              const isHidden = hidden.has(key);
              return (
                <Button
                  key={key}
                  variant="ghost"
                  size="xs"
                  onClick={() => toggle(key)}
                  aria-pressed={!isHidden}
                  className="gap-1.5"
                >
                  <span
                    className="h-0.5 w-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor: isHidden ? CHROME.gridline : FACTOR_COLORS[key],
                    }}
                    aria-hidden
                  />
                  <span className={isHidden ? "text-muted-foreground line-through" : ""}>
                    {FACTOR_LABELS[key]}
                  </span>
                </Button>
              );
            })}
          </div>

          {result.rolling.windowsSkipped > 0 ? (
            <p className="text-[11px] text-terminal-negative">
              {result.rolling.windowsSkipped} windows omitted as singular.
            </p>
          ) : null}
        </div>
      }
      table={
        <div className="max-h-[340px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Window end</TableHead>
                {available.map((key) => (
                  <TableHead key={key} className="text-right">
                    {FACTOR_LABELS[key]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Newest first: the current exposure is what gets read. */}
              {[...result.rolling.points].reverse().map((point) => (
                <TableRow key={point.date}>
                  <TableCell className="font-mono">{point.date}</TableCell>
                  {available.map((key) => (
                    <TableCell key={key} className="text-right font-mono">
                      {formatNumber(point.betas[key], { digits: 3, signed: true })}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      }
      actions={
        <ChartLegend
          className="hidden xl:flex"
          items={[{ color: CHROME.mutedInk, label: `${visible.length}/${available.length} shown`, muted: true }]}
        />
      }
    />
  );
}
