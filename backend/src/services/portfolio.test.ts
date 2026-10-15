import { describe, expect, it } from "vitest";
import { computePositions, portfolioTotals, type TxLike } from "./portfolio.js";

const D = (s: string) => new Date(`${s}T12:00:00Z`);
const buy = (
  assetId: string,
  quantity: number,
  unitPrice: number,
  fees = 0,
  tradedAt = "2026-01-05",
): TxLike => ({ assetId, symbol: assetId, type: "BUY", quantity, unitPrice, fees, tradedAt: D(tradedAt) });
const sell = (assetId: string, quantity: number, unitPrice = 0, tradedAt = "2026-02-05"): TxLike => ({
  assetId,
  symbol: assetId,
  type: "SELL",
  quantity,
  unitPrice,
  fees: 0,
  tradedAt: D(tradedAt),
});

describe("portfolio", () => {
  it("preço médio com taxas e venda parcial", () => {
    const txs = [buy("A", 10, 100, 10), buy("A", 10, 200), sell("A", 5, 250)];
    const [p] = computePositions(txs, { A: { price: 220, date: "2026-03-01" } });
    expect(p!.quantity).toBe(15);
    expect(p!.avgPrice).toBeCloseTo((10 * 100 + 10 + 10 * 200 - (3010 / 20) * 5) / 15, 10);
    expect(p!.invested).toBeCloseTo(3010 - (3010 / 20) * 5, 10);
    expect(p!.marketValue).toBe(15 * 220);
    expect(p!.pnl).toBeCloseTo(15 * 220 - p!.invested, 10);
  });

  it("venda maior que o saldo limita ao saldo", () => {
    const [p] = computePositions([buy("A", 10, 100), sell("A", 99)], {});
    expect(p).toBeUndefined(); // zerou: fora da posição
  });

  it("venda sem saldo é ignorada", () => {
    expect(computePositions([sell("A", 5)], {})).toEqual([]);
  });

  it("alocação pondera só posições com preço; sem preço tudo null", () => {
    const ps = computePositions([buy("A", 10, 100), buy("B", 10, 100)], {
      A: { price: 300, date: "2026-03-01" },
      B: { price: null, date: null },
    });
    const a = ps.find((p) => p.assetId === "A")!;
    const b = ps.find((b2) => b2.assetId === "B")!;
    expect(a.allocationPct).toBe(100);
    expect(b.marketValue).toBeNull();
    expect(b.allocationPct).toBeNull();
    expect(b.avgPrice).toBe(100);
    const t = portfolioTotals(ps);
    expect(t.totalInvested).toBe(2000);
    expect(t.totalMarketValue).toBe(3000);
    expect(t.totalPnl).toBe(2000); // só a parte com preço
  });

  it("carteira vazia zera totais", () => {
    const t = portfolioTotals(computePositions([], {}));
    expect(t).toEqual({ totalInvested: 0, totalMarketValue: null, totalPnl: null, totalPnlPct: null });
  });
});
