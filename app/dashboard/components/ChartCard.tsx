"use client";

import { BarChart3, TableIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Wrapper for every chart on the dashboard.
 *
 * Carries the table-view toggle. A tooltip must never be the only way to read a
 * value, so each chart ships a WCAG-clean table twin; that is also the relief
 * channel for anything encoded by color.
 *
 * `stale` holds the previous render at reduced opacity during a refetch instead
 * of swapping in a skeleton, which would flash and jump the layout.
 */
export function ChartCard({
  title,
  description,
  footnote,
  chart,
  table,
  stale = false,
  className,
  actions,
}: {
  title: string;
  description?: string;
  footnote?: React.ReactNode;
  chart: React.ReactNode;
  table?: React.ReactNode;
  stale?: boolean;
  className?: string;
  actions?: React.ReactNode;
}) {
  const [view, setView] = React.useState<"chart" | "table">("chart");

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {table ? (
            <div className="flex rounded-md border p-0.5">
              <Button
                variant={view === "chart" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setView("chart")}
                aria-pressed={view === "chart"}
                title="Chart view"
              >
                <BarChart3 />
              </Button>
              <Button
                variant={view === "table" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setView("table")}
                aria-pressed={view === "table"}
                title="Table view"
              >
                <TableIcon />
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={cn("transition-opacity", stale && "opacity-40")}>
          {view === "chart" ? chart : table}
        </div>
        {footnote ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{footnote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Recharts tooltip shell so every chart's hover layer looks identical. */
export function TooltipShell({
  label,
  children,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-popover/95 px-2.5 py-2 shadow-lg backdrop-blur">
      {label ? (
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      ) : null}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/**
 * One tooltip row: a colored key carries identity, the text stays in ink tokens.
 * Text never wears the series color.
 */
export function TooltipRow({
  color,
  name,
  value,
}: {
  color?: string;
  name: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {color ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      ) : null}
      <span className="text-muted-foreground">{name}</span>
      <span className="ml-auto pl-3 font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/**
 * Legend row. Always rendered for two or more series — identity is never
 * color-alone, and a colored swatch beside ink text is the mechanism.
 */
export function ChartLegend({
  items,
  className,
}: {
  items: Array<{ color: string; label: string; muted?: boolean }>;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className="h-0.5 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          <span
            className={cn(
              "text-[11px]",
              item.muted ? "text-muted-foreground" : "text-secondary-foreground",
            )}
          >
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
