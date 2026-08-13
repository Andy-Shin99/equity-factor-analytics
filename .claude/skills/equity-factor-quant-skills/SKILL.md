---
name: equity-factor-quant-skills
description: Financial formulas and quantitative analytics algorithms for Equity Portfolio Management.
---

# Quantitative Financial Formula Specifications

## 1. Multi-Factor Regression (Fama-French / Custom Factor)
- **Equation:** $R_{p,t} - R_{f,t} = \alpha + \beta_1 (R_{m,t} - R_{f,t}) + \beta_2 \text{SMB}_t + \beta_3 \text{HML}_t + \epsilon_t$
- **Outputs:** Alpha ($\alpha$, annualized), Beta ($\beta_i$), $t$-statistics, $p$-values, Adjusted $R^2$.

## 2. Risk & Tracking Metrics
- **Tracking Error (TE):** $\text{TE} = \sqrt{\frac{1}{N-1} \sum_{t=1}^N \left( R_{p,t} - R_{b,t} - \bar{D} \right)^2} \times \sqrt{252}$
- **Information Ratio (IR):** $\text{IR} = \frac{\text{Annualized Active Return}}{\text{Tracking Error}}$
- **Historical VaR (95%):** 5th percentile of daily portfolio returns.
