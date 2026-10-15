import type { ZodType } from "zod";
import {
  BrapiAuthError,
  BrapiBadRequestError,
  BrapiError,
  BrapiNotFoundError,
  BrapiPlanError,
  BrapiRateLimitError,
} from "./errors.js";
import {
  BrapiErrorBody,
  FiiDividendsResponse,
  FiiIndicatorsHistoryResponse,
  FiiSnapshotsResponse,
  FundDividendsResponse,
  FundIndicatorsResponse,
  FundNavHistoryResponse,
  MacroResponse,
  ScreenerResponse,
  StatisticsResponse,
  StockDividendsResponse,
  StockHistoricalResponse,
  StockQuoteResponse,
  TreasuryHistoryResponse,
  TreasuryListResponse,
  type DividendsParams,
  type FundNavParams,
  type HistoricalParams,
  type MacroParams,
} from "./schemas.js";

export interface BrapiClientOptions {
  /** Padrão: process.env.BRAPI_TOKEN. Sem token, só PETR4/MGLU3/VALE3/ITUB4 funcionam. */
  token?: string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Cache de respostas 2xx (evita quota). `false` desliga; padrão: memória por instância. */
  cache?: BrapiCache | false;
}

export interface BrapiCache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown, ttlMs: number): void;
}

export class MemoryCache implements BrapiCache {
  private readonly m = new Map<string, { v: unknown; exp: number }>();
  get(key: string): unknown | undefined {
    const e = this.m.get(key);
    if (!e || e.exp <= Date.now()) {
      this.m.delete(key);
      return undefined;
    }
    return e.v;
  }
  set(key: string, value: unknown, ttlMs: number): void {
    this.m.set(key, { v: value, exp: Date.now() + ttlMs });
  }
  clear(): void {
    this.m.clear();
  }
}

/** TTL por operação (cotações mudam intradia; histórico/indicadores, 1x/dia). */
function ttlFor(path: string): number {
  if (path.includes("/stocks/quote")) return 60_000;
  if (path.includes("/stocks/screener")) return 600_000;
  return 3_600_000;
}

const MAX_RETRY_WAIT_S = 60;

export class BrapiClient {
  private readonly token: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache: BrapiCache | null;

  constructor(opts: BrapiClientOptions = {}) {
    this.token = opts.token ?? process.env.BRAPI_TOKEN;
    this.baseUrl = opts.baseUrl ?? "https://brapi.dev";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 2;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.cache = opts.cache === false ? null : (opts.cache ?? new MemoryCache());
  }

  /** GET /api/v2/stocks/quote — vários tickers em UMA chamada (symbols=A,B). */
  quote(symbols: string[]): Promise<StockQuoteResponse> {
    return this.get("/api/v2/stocks/quote", { symbols: symbols.join(",") }, StockQuoteResponse);
  }

  /** GET /api/v2/stocks/historical — range/interval ou startDate/endDate. */
  historical(symbols: string[], params: HistoricalParams): Promise<StockHistoricalResponse> {
    return this.get(
      "/api/v2/stocks/historical",
      { symbols: symbols.join(","), ...params },
      StockHistoricalResponse,
    );
  }

  /** GET /api/v2/stocks/dividends — proventos em dinheiro (DIVIDENDO/JCP; FII retorna 400). */
  dividends(symbols: string[], params: DividendsParams = {}): Promise<StockDividendsResponse> {
    return this.get(
      "/api/v2/stocks/dividends",
      { symbols: symbols.join(","), ...params },
      StockDividendsResponse,
    );
  }

  /** GET /api/v2/fii/dividends — rendimentos/amortizações (resposta flat, casa por `symbol`). */
  fiiDividends(symbols: string[], params: DividendsParams = {}): Promise<FiiDividendsResponse> {
    return this.get("/api/v2/fii/dividends", { symbols: symbols.join(","), ...params }, FiiDividendsResponse);
  }

  /** GET /api/v2/macro — séries macro (selic, cdi, ipca...). Até 20 slugs por chamada. */
  macro(slugs: string[], params: MacroParams = {}): Promise<MacroResponse> {
    return this.get(
      "/api/v2/macro",
      {
        symbols: slugs.join(","),
        ...(params.startDate ? { startDate: params.startDate } : {}),
        ...(params.endDate ? { endDate: params.endDate } : {}),
        ...(params.limit !== undefined ? { limit: String(params.limit) } : {}),
      },
      MacroResponse,
    );
  }

  /** GET /api/v2/fii/indicators/history — série mensal de indicadores (P/VP, DY...). */
  fiiIndicatorsHistory(
    symbols: string[],
    params: DividendsParams = {},
  ): Promise<FiiIndicatorsHistoryResponse> {
    return this.get(
      "/api/v2/fii/indicators/history",
      { symbols: symbols.join(","), ...params },
      FiiIndicatorsHistoryResponse,
    );
  }

  /** GET /api/v2/fii/indicators — snapshot atual (campos extras ignorados). */
  fiiIndicators(symbols: string[]): Promise<FiiSnapshotsResponse> {
    return this.get("/api/v2/fii/indicators", { symbols: symbols.join(",") }, FiiSnapshotsResponse);
  }

  /** GET /api/v2/funds/nav/history — cota patrimonial (usa `symbols` ou `cnpjs`; paginado). */
  fundsNavHistory(symbols: string[], params: FundNavParams = {}): Promise<FundNavHistoryResponse> {
    return this.get(
      "/api/v2/funds/nav/history",
      {
        symbols: symbols.join(","),
        ...(params.startDate ? { startDate: params.startDate } : {}),
        ...(params.endDate ? { endDate: params.endDate } : {}),
        ...(params.limit !== undefined ? { limit: String(params.limit) } : {}),
        ...(params.page !== undefined ? { page: String(params.page) } : {}),
      },
      FundNavHistoryResponse,
    );
  }

  /** GET /api/v2/funds/indicators — snapshot (preço, cota, ágio/deságio). */
  fundsIndicators(symbols: string[]): Promise<FundIndicatorsResponse> {
    return this.get("/api/v2/funds/indicators", { symbols: symbols.join(",") }, FundIndicatorsResponse);
  }

  /** GET /api/v2/funds/dividends — rendimentos de fundos listados (resposta flat). */
  fundsDividends(symbols: string[], params: DividendsParams = {}): Promise<FundDividendsResponse> {
    return this.get(
      "/api/v2/funds/dividends",
      { symbols: symbols.join(","), ...params },
      FundDividendsResponse,
    );
  }

  /** GET /api/v2/treasury/indicators/history — série diária de taxa e PU (slug minúsculo). */
  treasuryHistory(symbols: string[], params: DividendsParams = {}): Promise<TreasuryHistoryResponse> {
    return this.get(
      "/api/v2/treasury/indicators/history",
      { symbols: symbols.join(","), ...params },
      TreasuryHistoryResponse,
    );
  }

  /** GET /api/v2/treasury/list — catálogo de títulos (passthrough; serve para descobrir slugs). */
  treasuryList(params: { search?: string; indexer?: string } = {}): Promise<TreasuryListResponse> {
    return this.get(
      "/api/v2/treasury/list",
      {
        ...(params.search ? { search: params.search } : {}),
        ...(params.indexer ? { indexer: params.indexer } : {}),
      },
      TreasuryListResponse,
    );
  }

  /** GET /api/v2/stocks/screener — filtro e ordenação por múltiplos (params repassados). */
  screener(params: Record<string, string | number | undefined> = {}): Promise<ScreenerResponse> {
    const q: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q[k] = String(v);
    return this.get("/api/v2/stocks/screener", q, ScreenerResponse);
  }

  /** GET /api/v2/stocks/statistics — envelope validado; `data` opaco. */
  statistics(
    symbols: string[],
    params: { mode?: string; period?: string; startDate?: string; endDate?: string } = {},
  ): Promise<StatisticsResponse> {
    return this.get(
      "/api/v2/stocks/statistics",
      {
        symbols: symbols.join(","),
        ...(params.mode ? { mode: params.mode } : {}),
        ...(params.period ? { period: params.period } : {}),
        ...(params.startDate ? { startDate: params.startDate } : {}),
        ...(params.endDate ? { endDate: params.endDate } : {}),
      },
      StatisticsResponse,
    );
  }

  private async get<T>(
    path: string,
    query: Record<string, string | undefined>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ZodType Def/Input variam por schema; any aqui é contravariância segura
    schema: ZodType<T, any, any>,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
    const cacheKey = `${path}?${url.searchParams.toString()}`;
    const hit = this.cache?.get(cacheKey);
    if (hit !== undefined) return hit as T;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`; // nunca na URL, nunca logado

    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, { headers });
      if (res.ok) {
        // Resposta externa invalida NÃO é erro do cliente: vira 502 (BrapiError), nunca 400 (ZodError).
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          throw new BrapiError("Resposta da brapi não é JSON válido", res.status, "brapi_invalid_response");
        }
        try {
          const parsed = schema.parse(body);
          this.cache?.set(cacheKey, parsed, ttlFor(path));
          return parsed;
        } catch (e) {
          throw new BrapiError(
            `Resposta da brapi não passou na validação: ${e instanceof Error ? e.message : String(e)}`,
            res.status,
            "brapi_invalid_response",
          );
        }
      }

      const body = BrapiErrorBody.safeParse(await res.json().catch(() => ({})));
      const msg = (body.success && body.data.message) || `HTTP ${res.status}`;
      const code = body.success ? body.data.code : undefined;

      switch (res.status) {
        case 400:
          throw new BrapiBadRequestError(msg, 400, code);
        case 401:
          throw new BrapiAuthError(`${msg} — verifique BRAPI_TOKEN (https://brapi.dev/dashboard)`, 401, code);
        case 403:
          throw new BrapiPlanError(
            `${msg} — o plano não inclui este recurso (https://brapi.dev/pricing)`,
            403,
            code,
          );
        case 404:
          throw new BrapiNotFoundError(msg, 404, code);
        case 429: {
          const wait = parseRetryAfter(res.headers.get("Retry-After"));
          if (attempt < this.maxRetries && wait !== null && wait <= MAX_RETRY_WAIT_S) {
            await this.sleep(wait * 1000);
            continue;
          }
          throw new BrapiRateLimitError(msg, wait);
        }
        default:
          throw new BrapiError(msg, res.status, code);
      }
    }
  }
}

/** Retry-After: segundos ou HTTP-date. */
export function parseRetryAfter(h: string | null, now = Date.now()): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const t = Date.parse(h);
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - now) / 1000));
}
