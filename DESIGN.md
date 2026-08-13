# Design System & UI/UX Specifications

## Theme & Palette
- **Concept:** Bloomberg Terminal meets Modern SaaS (Dark Theme First with High Contrast Data Visualization).
- **Primary Background:** `#090d16` (Slate Black) / Card BG: `#121826`
- **Accent Color:** `#3b82f6` (Financial Blue), `#10b981` (Positive/Alpha Green), `#ef4444` (Risk/Negative Red)
- **Typography:** Inter or JetBrains Mono (for financial tables & metrics).

## Key UI Components
- **Top Navigation:** Active Portfolio Selector, Benchmark Picker, Date Range Selector.
- **KPI Cards:** Portfolio Return, Active Return vs BM, Tracking Error, Information Ratio, Portfolio Beta.
- **Charts (Recharts only — do not introduce Plotly or a second charting library):**
  1. Radar Chart: Multi-Factor Exposure (Value, Momentum, Quality, Low Vol, Size).
  2. Timeseries Area/Line Chart: Rolling Factor Beta (Style Drift Monitoring).
  3. Bar Chart: Sector Active Exposure (Portfolio vs Benchmark).
  4. Scatter Plot: Risk vs Return Decomposition.
