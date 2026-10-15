import { z } from "zod";

const Stats = z.object({
  symbol: z.string(),
  points: z.number(),
  returnPct: z.number().nullable(),
  volatilityAnnPct: z.number().nullable(),
  maxDrawdownPct: z.number().nullable(),
  realReturnPct: z.number().nullable(),
  sharpe: z.number().nullable(),
  beta: z.number().nullable(),
  best: z.object({ date: z.string(), pct: z.number() }).nullable(),
  worst: z.object({ date: z.string(), pct: z.number() }).nullable(),
});
export const Benchmark = z.object({
  slug: z.string(),
  label: z.string(),
  unit: z.string().nullable(),
  points: z.number(),
  returnPct: z.number().nullable(),
  rebased: z.array(z.object({ date: z.string(), value: z.number() })),
});
export const CompareResponse = z.object({
  stats: z.array(Stats),
  ranking: z.array(z.string()),
  rebased: z.record(z.array(z.object({ date: z.string(), value: z.number() }))),
  benchmark: Benchmark.nullable(),
});
export type CompareResponse = z.infer<typeof CompareResponse>;

export const Asset = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  assetClass: z.enum(["STOCK", "FII", "FUND", "TREASURY", "OTHER"]),
  source: z.enum(["MANUAL", "BRAPI"]),
});
export type Asset = z.infer<typeof Asset>;

const num = z.coerce.number();
const numNull = z.coerce.number().nullable();

export const PriceBar = z.object({
  id: z.string(),
  date: z.string(),
  open: numNull,
  high: numNull,
  low: numNull,
  close: numNull,
  adjustedClose: numNull,
  volume: z.union([z.string(), z.number()]).nullable(),
  source: z.enum(["MANUAL", "BRAPI"]),
});
export type PriceBar = z.infer<typeof PriceBar>;

export const Portfolio = z.object({ id: z.string(), name: z.string() });
export type Portfolio = z.infer<typeof Portfolio>;

export const Position = z.object({
  assetId: z.string(),
  symbol: z.string(),
  quantity: num,
  avgPrice: numNull,
  invested: num,
  currentPrice: numNull,
  lastPriceDate: z.string().nullable(),
  marketValue: numNull,
  pnl: numNull,
  pnlPct: numNull,
  allocationPct: numNull,
});
export type Position = z.infer<typeof Position>;
export const PortfolioPosition = z.object({
  positions: z.array(Position),
  totalInvested: num,
  totalMarketValue: numNull,
  totalPnl: numNull,
  totalPnlPct: numNull,
});
export type PortfolioPosition = z.infer<typeof PortfolioPosition>;

export const Transaction = z.object({
  id: z.string(),
  portfolioId: z.string(),
  assetId: z.string(),
  type: z.enum(["BUY", "SELL"]),
  quantity: num,
  unitPrice: num,
  fees: num,
  tradedAt: z.string(),
  notes: z.string().nullable(),
  asset: Asset.optional(),
});
export type Transaction = z.infer<typeof Transaction>;

export const Dividend = z.object({
  id: z.string(),
  assetId: z.string(),
  kind: z.enum(["DIVIDEND", "JCP", "RENDIMENTO", "AMORTIZACAO", "OTHER"]),
  amountPerUnit: num,
  exDate: z.string().nullable(),
  paymentDate: z.string(),
  source: z.enum(["MANUAL", "BRAPI"]),
  asset: Asset.optional(),
});
export type Dividend = z.infer<typeof Dividend>;

const bigNull = z.union([z.string(), z.number()]).nullable();
export const FiiIndicator = z.object({
  id: z.string(),
  referenceDate: z.string(),
  price: numNull,
  navPerShare: numNull,
  priceToNav: numNull,
  dy12m: numNull,
  dy1m: numNull,
  monthlyReturn: numNull,
  totalInvestors: bigNull,
  shares: bigNull,
  equity: numNull,
  segment: z.string().nullable(),
});
export type FiiIndicator = z.infer<typeof FiiIndicator>;

export const Correlation = z.object({
  symbols: z.array(z.string()),
  matrix: z.array(z.array(z.number().nullable())),
  commonPoints: z.array(z.array(z.number())),
});
export type Correlation = z.infer<typeof Correlation>;

const frac = z.coerce.number().nullable();
export const ScreenerRow = z.object({
  symbol: z.string(),
  name: z.string().nullable(),
  sector: z.string().nullable(),
  quote: z.object({ lastPrice: numNull, changePercent: numNull, marketCap: numNull }).nullish(),
  metrics: z
    .object({
      trailingPE: numNull,
      priceToBook: numNull,
      enterpriseToEbitda: numNull,
      dividendYield: frac,
      returnOnEquity: frac,
      netMargin: frac,
    })
    .passthrough()
    .nullish(),
});
export type ScreenerRow = z.infer<typeof ScreenerRow>;
export const PerfStats = z.object({
  symbol: z.string(),
  points: z.number(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  returnPct: numNull,
  volatilityAnnPct: numNull,
  maxDrawdownPct: numNull,
  realReturnPct: numNull,
  sharpe: numNull,
  beta: numNull,
  best: z.object({ date: z.string(), pct: z.number() }).nullable(),
  worst: z.object({ date: z.string(), pct: z.number() }).nullable(),
});

async function http<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { "content-type": "application/json" }, ...init });
  if (res.status === 429)
    throw new Error(`Limite da API atingido. Tente em ${res.headers.get("Retry-After") ?? "alguns"}s.`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Erro ${res.status}`);
  return res.status === 204 ? (undefined as T) : schema.parse(await res.json());
}

export const api = {
  assets: () => http("/assets", z.array(Asset)),
  createAsset: (a: Omit<Asset, "id">) => http("/assets", Asset, { method: "POST", body: JSON.stringify(a) }),
  updateAsset: (id: string, a: Partial<Omit<Asset, "id">>) =>
    http(`/assets/${id}`, Asset, { method: "PUT", body: JSON.stringify(a) }),
  deleteAsset: (id: string) => http(`/assets/${id}`, z.undefined(), { method: "DELETE" }),
  prices: (assetId: string, from?: string, to?: string) => {
    const p = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
    return http(`/assets/${assetId}/prices${p ? `?${p}` : ""}`, z.array(PriceBar));
  },
  addPrices: (assetId: string, points: unknown) =>
    http(`/assets/${assetId}/prices`, z.object({ saved: z.number() }), {
      method: "POST",
      body: JSON.stringify(points),
    }),
  importPrices: (assetId: string, csv: string) =>
    http(`/assets/${assetId}/prices/import`, z.object({ saved: z.number(), errors: z.array(z.string()) }), {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csv,
    }),
  deletePrice: (id: string) => http(`/prices/${id}`, z.undefined(), { method: "DELETE" }),
  compare: (
    symbols: string[],
    from: string,
    to: string,
    source?: string,
    benchmark?: string,
    riskFree?: string,
    betaVs?: string,
  ) =>
    http(
      `/analytics/compare?symbols=${symbols.join(",")}&from=${from}&to=${to}${source ? `&source=${source}` : ""}${benchmark ? `&benchmark=${benchmark}` : ""}${riskFree ? `&riskFree=${riskFree}` : ""}${betaVs ? `&betaVs=${betaVs}` : ""}`,
      CompareResponse,
    ),
  correlation: (symbols: string[], from: string, to: string, source?: string) =>
    http(
      `/analytics/correlation?symbols=${symbols.join(",")}&from=${from}&to=${to}${source ? `&source=${source}` : ""}`,
      Correlation,
    ),
  screener: (params: Record<string, string>) => {
    const p = new URLSearchParams(params).toString();
    return http(`/screener${p ? `?${p}` : ""}`, z.object({ results: z.array(ScreenerRow) }));
  },
  fundamentals: (symbols: string[]) =>
    http(
      `/fundamentals?symbols=${symbols.join(",")}`,
      z.object({ results: z.array(z.object({ symbol: z.string(), data: z.unknown() })) }),
    ),
  performance: (
    from: string,
    to: string,
    assetClass?: string,
    source?: string,
    real?: boolean,
    riskFree?: string,
    betaVs?: string,
  ) =>
    http(
      `/reports/performance?from=${from}&to=${to}${assetClass ? `&assetClass=${assetClass}` : ""}${source ? `&source=${source}` : ""}${real ? "&real=1" : ""}${riskFree ? `&riskFree=${riskFree}` : ""}${betaVs ? `&betaVs=${betaVs}` : ""}`,
      z.object({ from: z.string(), to: z.string(), stats: z.array(PerfStats) }),
    ),
  portfolios: () => http("/portfolios", z.array(Portfolio)),
  createPortfolio: (name: string) =>
    http("/portfolios", Portfolio, { method: "POST", body: JSON.stringify({ name }) }),
  deletePortfolio: (id: string) => http(`/portfolios/${id}`, z.undefined(), { method: "DELETE" }),
  position: (portfolioId: string) => http(`/portfolios/${portfolioId}/position`, PortfolioPosition),
  transactions: () => http("/transactions", z.array(Transaction)),
  createTransaction: (t: unknown) =>
    http("/transactions", Transaction, { method: "POST", body: JSON.stringify(t) }),
  deleteTransaction: (id: string) => http(`/transactions/${id}`, z.undefined(), { method: "DELETE" }),
  dividends: () => http("/dividends", z.array(Dividend)),
  createDividend: (d: unknown) => http("/dividends", Dividend, { method: "POST", body: JSON.stringify(d) }),
  deleteDividend: (id: string) => http(`/dividends/${id}`, z.undefined(), { method: "DELETE" }),
  syncQuotes: () =>
    http("/sync/quotes", z.object({ updated: z.number(), missing: z.array(z.string()) }), {
      method: "POST",
      body: "{}",
    }),
  syncHistory: (symbols: string[], range = "1y") =>
    http("/sync/history", z.object({ rows: z.number() }), {
      method: "POST",
      body: JSON.stringify({ symbols, range }),
    }),
  syncMacro: (slugs: string[]) =>
    http("/sync/macro", z.object({ rows: z.number(), skipped: z.number() }), {
      method: "POST",
      body: JSON.stringify({ slugs }),
    }),
  syncDividends: (symbols: string[]) =>
    http("/sync/dividends", z.object({ rows: z.number(), skipped: z.number() }), {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),
  syncFunds: (symbols: string[]) =>
    http(
      "/sync/funds",
      z.object({
        nav: z.object({ rows: z.number(), skipped: z.number() }),
        indicators: z.object({ rows: z.number(), skipped: z.number() }),
      }),
      { method: "POST", body: JSON.stringify({ symbols }) },
    ),
  syncTreasury: (symbols: string[]) =>
    http("/sync/treasury", z.object({ rows: z.number(), skipped: z.number() }), {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),
  indicators: (assetId: string) => http(`/assets/${assetId}/indicators`, z.array(FiiIndicator)),
  fundIndicators: (assetId: string) =>
    http(
      `/assets/${assetId}/fund-indicators`,
      z.object({
        price: numNull,
        navPerShare: numNull,
        priceToNav: numNull,
        equity: numNull,
        totalInvestors: bigNull,
        monthlyReturn: numNull,
        dyMonthly: numNull,
      }),
    ),
  syncIndicators: (symbols: string[]) =>
    http("/sync/indicators", z.object({ rows: z.number(), skipped: z.number() }), {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),
};
