import type { Metadata } from "next";

import { DashboardClient } from "./components/DashboardClient";

export const metadata: Metadata = {
  title: "Dashboard · Equity Factor Analytics",
  description:
    "Factor exposure, style drift and risk decomposition for equity portfolios.",
};

/**
 * The dashboard is fully client-driven: every panel depends on a portfolio the
 * user is editing, so there is nothing meaningful to render on the server ahead
 * of that. Data fetching goes through /api/analytics, which is where the caching
 * and the region pinning live.
 */
export default function DashboardPage() {
  return <DashboardClient />;
}
