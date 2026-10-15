import { prisma } from "../db.js";
import { BrapiClient } from "../brapi/client.js";
import { BrapiError, BrapiNotFoundError } from "../brapi/errors.js";
import type { DividendsParams, FundNavParams, HistoricalParams, MacroParams } from "../brapi/schemas.js";
const brapi = new BrapiClient(process.env.BRAPI_CACHE === "0" ? { cache: false } : {});
const d = (unixSec: number) => new Date(unixSec * 1000);

async function log(
  operation: string,
  symbols: string[],
  status: "ok" | "error",
  httpStatus?: number,
  message?: string,
) {
  await prisma.syncLog.create({
    data: { operation, symbols, status, httpStatus: httpStatus ?? null, message: message ?? null },
  });
}

/** Atualiza cotações de todos os ativos source=BRAPI numa única chamada. */
export async function syncQuotes(symbols?: string[]) {
  const assets = await prisma.asset.findMany({
    where: { source: "BRAPI", active: true, ...(symbols ? { symbol: { in: symbols } } : {}) },
  });
  if (!assets.length) return { updated: 0, missing: [] as string[] };
  const syms = assets.map((a) => a.symbol);
  try {
    const res = await brapi.quote(syms);
    const bySym = new Map(assets.map((a) => [a.symbol, a]));
    let updated = 0;
    for (const r of res.results) {
      const asset = bySym.get(r.requestedSymbol);
      const q = r.data;
      if (!asset || q.regularMarketPrice === null) continue; // campos null: ignora snapshot incompleto
      await prisma.quoteSnapshot.create({
        data: {
          assetId: asset.id,
          price: q.regularMarketPrice,
          change: q.regularMarketChange,
          changePercent: q.regularMarketChangePercent,
          dayHigh: q.regularMarketDayHigh,
          dayLow: q.regularMarketDayLow,
          volume: q.regularMarketVolume === null ? null : BigInt(Math.round(q.regularMarketVolume)),
          marketCap: q.marketCap,
          quotedAt: q.regularMarketTime ? new Date(q.regularMarketTime) : new Date(),
          source: "BRAPI",
        },
      });
      if (q.logourl && !asset.logoUrl)
        await prisma.asset.update({ where: { id: asset.id }, data: { logoUrl: q.logourl } });
      updated++;
    }
    const got = new Set(res.results.map((r) => r.requestedSymbol));
    await log("stocks.quote", syms, "ok");
    return { updated, missing: syms.filter((s) => !got.has(s)) };
  } catch (e) {
    if (e instanceof BrapiNotFoundError) {
      await log("stocks.quote", syms, "error", 404, e.message);
      return { updated: 0, missing: syms };
    }
    if (e instanceof BrapiError) await log("stocks.quote", syms, "error", e.status, e.message);
    throw e;
  }
}

/** Baixa histórico (upsert idempotente por assetId+date+source; só ativos ativos). */
export async function syncHistory(symbols: string[], params: HistoricalParams) {
  const assets = await prisma.asset.findMany({
    where: { symbol: { in: symbols }, source: "BRAPI", active: true },
  });
  if (!assets.length) return { rows: 0 }; // nada registrado como BRAPI: não consome quota
  const bySym = new Map(assets.map((a) => [a.symbol, a]));
  try {
    const res = await brapi.historical([...bySym.keys()], params);
    const rows: {
      assetId: string;
      date: Date;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
      adjustedClose: number | null;
      volume: bigint | null;
    }[] = [];
    for (const r of res.results) {
      const asset = bySym.get(r.requestedSymbol);
      if (!asset) continue;
      for (const p of r.data.historicalDataPrice) {
        rows.push({
          assetId: asset.id,
          date: d(p.date),
          open: p.open,
          high: p.high,
          low: p.low,
          close: p.close,
          adjustedClose: p.adjustedClose,
          volume: p.volume === null ? null : BigInt(Math.round(p.volume)),
        });
      }
    }
    // upserts em lotes de 100 numa única transação (evita N round-trips)
    for (let i = 0; i < rows.length; i += 100) {
      const slice = rows.slice(i, i + 100);
      await prisma.$transaction(
        slice.map((b) =>
          prisma.priceBar.upsert({
            where: { assetId_date_source: { assetId: b.assetId, date: b.date, source: "BRAPI" } },
            create: {
              assetId: b.assetId,
              date: b.date,
              source: "BRAPI",
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
              adjustedClose: b.adjustedClose,
              volume: b.volume,
            },
            update: {
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
              adjustedClose: b.adjustedClose,
              volume: b.volume,
            },
          }),
        ),
      );
    }
    await log("stocks.historical", symbols, "ok");
    return { rows: rows.length };
  } catch (e) {
    if (e instanceof BrapiError) await log("stocks.historical", symbols, "error", e.status, e.message);
    throw e;
  }
}

type DivKind = "DIVIDEND" | "JCP" | "RENDIMENTO" | "AMORTIZACAO" | "OTHER";
interface DivRow {
  assetId: string;
  kind: DivKind;
  amountPerUnit: number;
  exDate: Date | null;
  paymentDate: Date;
}

/** Normaliza um provento em dinheiro; null = inválido (conta como `skipped`). */
function cashRow(
  assetId: string,
  label: string | null,
  rate: number | null,
  exDate: string | null,
  paymentDate: string | null,
): DivRow | null {
  const pay = paymentDate ? new Date(paymentDate) : null;
  if (pay === null || Number.isNaN(+pay) || rate === null || !(rate > 0)) return null;
  const ex = exDate ? new Date(exDate) : null;
  const kind: DivKind =
    label === "JCP"
      ? "JCP"
      : label === "DIVIDENDO"
        ? "DIVIDEND"
        : label === "RENDIMENTO"
          ? "RENDIMENTO"
          : label === "AMORTIZAÇÃO" || label === "AMORTIZACAO"
            ? "AMORTIZACAO"
            : "OTHER";
  return {
    assetId,
    kind,
    amountPerUnit: rate,
    exDate: ex !== null && !Number.isNaN(+ex) ? ex : null,
    paymentDate: pay,
  };
}

async function upsertDividends(rows: DivRow[], userId: string) {
  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100);
    await prisma.$transaction(
      slice.map((b) =>
        prisma.dividend.upsert({
          where: {
            assetId_paymentDate_kind_amountPerUnit: {
              assetId: b.assetId,
              paymentDate: b.paymentDate,
              kind: b.kind,
              amountPerUnit: b.amountPerUnit,
            },
          },
          create: {
            assetId: b.assetId,
            userId,
            kind: b.kind,
            amountPerUnit: b.amountPerUnit,
            exDate: b.exDate,
            paymentDate: b.paymentDate,
            source: "BRAPI",
          },
          update: { exDate: b.exDate, source: "BRAPI" },
        }),
      ),
    );
  }
}

/** Baixa proventos em dinheiro (ações via `stocks/dividends`, FIIs via `fii/dividends`,
 * fundos via `funds/dividends`).
 * Só cash com paymentDate e rate válidos entram; o resto conta como `skipped`.
 * Upsert idempotente por (assetId, paymentDate, kind, amountPerUnit), fonte BRAPI. */
export async function syncDividends(symbols: string[], params: DividendsParams = {}, userId?: string) {
  const assets = await prisma.asset.findMany({
    where: { symbol: { in: symbols }, source: "BRAPI", active: true },
  });
  if (!assets.length) return { rows: 0, skipped: 0 }; // nada registrado como BRAPI: não consome quota
  const bySym = new Map(assets.map((a) => [a.symbol, a]));
  const rows: DivRow[] = [];
  let skipped = 0;
  const stocks = assets.filter((a) => a.assetClass === "STOCK");
  const fiis = assets.filter((a) => a.assetClass === "FII");
  const funds = assets.filter((a) => a.assetClass === "FUND");
  try {
    if (stocks.length) {
      const res = await brapi.dividends(
        stocks.map((a) => a.symbol),
        params,
      );
      for (const r of res.results) {
        const asset = bySym.get(r.requestedSymbol);
        if (!asset) continue;
        for (const d of r.data.cashDividends) {
          const row = cashRow(asset.id, d.label, d.rate, d.exDate, d.paymentDate);
          if (row) rows.push(row);
          else skipped++;
        }
      }
      await log(
        "stocks.dividends",
        stocks.map((a) => a.symbol),
        "ok",
      );
    }
  } catch (e) {
    if (e instanceof BrapiError)
      await log(
        "stocks.dividends",
        stocks.map((a) => a.symbol),
        "error",
        e.status,
        e.message,
      );
    throw e;
  }
  try {
    if (fiis.length) {
      const res = await brapi.fiiDividends(
        fiis.map((a) => a.symbol),
        params,
      );
      for (const d of res.dividends) {
        const asset = bySym.get(d.symbol.trim().toUpperCase());
        if (!asset) continue;
        const row = cashRow(asset.id, d.label, d.rate, d.exDate, d.paymentDate);
        if (row) rows.push(row);
        else skipped++;
      }
      await log(
        "fii.dividends",
        fiis.map((a) => a.symbol),
        "ok",
      );
    }
  } catch (e) {
    if (e instanceof BrapiError)
      await log(
        "fii.dividends",
        fiis.map((a) => a.symbol),
        "error",
        e.status,
        e.message,
      );
    throw e;
  }
  try {
    if (funds.length) {
      const res = await brapi.fundsDividends(
        funds.map((a) => a.symbol),
        params,
      );
      for (const d of res.dividends) {
        const asset = d.symbol ? bySym.get(d.symbol.trim().toUpperCase()) : undefined;
        if (!asset) continue;
        const row = cashRow(asset.id, d.label, d.rate, d.exDate, d.paymentDate);
        if (row) rows.push(row);
        else skipped++;
      }
      await log(
        "funds.dividends",
        funds.map((a) => a.symbol),
        "ok",
      );
    }
  } catch (e) {
    if (e instanceof BrapiError)
      await log(
        "funds.dividends",
        funds.map((a) => a.symbol),
        "error",
        e.status,
        e.message,
      );
    throw e;
  }
  await upsertDividends(rows, userId ?? "");
  return { rows: rows.length, skipped };
}

interface FiiRow {
  assetId: string;
  referenceDate: Date;
  price: number | null;
  navPerShare: number | null;
  priceToNav: number | null;
  dy12m: number | null;
  dy1m: number | null;
  monthlyReturn: number | null;
  totalInvestors: bigint | null;
  shares: bigint | null;
  equity: number | null;
  segment: string | null;
}

function indicatorRow(
  assetId: string,
  referenceDate: Date,
  f: {
    price: number | null;
    navPerShare: number | null;
    priceToNav: number | null;
    dividendYield12m: number | null;
    dividendYield1m: number | null;
    monthlyReturn: number | null;
    totalInvestors: number | null;
    sharesOutstanding: number | null;
    equity: number | null;
    segmentType: string | null;
  },
): FiiRow {
  const big = (v: number | null) => (v === null || !Number.isFinite(v) ? null : BigInt(Math.round(v)));
  return {
    assetId,
    referenceDate,
    price: f.price,
    navPerShare: f.navPerShare,
    priceToNav: f.priceToNav,
    dy12m: f.dividendYield12m,
    dy1m: f.dividendYield1m,
    monthlyReturn: f.monthlyReturn,
    totalInvestors: big(f.totalInvestors),
    shares: big(f.sharesOutstanding),
    equity: f.equity,
    segment: f.segmentType,
  };
}

/** Baixa indicadores de FIIs: série mensal (`history`) + snapshot atual (vira o ponto
 * mais recente). Upsert por (assetId, referenceDate); linhas sem data válida contam como `skipped`. */
export async function syncIndicators(symbols: string[], params: DividendsParams = {}) {
  const assets = await prisma.asset.findMany({
    where: { symbol: { in: symbols }, source: "BRAPI", active: true, assetClass: "FII" },
  });
  if (!assets.length) return { rows: 0, skipped: 0 };
  const bySym = new Map(assets.map((a) => [a.symbol, a]));
  try {
    const res = await brapi.fiiIndicatorsHistory(
      assets.map((a) => a.symbol),
      params,
    );
    const rows: FiiRow[] = [];
    let skipped = 0;
    for (const e of res.history) {
      const asset = bySym.get(e.symbol.trim().toUpperCase());
      const ref = e.referenceDate ? new Date(e.referenceDate) : null;
      if (!asset || ref === null || Number.isNaN(+ref)) {
        skipped++;
        continue;
      }
      rows.push(indicatorRow(asset.id, ref, e));
    }
    // Snapshot atual entra como ponto mais recente (mesma tabela).
    try {
      const snap = await brapi.fiiIndicators(assets.map((a) => a.symbol));
      for (const s of snap.fiis) {
        const asset = bySym.get(s.symbol.trim().toUpperCase());
        const ref = s.asOfDate ? new Date(s.asOfDate) : null;
        if (!asset || ref === null || Number.isNaN(+ref)) {
          skipped++;
          continue;
        }
        rows.push(indicatorRow(asset.id, ref, s));
      }
      await log(
        "fii.indicators",
        assets.map((a) => a.symbol),
        "ok",
      );
    } catch (e) {
      if (e instanceof BrapiError)
        await log(
          "fii.indicators",
          assets.map((a) => a.symbol),
          "error",
          e.status,
          e.message,
        );
      throw e;
    }
    for (let i = 0; i < rows.length; i += 100) {
      const slice = rows.slice(i, i + 100);
      await prisma.$transaction(
        slice.map((b) =>
          prisma.fiiIndicator.upsert({
            where: { assetId_referenceDate: { assetId: b.assetId, referenceDate: b.referenceDate } },
            create: { ...b, source: "BRAPI" },
            update: { ...b, source: "BRAPI" },
          }),
        ),
      );
    }
    await log(
      "fii.indicators.history",
      assets.map((a) => a.symbol),
      "ok",
    );
    return { rows: rows.length, skipped };
  } catch (e) {
    if (e instanceof BrapiError)
      await log(
        "fii.indicators.history",
        assets.map((a) => a.symbol),
        "error",
        e.status,
        e.message,
      );
    throw e;
  }
}

/** Baixa séries macroeconômicas (selic, cdi, ipca...). Upsert por (slug, data). */
export async function syncMacro(slugs: string[], params: MacroParams = {}) {
  const clean = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (!clean.length) return { rows: 0, skipped: 0 };
  try {
    const res = await brapi.macro(clean, params);
    const rows: { slug: string; date: Date; value: number; unit: string | null }[] = [];
    let skipped = 0;
    for (const r of res.results) {
      const slug = r.series.slug.trim().toLowerCase();
      const unit = r.series.unit;
      for (const o of r.observations) {
        const date = new Date(o.date);
        if (Number.isNaN(+date) || o.value === null || !Number.isFinite(o.value)) {
          skipped++;
          continue;
        }
        rows.push({ slug, date, value: o.value, unit });
      }
    }
    for (let i = 0; i < rows.length; i += 100) {
      const slice = rows.slice(i, i + 100);
      await prisma.$transaction(
        slice.map((b) =>
          prisma.macroPoint.upsert({
            where: { slug_date: { slug: b.slug, date: b.date } },
            create: { slug: b.slug, date: b.date, value: b.value, unit: b.unit },
            update: { value: b.value, unit: b.unit },
          }),
        ),
      );
    }
    await log("macro", clean, "ok");
    return { rows: rows.length, skipped };
  } catch (e) {
    if (e instanceof BrapiError) await log("macro", clean, "error", e.status, e.message);
    throw e;
  }
}

/** Sincroniza tudo dos ativos BRAPI ativos (cotações + histórico + proventos).
 * Falha numa etapa não aborta as demais (cada sync já registra seu SyncLog). */
export async function syncAll(historyRange = "1mo", userId?: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const steps: [string, () => Promise<unknown>][] = [
    ["quotes", () => syncQuotes()],
    [
      "history",
      async () => {
        const assets = await prisma.asset.findMany({
          where: { source: "BRAPI", active: true, assetClass: { in: ["STOCK", "FII"] }, ...(userId ? { userId } : {}) },
        });
        return assets.length
          ? syncHistory(
              assets.map((a) => a.symbol),
              { range: historyRange, interval: "1d" },
            )
          : { rows: 0 };
      },
    ],
    [
      "dividends",
      async () => {
        const assets = await prisma.asset.findMany({ where: { source: "BRAPI", active: true, ...(userId ? { userId } : {}) } });
        return assets.length ? syncDividends(assets.map((a) => a.symbol), {}, userId) : { rows: 0, skipped: 0 };
      },
    ],
  ];
  for (const [name, fn] of steps) {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

/** Baixa a cota patrimonial de fundos (FUND) e grava como PriceBar (close = NAV).
 * Casa por `symbol` (fundo sem ticker vem com `symbol` null e é ignorado). */
export async function syncFunds(symbols: string[], params: FundNavParams = {}) {
  const assets = await prisma.asset.findMany({
    where: { symbol: { in: symbols }, source: "BRAPI", active: true, assetClass: "FUND" },
  });
  if (!assets.length) return { rows: 0, skipped: 0 };
  const bySym = new Map(assets.map((a) => [a.symbol, a]));
  try {
    const res = await brapi.fundsNavHistory(
      assets.map((a) => a.symbol),
      params,
    );
    const rows: { assetId: string; date: Date; close: number }[] = [];
    let skipped = 0;
    for (const h of res.history) {
      const asset = h.symbol ? bySym.get(h.symbol.trim().toUpperCase()) : undefined;
      const date = h.date ? new Date(h.date) : null;
      if (!asset || date === null || Number.isNaN(+date) || h.navPerShare === null || !(h.navPerShare > 0)) {
        skipped++;
        continue;
      }
      rows.push({ assetId: asset.id, date, close: h.navPerShare });
    }
    for (let i = 0; i < rows.length; i += 100) {
      const slice = rows.slice(i, i + 100);
      await prisma.$transaction(
        slice.map((b) =>
          prisma.priceBar.upsert({
            where: { assetId_date_source: { assetId: b.assetId, date: b.date, source: "BRAPI" } },
            create: {
              assetId: b.assetId,
              date: b.date,
              source: "BRAPI",
              open: b.close,
              high: b.close,
              low: b.close,
              close: b.close,
              adjustedClose: b.close,
              volume: null,
            },
            update: {
              open: b.close,
              high: b.close,
              low: b.close,
              close: b.close,
              adjustedClose: b.close,
            },
          }),
        ),
      );
    }
    await log(
      "funds.nav.history",
      assets.map((a) => a.symbol),
      "ok",
    );
    return { rows: rows.length, skipped };
  } catch (e) {
    if (e instanceof BrapiError)
      await log(
        "funds.nav.history",
        assets.map((a) => a.symbol),
        "error",
        e.status,
        e.message,
      );
    throw e;
  }
}

/** Baixa o snapshot de indicadores de fundos (preço, cota, ágio/deságio). 1 linha por ativo. */
export async function syncFundIndicators(symbols: string[]) {
  const assets = await prisma.asset.findMany({
    where: { symbol: { in: symbols }, source: "BRAPI", active: true, assetClass: "FUND" },
  });
  if (!assets.length) return { rows: 0, skipped: 0 };
  const bySym = new Map(assets.map((a) => [a.symbol, a]));
  try {
    const res = await brapi.fundsIndicators(assets.map((a) => a.symbol));
    let rows = 0;
    let skipped = 0;
    for (const f of res.funds) {
      const asset = f.symbol ? bySym.get(f.symbol.trim().toUpperCase()) : undefined;
      if (!asset) {
        skipped++;
        continue;
      }
      const asOf = f.asOfDate ? new Date(f.asOfDate) : null;
      await prisma.fundIndicator.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          asOfDate: asOf !== null && !Number.isNaN(+asOf) ? asOf : null,
          price: f.price,
          navPerShare: f.navPerShare,
          priceToNav: f.priceToNav,
          equity: f.equity,
          totalInvestors:
            f.totalInvestors === null || !Number.isFinite(f.totalInvestors)
              ? null
              : BigInt(Math.round(f.totalInvestors)),
          monthlyReturn: f.monthlyReturn,
          dyMonthly: f.dividendYieldMonthly,
          source: "BRAPI",
        },
        update: {
          asOfDate: asOf !== null && !Number.isNaN(+asOf) ? asOf : null,
          price: f.price,
          navPerShare: f.navPerShare,
          priceToNav: f.priceToNav,
          equity: f.equity,
          totalInvestors:
            f.totalInvestors === null || !Number.isFinite(f.totalInvestors)
              ? null
              : BigInt(Math.round(f.totalInvestors)),
          monthlyReturn: f.monthlyReturn,
          dyMonthly: f.dividendYieldMonthly,
          source: "BRAPI",
        },
      });
      rows++;
    }
    await log(
      "funds.indicators",
      assets.map((a) => a.symbol),
      "ok",
    );
    return { rows, skipped };
  } catch (e) {
    if (e instanceof BrapiError)
      await log(
        "funds.indicators",
        assets.map((a) => a.symbol),
        "error",
        e.status,
        e.message,
      );
    throw e;
  }
}

/** Baixa o PU diário do Tesouro Direto e grava como PriceBar (close = PU de venda).
 * Slugs são minúsculos na brapi; casa sem diferenciar maiúsculas. */
export async function syncTreasury(symbols: string[], params: DividendsParams = {}) {
  const assets = await prisma.asset.findMany({
    where: { symbol: { in: symbols }, source: "BRAPI", active: true, assetClass: "TREASURY" },
  });
  if (!assets.length) return { rows: 0, skipped: 0 };
  const bySlug = new Map(assets.map((a) => [a.symbol.toLowerCase(), a]));
  try {
    const res = await brapi.treasuryHistory(
      assets.map((a) => a.symbol.toLowerCase()),
      params,
    );
    const rows: { assetId: string; date: Date; close: number }[] = [];
    let skipped = 0;
    for (const r of res.results) {
      const asset = bySlug.get(r.symbol.trim().toLowerCase());
      if (!asset) {
        skipped += r.history.length;
        continue;
      }
      for (const h of r.history) {
        const date = h.baseDate ? new Date(h.baseDate) : null;
        const pu = h.sellPrice ?? h.basePrice ?? h.buyPrice;
        if (date === null || Number.isNaN(+date) || pu === null || !(pu > 0)) {
          skipped++;
          continue;
        }
        rows.push({ assetId: asset.id, date, close: pu });
      }
    }
    for (let i = 0; i < rows.length; i += 100) {
      const slice = rows.slice(i, i + 100);
      await prisma.$transaction(
        slice.map((b) =>
          prisma.priceBar.upsert({
            where: { assetId_date_source: { assetId: b.assetId, date: b.date, source: "BRAPI" } },
            create: {
              assetId: b.assetId,
              date: b.date,
              source: "BRAPI",
              open: b.close,
              high: b.close,
              low: b.close,
              close: b.close,
              adjustedClose: b.close,
              volume: null,
            },
            update: {
              open: b.close,
              high: b.close,
              low: b.close,
              close: b.close,
              adjustedClose: b.close,
            },
          }),
        ),
      );
    }
    await log(
      "treasury.indicators.history",
      assets.map((a) => a.symbol),
      "ok",
    );
    return { rows: rows.length, skipped };
  } catch (e) {
    if (e instanceof BrapiError)
      await log(
        "treasury.indicators.history",
        assets.map((a) => a.symbol),
        "error",
        e.status,
        e.message,
      );
    throw e;
  }
}
