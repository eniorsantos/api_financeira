import { describe, expect, it } from "vitest";
import { dateRange, holdingsValue, type HoldingTx } from "./patrimonio.js";

const tx = (assetId: string, type: "BUY" | "SELL", quantity: number, tradedAt: string): HoldingTx =>
  ({ assetId, symbol: assetId, type, quantity, tradedAt });

describe("patrimonio", () => {
  it("avalia quantidade × preço com carry-forward", () => {
    const txs = [tx("A", "BUY", 10, "2026-01-05"), tx("A", "SELL", 4, "2026-01-07")];
    const prices: Record<string, [string, number][]> = { A: [["2026-01-05", 100], ["2026-01-08", 110]] };
    const priceAt = (id: string, date: string) => {
      const hist = (prices[id] ?? []).filter(([d]) => d <= date);
      return hist.length ? hist[hist.length - 1]![1] : null;
    };
    const pts = holdingsValue(txs, ["2026-01-04", "2026-01-05", "2026-01-07", "2026-01-08"], priceAt);
    expect(pts.map((p) => p.total)).toEqual([0, 1000, 600, 660]);
    expect(pts[2]!.byAsset).toEqual({ A: 600 });
  });

  it("sem preço até a data zera o dia; venda além do saldo trava", () => {
    const txs = [tx("A", "BUY", 5, "2026-01-05"), tx("A", "SELL", 99, "2026-01-06")];
    const pts = holdingsValue(txs, ["2026-01-05", "2026-01-06"], () => null);
    expect(pts.map((p) => p.total)).toEqual([null, 0]);
    const pts2 = holdingsValue(txs, ["2026-01-06"], () => 10);
    expect(pts2[0]!.total).toBe(0); // zerou: soma vazia mas precificada
  });

  it("dateRange limita e valida", () => {
    expect(dateRange("2026-01-01", "2026-01-03")).toEqual({ dates: ["2026-01-01", "2026-01-02", "2026-01-03"], truncated: false });
    expect(dateRange("2026-01-03", "2026-01-01").dates).toEqual([]);
    expect(dateRange("2026-01-01", "2028-01-01", 10)).toEqual({ dates: expect.any(Array), truncated: true });
  });
});
