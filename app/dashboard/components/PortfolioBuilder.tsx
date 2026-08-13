"use client";

import { Check, FolderOpen, Plus, Save, Scale, Trash2, X } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { SAMPLE_PORTFOLIOS, type SamplePortfolio } from "@/lib/data/samplePortfolios";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Portfolio, PortfolioHolding } from "@/types/domain";

/**
 * Portfolio construction sidebar.
 *
 * Weights are edited as PERCENTAGES with a live sum readout, because the single
 * most common way to get a wrong answer here is a book that does not add to 100%
 * — and the engine renormalises silently, so the UI has to make the drift
 * visible before it is analysed.
 */

const TICKER_PATTERN = /^[A-Z0-9.^-]{1,15}$/;

export interface PortfolioBuilderProps {
  holdings: PortfolioHolding[];
  onHoldingsChange: (holdings: PortfolioHolding[]) => void;
  onLoadSample: (sample: SamplePortfolio) => void;
  savedPortfolios: Portfolio[];
  savedLoading: boolean;
  onLoadSaved: (portfolio: Portfolio) => void;
  onSave: (name: string) => Promise<void>;
  saveError: string | null;
  activeSampleId: string | null;
}

export function PortfolioBuilder({
  holdings,
  onHoldingsChange,
  onLoadSample,
  savedPortfolios,
  savedLoading,
  onLoadSaved,
  onSave,
  saveError,
  activeSampleId,
}: PortfolioBuilderProps) {
  const [tickerDraft, setTickerDraft] = React.useState("");
  const [tickerError, setTickerError] = React.useState<string | null>(null);
  const [saveName, setSaveName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [savedFlash, setSavedFlash] = React.useState(false);

  const weightSum = holdings.reduce((sum, h) => sum + h.weight, 0);
  const balanced = Math.abs(weightSum - 1) <= 0.0001;

  const setWeight = (ticker: string, percent: number) => {
    onHoldingsChange(
      holdings.map((h) => (h.ticker === ticker ? { ...h, weight: percent / 100 } : h)),
    );
  };

  const remove = (ticker: string) => {
    onHoldingsChange(holdings.filter((h) => h.ticker !== ticker));
  };

  const add = () => {
    const ticker = tickerDraft.trim().toUpperCase();
    if (!TICKER_PATTERN.test(ticker)) {
      setTickerError("Letters, digits, dot, hyphen or caret. Max 15 characters.");
      return;
    }
    if (holdings.some((h) => h.ticker === ticker)) {
      setTickerError(`${ticker} is already in the portfolio.`);
      return;
    }
    setTickerError(null);
    setTickerDraft("");
    // New names enter at 5%; the sum readout then shows the book is off 100%.
    onHoldingsChange([...holdings, { ticker, weight: 0.05 }]);
  };

  const normalize = () => {
    if (weightSum <= 0) return;
    onHoldingsChange(holdings.map((h) => ({ ...h, weight: h.weight / weightSum })));
  };

  const equalWeight = () => {
    if (holdings.length === 0) return;
    const each = 1 / holdings.length;
    onHoldingsChange(holdings.map((h) => ({ ...h, weight: each })));
  };

  const save = async () => {
    setSaving(true);
    setSavedFlash(false);
    try {
      await onSave(saveName.trim() || "Untitled portfolio");
      setSaveName("");
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* --- presets ------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Sample portfolios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {SAMPLE_PORTFOLIOS.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => onLoadSample(sample)}
              className={cn(
                "w-full rounded-md border p-2.5 text-left transition-colors",
                "hover:border-terminal-accent/50 hover:bg-secondary/50",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                activeSampleId === sample.id &&
                  "border-terminal-accent/60 bg-terminal-accent/5",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium">{sample.name}</span>
                {activeSampleId === sample.id ? (
                  <Check className="mt-0.5 size-3 shrink-0 text-terminal-accent" />
                ) : null}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {sample.thesis}
              </p>
              {/* Stating the expected tilt makes the chart falsifiable instead of
                  decorative — if the radar disagrees, something is wrong. */}
              <p className="mt-1 font-mono text-[10px] leading-snug text-terminal-accent/80">
                expect: {sample.expectedTilt}
              </p>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* --- holdings ----------------------------------------------------- */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Holdings ({holdings.length})</CardTitle>
          <Badge variant={balanced ? "positive" : "negative"}>
            Σ {formatPercent(weightSum)}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {!balanced ? (
            <p className="text-[11px] leading-snug text-terminal-negative">
              Weights do not sum to 100%. Analytics will rescale them, which changes every
              return — normalise here so what you see is what is measured.
            </p>
          ) : null}

          <div className="flex gap-1.5">
            <Button variant="outline" size="xs" onClick={normalize} className="flex-1">
              <Scale /> Normalise
            </Button>
            <Button variant="outline" size="xs" onClick={equalWeight} className="flex-1">
              Equal weight
            </Button>
          </div>

          <Separator />

          <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
            {holdings.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No holdings. Add a ticker or load a sample.
              </p>
            ) : (
              holdings.map((holding) => (
                <div key={holding.ticker} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium">{holding.ticker}</span>
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                      {(holding.weight * 100).toFixed(1)}%
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => remove(holding.ticker)}
                      aria-label={`Remove ${holding.ticker}`}
                      className="size-6 p-0 text-muted-foreground hover:text-terminal-negative"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Slider
                    value={[holding.weight * 100]}
                    min={0}
                    max={50}
                    step={0.5}
                    onValueChange={([percent]) => setWeight(holding.ticker, percent ?? 0)}
                    aria-label={`${holding.ticker} weight`}
                  />
                </div>
              ))
            )}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="ticker-input">Add ticker</Label>
            <div className="flex gap-1.5">
              <Input
                id="ticker-input"
                value={tickerDraft}
                onChange={(event) => {
                  setTickerDraft(event.target.value);
                  setTickerError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") add();
                }}
                placeholder="AAPL / 005930.KS"
                className="h-8 font-mono text-xs uppercase"
                autoComplete="off"
                spellCheck={false}
              />
              <Button size="sm" onClick={add} disabled={tickerDraft.trim().length === 0}>
                <Plus />
              </Button>
            </div>
            {tickerError ? (
              <p className="text-[11px] text-terminal-negative">{tickerError}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* --- persistence -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Save / load</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="save-name">Save current as</Label>
            <div className="flex gap-1.5">
              <Input
                id="save-name"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder="My test book"
                className="h-8 text-xs"
                maxLength={120}
              />
              <Button
                size="sm"
                onClick={save}
                disabled={saving || holdings.length === 0}
                title="Saves to Supabase as an anonymous dummy portfolio"
              >
                {savedFlash ? <Check /> : <Save />}
              </Button>
            </div>
            {saveError ? (
              <p className="text-[11px] leading-snug text-terminal-negative">{saveError}</p>
            ) : null}
            {savedFlash ? (
              <p className="text-[11px] text-terminal-positive">Saved.</p>
            ) : null}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label>Saved portfolios</Label>
            {savedLoading ? (
              <p className="text-[11px] text-muted-foreground">Loading…</p>
            ) : savedPortfolios.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">None saved yet.</p>
            ) : (
              <ul className="space-y-1">
                {savedPortfolios.map((portfolio) => (
                  <li key={portfolio.id}>
                    <button
                      type="button"
                      onClick={() => onLoadSaved(portfolio)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{portfolio.name}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                        {portfolio.holdings.length}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
        <X className="mr-1 inline size-2.5" aria-hidden />
        Public market data and dummy weights only. Never enter client holdings or any
        confidential position.
      </p>
    </div>
  );
}
