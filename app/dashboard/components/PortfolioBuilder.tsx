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
import {
  BALANCE_EPSILON,
  equalWeights,
  percentToWeight,
  rebalanceToOne,
  totalWeight,
  weightToPercentText,
} from "@/lib/portfolioWeights";
import { cn } from "@/lib/utils";
import type { Portfolio, PortfolioHolding } from "@/types/domain";

/**
 * Portfolio construction sidebar.
 *
 * Weights are edited as PERCENTAGES, both by typing and by dragging, because the
 * single most common way to get a wrong answer here is a book that does not add
 * to 100% — and the engine renormalises silently, so the UI has to make the
 * drift visible before it is analysed.
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

  /**
   * In-progress text per ticker. Needed so a half-typed value ("1", "12.") is
   * not overwritten by the canonical render on every keystroke — without it the
   * field fights the user mid-entry.
   */
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});

  // Loading a different book must not leave stale drafts on screen.
  const tickerKey = holdings.map((h) => h.ticker).join("|");
  React.useEffect(() => {
    setDrafts({});
  }, [tickerKey]);

  const weightSum = totalWeight(holdings);
  const remaining = 1 - weightSum;
  const balanced = Math.abs(remaining) < BALANCE_EPSILON;

  const setWeight = (ticker: string, weight: number) => {
    onHoldingsChange(
      holdings.map((h) => (h.ticker === ticker ? { ...h, weight } : h)),
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
    // Enter at whatever is unallocated, so adding a name to a balanced book
    // keeps it balanced instead of silently pushing it over 100%.
    const seed = remaining > BALANCE_EPSILON ? percentToWeight(remaining * 100) : 0;
    onHoldingsChange([...holdings, { ticker, weight: seed }]);
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
          {/* Says exactly how far off and in which direction, so the fix is
              arithmetic rather than trial and error. */}
          {balanced ? (
            <p className="text-[11px] text-terminal-positive">Weights balance to 100%.</p>
          ) : (
            <p className="text-[11px] leading-snug text-terminal-negative">
              {remaining > 0
                ? `${formatPercent(remaining)} unallocated.`
                : `${formatPercent(-remaining)} over-allocated.`}{" "}
              Analytics would rescale this, which changes every return — normalise so what
              you see is what is measured.
            </p>
          )}

          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="xs"
              onClick={() => onHoldingsChange(rebalanceToOne(holdings))}
              disabled={holdings.length === 0 || balanced}
              className="flex-1"
            >
              <Scale /> Normalise
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => onHoldingsChange(equalWeights(holdings))}
              disabled={holdings.length === 0}
              className="flex-1"
            >
              Equal weight
            </Button>
          </div>

          <Separator />

          {/* No nested scroll container. The sidebar already scrolls, and two
              stacked scroll regions make it unpredictable which one the wheel
              acts on — the list grows and the sidebar carries it. */}
          <div className="space-y-3">
            {holdings.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No holdings. Add a ticker or load a sample.
              </p>
            ) : (
              holdings.map((holding) => (
                <HoldingRow
                  key={holding.ticker}
                  holding={holding}
                  draft={drafts[holding.ticker]}
                  onDraftChange={(text) =>
                    setDrafts((previous) => ({ ...previous, [holding.ticker]: text }))
                  }
                  onDraftCommit={() =>
                    setDrafts((previous) => {
                      const next = { ...previous };
                      delete next[holding.ticker];
                      return next;
                    })
                  }
                  onWeightChange={(weight) => setWeight(holding.ticker, weight)}
                  onRemove={() => remove(holding.ticker)}
                />
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

/**
 * One holding: typed percent entry and a slider, both writing the same weight.
 *
 * The text field is the authority while focused; the slider only ever writes
 * canonical grid values.
 */
function HoldingRow({
  holding,
  draft,
  onDraftChange,
  onDraftCommit,
  onWeightChange,
  onRemove,
}: {
  holding: PortfolioHolding;
  draft: string | undefined;
  onDraftChange: (text: string) => void;
  onDraftCommit: () => void;
  onWeightChange: (weight: number) => void;
  onRemove: () => void;
}) {
  const canonical = weightToPercentText(holding.weight);
  const text = draft ?? canonical;
  // An unparseable or out-of-range draft is flagged rather than silently dropped.
  const parsed = text.trim() === "" ? Number.NaN : Number(text);
  const invalid = !Number.isFinite(parsed) || parsed < 0 || parsed > 100;

  const commit = (raw: string) => {
    onDraftChange(raw);
    const value = Number(raw);
    // Only write through when the text is a usable number; otherwise the draft
    // stands until blur so intermediate states survive.
    if (raw.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100) {
      onWeightChange(percentToWeight(value));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-medium">{holding.ticker}</span>
        <div className="ml-auto flex items-center gap-1">
          <Input
            value={text}
            onChange={(event) => commit(event.target.value)}
            onBlur={onDraftCommit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onDraftCommit();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") onDraftCommit();
            }}
            onFocus={(event) => event.currentTarget.select()}
            // `type="text"` with a decimal hint: a number input adds spinners and
            // rejects partial entry like "7." mid-typing.
            type="text"
            inputMode="decimal"
            aria-label={`${holding.ticker} weight in percent`}
            aria-invalid={invalid}
            className={cn(
              "h-7 w-[68px] px-1.5 text-right font-mono text-xs tabular-nums",
              invalid && "border-terminal-negative text-terminal-negative",
            )}
          />
          <span className="font-mono text-xs text-muted-foreground">%</span>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onRemove}
          aria-label={`Remove ${holding.ticker}`}
          className="size-6 p-0 text-muted-foreground hover:text-terminal-negative"
        >
          <Trash2 />
        </Button>
      </div>
      <Slider
        value={[Math.min(100, Math.max(0, holding.weight * 100))]}
        min={0}
        max={100}
        // Matches the 2-decimal grid closely enough to drag to a clean value,
        // while still letting the text field express 7.55%.
        step={0.1}
        onValueChange={([percent]) => {
          onDraftCommit();
          onWeightChange(percentToWeight(percent ?? 0));
        }}
        aria-label={`${holding.ticker} weight`}
      />
    </div>
  );
}
