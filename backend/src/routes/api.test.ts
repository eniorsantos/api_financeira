import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { hashPassword, signToken } from "../auth.js";

let app: FastifyInstance;
let token: string;
beforeAll(async () => {
  app = await buildApp();
  // cria usuário diretamente e gera token JWT
  await prisma.user.deleteMany({ where: { email: "test@test.local" } });
  const passwordHash = await hashPassword("senha123");
  const user = await prisma.user.create({
    data: { email: "test@test.local", passwordHash, name: "Test" },
  });
  token = await signToken(app, { id: user.id, email: user.email });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.dividend.deleteMany();
  await prisma.priceBar.deleteMany();
  await prisma.quoteSnapshot.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.portfolio.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.macroPoint.deleteMany();
  await prisma.fiiIndicator.deleteMany();
  await prisma.fundIndicator.deleteMany();
});

const authHeaders = () => ({ authorization: `Bearer ${token}` });
const jsonBody = (body: unknown) => ({
  payload: JSON.stringify(body),
  headers: { "content-type": "application/json", ...authHeaders() },
});
const post = (url: string, body: unknown) => app.inject({ method: "POST", url, ...jsonBody(body) });
const get = (url: string) => app.inject({ method: "GET", url, headers: authHeaders() });
const put = (url: string, body: unknown) => app.inject({ method: "PUT", url, ...jsonBody(body) });
const del = (url: string) => app.inject({ method: "DELETE", url, headers: authHeaders() });
const j = <T>(res: { body: string }) => JSON.parse(res.body) as T;

const mkAsset = (symbol: string, extra: Record<string, unknown> = {}) =>
  post("/api/assets", { symbol, name: `${symbol} S.A.`, assetClass: "STOCK", ...extra }).then((r) => {
    expect(r.statusCode).toBe(201);
    return j<{ id: string; symbol: string }>(r);
  });

describe("assets", () => {
  it("CRUD completo com símbolo normalizado para maiúsculas", async () => {
    const a = await mkAsset("petr4");
    expect(a.symbol).toBe("PETR4");
    expect((await get("/api/assets")).statusCode).toBe(200);
    expect(j<{ symbol: string }[]>(await get("/api/assets"))).toHaveLength(1);
    expect(j<{ id: string }>(await get(`/api/assets/${a.id}`)).id).toBe(a.id);
    const upd = await put(`/api/assets/${a.id}`, { name: "Petrobras PN" });
    expect(upd.statusCode).toBe(200);
    expect(j<{ name: string }>(upd).name).toBe("Petrobras PN");
    expect((await del(`/api/assets/${a.id}`)).statusCode).toBe(204);
    expect(j<unknown[]>(await get("/api/assets"))).toHaveLength(0);
  });

  it("404 com message para id inexistente", async () => {
    const r = await get("/api/assets/sem-id");
    expect(r.statusCode).toBe(404);
    const b = j<{ error: string; message: string }>(r);
    expect(b.error).toBe("not_found");
    expect(typeof b.message).toBe("string");
  });

  it("símbolo duplicado -> 409 conflict", async () => {
    await mkAsset("PETR4");
    const r = await post("/api/assets", { symbol: "petr4", name: "dup", assetClass: "STOCK" });
    expect(r.statusCode).toBe(409);
    expect(j<{ error: string }>(r).error).toBe("conflict");
  });

  it("paginação opt-in: array por padrão, objeto com page/pageSize", async () => {
    await mkAsset("A1");
    await mkAsset("A2");
    await mkAsset("A3");
    expect(j<unknown[]>(await get("/api/assets"))).toHaveLength(3);
    const p1 = j<{ data: { symbol: string }[]; page: number; pageSize: number; total: number }>(
      await get("/api/assets?page=1&pageSize=2"),
    );
    expect(p1).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(p1.data.map((a) => a.symbol)).toEqual(["A1", "A2"]);
    const p2 = j<{ data: { symbol: string }[] }>(await get("/api/assets?page=2&pageSize=2"));
    expect(p2.data.map((a) => a.symbol)).toEqual(["A3"]);
    expect((await get("/api/assets?page=0")).statusCode).toBe(400);
  });
});

describe("prices", () => {
  it("POST upsert (1 ponto e array), GET ordenado e DELETE", async () => {
    const a = await mkAsset("M1", { source: "MANUAL" });
    expect(
      (await post(`/api/assets/${a.id}/prices`, { date: "2026-01-02", close: 10, volume: 5 })).statusCode,
    ).toBe(201);
    const batch = await post(`/api/assets/${a.id}/prices`, [
      { date: "2026-01-01", close: 9 },
      { date: "2026-01-02", close: 11 }, // mesma data: atualiza
    ]);
    expect(j<{ saved: number }>(batch).saved).toBe(2);
    const rows = j<{ date: string; close: string; volume: string | null }[]>(
      await get(`/api/assets/${a.id}/prices`),
    );
    expect(rows.map((r) => [r.date.slice(0, 10), Number(r.close)])).toEqual([
      ["2026-01-01", 9],
      ["2026-01-02", 11],
    ]);
    expect(rows[1]!.volume).toBeNull(); // reenvio substitui a barra: volume omitido vira null
    const ranged = j<unknown[]>(await get(`/api/assets/${a.id}/prices?from=2026-01-02&to=2026-01-02`));
    expect(ranged).toHaveLength(1);
    const barId = j<{ id: string }[]>(await get(`/api/assets/${a.id}/prices`))[0]!.id;
    expect((await del(`/api/prices/${barId}`)).statusCode).toBe(204);
    expect(j<unknown[]>(await get(`/api/assets/${a.id}/prices`))).toHaveLength(1);
  });

  it("volume fracionário -> 400 com issues", async () => {
    const a = await mkAsset("M2", { source: "MANUAL" });
    const r = await post(`/api/assets/${a.id}/prices`, { date: "2026-01-01", close: 1, volume: 1.5 });
    expect(r.statusCode).toBe(400);
    const b = j<{ error: string; message: string; issues: unknown[] }>(r);
    expect(b.error).toBe("validation");
    expect(b.issues.length).toBeGreaterThan(0);
  });

  it("import CSV com cabeçalho, parcial com erros e vazio", async () => {
    const a = await mkAsset("MCSV", { source: "MANUAL" });
    const csv = (body: string) =>
      app.inject({
        method: "POST",
        url: `/api/assets/${a.id}/prices/import`,
        payload: body,
        headers: { "content-type": "text/csv", ...authHeaders() },
      });
    const ok = await csv("date,close,volume\n2026-01-05,10,100\n2026-01-06,11,\n");
    expect(ok.statusCode).toBe(201);
    expect(j<{ saved: number; errors: string[] }>(ok)).toEqual({ saved: 2, errors: [] });
    const bad = await csv("date,close\n2026-01-07,12\nruim,xx\n");
    expect(j<{ saved: number; errors: string[] }>(bad)).toEqual({
      saved: 1,
      errors: expect.arrayContaining([expect.stringMatching(/^linha 3:/)]),
    });
    expect(j<unknown[]>(await get(`/api/assets/${a.id}/prices`))).toHaveLength(3);
    const empty = await csv("  \n");
    expect(empty.statusCode).toBe(400);
    const wrongCt = await post(`/api/assets/${a.id}/prices/import`, { date: "2026-01-01", close: 1 });
    expect(wrongCt.statusCode).toBe(400);
  });
});

describe("portfolios, transactions, dividends", () => {
  it("CRUD e 409 ao excluir ativo com transação", async () => {
    const a = await mkAsset("ITUB4");
    const pf = j<{ id: string }>(await post("/api/portfolios", { name: "Carteira" }));
    const tx = await post("/api/transactions", {
      portfolioId: pf.id,
      assetId: a.id,
      type: "BUY",
      quantity: 10,
      unitPrice: 30.5,
      tradedAt: "2026-01-05",
    });
    expect(tx.statusCode).toBe(201);
    const txs = j<{ asset: { symbol: string } }[]>(await get("/api/transactions"));
    expect(txs[0]!.asset.symbol).toBe("ITUB4");
    const dv = await post("/api/dividends", { assetId: a.id, amountPerUnit: 0.5, paymentDate: "2026-02-01" });
    expect(dv.statusCode).toBe(201);
    expect(j<{ asset: { symbol: string } }[]>(await get("/api/dividends"))[0]!.asset.symbol).toBe("ITUB4");
    const delAsset = await del(`/api/assets/${a.id}`);
    expect(delAsset.statusCode).toBe(409);
    expect(j<{ error: string }>(delAsset).error).toBe("conflict");
  });
});

describe("sync (brapi simulada no setup)", () => {
  it("quotes atualiza 2 ativos e grava snapshots + log", async () => {
    await mkAsset("PETR4", { source: "BRAPI" });
    await mkAsset("VALE3", { source: "BRAPI" });
    const r = await post("/api/sync/quotes", {});
    expect(r.statusCode).toBe(200);
    expect(j<{ updated: number; missing: string[] }>(r)).toEqual({ updated: 2, missing: [] });
    expect(await prisma.quoteSnapshot.count()).toBe(2);
    expect(await prisma.syncLog.count({ where: { operation: "stocks.quote", status: "ok" } })).toBe(1);
  });

  it("ticker desconhecido na brapi -> missing + 404 brapi_not_found no histórico", async () => {
    await mkAsset("XXXX9", { source: "BRAPI" });
    const q = await post("/api/sync/quotes", { symbols: ["XXXX9"] });
    expect(j<{ updated: number; missing: string[] }>(q)).toEqual({ updated: 0, missing: ["XXXX9"] });
    const h = await post("/api/sync/history", { symbols: ["XXXX9"], range: "1mo", interval: "1d" });
    expect(h.statusCode).toBe(404);
    expect(j<{ error: string }>(h).error).toBe("brapi_not_found");
  });

  it("history grava 10 barras (5 por ativo)", async () => {
    await mkAsset("PETR4", { source: "BRAPI" });
    await mkAsset("VALE3", { source: "BRAPI" });
    const r = await post("/api/sync/history", { symbols: ["PETR4", "VALE3"], range: "1mo", interval: "1d" });
    expect(j<{ rows: number }>(r)).toEqual({ rows: 10 });
    expect(await prisma.priceBar.count({ where: { source: "BRAPI" } })).toBe(10);
  });

  it("sync ignora ativo MANUAL", async () => {
    await mkAsset("M3", { source: "MANUAL" });
    const r = await post("/api/sync/history", { symbols: ["M3"], range: "1mo", interval: "1d" });
    expect(j<{ rows: number }>(r)).toEqual({ rows: 0 });
  });

  it("dividends grava proventos BRAPI e é idempotente", async () => {
    await mkAsset("PETR4", { source: "BRAPI" });
    await mkAsset("VALE3", { source: "BRAPI" });
    const first = await post("/api/sync/dividends", { symbols: ["PETR4", "VALE3"] });
    expect(j<{ rows: number; skipped: number }>(first)).toEqual({ rows: 3, skipped: 1 });
    const rows = j<{ kind: string; amountPerUnit: string; source: string }[]>(await get("/api/dividends"));
    expect(rows.map((r) => [r.kind, r.source]).sort()).toEqual([
      ["DIVIDEND", "BRAPI"],
      ["JCP", "BRAPI"],
      ["RENDIMENTO", "BRAPI"],
    ]);
    const second = await post("/api/sync/dividends", { symbols: ["PETR4", "VALE3"] });
    expect(j<{ rows: number; skipped: number }>(second)).toEqual({ rows: 3, skipped: 1 });
    expect(await prisma.dividend.count()).toBe(3);
  });

  it("dividends de FII usa o endpoint fii/dividends", async () => {
    await mkAsset("MXRF11", { source: "BRAPI", assetClass: "FII" });
    const r = await post("/api/sync/dividends", { symbols: ["MXRF11"] });
    expect(j<{ rows: number; skipped: number }>(r)).toEqual({ rows: 2, skipped: 0 });
    const kinds = j<{ kind: string }[]>(await get("/api/dividends"))
      .map((d) => d.kind)
      .sort();
    expect(kinds).toEqual(["AMORTIZACAO", "RENDIMENTO"]);
    expect(await prisma.syncLog.count({ where: { operation: "fii.dividends", status: "ok" } })).toBe(1);
  });

  it("dividends de fundo usa o endpoint funds/dividends", async () => {
    await mkAsset("JURO11", { source: "BRAPI", assetClass: "FUND" });
    const r = await post("/api/sync/dividends", { symbols: ["JURO11"] });
    expect(j<{ rows: number; skipped: number }>(r)).toEqual({ rows: 1, skipped: 0 });
    const rows = j<{ kind: string; amountPerUnit: string; source: string }[]>(await get("/api/dividends"));
    expect(rows.map((d) => [d.kind, d.amountPerUnit, d.source])).toEqual([["RENDIMENTO", "0.5", "BRAPI"]]);
    expect(await prisma.syncLog.count({ where: { operation: "funds.dividends", status: "ok" } })).toBe(1);
  });

  it("indicadores de FII: sync idempotente + leitura", async () => {
    const a = await mkAsset("MXRF11", { source: "BRAPI", assetClass: "FII" });
    const first = await post("/api/sync/indicators", { symbols: ["MXRF11"] });
    expect(j<{ rows: number; skipped: number }>(first)).toEqual({ rows: 3, skipped: 0 });
    const rows = j<
      { referenceDate: string; priceToNav: string; dy12m: string; totalInvestors: string; segment: string }[]
    >(await get(`/api/assets/${a.id}/indicators`));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.referenceDate.slice(0, 10)).toBe("2026-01-09"); // snapshot atual primeiro
    expect(Number(rows[0]!.priceToNav)).toBeCloseTo(1.0085, 6);
    expect(Number(rows[1]!.dy12m)).toBeCloseTo(0.12381, 5);
    expect(rows[1]!.totalInvestors).toBe("1357621");
    expect(rows[1]!.segment).toBe("papel");
    const second = await post("/api/sync/indicators", { symbols: ["MXRF11"] });
    expect(j<{ rows: number }>(second)).toEqual({ rows: 3, skipped: 0 });
    expect(await prisma.fiiIndicator.count()).toBe(3);
  });

  it("fundos: NAV vira PriceBar + snapshot legível", async () => {
    const a = await mkAsset("JURO11", { source: "BRAPI", assetClass: "FUND" });
    const r = await post("/api/sync/funds", { symbols: ["JURO11"] });
    expect(j<{ nav: { rows: number; skipped: number }; indicators: { rows: number } }>(r)).toEqual({
      nav: { rows: 2, skipped: 1 },
      indicators: { rows: 1, skipped: 0 },
    });
    const bars = j<{ close: string }[]>(await get(`/api/assets/${a.id}/prices`));
    expect(bars.map((b) => Number(b.close)).sort((x, y) => x - y)).toEqual([99.19945, 99.36075]);
    const snap = j<{ priceToNav: string; dyMonthly: string }>(
      await get(`/api/assets/${a.id}/fund-indicators`),
    );
    expect(Number(snap.priceToNav)).toBeCloseTo(0.9777272, 6);
    expect(Number(snap.dyMonthly)).toBeCloseTo(0.008, 5);
    const again = await post("/api/sync/funds", { symbols: ["JURO11"] });
    expect(j<{ nav: { rows: number } }>(again).nav).toEqual({ rows: 2, skipped: 1 });
    expect(await prisma.priceBar.count({ where: { assetId: a.id } })).toBe(2);
  });

  it("tesouro: PU vira PriceBar (slug minúsculo) + listagem ao vivo", async () => {
    const asset = await mkAsset("TESOURO-SELIC-01032031", { source: "BRAPI", assetClass: "TREASURY" });
    const r = await post("/api/sync/treasury", { symbols: ["TESOURO-SELIC-01032031"] });
    expect(j<{ rows: number; skipped: number }>(r)).toEqual({ rows: 2, skipped: 0 });
    const bars = j<{ close: string }[]>(await get(`/api/assets/${asset.id}/prices`));
    expect(bars.map((b) => Number(b.close)).sort((x, y) => x - y)).toEqual([18910, 18925.53]);
    const list = await get("/api/treasury/list?search=selic");
    expect(j<{ results: { symbol: string }[] }>(list).results[0]!.symbol).toBe("tesouro-selic-01032031");
  });
});

describe("position", () => {
  it("posição com preço médio, P&L e alocação", async () => {
    const a = await mkAsset("ITUB4", { source: "MANUAL" });
    const b = await mkAsset("SEMPRECO", { source: "MANUAL" });
    const pf = j<{ id: string }>(await post("/api/portfolios", { name: "Carteira" }));
    await post("/api/transactions", {
      portfolioId: pf.id,
      assetId: a.id,
      type: "BUY",
      quantity: 10,
      unitPrice: 30,
      fees: 5,
      tradedAt: "2026-01-05",
    });
    await post("/api/transactions", {
      portfolioId: pf.id,
      assetId: a.id,
      type: "BUY",
      quantity: 10,
      unitPrice: 32,
      tradedAt: "2026-01-06",
    });
    await post("/api/transactions", {
      portfolioId: pf.id,
      assetId: a.id,
      type: "SELL",
      quantity: 5,
      unitPrice: 40,
      tradedAt: "2026-01-07",
    });
    await post("/api/transactions", {
      portfolioId: pf.id,
      assetId: b.id,
      type: "BUY",
      quantity: 1,
      unitPrice: 7,
      tradedAt: "2026-01-05",
    });
    await post(`/api/assets/${a.id}/prices`, { date: "2026-01-10", close: 35 });
    const r = await get(`/api/portfolios/${pf.id}/position`);
    expect(r.statusCode).toBe(200);
    const body = j<{
      positions: {
        assetId: string;
        symbol: string;
        quantity: number;
        avgPrice: number | null;
        invested: number;
        currentPrice: number | null;
        marketValue: number | null;
        pnl: number | null;
        pnlPct: number | null;
        allocationPct: number | null;
      }[];
      totalInvested: number;
      totalMarketValue: number | null;
      totalPnl: number | null;
      totalPnlPct: number | null;
    }>(r);
    expect(body.positions).toHaveLength(2);
    const itu = body.positions.find((p) => p.symbol === "ITUB4")!;
    expect(itu.quantity).toBe(15);
    expect(itu.avgPrice).toBeCloseTo(31.25, 10);
    expect(itu.invested).toBeCloseTo(468.75, 10);
    expect(itu.currentPrice).toBe(35);
    expect(itu.marketValue).toBe(525);
    expect(itu.pnl).toBeCloseTo(56.25, 10);
    expect(itu.pnlPct).toBeCloseTo(12, 10);
    expect(itu.allocationPct).toBe(100);
    const sem = body.positions.find((p) => p.symbol === "SEMPRECO")!;
    expect(sem.marketValue).toBeNull();
    expect(body.totalInvested).toBeCloseTo(475.75, 10);
    expect(body.totalMarketValue).toBe(525);
    expect(body.totalPnl).toBeCloseTo(56.25, 10);
  });

  it("carteira vazia e carteira inexistente", async () => {
    const pf = j<{ id: string }>(await post("/api/portfolios", { name: "Vazia" }));
    const r = await get(`/api/portfolios/${pf.id}/position`);
    const b = j<{ positions: unknown[]; totalInvested: number; totalMarketValue: null }>(r);
    expect(b.positions).toEqual([]);
    expect(b.totalInvested).toBe(0);
    expect(b.totalMarketValue).toBeNull();
    expect((await get("/api/portfolios/inexistente/position")).statusCode).toBe(404);
    expect(j<{ id: string }>(await get(`/api/portfolios/${pf.id}`)).id).toBe(pf.id);
  });
});

describe("avaliação", () => {
  it("screener repassa filtros e valida números", async () => {
    const r = await get("/api/screener?trailingPEMax=8&sortBy=dividendYield");
    expect(r.statusCode).toBe(200);
    const b = j<{ results: { symbol: string; metrics: { trailingPE: number | null } | null }[] }>(r);
    expect(b.results.map((x) => x.symbol)).toEqual(["PETR4", "VALE3"]);
    expect(b.results[0]!.metrics!.trailingPE).toBe(5.2);
    expect((await get("/api/screener?trailingPEMax=invalido")).statusCode).toBe(400);
  });

  it("fundamentals devolve envelope por símbolo", async () => {
    const r = await get("/api/fundamentals?symbols=PETR4,VALE3");
    expect(r.statusCode).toBe(200);
    const b = j<{ results: { symbol: string; data: unknown }[] }>(r);
    expect(b.results.map((x) => x.symbol)).toEqual(["PETR4", "VALE3"]);
    expect((await get("/api/fundamentals?symbols=%20")).statusCode).toBe(400);
  });
});

describe("openapi", () => {
  it("expõe /api/docs/json e o Swagger UI", async () => {
    const spec = await get("/api/docs/json");
    expect(spec.statusCode).toBe(200);
    const paths = Object.keys(j<{ paths: Record<string, unknown> }>(spec).paths);
    expect(paths).toContain("/api/assets");
    expect(paths).toContain("/api/analytics/compare");
    const ui = await get("/api/docs/");
    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-type"]).toContain("text/html");
  });
});

describe("macro e benchmarks", () => {  it("sync/macro grava pontos e é idempotente", async () => {
    const r = await post("/api/sync/macro", { slugs: ["cdi", "ipca"] });
    expect(j<{ rows: number; skipped: number }>(r)).toEqual({ rows: 7, skipped: 0 });
    expect(await prisma.macroPoint.count()).toBe(7);
    const again = await post("/api/sync/macro", { slugs: ["cdi"] });
    expect(j<{ rows: number }>(again)).toEqual({ rows: 5, skipped: 0 });
    expect(await prisma.macroPoint.count()).toBe(7);
  });

  it("compare com benchmark CDI e null sem dados", async () => {
    const empty = j<{ benchmark: null }>(
      await get("/api/analytics/compare?symbols=PETR4&from=2026-01-01&to=2026-01-31&benchmark=CDI"),
    );
    expect(empty.benchmark).toBeNull();
    await mkAsset("PETR4", { source: "BRAPI" });
    await post("/api/sync/history", { symbols: ["PETR4"], range: "1mo", interval: "1d" });
    await post("/api/sync/macro", { slugs: ["cdi"] });
    const b = j<{
      benchmark: {
        slug: string;
        points: number;
        returnPct: number;
        rebased: { date: string; value: number }[];
      } | null;
    }>(await get("/api/analytics/compare?symbols=PETR4&from=2026-01-01&to=2026-01-31&benchmark=CDI"));
    expect(b.benchmark?.slug).toBe("cdi");
    expect(b.benchmark?.points).toBe(5);
    expect(b.benchmark?.returnPct).toBeCloseTo(0.2603, 4);
    expect(b.benchmark?.rebased[0]?.value).toBe(100);
  });

  it("compare com sharpe e beta vs CDI", async () => {
    await mkAsset("PETR4", { source: "BRAPI" });
    await post("/api/sync/history", { symbols: ["PETR4"], range: "1mo", interval: "1d" });
    await post("/api/sync/macro", { slugs: ["cdi"] });
    const q = "symbols=PETR4&from=2026-01-01&to=2026-01-31";
    const plain = j<{ stats: { sharpe: null; beta: null }[] }>(await get(`/api/analytics/compare?${q}`));
    expect(plain.stats[0]?.sharpe).toBeNull();
    expect(plain.stats[0]?.beta).toBeNull();
    const full = j<{ stats: { sharpe: number; beta: number }[] }>(
      await get(`/api/analytics/compare?${q}&riskFree=10&betaVs=CDI`),
    );
    expect(typeof full.stats[0]?.sharpe).toBe("number");
    expect(typeof full.stats[0]?.beta).toBe("number");
    const zero = j<{ stats: { sharpe: number }[] }>(await get(`/api/analytics/compare?${q}&riskFree=0`));
    expect(zero.stats[0]!.sharpe).toBeGreaterThan(full.stats[0]!.sharpe);
  });

  it("correlation simétrica com diagonal 1", async () => {
    await mkAsset("PETR4", { source: "BRAPI" });
    await mkAsset("VALE3", { source: "BRAPI" });
    await post("/api/sync/history", { symbols: ["PETR4", "VALE3"], range: "1mo", interval: "1d" });
    const m = j<{ symbols: string[]; matrix: (number | null)[][] }>(
      await get("/api/analytics/correlation?symbols=PETR4,VALE3&from=2026-01-01&to=2026-01-31"),
    );
    expect(m.symbols).toEqual(["PETR4", "VALE3"]);
    expect(m.matrix[0]![0]).toBe(1);
    expect(m.matrix[1]![1]).toBe(1);
    expect(m.matrix[0]![1]).toBe(m.matrix[1]![0]);
    expect(m.matrix[0]![1]).toBeGreaterThanOrEqual(-1);
    expect(m.matrix[0]![1]).toBeLessThanOrEqual(1);
  });

  it("performance real deflaciona pelo IPCA", async () => {
    await mkAsset("PETR4", { source: "BRAPI" });
    await post("/api/sync/history", { symbols: ["PETR4"], range: "1mo", interval: "1d" });
    const semIpca = j<{ stats: { realReturnPct: number | null }[] }>(
      await get("/api/reports/performance?from=2026-01-01&to=2026-02-28&real=1"),
    );
    expect(semIpca.stats[0]?.realReturnPct).toBeNull();
    await post("/api/sync/macro", { slugs: ["ipca"] });
    const comIpca = j<{ stats: { returnPct: number; realReturnPct: number | null }[] }>(
      await get("/api/reports/performance?from=2026-01-01&to=2026-02-28&real=1"),
    );
    expect(comIpca.stats[0]?.returnPct).toBeCloseTo(10, 5);
    expect(comIpca.stats[0]?.realReturnPct).toBeCloseTo(9.0167, 3);
    const csv = await get("/api/reports/performance?from=2026-01-01&to=2026-02-28&real=1&format=csv");
    expect(csv.body.split("\n")[0]).toContain("realReturnPct");
    expect(csv.body).toContain("9.02");
  });
});

describe("analytics e relatórios", () => {
  const seed = async () => {
    await mkAsset("PETR4", { source: "BRAPI" });
    await mkAsset("VALE3", { source: "BRAPI" });
    await post("/api/sync/history", { symbols: ["PETR4", "VALE3"], range: "1mo", interval: "1d" });
  };

  it("compare usa retorno do adjustedClose e ordena ranking", async () => {
    await seed();
    const r = await get("/api/analytics/compare?symbols=PETR4,VALE3&from=2026-01-01&to=2026-01-31");
    expect(r.statusCode).toBe(200);
    const b = j<{
      stats: { symbol: string; points: number; returnPct: number }[];
      ranking: string[];
      rebased: Record<string, { date: string; value: number }[]>;
    }>(r);
    const petr = b.stats.find((s) => s.symbol === "PETR4")!;
    const vale = b.stats.find((s) => s.symbol === "VALE3")!;
    expect(petr.points).toBe(5);
    expect(petr.returnPct).toBeCloseTo(10, 5);
    expect(vale.returnPct).toBeCloseTo(3.3333, 3);
    expect(b.ranking).toEqual(["PETR4", "VALE3"]);
    expect(b.rebased.PETR4![0]!.value).toBe(100);
  });

  it("fonte preferencial: BRAPI por padrão, MANUAL sob ?source=", async () => {
    await seed();
    const petr = j<{ id: string; symbol: string }[]>(await get("/api/assets")).find(
      (a) => a.symbol === "PETR4",
    )!;
    const r = await post(`/api/assets/${petr.id}/prices`, [
      { date: "2026-01-05", close: 100 },
      { date: "2026-01-06", close: 100 },
      { date: "2026-01-07", close: 100 },
      { date: "2026-01-08", close: 100 },
      { date: "2026-01-09", close: 200 }, // retorno manual: +100%
    ]);
    expect(r.statusCode).toBe(201);
    const q = "symbols=PETR4&from=2026-01-01&to=2026-01-31";
    const dflt = j<{ stats: { returnPct: number }[] }>(await get(`/api/analytics/compare?${q}`));
    expect(dflt.stats[0]!.returnPct).toBeCloseTo(10, 5); // BRAPI vence
    const manual = j<{ stats: { returnPct: number }[] }>(
      await get(`/api/analytics/compare?${q}&source=MANUAL`),
    );
    expect(manual.stats[0]!.returnPct).toBeCloseTo(100, 5);
    const auto = j<{ stats: { returnPct: number }[] }>(await get(`/api/analytics/compare?${q}&source=BRAPI`));
    expect(auto.stats[0]!.returnPct).toBeCloseTo(10, 5);
  });

  it("performance JSON e CSV", async () => {
    await seed();
    const q = "from=2026-01-01&to=2026-01-31";
    const js = j<{ from: string; to: string; stats: { symbol: string }[] }>(
      await get(`/api/reports/performance?${q}`),
    );
    expect(js.stats.map((s) => s.symbol).sort()).toEqual(["PETR4", "VALE3"]);
    const csv = await get(`/api/reports/performance?${q}&format=csv`);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const lines = csv.body.split("\n");
    expect(lines[0]).toBe(
      "symbol,points,startDate,endDate,returnPct,volatilityAnnPct,maxDrawdownPct,realReturnPct",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^PETR4,5,2026-01-05,2026-01-09,10\.00,/);
  });
});
