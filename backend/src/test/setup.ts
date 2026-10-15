// Roda antes dos imports dos testes: banco de teste + brapi simulada.
// O cliente brapi do sync captura o fetch global no import; os testes
// unitários de client.test.ts passam fetchImpl próprio e não são afetados.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://finance:finance@localhost:5433/finance_test";

const KNOWN = ["PETR4", "VALE3"];
const DAYS = [5, 6, 7, 8, 9].map((d) => Date.UTC(2026, 0, d) / 1000);
const CLOSES: Record<string, number[]> = {
  PETR4: [50, 52, 51, 53, 55], // retorno no período: +10%
  VALE3: [60, 59, 61, 60, 62], // retorno no período: +3.33%
};

const quoteResult = (sym: string, price: number) => ({
  requestedSymbol: sym,
  symbol: sym,
  changed: false,
  data: {
    shortName: sym,
    longName: null,
    currency: "BRL",
    regularMarketPrice: price,
    regularMarketDayHigh: price,
    regularMarketDayLow: price,
    regularMarketChange: 0,
    regularMarketChangePercent: 0,
    regularMarketTime: "2026-01-09T21:00:00.000Z",
    marketCap: null,
    regularMarketVolume: 1000,
    regularMarketPreviousClose: price,
    regularMarketOpen: price,
    fiftyTwoWeekLow: price,
    fiftyTwoWeekHigh: price,
    logourl: null,
  },
});

const histResult = (sym: string, interval: string, range: string) => ({
  requestedSymbol: sym,
  symbol: sym,
  changed: false,
  data: {
    usedInterval: interval,
    usedRange: range,
    historicalDataPrice: DAYS.map((date, i) => {
      const close = CLOSES[sym]![i]!;
      return { date, open: close, high: close, low: close, close, volume: 1000, adjustedClose: close };
    }),
  },
});

const asJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: unknown) => {
  const url = new URL(String(input));
  const syms = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const known = syms.filter((s) => KNOWN.includes(s));
  if (url.pathname.endsWith("/stocks/quote")) {
    if (!known.length) return asJson({ error: true, message: "Tickers não encontrados" }, 404);
    return asJson({
      results: known.map((s) => quoteResult(s, CLOSES[s]![0]!)),
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/stocks/historical")) {
    if (!known.length) return asJson({ error: true, message: "Tickers não encontrados" }, 404);
    const interval = url.searchParams.get("interval") ?? "1d";
    const range = url.searchParams.get("range") ?? "1y";
    return asJson({
      results: known.map((s) => histResult(s, interval, range)),
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/stocks/dividends")) {
    if (!known.length) return asJson({ error: true, message: "Tickers não encontrados" }, 404);
    const dv = (paymentDate: string | null, rate: number, label: string, exDate: string | null) => ({
      paymentDate,
      rate,
      label,
      exDate,
      lastDatePrior: null,
      relatedTo: null,
      approvedOn: null,
    });
    const cash: Record<string, unknown[]> = {
      PETR4: [
        dv("2026-02-10", 0.5, "DIVIDENDO", "2026-01-20"),
        dv("2026-03-10", 0.3, "JCP", null),
        dv(null, 0.1, "DIVIDENDO", null), // sem paymentDate: ignorado no sync
        dv("2026-04-10", 0.2, "RENDIMENTO", null), // label fora do par: vira OTHER
      ],
      VALE3: [],
    };
    return asJson({
      results: known.map((s) => ({
        requestedSymbol: s,
        symbol: s,
        changed: false,
        data: { cashDividends: cash[s] ?? [], stockDividends: [], subscriptions: [] },
      })),
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/fii/dividends")) {
    if (!known.length && !syms.includes("MXRF11")) {
      return asJson({ error: true, message: "Tickers não encontrados" }, 404);
    }
    const list = syms.includes("MXRF11")
      ? [
          {
            symbol: "MXRF11",
            paymentDate: "2026-02-15",
            rate: 0.1,
            label: "RENDIMENTO",
            exDate: "2026-01-31",
            lastDatePrior: null,
            approvedOn: null,
          },
          {
            symbol: "MXRF11",
            paymentDate: "2026-03-15",
            rate: 0.05,
            label: "AMORTIZAÇÃO",
            exDate: null,
            lastDatePrior: null,
            approvedOn: null,
          },
        ]
      : [];
    return asJson({ dividends: list, requestedAt: "2026-01-09T21:00:00.000Z", took: 1 });
  }
  if (url.pathname.endsWith("/funds/dividends")) {
    const syms = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!syms.includes("JURO11")) return asJson({ error: true, message: "Sem dados" }, 404);
    return asJson({
      dividends: [
        {
          symbol: "JURO11",
          cnpj: "42730834000100",
          assetType: "fiinfra",
          declaredDate: "2026-05-29T00:00:00.000Z",
          lastDatePrior: "2026-05-29T00:00:00.000Z",
          exDate: null,
          paymentDate: "2026-06-13T00:00:00.000Z",
          rate: 0.5,
          label: "RENDIMENTO",
          isinCode: "BRJUROCTF002",
        },
      ],
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/api/v2/macro")) {
    const slugs = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const series: Record<
      string,
      { unit: string; frequency: string; name: string; observations: { date: string; value: number }[] }
    > = {
      cdi: {
        unit: "percentPerDay",
        frequency: "daily",
        name: "CDI",
        observations: [0.05, 0.06, 0.04, 0.05, 0.06].map((value, i) => ({
          date: `2026-01-0${5 + i}`,
          value,
        })),
      },
      selic: {
        unit: "percentPerYear",
        frequency: "daily",
        name: "Taxa Selic",
        observations: [5, 6, 7, 8, 9].map((d) => ({ date: `2026-01-0${d}`, value: 14.75 })),
      },
      ipca: {
        unit: "percent",
        frequency: "monthly",
        name: "IPCA",
        observations: [
          { date: "2026-01-01", value: 0.5 },
          { date: "2026-02-01", value: 0.4 },
        ],
      },
    };
    const results = slugs
      .filter((s) => series[s])
      .map((s) => ({
        series: {
          slug: s,
          name: series[s]!.name,
          description: "",
          unit: series[s]!.unit,
          frequency: series[s]!.frequency,
          category: "",
          startDate: "2000-01-01",
        },
        observations: series[s]!.observations,
      }));
    if (!results.length) return asJson({ error: true, message: "Séries não encontradas" }, 404);
    return asJson({ results, requestedAt: "2026-01-09T21:00:00.000Z", took: 1 });
  }
  if (url.pathname.endsWith("/fii/indicators/history")) {
    const slugs = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!slugs.includes("MXRF11")) return asJson({ error: true, message: "Sem dados" }, 404);
    const entry = (
      referenceDate: string,
      price: number,
      priceToNav: number,
      dy12m: number,
      investors: number,
    ) => ({
      symbol: "MXRF11",
      referenceDate,
      price,
      navPerShare: 9.41,
      priceToNav,
      dividendYield12m: dy12m,
      dividendYield1m: 0.009,
      monthlyReturn: 0.008,
      totalInvestors: investors,
      sharesOutstanding: 460269540,
      equity: 4331102700,
      totalAssets: 4375755000,
      segmentType: "papel",
    });
    return asJson({
      history: [
        entry("2025-12-01 00:00:00+00", 9.411791, 1.0001981, 0.12381, 1357621),
        entry("2025-11-01 00:00:00+00", 9.463164, 1.0041974, 0.125273, 1339326),
      ],
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/fii/indicators")) {
    const syms = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!syms.includes("MXRF11")) return asJson({ error: true, message: "Sem dados" }, 404);
    return asJson({
      fiis: [
        {
          symbol: "MXRF11",
          asOfDate: "2026-01-09T00:00:00.000Z",
          price: 9.5,
          navPerShare: 9.42,
          priceToNav: 1.0085,
          dividendYield12m: 0.12,
          dividendYield1m: 0.0095,
          monthlyReturn: 0.009,
          totalInvestors: 1360000,
          sharesOutstanding: 460269540,
          equity: 4335000000,
          totalAssets: 4380000000,
          segmentType: "papel",
          name: "FII MXRF11",
          cnpj: "1",
        },
      ],
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/funds/nav/history")) {
    const syms = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!syms.includes("JURO11")) return asJson({ error: true, message: "Sem dados" }, 404);
    const pt = (date: string, navPerShare: number | null) => ({
      symbol: "JURO11",
      cnpj: "42730834000100",
      date,
      classOrSeries: null,
      totalAssets: 2041704100,
      navPerShare,
      equity: 2040699000,
      dailyApplications: 0,
      dailyRedemptions: 0,
      totalInvestors: 92710,
      monthlyReturn: null,
    });
    return asJson({
      history: [
        pt("2026-06-18T00:00:00.000Z", 99.19945),
        pt("2026-06-17T00:00:00.000Z", 99.36075),
        pt("2026-06-16T00:00:00.000Z", null),
      ],
      pagination: { page: 1, limit: 20, totalItems: 3, totalPages: 1, hasNextPage: false },
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/funds/indicators")) {
    const syms = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!syms.includes("JURO11")) return asJson({ error: true, message: "Sem dados" }, 404);
    return asJson({
      funds: [
        {
          symbol: "JURO11",
          cnpj: "42730834000100",
          name: "SPARTA INFRA",
          assetType: "fiinfra",
          asOfDate: "2026-06-18T00:00:00.000Z",
          price: 96.99,
          navPerShare: 99.19945,
          priceToNav: 0.9777272,
          equity: 2040699000,
          totalAssets: 2041704100,
          totalInvestors: 92710,
          dailyApplications: 0,
          dailyRedemptions: 0,
          sharesOutstanding: null,
          monthlyReturn: null,
          patrimonialMonthlyReturn: null,
          dividendYieldMonthly: 0.008,
        },
      ],
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/treasury/indicators/history")) {
    const syms = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!syms.includes("tesouro-selic-01032031")) return asJson({ error: true, message: "Sem dados" }, 404);
    return asJson({
      results: [
        {
          symbol: "tesouro-selic-01032031",
          bondType: "Tesouro Selic",
          indexer: "selic",
          couponType: "zero",
          maturityDate: "2031-03-01",
          history: [
            {
              baseDate: "2026-05-15",
              buyRate: 0.08,
              sellRate: 0.09,
              buyPrice: 18944.78,
              sellPrice: 18925.53,
              basePrice: 18925.53,
            },
            {
              baseDate: "2026-05-14",
              buyRate: 0.08,
              sellRate: 0.09,
              buyPrice: 18930.1,
              sellPrice: 18910.0,
              basePrice: 18910.0,
            },
          ],
        },
      ],
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/treasury/list")) {
    return asJson({
      results: [
        {
          symbol: "tesouro-selic-01032031",
          bondType: "Tesouro Selic",
          indexer: "selic",
          couponType: "zero",
          maturityDate: "2031-03-01",
          baseDate: "2026-05-15",
          buyPrice: 18944.78,
          sellPrice: 18925.53,
        },
      ],
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/stocks/screener")) {
    const item = (
      symbol: string,
      trailingPE: number | null,
      priceToBook: number,
      dividendYield: number | null,
      returnOnEquity: number | null,
    ) => ({
      symbol,
      name: `${symbol} S.A.`,
      longName: null,
      assetType: "stock",
      subType: null,
      exchange: "B3",
      currency: "BRL",
      sector: "Petróleo",
      subsector: null,
      isActive: true,
      logoUrl: null,
      quote: { lastPrice: 50, changePercent: 1, volume: 1000, marketCap: 1000000 },
      metrics: {
        trailingPE,
        priceToBook,
        enterpriseToEbitda: null,
        enterpriseToRevenue: null,
        pegRatio: null,
        earningsPerShare: null,
        bookValuePerShare: null,
        netMargin: 0.2,
        enterpriseValue: null,
        fiftyTwoWeekChange: null,
        dividendYield,
        returnOnEquity,
        returnOnAssets: null,
        grossMargin: null,
        ebitdaMargin: null,
        operatingMargin: null,
        debtToEquity: null,
        netDebtToEbitda: null,
        currentRatio: null,
        quickRatio: null,
        revenueGrowth: null,
        earningsGrowth: null,
        totalRevenue: null,
        ebitda: null,
        freeCashflow: null,
        totalDebt: null,
        totalCash: null,
      },
    });
    return asJson({
      results: [item("PETR4", 5.2, 1.1, 0.08, 0.18), item("VALE3", null, 0.9, null, null)],
      pagination: { page: 1, limit: 20, totalItems: 2, totalPages: 1, hasNextPage: false },
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  if (url.pathname.endsWith("/stocks/statistics")) {
    const syms = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!syms.length) return asJson({ error: true, message: "Sem dados" }, 404);
    return asJson({
      results: syms.map((s) => ({
        requestedSymbol: s,
        symbol: s,
        changed: false,
        data: { trailingPE: 5.2 },
      })),
      requestedAt: "2026-01-09T21:00:00.000Z",
      took: 1,
    });
  }
  return asJson({ error: true, message: "mock: rota desconhecida" }, 404);
}) as typeof fetch;
