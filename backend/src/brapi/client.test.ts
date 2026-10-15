import { describe, expect, it, vi } from "vitest";
import { BrapiClient, parseRetryAfter } from "./client.js";
import { BrapiAuthError, BrapiError, BrapiNotFoundError, BrapiRateLimitError } from "./errors.js";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const quoteBody = {
  results: [
    {
      requestedSymbol: "PETR4",
      symbol: "PETR4",
      changed: false,
      data: {
        shortName: "PETROBRAS PN",
        longName: null,
        currency: "BRL",
        regularMarketPrice: 38.5,
        regularMarketDayHigh: 39,
        regularMarketDayLow: 38,
        regularMarketChange: 0.5,
        regularMarketChangePercent: 1.3,
        regularMarketTime: "2026-10-14T20:00:00Z",
        marketCap: null,
        regularMarketVolume: 1000,
        regularMarketPreviousClose: 38,
        regularMarketOpen: 38.1,
        fiftyTwoWeekLow: 30,
        fiftyTwoWeekHigh: 40,
        logourl: "",
      },
    },
  ],
  requestedAt: "2026-10-14T20:00:00Z",
  took: 5,
};

describe("BrapiClient", () => {
  it("envia símbolos em uma chamada e o token no header Authorization", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, quoteBody));
    const c = new BrapiClient({ token: "SECRET", fetchImpl });
    const r = await c.quote(["PETR4", "VALE3"]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://brapi.dev/api/v2/stocks/quote?symbols=PETR4%2CVALE3");
    expect(String(url)).not.toContain("SECRET");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer SECRET" });
    expect(r.results[0]!.data.marketCap).toBeNull(); // null tratado
    expect(r.results[0]!.data.longName).toBeNull();
  });

  it("401 -> BrapiAuthError", async () => {
    const c = new BrapiClient({
      token: "x",
      fetchImpl: vi.fn().mockResolvedValue(json(401, { error: true, message: "Token inválido" })),
    });
    await expect(c.quote(["PETR4"])).rejects.toBeInstanceOf(BrapiAuthError);
  });

  it("404 -> BrapiNotFoundError", async () => {
    const c = new BrapiClient({
      fetchImpl: vi.fn().mockResolvedValue(json(404, { error: true, message: "nada" })),
    });
    await expect(c.quote(["XXXX9"])).rejects.toBeInstanceOf(BrapiNotFoundError);
  });

  it("429 respeita Retry-After e tenta de novo", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(429, { error: true, message: "limite" }, { "Retry-After": "3" }))
      .mockResolvedValueOnce(json(200, quoteBody));
    const c = new BrapiClient({ fetchImpl, sleep });
    await c.quote(["PETR4"]);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("429 persistente -> BrapiRateLimitError com retryAfter", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => json(429, { error: true, message: "limite" }, { "Retry-After": "2" }));
    const c = new BrapiClient({ fetchImpl, sleep: async () => {}, maxRetries: 1 });
    const err = await c.quote(["PETR4"]).catch((e) => e);
    expect(err).toBeInstanceOf(BrapiRateLimitError);
    expect(err.retryAfterSeconds).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("histórico aceita campos null", async () => {
    const body = {
      results: [
        {
          requestedSymbol: "VALE3",
          symbol: "VALE3",
          changed: false,
          data: {
            usedInterval: "1d",
            usedRange: "1mo",
            historicalDataPrice: [
              {
                date: 1760400000,
                open: null,
                high: 60,
                low: 58,
                close: 59,
                volume: null,
                adjustedClose: null,
              },
            ],
          },
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, body)) });
    const r = await c.historical(["VALE3"], { range: "1mo", interval: "1d" });
    expect(r.results[0]!.data.historicalDataPrice[0]!.adjustedClose).toBeNull();
  });

  it("resposta 200 fora do schema -> BrapiError (não ZodError)", async () => {
    const c = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, { results: "nope" })) });
    const err = await c.quote(["PETR4"]).catch((e) => e);
    expect(err).toBeInstanceOf(BrapiError);
    expect(err).not.toBeInstanceOf(BrapiAuthError);
    expect(err.code).toBe("brapi_invalid_response");
  });

  it("dividends mapeia cashDividends e tolera campos null", async () => {
    const body = {
      results: [
        {
          requestedSymbol: "PETR4",
          symbol: "PETR4",
          changed: false,
          data: {
            cashDividends: [
              {
                paymentDate: "2026-02-10",
                rate: 0.5,
                label: "DIVIDENDO",
                exDate: "2026-01-20",
                lastDatePrior: null,
                relatedTo: null,
                approvedOn: null,
              },
              {
                paymentDate: null,
                rate: null,
                label: null,
                exDate: null,
                lastDatePrior: null,
                relatedTo: null,
                approvedOn: null,
              },
            ],
            stockDividends: [],
            subscriptions: [],
          },
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, body)) });
    const r = await c.dividends(["PETR4"], { startDate: "2026-01-01" });
    expect(r.results[0]!.data.cashDividends[0]!.label).toBe("DIVIDENDO");
    expect(r.results[0]!.data.cashDividends[1]!.paymentDate).toBeNull();
  });

  it("fiiDividends lê resposta flat e casa por symbol", async () => {
    const body = {
      dividends: [
        {
          symbol: "MXRF11",
          paymentDate: "2026-02-15",
          rate: 0.1,
          label: "RENDIMENTO",
          exDate: "2026-01-31",
          lastDatePrior: null,
          approvedOn: null,
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, body)) });
    const r = await c.fiiDividends(["MXRF11"]);
    expect(r.dividends[0]!.label).toBe("RENDIMENTO");
    expect(r.dividends[0]!.rate).toBe(0.1);
  });

  it("macro lê séries e observações", async () => {
    const body = {
      results: [
        {
          series: {
            slug: "cdi",
            name: "CDI",
            description: "",
            unit: "percentPerDay",
            frequency: "daily",
            category: "",
            startDate: "",
          },
          observations: [{ date: "2026-01-05", value: 0.05 }],
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, body)) });
    const r = await c.macro(["cdi"], { limit: 10 });
    expect(r.results[0]!.series.slug).toBe("cdi");
    expect(r.results[0]!.observations[0]!.value).toBe(0.05);
  });

  it("fundsDividends lê resposta flat", async () => {
    const body = {
      dividends: [
        {
          symbol: "JURO11",
          cnpj: "1",
          assetType: "fiinfra",
          declaredDate: "2026-05-29T00:00:00.000Z",
          lastDatePrior: "2026-05-29T00:00:00.000Z",
          exDate: null,
          paymentDate: "2026-06-13T00:00:00.000Z",
          rate: 0.5,
          label: "RENDIMENTO",
          isinCode: null,
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, body)) });
    const r = await c.fundsDividends(["JURO11"]);
    expect(r.dividends[0]!.label).toBe("RENDIMENTO");
    expect(r.dividends[0]!.rate).toBe(0.5);
  });

  it("funds e treasury: nav, snapshot e PU", async () => {
    const nav = {
      history: [
        {
          symbol: "JURO11",
          cnpj: "1",
          date: "2026-06-18T00:00:00.000Z",
          classOrSeries: null,
          totalAssets: null,
          navPerShare: 99.2,
          equity: null,
          dailyApplications: null,
          dailyRedemptions: null,
          totalInvestors: null,
          monthlyReturn: null,
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, nav)) });
    const h = await c.fundsNavHistory(["JURO11"]);
    expect(h.history[0]!.navPerShare).toBe(99.2);
    expect(h.pagination).toBeNull(); // pagination opcional

    const snap = {
      funds: [
        {
          symbol: "JURO11",
          cnpj: "1",
          name: null,
          assetType: "fiinfra",
          asOfDate: null,
          price: 96.99,
          navPerShare: 99.2,
          priceToNav: 0.977,
          equity: null,
          totalAssets: null,
          totalInvestors: null,
          dailyApplications: null,
          dailyRedemptions: null,
          sharesOutstanding: null,
          monthlyReturn: null,
          patrimonialMonthlyReturn: null,
          dividendYieldMonthly: null,
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c2 = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, snap)) });
    expect((await c2.fundsIndicators(["JURO11"])).funds[0]!.priceToNav).toBe(0.977);

    const tes = {
      results: [
        {
          symbol: "tesouro-selic-01032031",
          history: [
            {
              baseDate: "2026-05-15",
              buyRate: 0.08,
              sellRate: 0.09,
              buyPrice: 1,
              sellPrice: 18925.53,
              basePrice: 18925.53,
            },
          ],
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c3 = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, tes)) });
    const t = await c3.treasuryHistory(["tesouro-selic-01032031"]);
    expect(t.results[0]!.history[0]!.sellPrice).toBe(18925.53);
  });

  it("fiiIndicators lê snapshot e ignora campos extras", async () => {
    const body = {
      fiis: [
        {
          symbol: "MXRF11",
          asOfDate: "2026-01-09T00:00:00.000Z",
          price: 9.5,
          navPerShare: 9.42,
          priceToNav: 1.0085,
          dividendYield12m: 0.12,
          dividendYield1m: null,
          monthlyReturn: null,
          totalInvestors: 1360000,
          sharesOutstanding: null,
          equity: null,
          totalAssets: null,
          segmentType: "papel",
          name: "x",
          cnpj: "1",
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, body)) });
    const r = await c.fiiIndicators(["MXRF11"]);
    expect(r.fiis[0]!.priceToNav).toBe(1.0085);
    expect(r.fiis[0]!.dividendYield1m).toBeNull();
  });

  it("screener tolera chaves Pro ausentes", async () => {
    const body = {
      results: [
        {
          symbol: "PETR4",
          name: "x",
          longName: null,
          assetType: "stock",
          subType: null,
          exchange: "B3",
          currency: "BRL",
          sector: null,
          subsector: null,
          isActive: true,
          logoUrl: null,
          quote: { lastPrice: 50, changePercent: 1, volume: 1, marketCap: 1 },
          metrics: { trailingPE: 5.2, priceToBook: 1.1, dividendYield: 0.08 },
        },
      ],
      requestedAt: "x",
      took: 1,
    };
    const c = new BrapiClient({ fetchImpl: vi.fn().mockResolvedValue(json(200, body)) });
    const r = await c.screener({ trailingPEMax: 8, sortBy: "dividendYield" });
    expect(r.results[0]!.metrics!.trailingPE).toBe(5.2);
    expect(r.results[0]!.metrics!.returnOnEquity).toBeNull(); // chave Pro ausente
  });

  it("cache evita segunda chamada; erros não são cacheados", async () => {
    const payload = { results: [], requestedAt: "x", took: 1 };
    const fetchImpl = vi.fn().mockImplementation(async () => json(200, payload));
    const c = new BrapiClient({ fetchImpl });
    await c.screener({ trailingPEMax: 8 });
    await c.screener({ trailingPEMax: 8 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const noCache = vi.fn().mockImplementation(async () => json(200, payload));
    const c2 = new BrapiClient({ fetchImpl: noCache, cache: false });
    await c2.screener({});
    await c2.screener({});
    expect(noCache).toHaveBeenCalledTimes(2);
  });

  it("parseRetryAfter aceita segundos e HTTP-date", () => {
    expect(parseRetryAfter("5")).toBe(5);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6);
    expect(parseRetryAfter(null)).toBeNull();
  });
});
