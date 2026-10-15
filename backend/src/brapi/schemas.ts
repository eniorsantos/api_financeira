import { z } from "zod";

// Qualquer número pode vir null na prática: tolerar null/ausente e normalizar.
const num = z
  .number()
  .nullish()
  .transform((v) => v ?? null);
const str = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

export const StockQuoteSnapshot = z.object({
  shortName: str,
  longName: str,
  currency: str,
  regularMarketPrice: num,
  regularMarketDayHigh: num,
  regularMarketDayLow: num,
  regularMarketChange: num,
  regularMarketChangePercent: num,
  regularMarketTime: str,
  marketCap: num,
  regularMarketVolume: num,
  regularMarketPreviousClose: num,
  regularMarketOpen: num,
  fiftyTwoWeekLow: num,
  fiftyTwoWeekHigh: num,
  logourl: str,
});
export type StockQuoteSnapshot = z.infer<typeof StockQuoteSnapshot>;

export const StockQuoteResponse = z.object({
  results: z.array(
    z.object({
      requestedSymbol: z.string(),
      symbol: z.string(),
      changed: z.boolean(),
      data: StockQuoteSnapshot,
    }),
  ),
  requestedAt: z.string(),
  took: z.number(),
});
export type StockQuoteResponse = z.infer<typeof StockQuoteResponse>;

export const StockHistoricalPrice = z.object({
  date: z.number().int(), // Unix, segundos
  open: num,
  high: num,
  low: num,
  close: num,
  volume: num,
  adjustedClose: num,
});
export type StockHistoricalPrice = z.infer<typeof StockHistoricalPrice>;

export const StockHistoricalResponse = z.object({
  results: z.array(
    z.object({
      requestedSymbol: z.string(),
      symbol: z.string(),
      changed: z.boolean(),
      data: z.object({
        usedInterval: z.string(),
        usedRange: z.string(),
        historicalDataPrice: z.array(StockHistoricalPrice),
      }),
    }),
  ),
  requestedAt: z.string(),
  took: z.number(),
});
export type StockHistoricalResponse = z.infer<typeof StockHistoricalResponse>;

export const BrapiErrorBody = z.object({
  error: z.boolean().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
});

// GET /api/v2/stocks/dividends — proventos em dinheiro (DIVIDENDO/JCP).
// stockDividends (desdobramentos etc.) e subscriptions não viram Dividend.
export const StockCashDividend = z.object({
  paymentDate: str, // pode ser null (só prazo divulgado) — o sync ignora
  rate: num,
  label: str, // "DIVIDENDO" | "JCP" | ...
  exDate: str,
  lastDatePrior: str,
  relatedTo: str,
  approvedOn: str,
});

export const StockDividendsResponse = z.object({
  results: z.array(
    z.object({
      requestedSymbol: z.string(),
      symbol: z.string(),
      changed: z.boolean(),
      data: z.object({
        cashDividends: z.array(StockCashDividend),
        stockDividends: z.array(z.unknown()).optional().default([]),
        subscriptions: z.array(z.unknown()).optional().default([]),
      }),
    }),
  ),
  requestedAt: z.string(),
  took: z.number(),
});
export type StockDividendsResponse = z.infer<typeof StockDividendsResponse>;

export interface DividendsParams {
  startDate?: string;
  endDate?: string;
}

// GET /api/v2/macro — séries macroeconômicas (selic, cdi, ipca...). Frequências variam por série.
export const MacroObservation = z.object({ date: z.string(), value: num });
export const MacroSeries = z.object({
  slug: z.string(),
  name: str,
  description: str,
  unit: str,
  frequency: str,
  category: str,
  startDate: str,
});
export const MacroResponse = z.object({
  results: z.array(z.object({ series: MacroSeries, observations: z.array(MacroObservation) })),
  requestedAt: z.string(),
  took: z.number(),
});
export type MacroResponse = z.infer<typeof MacroResponse>;

export interface MacroParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

// GET /api/v2/stocks/screener — filtro por múltiplos (P/L, P/VP, DY, ROE...).
// Chaves do plano Pro podem vir ausentes: tudo é nullish.
export const ScreenerMetrics = z.object({
  trailingPE: num,
  priceToBook: num,
  enterpriseToEbitda: num,
  enterpriseToRevenue: num,
  pegRatio: num,
  earningsPerShare: num,
  bookValuePerShare: num,
  netMargin: num,
  enterpriseValue: num,
  fiftyTwoWeekChange: num,
  dividendYield: num,
  returnOnEquity: num,
  returnOnAssets: num,
  grossMargin: num,
  ebitdaMargin: num,
  operatingMargin: num,
  debtToEquity: num,
  netDebtToEbitda: num,
  currentRatio: num,
  quickRatio: num,
  revenueGrowth: num,
  earningsGrowth: num,
  totalRevenue: num,
  ebitda: num,
  freeCashflow: num,
  totalDebt: num,
  totalCash: num,
});

export const ScreenerItem = z.object({
  symbol: z.string(),
  name: str,
  longName: str,
  assetType: str,
  subType: str,
  exchange: str,
  currency: str,
  sector: str,
  subsector: str,
  isActive: z.boolean(),
  logoUrl: str,
  quote: z.object({ lastPrice: num, changePercent: num, volume: num, marketCap: num }).nullish(),
  metrics: ScreenerMetrics.nullish(),
});

export const ScreenerResponse = z.object({
  results: z.array(ScreenerItem),
  pagination: z
    .object({
      page: z.number(),
      limit: z.number(),
      totalItems: z.number(),
      totalPages: z.number(),
      hasNextPage: z.boolean(),
    })
    .nullish()
    .transform((v) => v ?? null),
  requestedAt: z.string(),
  took: z.number(),
});
export type ScreenerResponse = z.infer<typeof ScreenerResponse>;

// GET /api/v2/stocks/statistics — envelope validado; `data` é opaco (objeto/array/null
// conforme mode/period) e vai ao front sem interpretação.
export const StatisticsResponse = z.object({
  results: z.array(
    z.object({
      requestedSymbol: z.string(),
      symbol: z.string(),
      changed: z.boolean(),
      data: z.unknown(),
    }),
  ),
  requestedAt: z.string(),
  took: z.number(),
});
export type StatisticsResponse = z.infer<typeof StatisticsResponse>;

// GET /api/v2/funds/nav/history — valor patrimonial por cota (FIAGRO, FI-Infra, FIF...).
// Plano Pro. `symbol` pode vir null (fundo sem ticker) — o sync ignora esses pontos.
export const FundNavPoint = z.object({
  symbol: str,
  cnpj: str,
  date: str,
  classOrSeries: str,
  totalAssets: num,
  navPerShare: num,
  equity: num,
  dailyApplications: num,
  dailyRedemptions: num,
  totalInvestors: num,
  monthlyReturn: num,
});

export const FundNavHistoryResponse = z.object({
  history: z.array(FundNavPoint),
  pagination: z
    .object({
      page: z.number(),
      limit: z.number(),
      totalItems: z.number(),
      totalPages: z.number(),
      hasNextPage: z.boolean(),
    })
    .nullish()
    .transform((v) => v ?? null),
  requestedAt: z.string(),
  took: z.number(),
});
export type FundNavHistoryResponse = z.infer<typeof FundNavHistoryResponse>;

export interface FundNavParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
  page?: number;
}

// GET /api/v2/funds/dividends — rendimentos de FIAGRO, FI-Infra, FIF... (flat; FII retorna 400).
export const FundDividend = z.object({
  symbol: z.string(),
  cnpj: str,
  assetType: str,
  declaredDate: str,
  lastDatePrior: str,
  exDate: str,
  paymentDate: str,
  rate: num,
  label: str,
  isinCode: str,
});

export const FundDividendsResponse = z.object({
  dividends: z.array(FundDividend),
  pagination: z
    .object({
      page: z.number(),
      limit: z.number(),
      totalItems: z.number(),
      totalPages: z.number(),
      hasNextPage: z.boolean(),
    })
    .nullish()
    .transform((v) => v ?? null),
  requestedAt: z.string(),
  took: z.number(),
});
export type FundDividendsResponse = z.infer<typeof FundDividendsResponse>;

// GET /api/v2/funds/indicators — snapshot: preço, cota patrimonial, ágio/deságio.
export const FundIndicator = z.object({
  symbol: str,
  cnpj: str,
  name: str,
  assetType: str,
  asOfDate: str,
  price: num,
  navPerShare: num,
  priceToNav: num,
  equity: num,
  totalAssets: num,
  totalInvestors: num,
  dailyApplications: num,
  dailyRedemptions: num,
  sharesOutstanding: num,
  monthlyReturn: num,
  patrimonialMonthlyReturn: num,
  dividendYieldMonthly: num,
});

export const FundIndicatorsResponse = z.object({
  funds: z.array(FundIndicator),
  requestedAt: z.string(),
  took: z.number(),
});
export type FundIndicatorsResponse = z.infer<typeof FundIndicatorsResponse>;

// GET /api/v2/treasury/list — catálogo (símbolo slug, taxa e preço atuais).
export const TreasuryListItem = z.object({ symbol: z.string() }).passthrough();
export const TreasuryListResponse = z.object({
  results: z.array(TreasuryListItem),
  requestedAt: z.string(),
  took: z.number(),
});
export type TreasuryListResponse = z.infer<typeof TreasuryListResponse>;

// GET /api/v2/treasury/indicators/history — série diária de taxa e PU por título.
// `symbol` é slug minúsculo (ex.: tesouro-selic-01032031). Plano Pro (3 títulos livres).
export const TreasuryHistoryPoint = z.object({
  baseDate: str,
  buyRate: num,
  sellRate: num,
  buyPrice: num,
  sellPrice: num,
  basePrice: num,
});

export const TreasuryHistoryResponse = z.object({
  results: z.array(
    z.object({
      symbol: z.string(),
      bondType: str,
      indexer: str,
      couponType: str,
      maturityDate: str,
      history: z.array(TreasuryHistoryPoint),
    }),
  ),
  requestedAt: z.string(),
  took: z.number(),
});
export type TreasuryHistoryResponse = z.infer<typeof TreasuryHistoryResponse>;

// GET /api/v2/fii/indicators — snapshot atual (campos extras de info são ignorados).
export const FiiSnapshot = z.object({
  symbol: z.string(),
  asOfDate: str,
  price: num,
  navPerShare: num,
  priceToNav: num,
  dividendYield12m: num,
  dividendYield1m: num,
  monthlyReturn: num,
  totalInvestors: num,
  sharesOutstanding: num,
  equity: num,
  totalAssets: num,
  segmentType: str,
});

export const FiiSnapshotsResponse = z.object({
  fiis: z.array(FiiSnapshot),
  requestedAt: z.string(),
  took: z.number(),
});
export type FiiSnapshotsResponse = z.infer<typeof FiiSnapshotsResponse>;

// GET /api/v2/fii/indicators/history — série mensal (P/VP, DY, patrimônio, cotistas).
// Um ponto por mês; `referenceDate` no último dia do mês.
export const FiiIndicatorEntry = z.object({
  symbol: z.string(),
  referenceDate: str,
  price: num,
  navPerShare: num,
  priceToNav: num,
  dividendYield12m: num,
  dividendYield1m: num,
  monthlyReturn: num,
  totalInvestors: num,
  sharesOutstanding: num,
  equity: num,
  totalAssets: num,
  segmentType: str,
});

export const FiiIndicatorsHistoryResponse = z.object({
  history: z.array(FiiIndicatorEntry),
  requestedAt: z.string(),
  took: z.number(),
});
export type FiiIndicatorsHistoryResponse = z.infer<typeof FiiIndicatorsHistoryResponse>;

// GET /api/v2/fii/dividends — resposta FLAT (sem requestedSymbol; casa por `symbol`).
// label: "RENDIMENTO" | "AMORTIZAÇÃO" (amortização devolve capital, não entra no yield).
export const FiiDividend = z.object({
  symbol: z.string(),
  paymentDate: str,
  rate: num,
  label: str,
  exDate: str,
  lastDatePrior: str,
  approvedOn: str,
});

export const FiiDividendsResponse = z.object({
  dividends: z.array(FiiDividend),
  requestedAt: z.string(),
  took: z.number(),
});
export type FiiDividendsResponse = z.infer<typeof FiiDividendsResponse>;

export type HistoricalParams =
  | { range: string; interval?: string; sortOrder?: "asc" | "desc" }
  | { startDate: string; endDate: string; interval?: string; sortOrder?: "asc" | "desc" };
