/** Evolução patrimonial: carteira avaliada a mercado ao longo do tempo.
 *
 * - Quantidades vêm das transações (venda limitada ao saldo, como em `portfolio.ts`).
 * - `priceAt(assetId, date)` = preço da barra mais recente **até** a data (carry-forward);
 *   `null` quando o ativo nunca teve barra até ali → valor do dia fica `null`.
 * - `dates` deve vir ordenado (ISO `YYYY-MM-DD`); dias sem negociação repetem o último preço.
 */
export interface HoldingTx {
  assetId: string;
  symbol: string;
  type: "BUY" | "SELL";
  quantity: number;
  tradedAt: string; // ISO YYYY-MM-DD
}

export interface WealthPoint {
  date: string;
  total: number | null;
  byAsset: Record<string, number | null>;
}

export function holdingsValue(
  txs: HoldingTx[],
  dates: string[],
  priceAt: (assetId: string, date: string) => number | null,
): WealthPoint[] {
  const ordered = [...txs]
    .filter((t) => t.quantity > 0)
    .sort((a, b) => (a.tradedAt < b.tradedAt ? -1 : a.tradedAt > b.tradedAt ? 1 : 0));
  const symbols = new Map<string, string>();
  for (const t of ordered) symbols.set(t.assetId, t.symbol);
  const qty = new Map<string, number>();
  let ti = 0;
  return dates.map((date) => {
    while (ti < ordered.length && ordered[ti]!.tradedAt <= date) {
      const t = ordered[ti]!;
      const q = qty.get(t.assetId) ?? 0;
      qty.set(t.assetId, t.type === "BUY" ? q + t.quantity : Math.max(0, q - t.quantity));
      ti++;
    }
    const byAsset: Record<string, number | null> = {};
    let total = 0;
    let missing = false;
    for (const [assetId, q] of qty) {
      if (q <= 0) continue;
      const p = priceAt(assetId, date);
      const sym = symbols.get(assetId) ?? assetId;
      if (p === null) {
        missing = true;
        byAsset[sym] = null;
        continue;
      }
      const v = q * p;
      byAsset[sym] = v;
      total += v;
    }
    return { date, total: missing ? null : total, byAsset };
  });
}

/** Datas diárias ISO de `from` a `to` (inclusive). `truncated` indica corte no limite. */
export function dateRange(from: string, to: string, maxDays = 370): { dates: string[]; truncated: boolean } {
  const dates: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(+d) || Number.isNaN(+end) || d > end) return { dates, truncated: false };
  while (d <= end && dates.length < maxDays) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { dates, truncated: d <= end };
}
