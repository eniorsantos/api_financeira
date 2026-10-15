import { describe, expect, it } from "vitest";
import {
  accumulateRates,
  accumulatedReturnPct,
  alignedReturns,
  beta,
  compare,
  correlation,
  correlationMatrix,
  dailyReturns,
  periodStats,
  realReturnPct,
  rebaseFactors,
  sharpeRatio,
} from "./analytics.js";

const d = (i: number) => new Date(Date.UTC(2026, 0, 1 + i));
const bars = (xs: (number | null)[]) => xs.map((c, i) => ({ date: d(i), close: c, adjustedClose: c }));

describe("analytics", () => {
  it("retorno, drawdown e ignora null", () => {
    const s = periodStats("A", bars([100, null, 110, 99, 120]));
    expect(s.points).toBe(4);
    expect(s.returnPct).toBeCloseTo(20);
    expect(s.maxDrawdownPct).toBeCloseTo(-10);
  });
  it("série curta retorna nulos", () => {
    expect(periodStats("A", bars([100])).returnPct).toBeNull();
  });
  it("ranking e base 100", () => {
    const r = compare({ A: bars([100, 110]), B: bars([50, 45]) });
    expect(r.ranking).toEqual(["A", "B"]);
    expect(r.rebased.B!.at(-1)!.value).toBeCloseTo(90);
  });

  it("acumula CDI ao dia e IPCA por observação", () => {
    const days = ["2026-01-05", "2026-01-06", "2026-01-07"].map((date) => ({ date, value: 0.05 }));
    const cdi = accumulateRates(days, "percentPerDay")!;
    expect(accumulatedReturnPct(cdi)).toBeCloseTo((1.0005 ** 3 - 1) * 100, 8);
    const ipca = accumulateRates(
      [
        { date: "2026-01-01", value: 0.5 },
        { date: "2026-02-01", value: 0.4 },
      ],
      "percent",
    )!;
    expect(accumulatedReturnPct(ipca)).toBeCloseTo(0.902, 5);
    expect(rebaseFactors(cdi)[0]!.value).toBe(100);
  });

  it("Selic anual vira equivalente diário; unidade desconhecida dá null", () => {
    const selic = accumulateRates([{ date: "2026-01-05", value: 14.75 }], "percentPerYear")!;
    expect(accumulatedReturnPct(selic)).toBeCloseTo((1.1475 ** (1 / 252) - 1) * 100, 8);
    expect(accumulateRates([{ date: "2026-01-05", value: 1 }], "pontos")).toBeNull();
    expect(accumulateRates([], "percent")).toBeNull();
  });

  it("retorno real deflaciona pelo IPCA", () => {
    expect(realReturnPct(10, 1.00902)).toBeCloseTo(9.0167, 3);
    expect(realReturnPct(null, 1.00902)).toBeNull();
    expect(realReturnPct(10, null)).toBeNull();
  });

  it("dailyReturns ignora null/zero", () => {
    const r = dailyReturns([100, null, 110, 0, 121]);
    expect(r).toHaveLength(2);
    r.forEach((x) => expect(x).toBeCloseTo(0.1, 10));
    expect(dailyReturns([100])).toEqual([]);
  });

  it("sharpe: positivo com prêmio, null sem variância ou dados", () => {
    const s = sharpeRatio([0.01, 0.02, -0.005, 0.015], null)!;
    expect(s).toBeGreaterThan(0);
    expect(sharpeRatio([0.01, 0.01, 0.01], null)).toBeNull();
    expect(sharpeRatio([0.01], null)).toBeNull();
    // risk-free maior que o retorno zera/inverte o prêmio
    expect(sharpeRatio([0.01, 0.02, -0.005, 0.015], 50)).toBeLessThan(s);
  });

  it("beta: série idêntica dá 1; bench constante dá null", () => {
    const r = [0.01, -0.02, 0.03];
    expect(beta(r, r)).toBeCloseTo(1, 10);
    expect(beta(r, [0.005, 0.005, 0.005])).toBeNull();
    expect(beta([0.01], [0.02])).toBeNull();
    expect(beta([0.01, 0.02], [0.01])).toBeNull(); // tamanhos diferentes
  });

  it("correlation: idêntica 1, inversa -1, sem variância null", () => {
    expect(correlation([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 10);
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it("alignedReturns usa interseção de datas; matriz é simétrica", () => {
    const px = (dates: string[], vals: (number | null)[]) =>
      dates.map((date, i) => ({ date, price: vals[i] ?? null }));
    const aligned = alignedReturns({
      A: px(["d1", "d2", "d3"], [100, 110, 121]),
      B: px(["d2", "d3", "d4"], [50, 55, 60.5]),
    });
    expect(aligned.A!).toHaveLength(1);
    expect(aligned.A![0]!).toBeCloseTo(0.1, 10); // só d2,d3 em comum → 1 retorno
    expect(aligned.B!).toHaveLength(1);
    const m = correlationMatrix({
      A: px(["d1", "d2", "d3"], [100, 110, 99]),
      B: px(["d1", "d2", "d3"], [50, 45, 49.5]),
    });
    expect(m.symbols).toEqual(["A", "B"]);
    expect(m.matrix[0]![0]).toBe(1);
    expect(m.matrix[0]![1]).toBeCloseTo(-1, 5);
    expect(m.matrix[1]![0]).toBe(m.matrix[0]![1]);
  });
});
