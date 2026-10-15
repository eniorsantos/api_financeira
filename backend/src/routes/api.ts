import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { DataSource, AssetClass } from "@prisma/client";
import { BrapiClient } from "../brapi/client.js";
import { compare, type Bar, type PeriodStats } from "../services/analytics.js";
import {
  accumulateRates,
  accumulatedReturnPct,
  alignedReturns,
  beta,
  correlationMatrix,
  dailyReturns,
  rebaseFactors,
  realReturnPct,
  sharpeRatio,
} from "../services/analytics.js";
import { parsePricesCsv } from "../services/csv.js";
import { portfolioPosition } from "../services/portfolio.js";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  hashPassword,
  comparePassword,
  requireAuth,
  signToken,
} from "../auth.js";
import {
  syncDividends,
  syncFundIndicators,
  syncFunds,
  syncHistory,
  syncIndicators,
  syncMacro,
  syncQuotes,
  syncTreasury,
} from "../services/sync.js";

const id = z.object({ id: z.string().min(1) });
const date = z.coerce.date();
const dec = z.coerce.number();

/** Com exactOptionalPropertyTypes, Prisma não aceita `| undefined` que o Zod gera em campos opcionais. */
type StripUndefined<T> = { [K in keyof T]: Exclude<T[K], undefined> };
const strip = <T extends object>(x: T): StripUndefined<T> => x as StripUndefined<T>;

/** Extrai o userId do request autenticado (lança 401 se não houver sessão). */
function userId(req: FastifyRequest): string {
  const u = requireAuth(req);
  return u.id;
}

/** Lote de upserts em uma única transação (menos round-trips; preserva update-on-conflict). */
async function upsertBatch<T extends { assetId: string; date: Date; source: "MANUAL" | "BRAPI" }>(
  rows: T[],
  mk: (r: T) => { create: T; update: Record<string, unknown> },
  chunk = 100,
) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    await prisma.$transaction(
      slice.map((r) => {
        const { create, update } = mk(r);
        return prisma.priceBar.upsert({
          where: { assetId_date_source: { assetId: r.assetId, date: r.date, source: r.source } },
          create,
          update,
        });
      }),
    );
  }
}

const AssetIn = z.object({
  symbol: z.string().trim().toUpperCase().min(1),
  name: z.string().min(1),
  assetClass: z.enum(["STOCK", "FII", "FUND", "TREASURY", "OTHER"]),
  source: z.enum(["MANUAL", "BRAPI"]).default("MANUAL"),
  currency: z.string().default("BRL"),
});
const PriceIn = z.object({
  date,
  close: dec,
  open: dec.nullish(),
  high: dec.nullish(),
  low: dec.nullish(),
  adjustedClose: dec.nullish(),
  volume: z.coerce
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => (v == null ? null : BigInt(v))),
});
const TxIn = z.object({
  portfolioId: z.string(),
  assetId: z.string(),
  type: z.enum(["BUY", "SELL"]),
  quantity: dec.positive(),
  unitPrice: dec.nonnegative(),
  fees: dec.nonnegative().default(0),
  tradedAt: date,
  notes: z.string().nullish(),
});
const DivIn = z.object({
  assetId: z.string(),
  kind: z.enum(["DIVIDEND", "JCP", "RENDIMENTO", "AMORTIZACAO", "OTHER"]).default("DIVIDEND"),
  amountPerUnit: dec.positive(),
  exDate: date.nullish(),
  paymentDate: date,
});

const toBar = (p: { date: Date; close: unknown; adjustedClose: unknown }): Bar => ({
  date: p.date,
  close: p.close == null ? null : Number(p.close),
  adjustedClose: p.adjustedClose == null ? null : Number(p.adjustedClose),
});

type SourcedBar = Bar & { source: "MANUAL" | "BRAPI" };

const toSourcedBar = (p: {
  date: Date;
  close: unknown;
  adjustedClose: unknown;
  source: "MANUAL" | "BRAPI";
}): SourcedBar => ({
  ...toBar(p),
  source: p.source,
});

/**
 * Fonte preferencial: se `want` for dado, usa só ela; senão, por ativo,
 * prefere barras BRAPI (dado automático) e cai para MANUAL quando não há.
 * Evita pontos duplicados quando as duas fontes cobrem a mesma data.
 */
function pickSource(bars: SourcedBar[], want?: "MANUAL" | "BRAPI"): Bar[] {
  if (want) return bars.filter((b) => b.source === want);
  const auto = bars.filter((b) => b.source === "BRAPI");
  return auto.length ? auto : bars.filter((b) => b.source === "MANUAL");
}

const sourceParam = z.enum(["MANUAL", "BRAPI"]).optional();

const BENCHMARKS = { CDI: "cdi", SELIC: "selic", IPCA: "ipca" } as const;

/** Série acumulada de um benchmark (CDI/SELIC/IPCA) no período; null sem dados. */
async function benchmarkSeries(label: keyof typeof BENCHMARKS, from: Date, to: Date) {
  const slug = BENCHMARKS[label];
  const points = await prisma.macroPoint.findMany({
    where: { slug, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  if (!points.length) return null;
  const unit = points.find((p) => p.unit !== null)?.unit ?? null;
  const acc = accumulateRates(
    points.map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      value: p.value === null ? null : Number(p.value),
    })),
    unit,
  );
  if (!acc) return null;
  return {
    slug,
    label,
    unit,
    points: acc.length,
    returnPct: accumulatedReturnPct(acc),
    rebased: rebaseFactors(acc),
  };
}

/** Fator acumulado do IPCA no período (para retorno real); null sem dados. */
async function ipcaFactor(from: Date, to: Date): Promise<number | null> {
  const points = await prisma.macroPoint.findMany({
    where: { slug: "ipca", date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  if (!points.length) return null;
  const acc = accumulateRates(
    points.map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      value: p.value === null ? null : Number(p.value),
    })),
    "percent",
  );
  return acc ? acc[acc.length - 1]!.factor : null;
}

const riskFreeParam = z.union([z.coerce.number(), z.enum(["CDI", "SELIC"])]).optional();

/** Taxa anual risk-free: número direto ou anualização geométrica do CDI/Selic no período. */
async function riskFreeAnnual(
  rf: number | "CDI" | "SELIC" | undefined,
  from: Date,
  to: Date,
): Promise<number | null> {
  if (rf === undefined) return null;
  if (typeof rf === "number") return Number.isFinite(rf) ? rf : null;
  const slug = BENCHMARKS[rf];
  const points = await prisma.macroPoint.findMany({
    where: { slug, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  if (points.length < 2) return null;
  const unit = points.find((p) => p.unit !== null)?.unit ?? null;
  if (unit !== "percentPerDay" && unit !== "percentPerYear") return null;
  const acc = accumulateRates(
    points.map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      value: p.value === null ? null : Number(p.value),
    })),
    unit,
  );
  if (!acc) return null;
  return (Math.pow(acc[acc.length - 1]!.factor, 252 / acc.length) - 1) * 100;
}

/** Retornos diários de barras (adjustedClose, senão close) para Sharpe/beta/correlação. */
function barReturns(bars: Bar[]): number[] {
  const px = (b: Bar) => b.adjustedClose ?? b.close;
  return dailyReturns([...bars].sort((a, b) => +a.date - +b.date).map(px));
}

/** Preenche sharpe/beta dos stats (null quando o parâmetro falta ou sem dados). */
async function withRisk(
  picked: Record<string, Bar[]>,
  stats: PeriodStats[],
  q: {
    riskFree?: number | "CDI" | "SELIC" | undefined;
    betaVs?: keyof typeof BENCHMARKS | undefined;
    from: Date;
    to: Date;
  },
) {
  const rf = await riskFreeAnnual(q.riskFree, q.from, q.to);
  const betas = q.betaVs ? await betasVs(q.betaVs, picked, q.from, q.to) : null;
  return stats.map((s) => ({
    ...s,
    sharpe: rf === null ? null : sharpeRatio(barReturns(picked[s.symbol] ?? []), rf),
    beta: betas ? (betas[s.symbol] ?? null) : null,
  }));
}

/** Beta de cada ativo vs benchmark acumulado (CDI/SELIC/IPCA); null sem dados comuns. */
async function betasVs(
  label: keyof typeof BENCHMARKS,
  series: Record<string, Bar[]>,
  from: Date,
  to: Date,
): Promise<Record<string, number | null>> {
  const slug = BENCHMARKS[label];
  const points = await prisma.macroPoint.findMany({
    where: { slug, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  const unit = points.find((p) => p.unit !== null)?.unit ?? null;
  const acc = accumulateRates(
    points.map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      value: p.value === null ? null : Number(p.value),
    })),
    unit,
  );
  const out: Record<string, number | null> = {};
  if (!acc) {
    for (const s of Object.keys(series)) out[s] = null;
    return out;
  }
  const bench = acc.map((p) => ({ date: p.date, price: p.factor }));
  for (const [sym, bars] of Object.entries(series)) {
    const px = (b: Bar) => b.adjustedClose ?? b.close;
    const asset = [...bars]
      .sort((a, b) => +a.date - +b.date)
      .map((b) => ({ date: b.date.toISOString().slice(0, 10), price: px(b) }));
    const aligned = alignedReturns({ asset, bench });
    out[sym] = beta(aligned.asset!, aligned.bench!);
  }
  return out;
}

const pageParams = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
type Page = z.infer<typeof pageParams>;

/** Paginação opt-in: sem `page`/`pageSize` devolve o array (compatível); com eles, `{data, page, pageSize, total}`. */
async function pageOrAll<T>(
  q: Page,
  total: () => Promise<number>,
  list: (page: { skip: number; take: number } | undefined) => Promise<T[]>,
): Promise<T[] | { data: T[]; page: number; pageSize: number; total: number }> {
  if (q.page === undefined && q.pageSize === undefined) return list(undefined);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const [t, data] = await Promise.all([total(), list({ skip: (page - 1) * pageSize, take: pageSize })]);
  return { data, page, pageSize, total: t };
}

export async function api(app: FastifyInstance) {
  // ---- Auth ----
  app.post("/auth/register", async (req, rep) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(6), name: z.string().optional() })
      .parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return rep.code(409).send({ error: "conflict", message: "E-mail já cadastrado" });
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: { email: body.email, passwordHash, name: body.name ?? null },
      select: { id: true, email: true, name: true },
    });
    return rep.code(201).send(user);
  });
  app.post("/auth/login", async (req, rep) => {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return rep.code(401).send({ error: "auth_required", message: "Credenciais inválidas" });
    const ok = await comparePassword(body.password, user.passwordHash);
    if (!ok) return rep.code(401).send({ error: "auth_required", message: "Credenciais inválidas" });
    const token = await signToken(app, { id: user.id, email: user.email });
    return rep.send({ token, user: { id: user.id, email: user.email, name: user.name } });
  });
  app.get("/auth/me", async (req, rep) => {
    const uid = userId(req);
    const user = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, email: true, name: true } });
    if (!user) return rep.code(404).send({ error: "not_found", message: "Usuário não encontrado" });
    return user;
  });

  // ---- Assets (CRUD) ----
  app.get("/assets", async (req) => {
    const q = pageParams.parse(req.query);
    const uid = userId(req);
    return pageOrAll(
      q,
      () => prisma.asset.count({ where: { userId: uid } }),
      (p) => prisma.asset.findMany({ where: { userId: uid }, orderBy: { symbol: "asc" }, ...p }),
    );
  });
  app.post("/assets", async (req, rep) => {
    const uid = userId(req);
    return rep.code(201).send(await prisma.asset.create({ data: strip({ ...AssetIn.parse(req.body), userId: uid }) }));
  });
  app.get("/assets/:id", async (req) => {
    const uid = userId(req);
    return prisma.asset.findUniqueOrThrow({ where: { id: id.parse(req.params).id, userId: uid } });
  });
  app.put("/assets/:id", async (req) => {
    const uid = userId(req);
    return prisma.asset.update({
      where: { id: id.parse(req.params).id, userId: uid },
      data: strip(AssetIn.partial().parse(req.body)),
    });
  });
  app.delete("/assets/:id", async (req, rep) => {
    const uid = userId(req);
    await prisma.asset.delete({ where: { id: id.parse(req.params).id, userId: uid } });
    return rep.code(204).send();
  });

  // ---- Preços manuais (CRUD) ----
  app.get("/assets/:id/prices", async (req) => {
    const uid = userId(req);
    const q = z.object({ from: date.optional(), to: date.optional() }).parse(req.query);
    const rows = await prisma.priceBar.findMany({
      where: {
        assetId: id.parse(req.params).id,
        asset: { userId: uid },
        date: { gte: q.from ?? new Date(0), lte: q.to ?? new Date("2999-01-01") },
      },
      orderBy: { date: "asc" },
    });
    return rows.map((r) => ({ ...r, volume: r.volume?.toString() ?? null }));
  });
  app.post("/assets/:id/prices", async (req, rep) => {
    const uid = userId(req);
    const body = z
      .array(PriceIn)
      .or(PriceIn.transform((x) => [x]))
      .parse(req.body); // 1 ou N pontos
    const assetId = id.parse(req.params).id;
    // Verifica propriedade do ativo
    await prisma.asset.findUniqueOrThrow({ where: { id: assetId, userId: uid } });
    const rows = body.map((p) => ({
      assetId,
      date: p.date,
      source: "MANUAL" as const,
      open: p.open ?? null,
      high: p.high ?? null,
      low: p.low ?? null,
      close: p.close,
      adjustedClose: p.adjustedClose ?? p.close,
      volume: p.volume,
    }));
    await upsertBatch(rows, (r) => ({
      create: r,
      update: {
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        adjustedClose: r.adjustedClose,
        volume: r.volume,
      },
    }));
    return rep.code(201).send({ saved: body.length });
  });
  app.delete("/prices/:id", async (req, rep) => {
    const uid = userId(req);
    const priceId = id.parse(req.params).id;
    const price = await prisma.priceBar.findUnique({
      where: { id: priceId },
      select: { asset: { select: { userId: true } } },
    });
    if (!price || price.asset.userId !== uid) {
      return rep.code(404).send({ error: "not_found", message: "Preço não encontrado" });
    }
    await prisma.priceBar.delete({ where: { id: priceId } });
    return rep.code(204).send();
  });
  app.post("/assets/:id/prices/import", async (req, rep) => {
    const uid = userId(req);
    if (typeof req.body !== "string") {
      return rep.code(400).send({ error: "validation", message: "Envie o CSV com Content-Type: text/csv" });
    }
    const assetId = id.parse(req.params).id;
    await prisma.asset.findUniqueOrThrow({ where: { id: assetId, userId: uid } });
    const { rows, errors } = parsePricesCsv(req.body);
    if (!rows.length && errors.length) {
      return rep.code(400).send({ error: "validation", message: "Nenhuma linha válida", issues: errors });
    }
    await upsertBatch(
      rows.map((p) => ({
        assetId,
        date: p.date,
        source: "MANUAL" as const,
        open: p.open ?? null,
        high: p.high ?? null,
        low: p.low ?? null,
        close: p.close,
        adjustedClose: p.adjustedClose ?? p.close,
        volume: p.volume,
      })),
      (r) => ({
        create: r,
        update: {
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          adjustedClose: r.adjustedClose,
          volume: r.volume,
        },
      }),
    );
    return rep.code(201).send({ saved: rows.length, errors });
  });

  // ---- Portfólios / Transações / Dividendos (CRUD) ----
  app.get("/portfolios", async (req) => {
    const q = pageParams.parse(req.query);
    const uid = userId(req);
    return pageOrAll(
      q,
      () => prisma.portfolio.count({ where: { userId: uid } }),
      (p) => prisma.portfolio.findMany({ where: { userId: uid }, ...p }),
    );
  });
  app.get("/portfolios/:id", async (req) => {
    const uid = userId(req);
    return prisma.portfolio.findUniqueOrThrow({ where: { id: id.parse(req.params).id, userId: uid } });
  });
  app.get("/portfolios/:id/position", async (req) => {
    const uid = userId(req);
    // verifica propriedade antes de calcular posição
    await prisma.portfolio.findUniqueOrThrow({ where: { id: id.parse(req.params).id, userId: uid } });
    return portfolioPosition(id.parse(req.params).id);
  });
  app.post("/portfolios", async (req, rep) => {
    const uid = userId(req);
    return rep
      .code(201)
      .send(
        await prisma.portfolio.create({
          data: strip({ ...z.object({ name: z.string().min(1) }).parse(req.body), userId: uid }),
        }),
      );
  });
  app.put("/portfolios/:id", async (req) => {
    const uid = userId(req);
    return prisma.portfolio.update({
      where: { id: id.parse(req.params).id, userId: uid },
      data: z.object({ name: z.string().min(1) }).parse(req.body),
    });
  });
  app.delete("/portfolios/:id", async (req, rep) => {
    const uid = userId(req);
    await prisma.portfolio.delete({ where: { id: id.parse(req.params).id, userId: uid } });
    return rep.code(204).send();
  });

  app.get("/transactions", async (req) => {
    const q = pageParams.parse(req.query);
    const uid = userId(req);
    return pageOrAll(
      q,
      () => prisma.transaction.count({ where: { userId: uid } }),
      (p) =>
        prisma.transaction.findMany({
          where: { userId: uid },
          orderBy: { tradedAt: "desc" },
          include: { asset: true },
          ...p,
        }),
    );
  });
  app.post("/transactions", async (req, rep) => {
    const uid = userId(req);
    const data = strip(TxIn.parse(req.body));
    // verifica que o portfolio e o ativo pertencem ao usuário
    await prisma.portfolio.findUniqueOrThrow({ where: { id: data.portfolioId, userId: uid } });
    await prisma.asset.findUniqueOrThrow({ where: { id: data.assetId, userId: uid } });
    return rep.code(201).send(await prisma.transaction.create({ data: { ...data, userId: uid } }));
  });
  app.put("/transactions/:id", async (req) => {
    const uid = userId(req);
    const data = strip(TxIn.partial().parse(req.body));
    // verifica propriedade da transação
    await prisma.transaction.findUniqueOrThrow({ where: { id: id.parse(req.params).id, userId: uid } });
    return prisma.transaction.update({
      where: { id: id.parse(req.params).id, userId: uid },
      data,
    });
  });
  app.delete("/transactions/:id", async (req, rep) => {
    const uid = userId(req);
    await prisma.transaction.delete({ where: { id: id.parse(req.params).id, userId: uid } });
    return rep.code(204).send();
  });

  app.get("/dividends", async (req) => {
    const q = pageParams.parse(req.query);
    const uid = userId(req);
    return pageOrAll(
      q,
      () => prisma.dividend.count({ where: { userId: uid } }),
      (p) =>
        prisma.dividend.findMany({
          where: { userId: uid },
          orderBy: { paymentDate: "desc" },
          include: { asset: true },
          ...p,
        }),
    );
  });
  app.post("/dividends", async (req, rep) => {
    const uid = userId(req);
    const data = strip(DivIn.parse(req.body));
    await prisma.asset.findUniqueOrThrow({ where: { id: data.assetId, userId: uid } });
    return rep.code(201).send(await prisma.dividend.create({ data: { ...data, userId: uid } }));
  });
  app.put("/dividends/:id", async (req) => {
    const uid = userId(req);
    const data = strip(DivIn.partial().parse(req.body));
    await prisma.dividend.findUniqueOrThrow({ where: { id: id.parse(req.params).id, userId: uid } });
    return prisma.dividend.update({
      where: { id: id.parse(req.params).id, userId: uid },
      data,
    });
  });
  app.delete("/dividends/:id", async (req, rep) => {
    const uid = userId(req);
    await prisma.dividend.delete({ where: { id: id.parse(req.params).id, userId: uid } });
    return rep.code(204).send();
  });

  // ---- Sincronização via brapi (token só no servidor) ----
  app.post("/sync/quotes", async (req) => {
    const uid = userId(req);
    const parsed = z.object({ symbols: z.array(z.string()).optional() }).parse(req.body ?? {});
    const where: { userId: string; source: DataSource; active: boolean; symbol?: { in: string[] } } = {
      userId: uid,
      source: "BRAPI",
      active: true,
    };
    if (parsed.symbols) where.symbol = { in: parsed.symbols };
    const assets = await prisma.asset.findMany({ where });
    return syncQuotes(assets.map((a) => a.symbol));
  });
  app.post("/sync/history", async (req) => {
    const uid = userId(req);
    const b = z
      .object({
        symbols: z.array(z.string()).min(1),
        range: z.string().default("1y"),
        interval: z.string().default("1d"),
      })
      .parse(req.body);
    const where: { userId: string; source: DataSource; active: boolean; symbol: { in: string[] } } = {
      userId: uid,
      source: "BRAPI",
      active: true,
      symbol: { in: b.symbols },
    };
    const assets = await prisma.asset.findMany({ where });
    return syncHistory(assets.map((a) => a.symbol), { range: b.range, interval: b.interval });
  });
  app.post("/sync/dividends", async (req) => {
    const uid = userId(req);
    const b = z
      .object({
        symbols: z.array(z.string()).min(1),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .parse(req.body);
    const where: { userId: string; source: DataSource; active: boolean; symbol: { in: string[] } } = {
      userId: uid,
      source: "BRAPI",
      active: true,
      symbol: { in: b.symbols },
    };
    const assets = await prisma.asset.findMany({ where });
    return syncDividends(assets.map((a) => a.symbol), {
      ...(b.startDate ? { startDate: b.startDate } : {}),
      ...(b.endDate ? { endDate: b.endDate } : {}),
    }, uid);
  });
  app.post("/sync/macro", async (req) => {
    const b = z
      .object({
        slugs: z.array(z.string()).min(1).max(20),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.coerce.number().int().positive().optional(),
      })
      .parse(req.body);
    return syncMacro(b.slugs, {
      ...(b.startDate ? { startDate: b.startDate } : {}),
      ...(b.endDate ? { endDate: b.endDate } : {}),
      ...(b.limit !== undefined ? { limit: b.limit } : {}),
    });
  });
  app.post("/sync/indicators", async (req) => {
    const uid = userId(req);
    const b = z
      .object({
        symbols: z.array(z.string()).min(1),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .parse(req.body);
    const where: {
      userId: string;
      source: DataSource;
      active: boolean;
      assetClass: AssetClass;
      symbol: { in: string[] };
    } = { userId: uid, source: "BRAPI", active: true, assetClass: "TREASURY", symbol: { in: b.symbols } };
    const assets = await prisma.asset.findMany({ where });
    return syncIndicators(assets.map((a) => a.symbol), {
      ...(b.startDate ? { startDate: b.startDate } : {}),
      ...(b.endDate ? { endDate: b.endDate } : {}),
    });
  });
  app.post("/sync/funds", async (req) => {
    const uid = userId(req);
    const b = z
      .object({
        symbols: z.array(z.string()).min(1),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .parse(req.body);
    const where: {
      userId: string;
      source: DataSource;
      active: boolean;
      assetClass: AssetClass;
      symbol: { in: string[] };
    } = { userId: uid, source: "BRAPI", active: true, assetClass: "FUND", symbol: { in: b.symbols } };
    const assets = await prisma.asset.findMany({ where });
    return {
      nav: await syncFunds(assets.map((a) => a.symbol), {
        ...(b.startDate ? { startDate: b.startDate } : {}),
        ...(b.endDate ? { endDate: b.endDate } : {}),
      }),
      indicators: await syncFundIndicators(assets.map((a) => a.symbol)),
    };
  });
  app.post("/sync/treasury", async (req) => {
    const uid = userId(req);
    const b = z
      .object({
        symbols: z.array(z.string()).min(1),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .parse(req.body);
    const where: {
      userId: string;
      source: DataSource;
      active: boolean;
      assetClass: AssetClass;
      symbol: { in: string[] };
    } = { userId: uid, source: "BRAPI", active: true, assetClass: "TREASURY", symbol: { in: b.symbols } };
    const assets = await prisma.asset.findMany({ where });
    return syncTreasury(assets.map((a) => a.symbol.toLowerCase()), {
      ...(b.startDate ? { startDate: b.startDate } : {}),
      ...(b.endDate ? { endDate: b.endDate } : {}),
    });
  });
  app.get("/treasury/list", async (req) => {
    const q = z.object({ search: z.string().optional(), indexer: z.string().optional() }).parse(req.query);
    // Catálogo ao vivo (sem persistência): serve para descobrir slugs ao cadastrar o ativo.
    // Erros da brapi caem no handler global (502/429).
    return new BrapiClient().treasuryList({
      ...(q.search ? { search: q.search } : {}),
      ...(q.indexer ? { indexer: q.indexer } : {}),
    });
  });
  app.get("/assets/:id/fund-indicators", async (req, rep) => {
    const uid = userId(req);
    const row = await prisma.fundIndicator.findUnique({
      where: { assetId: id.parse(req.params).id },
      include: { asset: { select: { userId: true } } },
    });
    if (!row || row.asset.userId !== uid)
      return rep.code(404).send({ error: "not_found", message: "Sem snapshot para este ativo" });
    return row;
  });

  // ---- Avaliação (brapi ao vivo; filtros numéricos validados, resto repassado) ----
  app.get("/screener", async (req) => {
    const q = z
      .object({
        search: z.string().optional(),
        sortBy: z.string().optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        trailingPEMin: z.coerce.number().optional(),
        trailingPEMax: z.coerce.number().optional(),
        priceToBookMin: z.coerce.number().optional(),
        priceToBookMax: z.coerce.number().optional(),
        dividendYieldMin: z.coerce.number().optional(),
        dividendYieldMax: z.coerce.number().optional(),
        returnOnEquityMin: z.coerce.number().optional(),
        enterpriseToEbitdaMax: z.coerce.number().optional(),
        netMarginMin: z.coerce.number().optional(),
      })
      .passthrough()
      .parse(req.query);
    const params: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params[k] = String(v);
    return new BrapiClient().screener(params);
  });
  app.get("/fundamentals", async (req) => {
    const q = z
      .object({
        symbols: z
          .string()
          .transform((s) =>
            s
              .split(",")
              .map((x) => x.trim().toUpperCase())
              .filter(Boolean),
          )
          .refine((a) => a.length > 0, "symbols vazio"),
        mode: z.enum(["current", "history"]).optional(),
        period: z.enum(["annual", "quarterly"]).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .parse(req.query);
    return new BrapiClient().statistics(q.symbols, {
      ...(q.mode ? { mode: q.mode } : {}),
      ...(q.period ? { period: q.period } : {}),
      ...(q.startDate ? { startDate: q.startDate } : {}),
      ...(q.endDate ? { endDate: q.endDate } : {}),
    });
  });
  app.get("/assets/:id/indicators", async (req) => {
    const uid = userId(req);
    const q = z.object({ from: date.optional(), to: date.optional() }).parse(req.query);
    return prisma.fiiIndicator.findMany({
      where: {
        assetId: id.parse(req.params).id,
        asset: { userId: uid },
        referenceDate: { gte: q.from ?? new Date(0), lte: q.to ?? new Date("2999-01-01") },
      },
      orderBy: { referenceDate: "desc" },
    });
  });

  // ---- Comparativo + relatórios ----
  app.get("/analytics/compare", async (req) => {
    const q = z
      .object({
        symbols: z.string().transform((s) => s.split(",").map((x) => x.trim().toUpperCase())),
        from: date,
        to: date,
        source: sourceParam,
        benchmark: z.enum(["CDI", "SELIC", "IPCA"]).optional(),
        riskFree: riskFreeParam,
        betaVs: z.enum(["CDI", "SELIC", "IPCA"]).optional(),
      })
      .parse(req.query);
    const assets = await prisma.asset.findMany({
      where: { symbol: { in: q.symbols }, userId: userId(req) },
      include: { prices: { where: { date: { gte: q.from, lte: q.to } }, orderBy: { date: "asc" } } },
    });
    const picked = Object.fromEntries(
      assets.map((a) => [a.symbol, pickSource(a.prices.map(toSourcedBar), q.source)]),
    );
    const cmp = compare(picked);
    const stats = await withRisk(picked, cmp.stats, q);
    return {
      ...cmp,
      stats,
      benchmark: q.benchmark ? await benchmarkSeries(q.benchmark, q.from, q.to) : null,
    };
  });

  app.get("/analytics/correlation", async (req) => {
    const q = z
      .object({
        symbols: z.string().transform((s) => s.split(",").map((x) => x.trim().toUpperCase())),
        from: date,
        to: date,
        source: sourceParam,
      })
      .parse(req.query);
    const assets = await prisma.asset.findMany({
      where: { symbol: { in: q.symbols }, userId: userId(req) },
      include: { prices: { where: { date: { gte: q.from, lte: q.to } }, orderBy: { date: "asc" } } },
    });
    const px = (b: { close: unknown; adjustedClose: unknown }) => {
      const v = b.adjustedClose ?? b.close;
      return v === null || v === undefined ? null : Number(v);
    };
    return correlationMatrix(
      Object.fromEntries(
        assets.map((a) => [
          a.symbol,
          pickSource(a.prices.map(toSourcedBar), q.source).map((b) => ({
            date: b.date.toISOString().slice(0, 10),
            price: px(b),
          })),
        ]),
      ),
    );
  });

  app.get("/reports/performance", async (req, rep) => {
    const q = z
      .object({
        from: date,
        to: date,
        assetClass: z.enum(["STOCK", "FII", "FUND", "TREASURY", "OTHER"]).optional(),
        format: z.enum(["json", "csv", "xlsx", "pdf"]).default("json"),
        source: sourceParam,
        real: z.enum(["0", "1"]).optional(),
        riskFree: riskFreeParam,
        betaVs: z.enum(["CDI", "SELIC", "IPCA"]).optional(),
      })
      .parse(req.query);
    const assets = await prisma.asset.findMany({
      where: {
        ...(q.assetClass ? { assetClass: q.assetClass } : {}),
        userId: userId(req),
      },
      orderBy: { symbol: "asc" },
      include: { prices: { where: { date: { gte: q.from, lte: q.to } }, orderBy: { date: "asc" } } },
    });
    const picked = Object.fromEntries(
      assets.map((a) => [a.symbol, pickSource(a.prices.map(toSourcedBar), q.source)]),
    );
    const { stats } = compare(picked);
    const withRiskStats = await withRisk(picked, stats, q);
    const withReal =
      q.real === "1"
        ? await (async () => {
            const factor = await ipcaFactor(q.from, q.to);
            return withRiskStats.map((s) => ({ ...s, realReturnPct: realReturnPct(s.returnPct, factor) }));
          })()
        : withRiskStats;
    if (q.format === "csv") {
      const head = "symbol,points,startDate,endDate,returnPct,volatilityAnnPct,maxDrawdownPct,realReturnPct";
      const f = (n: number | null) => (n === null ? "" : n.toFixed(2));
      const rows = withReal.map((s) =>
        [
          s.symbol,
          s.points,
          s.startDate ?? "",
          s.endDate ?? "",
          f(s.returnPct),
          f(s.volatilityAnnPct),
          f(s.maxDrawdownPct),
          f(s.realReturnPct),
        ].join(","),
      );
      return rep.header("content-type", "text/csv").send([head, ...rows].join("\n"));
    }
    if (q.format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Painel de Análise Financeira";
      wb.title = "Relatório de Performance";
      const ws = wb.addWorksheet("Performance");
      ws.columns = [
        { header: "Symbol", key: "symbol", width: 12 },
        { header: "Points", key: "points", width: 10 },
        { header: "Start Date", key: "startDate", width: 14 },
        { header: "End Date", key: "endDate", width: 14 },
        { header: "Return %", key: "returnPct", width: 12 },
        { header: "Volatility %", key: "volatilityAnnPct", width: 14 },
        { header: "Max Drawdown %", key: "maxDrawdownPct", width: 16 },
        { header: "Real Return %", key: "realReturnPct", width: 14 },
      ];
      for (const s of withReal) {
        ws.addRow({
          symbol: s.symbol,
          points: s.points,
          startDate: s.startDate ?? "",
          endDate: s.endDate ?? "",
          returnPct: s.returnPct ?? null,
          volatilityAnnPct: s.volatilityAnnPct ?? null,
          maxDrawdownPct: s.maxDrawdownPct ?? null,
          realReturnPct: s.realReturnPct ?? null,
        });
      }
      const buf = await wb.xlsx.writeBuffer();
      return rep
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", 'attachment; filename="performance.xlsx"')
        .send(Buffer.from(buf));
    }
    if (q.format === "pdf") {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.fontSize(18).text("Relatório de Performance", { align: "center" });
      doc.fontSize(12).text(`Período: ${q.from} a ${q.to}`, { align: "center" });
      doc.moveDown();
      doc.fontSize(10);
      doc.text("Ativo", 50, doc.y, { continued: true });
      doc.text("Pontos", 150, doc.y, { continued: true });
      doc.text("Retorno %", 210, doc.y, { continued: true });
      doc.text("Vol. a.a. %", 280, doc.y, { continued: true });
      doc.text("Drawdown %", 360, doc.y);
      doc.moveDown(0.5);
      for (const s of withReal) {
        doc.text(s.symbol, 50, doc.y, { continued: true });
        doc.text(String(s.points), 150, doc.y, { continued: true });
        doc.text(s.returnPct?.toFixed(2) ?? "—", 210, doc.y, { continued: true });
        doc.text(s.volatilityAnnPct?.toFixed(2) ?? "—", 280, doc.y, { continued: true });
        doc.text(s.maxDrawdownPct?.toFixed(2) ?? "—", 360, doc.y);
        doc.moveDown(0.3);
      }
      doc.end();
      const pdfBuf = Buffer.concat(chunks);
      return rep
        .header("content-type", "application/pdf")
        .header("content-disposition", 'attachment; filename="performance.pdf"')
        .send(pdfBuf);
    }
    return { from: q.from, to: q.to, stats: withReal };
  });
}
