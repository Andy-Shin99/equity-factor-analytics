"use client";

import { Play, RefreshCw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BENCHMARKS, RANGE_PRESETS } from "@/lib/data/samplePortfolios";
import { cn } from "@/lib/utils";

/**
 * One filter row above everything it scopes.
 *
 * Deliberately NOT per-chart: every chart on every tab re-renders against the
 * same slice, so a reader can never compare two panels that were computed on
 * different windows.
 */

export interface ControlBarProps {
  benchmark: string;
  onBenchmarkChange: (benchmark: string) => void;
  from: string;
  to: string;
  onRangeChange: (range: { from: string; to: string }) => void;
  activePreset: string | null;
  onPresetChange: (presetId: string) => void;
  rollingWindow: number;
  onRollingWindowChange: (window: number) => void;
  onRun: () => void;
  loading: boolean;
  dirty: boolean;
}

const ROLLING_WINDOWS = [30, 60, 90, 120, 252];

export function ControlBar({
  benchmark,
  onBenchmarkChange,
  from,
  to,
  onRangeChange,
  activePreset,
  onPresetChange,
  rollingWindow,
  onRollingWindowChange,
  onRun,
  loading,
  dirty,
}: ControlBarProps) {
  const usBenchmarks = BENCHMARKS.filter((b) => b.region === "US");
  const krBenchmarks = BENCHMARKS.filter((b) => b.region === "KR");

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <div className="space-y-1.5">
        <Label htmlFor="benchmark">Benchmark</Label>
        <Select value={benchmark} onValueChange={onBenchmarkChange}>
          <SelectTrigger id="benchmark" className="h-8 w-[220px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>United States</SelectLabel>
              {usBenchmarks.map((option) => (
                <SelectItem key={option.ticker} value={option.ticker} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Korea</SelectLabel>
              {krBenchmarks.map((option) => (
                <SelectItem key={option.ticker} value={option.ticker} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Period</Label>
        <div className="flex rounded-md border p-0.5">
          {RANGE_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant={activePreset === preset.id ? "secondary" : "ghost"}
              size="xs"
              onClick={() => onPresetChange(preset.id)}
              aria-pressed={activePreset === preset.id}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="from-date">From</Label>
        <Input
          id="from-date"
          type="date"
          value={from}
          max={to}
          onChange={(event) => onRangeChange({ from: event.target.value, to })}
          className="h-8 w-[140px] font-mono text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="to-date">To</Label>
        <Input
          id="to-date"
          type="date"
          value={to}
          min={from}
          onChange={(event) => onRangeChange({ from, to: event.target.value })}
          className="h-8 w-[140px] font-mono text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rolling-window">Rolling window</Label>
        <Select
          value={String(rollingWindow)}
          onValueChange={(value) => onRollingWindowChange(Number(value))}
        >
          <SelectTrigger id="rolling-window" className="h-8 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLLING_WINDOWS.map((window) => (
              <SelectItem key={window} value={String(window)} className="text-xs">
                {window} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        onClick={onRun}
        disabled={loading}
        size="sm"
        className={cn("ml-auto", dirty && !loading && "ring-1 ring-terminal-accent")}
      >
        {loading ? <RefreshCw className="animate-spin" /> : <Play />}
        {loading ? "Running" : dirty ? "Run analysis" : "Re-run"}
      </Button>
    </div>
  );
}
