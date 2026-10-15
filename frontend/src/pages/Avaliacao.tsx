import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ScreenerRow } from "../lib/api";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const dy = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${(n * 100).toFixed(2)}%`;

export default function Avaliacao() {
  const [peMax, setPeMax] = useState("15");
  const [pbMax, setPbMax] = useState("");
  const [dyMin, setDyMin] = useState("");
  const [roeMin, setRoeMin] = useState("");
  const [sortBy, setSortBy] = useState("dividendYield");
  const [applied, setApplied] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["screener", applied],
    enabled: Object.keys(applied).length > 0,
    queryFn: () => api.screener(applied),
  });

  const apply = () => {
    const p: Record<string, string> = { sortBy, sortOrder: "desc", limit: "50" };
    if (peMax) p.trailingPEMax = peMax;
    if (pbMax) p.priceToBookMax = pbMax;
    if (dyMin) p.dividendYieldMin = String(Number(dyMin) / 100);
    if (roeMin) p.returnOnEquityMin = String(Number(roeMin) / 100);
    setApplied(p);
  };

  return (
    <div>
      <h1>Avaliação (screener)</h1>
      <p style={{ color: "#6b7280" }}>
        Filtros e múltiplos ao vivo da brapi (P/L, P/VP, DY em fração). Métricas do plano Pro podem vir
        vazias.
      </p>
      <section style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input
          placeholder="P/L máx"
          value={peMax}
          onChange={(e) => setPeMax(e.target.value)}
          style={{ width: 90 }}
        />
        <input
          placeholder="P/VP máx"
          value={pbMax}
          onChange={(e) => setPbMax(e.target.value)}
          style={{ width: 90 }}
        />
        <input
          placeholder="DY mín %"
          value={dyMin}
          onChange={(e) => setDyMin(e.target.value)}
          style={{ width: 90 }}
        />
        <input
          placeholder="ROE mín %"
          value={roeMin}
          onChange={(e) => setRoeMin(e.target.value)}
          style={{ width: 90 }}
        />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="dividendYield">Ordenar: DY</option>
          <option value="trailingPE">Ordenar: P/L</option>
          <option value="returnOnEquity">Ordenar: ROE</option>
          <option value="priceToBook">Ordenar: P/VP</option>
        </select>
        <button onClick={apply}>Buscar</button>
      </section>
      {q.isError && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {(q.error as Error).message}
        </p>
      )}
      {q.data && (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th align="left">Ativo</th>
              <th align="left">Setor</th>
              <th align="right">Preço</th>
              <th align="right">P/L</th>
              <th align="right">P/VP</th>
              <th align="right">DY</th>
              <th align="right">ROE</th>
              <th align="right">EV/EBITDA</th>
            </tr>
          </thead>
          <tbody>
            {q.data.results.map((r: ScreenerRow) => (
              <tr key={r.symbol} style={{ borderTop: "1px solid #e5e7eb" }}>
                <td>
                  <strong>{r.symbol}</strong> <span style={{ color: "#6b7280" }}>{r.name ?? ""}</span>
                </td>
                <td>{r.sector ?? "—"}</td>
                <td align="right">{money(r.quote?.lastPrice ?? null)}</td>
                <td align="right">{money(r.metrics?.trailingPE ?? null)}</td>
                <td align="right">{money(r.metrics?.priceToBook ?? null)}</td>
                <td align="right">{dy(r.metrics?.dividendYield ?? null)}</td>
                <td align="right">{dy(r.metrics?.returnOnEquity ?? null)}</td>
                <td align="right">{money(r.metrics?.enterpriseToEbitda ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
