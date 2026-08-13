"use client";

import { Activity, AlertTriangle, LineChart, PieChart } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AnalyticsResult } from "@/lib/analytics/factorEngine";
import { SAMPLE_PORTFOLIOS, RANGE_PRESETS } from "@/lib/data/samplePortfolios";
import type { Portfolio, PortfolioHolding, ReturnSeries } from "@/types/domain";

import { ControlBar } from "./ControlBar";
import { FactorBetaChart } from "./FactorBetaChart";
import { FactorRadarChart } from "./FactorRadarChart";
import { KpiRow } from "./KpiRow";
import { PortfolioBuilder } from "./PortfolioBuilder";
import { DrawdownChart, ValueAtRiskChart } from "./RiskVisuals";
import { SectorExposureChart, StaticDataBadge } from "./SectorExposureChart";
import { StyleDriftChart } from "./StyleDriftChart";

/** Response envelope from POST /api/analytics. */
type AnalyticsResponse =
  | ({ ok: true; portfolioSeries?: ReturnSeries } & AnalyticsResult)
  | { ok: false; error: string; field?: string };

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoYearsAgo(years: number): string {
  const now = new Date();
  now.setUTCFullYear(now.getUTCFullYear() - years);
  return now.toISOString().slice(0, 10);
}

/** Factor history begins in 2013; MAX cannot usefully start earlier. */
const HISTORY_START = "2013-09-01";

const DEFAULT_SAMPLE = SAMPLE_PORTFOLIOS[0]!;

export function DashboardClient() {
  const [holdings, setHoldings] = React.useState<PortfolioHolding[]>([
    ...DEFAULT_SAMPLE.holdings,
  ]);
  const [activeSampleId, setActiveSampleId] = React.useState<string | null>(
    DEFAULT_SAMPLE.id,
  );
  const [benchmark, setBenchmark] = React.useState(DEFAULT_SAMPLE.benchmark);
  const [range, setRange] = React.useState({ from: isoYearsAgo(3), to: isoToday() });
  const [activePreset, setActivePreset] = React.useState<string | null>("3y");
  const [rollingWindow, setRollingWindow] = React.useState(60);

  const [result, setResult] = React.useState<AnalyticsResult | null>(null);
  const [series, setSeries] = React.useState<ReturnSeries | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** True when inputs changed since the last successful run. */
  const [dirty, setDirty] = React.useState(true);

  const [savedPortfolios, setSavedPortfolios] = React.useState<Portfolio[]>([]);
  const [savedLoading, setSavedLoading] = React.useState(true);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // --- saved portfolios ------------------------------------------------------
  const refreshSaved = React.useCallback(async () => {
    setSavedLoading(true);
    try {
      const response = await fetch("/api/portfolios?limit=50");
      const body = (await response.json()) as
        | { ok: true; portfolios: Portfolio[] }
        | { ok: false; error: string };
      if (body.ok) setSavedPortfolios(body.portfolios);
    } catch {
      // A failed list is not worth blocking the dashboard over; the save path
      // reports its own errors.
    } finally {
      setSavedLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

  // --- analytics -------------------------------------------------------------
  const run = React.useCallback(async () => {
    if (holdings.length === 0) {
      setError("Add at least one holding.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdings,
          benchmark,
          from: range.from,
          to: range.to,
          rollingWindow,
          // Needed for the drawdown and VaR views, which are computed in the
          // browser with the same pure functions the server uses.
          includePortfolioSeries: true,
        }),
      });

      const body = (await response.json()) as AnalyticsResponse;
      if (!body.ok) {
        setError(body.error);
        return;
      }

      const { portfolioSeries, ...rest } = body;
      // `ok` and `request` are envelope fields, not part of the analytics result.
      setResult(rest as unknown as AnalyticsResult);
      setSeries(portfolioSeries ?? null);
      setDirty(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [holdings, benchmark, range.from, range.to, rollingWindow]);

  // Run once on mount so the dashboard is never an empty shell.
  const ranOnce = React.useRef(false);
  React.useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;
    void run();
  }, [run]);

  // --- input handlers --------------------------------------------------------
  const markDirty = () => setDirty(true);

  const applyHoldings = (next: PortfolioHolding[]) => {
    setHoldings(next);
    setActiveSampleId(null);
    markDirty();
  };

  const loadSample = (sample: (typeof SAMPLE_PORTFOLIOS)[number]) => {
    setHoldings([...sample.holdings]);
    setBenchmark(sample.benchmark);
    setActiveSampleId(sample.id);
    markDirty();
  };

  const loadSaved = (portfolio: Portfolio) => {
    setHoldings([...portfolio.holdings]);
    setActiveSampleId(null);
    markDirty();
  };

  const save = async (name: string) => {
    setSaveError(null);
    const response = await fetch("/api/portfolios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The server rejects a book that does not sum to 1 unless asked to
      // normalise; the sidebar already surfaces the sum, so opt in here.
      body: JSON.stringify({ name, holdings, normalize: true }),
    });
    const body = (await response.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      setSaveError(body.error ?? "Save failed.");
      return;
    }
    await refreshSaved();
  };

  const applyPreset = (presetId: string) => {
    const preset = RANGE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);
    setRange({
      from: preset.years === null ? HISTORY_START : isoYearsAgo(preset.years),
      to: isoToday(),
    });
    markDirty();
  };

  const applyRange = (next: { from: string; to: string }) => {
    setRange(next);
    setActivePreset(null);
    markDirty();
  };

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card/50">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold tracking-tight">
              Equity Factor Analytics
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Style &amp; factor attribution · public data only
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {result ? (
              <>
                <Badge variant="outline">{result.regression.observations} obs</Badge>
                <Badge variant="outline">
                  {result.timings.totalMs}ms · {result.data.prices.cacheReadRequests} reads
                </Badge>
                {result.regression.riskAdjusted ? (
                  <Badge variant="positive">risk-adjusted</Badge>
                ) : (
                  <Badge variant="negative">raw intercept</Badge>
                )}
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 xl:flex-row xl:items-start">
        {/* Sticky with its own scroll on wide screens: otherwise the sidebar is
            taller than the charts and drives a page height that leaves the main
            column stranded in whitespace. The bar itself is hidden — at full
            height it sits directly beside the charts and reads as chrome
            competing with the data. */}
        <aside className="scrollbar-hidden w-full shrink-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:w-[320px] xl:overflow-y-auto">
          <PortfolioBuilder
            holdings={holdings}
            onHoldingsChange={applyHoldings}
            onLoadSample={loadSample}
            savedPortfolios={savedPortfolios}
            savedLoading={savedLoading}
            onLoadSaved={loadSaved}
            onSave={save}
            saveError={saveError}
            activeSampleId={activeSampleId}
          />
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          <ControlBar
            benchmark={benchmark}
            onBenchmarkChange={(next) => {
              setBenchmark(next);
              markDirty();
            }}
            from={range.from}
            to={range.to}
            onRangeChange={applyRange}
            activePreset={activePreset}
            onPresetChange={applyPreset}
            rollingWindow={rollingWindow}
            onRollingWindowChange={(next) => {
              setRollingWindow(next);
              markDirty();
            }}
            onRun={run}
            loading={loading}
            dirty={dirty}
          />

          {error ? (
            <Card className="border-terminal-negative/40 bg-terminal-negative/5">
              <CardContent className="flex items-start gap-2 p-4">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-terminal-negative" />
                <div>
                  <p className="text-sm font-medium text-terminal-negative">
                    Analysis failed
                  </p>
                  <p className="mt-1 text-xs text-secondary-foreground">{error}</p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {result ? (
            <>
              <KpiRow result={result} stale={loading} />

              {result.warnings.length > 0 ? (
                <Card className="border-terminal-negative/30">
                  <CardContent className="p-4">
                    <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-terminal-negative">
                      <AlertTriangle className="size-3" />
                      {result.warnings.length} caveat
                      {result.warnings.length === 1 ? "" : "s"}
                    </p>
                    <ul className="space-y-1">
                      {result.warnings.map((warning) => (
                        <li
                          key={warning}
                          className="text-[11px] leading-relaxed text-secondary-foreground"
                        >
                          · {warning}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}

              <Tabs defaultValue="exposure">
                <TabsList>
                  <TabsTrigger value="exposure">
                    <PieChart className="size-3.5" />
                    Factor Exposure &amp; Style
                  </TabsTrigger>
                  <TabsTrigger value="drift">
                    <LineChart className="size-3.5" />
                    Style Drift Monitoring
                  </TabsTrigger>
                  <TabsTrigger value="risk">
                    <Activity className="size-3.5" />
                    Risk &amp; Return Decomposition
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="exposure" className="mt-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <FactorRadarChart result={result} stale={loading} />
                    <FactorBetaChart result={result} stale={loading} />
                  </div>
                </TabsContent>

                <TabsContent value="drift" className="mt-4">
                  <StyleDriftChart result={result} stale={loading} />
                </TabsContent>

                <TabsContent value="risk" className="mt-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <StaticDataBadge />
                  </div>
                  <SectorExposureChart
                    holdings={holdings}
                    benchmark={benchmark}
                    stale={loading}
                  />
                  {series ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <DrawdownChart result={result} series={series} stale={loading} />
                      <ValueAtRiskChart result={result} series={series} stale={loading} />
                    </div>
                  ) : null}
                </TabsContent>
              </Tabs>
            </>
          ) : loading ? (
            <Card>
              <CardContent className="flex h-64 items-center justify-center p-4">
                <p className="text-xs text-muted-foreground">Running analysis…</p>
              </CardContent>
            </Card>
          ) : null}
        </main>
      </div>
    </div>
  );
}
