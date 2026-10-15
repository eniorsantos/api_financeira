export interface Bar {
  date: Date;
  close: number | null;
  adjustedClose: number | null;
}

export interface PeriodStats {
  symbol: string;
  points: number;
  startDate: string | null;
  endDate: string | null;
  returnPct: number | null; // retorno do período (adjustedClose, senão close)
  volatilityAnnPct: number | null; // desvio-padrão dos retornos diários * sqrt(252)
  maxDrawdownPct: number | null;
  realReturnPct: number | null; // retorno deflacionado (preenchido pelas rotas com IPCA)
  sharpe: number | null; // Sharpe anualizado (preenchido pelas rotas com risk-free)
  beta: number | null; // beta vs benchmark (preenchido pelas rotas)
  best: { date: string; pct: number } | null;
  worst: { date: string; pct: number } | null;
}

const px = (b: Bar) => b.adjustedClose ?? b.close; // null-safe

export function periodStats(symbol: string, bars: Bar[]): PeriodStats {
  const s = bars.filter((b) => px(b) !== null).sort((a, b) => +a.date - +b.date);
  const empty: PeriodStats = {
    symbol,
    points: s.length,
    startDate: null,
    endDate: null,
    returnPct: null,
    volatilityAnnPct: null,
    maxDrawdownPct: null,
    realReturnPct: null,
    sharpe: null,
    beta: null,
    best: null,
    worst: null,
  };
  if (s.length < 2) return empty;

  const prices = s.map((b) => px(b)!);
  const rets: { date: string; r: number }[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    if (prev > 0) rets.push({ date: s[i]!.date.toISOString().slice(0, 10), r: prices[i]! / prev - 1 });
  }
  const mean = rets.reduce((a, x) => a + x.r, 0) / (rets.length || 1);
  const variance = rets.length > 1 ? rets.reduce((a, x) => a + (x.r - mean) ** 2, 0) / (rets.length - 1) : 0;

  let peak = prices[0]!,
    mdd = 0;
  for (const p of prices) {
    peak = Math.max(peak, p);
    mdd = Math.min(mdd, p / peak - 1);
  }

  const sorted = [...rets].sort((a, b) => a.r - b.r);
  const first = prices[0]!,
    last = prices.at(-1)!;
  return {
    symbol,
    points: s.length,
    startDate: s[0]!.date.toISOString().slice(0, 10),
    endDate: s.at(-1)!.date.toISOString().slice(0, 10),
    returnPct: (last / first - 1) * 100,
    volatilityAnnPct: Math.sqrt(variance) * Math.sqrt(252) * 100,
    maxDrawdownPct: mdd * 100,
    realReturnPct: null, // preenchido pelas rotas (precisa do IPCA)
    sharpe: null, // preenchido pelas rotas (precisa do risk-free)
    beta: null, // preenchido pelas rotas (precisa do benchmark)
    best: sorted.length ? { date: sorted.at(-1)!.date, pct: sorted.at(-1)!.r * 100 } : null,
    worst: sorted.length ? { date: sorted[0]!.date, pct: sorted[0]!.r * 100 } : null,
  };
}

/** Série normalizada em base 100 para comparar ativos no mesmo gráfico. */
export function rebaseTo100(bars: Bar[]): { date: string; value: number }[] {
  const s = bars.filter((b) => px(b) !== null).sort((a, b) => +a.date - +b.date);
  if (!s.length) return [];
  const base = px(s[0]!)!;
  return s.map((b) => ({ date: b.date.toISOString().slice(0, 10), value: (px(b)! / base) * 100 }));
}

export function compare(series: Record<string, Bar[]>) {
  const stats = Object.entries(series).map(([sym, bars]) => periodStats(sym, bars));
  const ranking = [...stats].filter((x) => x.returnPct !== null).sort((a, b) => b.returnPct! - a.returnPct!);
  return {
    stats,
    ranking: ranking.map((x) => x.symbol),
    rebased: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, rebaseTo100(v)])),
  };
}

/** Fator acumulado de taxas por unidade da série:
 * - `percentPerDay` (CDI): compõe ao dia;
 * - `percentPerYear` (Selic): equivalente diário em 252 dias úteis;
 * - `percent` (IPCA mensal): compõe por observação.
 * Unidade desconhecida ou sem pontos válidos → null. */
export interface RatePoint {
  date: string;
  value: number | null;
}

export function accumulateRates(
  points: RatePoint[],
  unit: string | null,
): { date: string; factor: number }[] | null {
  const valid = points
    .filter((p) => p.value !== null && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!valid.length) return null;
  let f = 1;
  const out: { date: string; factor: number }[] = [];
  for (const p of valid) {
    const v = p.value as number;
    let step: number;
    if (unit === "percentPerDay") step = v / 100;
    else if (unit === "percentPerYear") step = Math.pow(1 + v / 100, 1 / 252) - 1;
    else if (unit === "percent") step = v / 100;
    else return null;
    f *= 1 + step;
    if (!Number.isFinite(f)) return null;
    out.push({ date: p.date, factor: f });
  }
  return out;
}

export function accumulatedReturnPct(acc: { factor: number }[] | null): number | null {
  if (!acc || !acc.length) return null;
  return (acc[acc.length - 1]!.factor - 1) * 100;
}

/** Retorno real: nominal deflacionado pelo fator acumulado do IPCA. */
export function realReturnPct(nominalPct: number | null, ipcaFactor: number | null): number | null {
  if (nominalPct === null || ipcaFactor === null || ipcaFactor <= 0) return null;
  return ((1 + nominalPct / 100) / ipcaFactor - 1) * 100;
}

/** Fatores acumulados em base 100 para o gráfico. */
export function rebaseFactors(acc: { date: string; factor: number }[]): { date: string; value: number }[] {
  if (!acc.length) return [];
  const base = acc[0]!.factor;
  if (base === 0) return [];
  return acc.map((p) => ({ date: p.date, value: (p.factor / base) * 100 }));
}

/** Retornos diários simples de uma série de preços (ignora null/≤0). */
export function dailyReturns(prices: (number | null)[]): number[] {
  const valid = prices.filter((p): p is number => p !== null && p > 0);
  const out: number[] = [];
  for (let i = 1; i < valid.length; i++) out.push(valid[i]! / valid[i - 1]! - 1);
  return out;
}

/** Sharpe anualizado sobre retornos diários. Sem risk-free usa retorno bruto. */
export function sharpeRatio(rets: number[], riskFreeAnnualPct: number | null): number | null {
  if (rets.length < 2) return null;
  const rf = riskFreeAnnualPct === null ? 0 : Math.pow(1 + riskFreeAnnualPct / 100, 1 / 252) - 1;
  const ex = rets.map((r) => r - rf);
  const mean = ex.reduce((a, x) => a + x, 0) / ex.length;
  const variance = ex.reduce((a, x) => a + (x - mean) ** 2, 0) / (ex.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0 || !Number.isFinite(sd)) return null;
  return (mean / sd) * Math.sqrt(252);
}

/** Beta = Cov(ativo, bench) / Var(bench). Séries já alinhadas (mesmo tamanho). */
export function beta(stock: number[], bench: number[]): number | null {
  if (stock.length !== bench.length || stock.length < 2) return null;
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const ms = mean(stock);
  const mb = mean(bench);
  let cov = 0;
  let vb = 0;
  for (let i = 0; i < stock.length; i++) {
    cov += (stock[i]! - ms) * (bench[i]! - mb);
    vb += (bench[i]! - mb) ** 2;
  }
  if (vb === 0) return null;
  return cov / vb;
}

/** Correlação de Pearson entre duas séries alinhadas. */
export function correlation(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let cab = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    cab += (a[i]! - ma) * (b[i]! - mb);
    va += (a[i]! - ma) ** 2;
    vb += (b[i]! - mb) ** 2;
  }
  if (va === 0 || vb === 0) return null;
  return cab / Math.sqrt(va * vb);
}

/** Retornos diários de cada série restritos às datas em comum (interseção, ordenada). */
export function alignedReturns(
  series: Record<string, { date: string; price: number | null }[]>,
): Record<string, number[]> {
  const byDate = new Map<string, Map<string, number>>();
  for (const [sym, pts] of Object.entries(series)) {
    for (const p of pts) {
      if (p.price === null || !(p.price > 0)) continue;
      const m = byDate.get(p.date) ?? new Map<string, number>();
      m.set(sym, p.price);
      byDate.set(p.date, m);
    }
  }
  const syms = Object.keys(series);
  const common = [...byDate.entries()]
    .filter(([, m]) => syms.every((s) => m.has(s)))
    .map(([d]) => d)
    .sort();
  const out: Record<string, number[]> = Object.fromEntries(syms.map((s) => [s, []]));
  const prev: Record<string, number> = {};
  for (const d of common) {
    const m = byDate.get(d)!;
    for (const s of syms) {
      const px = m.get(s)!;
      if (prev[s] !== undefined) out[s]!.push(px / prev[s]! - 1);
      prev[s] = px;
    }
  }
  return out;
}

/** Matriz de correlação (Pearson) entre símbolos; null com < 2 retornos comuns. */
export function correlationMatrix(series: Record<string, { date: string; price: number | null }[]>): {
  symbols: string[];
  matrix: (number | null)[][];
  commonPoints: number[][];
} {
  const symbols = Object.keys(series);
  const aligned = alignedReturns(series);
  const matrix = symbols.map((a) =>
    symbols.map((b) => {
      if (a === b) return aligned[a]!.length >= 1 ? 1 : null;
      return correlation(aligned[a]!, aligned[b]!);
    }),
  );
  const commonPoints = symbols.map((a) =>
    symbols.map((b) =>
      a === b ? aligned[a]!.length + 1 : Math.min(aligned[a]!.length, aligned[b]!.length) + 1,
    ),
  );
  return { symbols, matrix, commonPoints };
}
