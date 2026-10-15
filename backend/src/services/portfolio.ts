/** Posição de carteira pelo método do preço médio ponderado.
 *
 * - Compras somam `quantidade × preço + taxas` ao custo; vendas consomem o
 *   custo pela média vigente (limitadas ao saldo; venda a descoberto é ignorada).
 * - Taxas de venda não alteram a base das ações remanescentes (só as de compra).
 * - `invested` = custo remanescente; P&L é sempre não realizado vs. preço atual.
 * - `allocationPct` pondera só posições com preço; totais de mercado/P&L
 *   consideram o investido das posições com preço.
 * - Preço atual = `close` (fallback `adjustedClose`) da barra mais recente,
 *   preferindo fonte BRAPI (mesma regra do comparativo).
 */
import { prisma } from "../db.js";
export interface TxLike {
  assetId: string;
  symbol: string;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  fees: number;
  tradedAt: Date;
}

export interface PriceLike {
  price: number | null;
  date: string | null;
}

export interface Position {
  assetId: string;
  symbol: string;
  quantity: number;
  avgPrice: number | null;
  invested: number;
  currentPrice: number | null;
  lastPriceDate: string | null;
  marketValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  allocationPct: number | null;
}

export interface PortfolioTotals {
  positions: Position[];
  totalInvested: number;
  totalMarketValue: number | null;
  totalPnl: number | null;
  totalPnlPct: number | null;
}

export function computePositions(txs: TxLike[], prices: Record<string, PriceLike | undefined>): Position[] {
  const acc = new Map<string, { symbol: string; qty: number; cost: number }>();
  for (const t of [...txs].sort((a, b) => +a.tradedAt - +b.tradedAt)) {
    if (!(t.quantity > 0) || !(t.unitPrice >= 0) || !(t.fees >= 0)) continue;
    let e = acc.get(t.assetId);
    if (!e) {
      e = { symbol: t.symbol, qty: 0, cost: 0 };
      acc.set(t.assetId, e);
    }
    if (t.type === "BUY") {
      e.cost += t.quantity * t.unitPrice + t.fees;
      e.qty += t.quantity;
    } else {
      if (e.qty <= 0) continue;
      const sold = Math.min(t.quantity, e.qty);
      e.cost -= (e.cost / e.qty) * sold; // consome pela média
      e.qty -= sold;
      if (e.qty === 0) e.cost = 0;
    }
  }
  const positions: Position[] = [...acc.entries()]
    .filter(([, e]) => e.qty > 0)
    .map(([assetId, e]) => {
      const avgPrice = e.qty > 0 ? e.cost / e.qty : null;
      const p = prices[assetId];
      const currentPrice = p?.price ?? null;
      const marketValue = currentPrice === null ? null : e.qty * currentPrice;
      const pnl = marketValue === null ? null : marketValue - e.cost;
      return {
        assetId,
        symbol: e.symbol,
        quantity: e.qty,
        avgPrice,
        invested: e.cost,
        currentPrice,
        lastPriceDate: p?.date ?? null,
        marketValue,
        pnl,
        pnlPct: pnl === null || e.cost === 0 ? null : (pnl / e.cost) * 100,
        allocationPct: null,
      };
    });
  const base = positions.reduce((a, p) => a + (p.marketValue ?? 0), 0);
  for (const p of positions)
    p.allocationPct = p.marketValue === null || base === 0 ? null : (p.marketValue / base) * 100;
  return positions.sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));
}

export function portfolioTotals(positions: Position[]): Omit<PortfolioTotals, "positions"> {
  const priced = positions.filter((p) => p.marketValue !== null);
  const totalInvested = positions.reduce((a, p) => a + p.invested, 0);
  const investedPriced = priced.reduce((a, p) => a + p.invested, 0);
  const totalMarketValue = priced.length ? priced.reduce((a, p) => a + p.marketValue!, 0) : null;
  const totalPnl = totalMarketValue === null ? null : totalMarketValue - investedPriced;
  return {
    totalInvested,
    totalMarketValue,
    totalPnl,
    totalPnlPct: totalPnl === null || investedPriced === 0 ? null : (totalPnl / investedPriced) * 100,
  };
}

/** Lê transações e últimas barras e devolve posição + totais (404 se a carteira não existir). */
export async function portfolioPosition(portfolioId: string): Promise<PortfolioTotals> {
  await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolioId } });
  const txs = await prisma.transaction.findMany({
    where: { portfolioId },
    orderBy: { tradedAt: "asc" },
    include: { asset: true },
  });
  const assetIds = [...new Set(txs.map((t) => t.assetId))];
  const bars = assetIds.length
    ? await prisma.priceBar.findMany({ where: { assetId: { in: assetIds } }, orderBy: { date: "desc" } })
    : [];
  const byAsset = new Map<string, typeof bars>();
  for (const b of bars) {
    const l = byAsset.get(b.assetId) ?? [];
    l.push(b);
    byAsset.set(b.assetId, l);
  }
  const prices: Record<string, PriceLike> = {};
  for (const [assetId, list] of byAsset) {
    const preferred = list.some((b) => b.source === "BRAPI")
      ? list.filter((b) => b.source === "BRAPI")
      : list;
    const latest = preferred[0]!; // orderBy date desc
    const close = latest.close === null ? null : Number(latest.close);
    const adj = latest.adjustedClose === null ? null : Number(latest.adjustedClose);
    prices[assetId] = { price: close ?? adj, date: latest.date.toISOString().slice(0, 10) };
  }
  const likes: TxLike[] = txs.map((t) => ({
    assetId: t.assetId,
    symbol: t.asset.symbol,
    type: t.type,
    quantity: Number(t.quantity),
    unitPrice: Number(t.unitPrice),
    fees: Number(t.fees),
    tradedAt: t.tradedAt,
  }));
  const positions = computePositions(likes, prices);
  return { positions, ...portfolioTotals(positions) };
}
