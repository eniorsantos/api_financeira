import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);

export default function Relatorios() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 365 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [assetClass, setAssetClass] = useState("");
  const [source, setSource] = useState("");
  const [real, setReal] = useState(false);
  const [riskFree, setRiskFree] = useState("");
  const [betaVs, setBetaVs] = useState("");

  const perf = useQuery({
    queryKey: ["performance", from, to, assetClass, source, real, riskFree, betaVs],
    queryFn: () =>
      api.performance(
        from,
        to,
        assetClass || undefined,
        source || undefined,
        real,
        riskFree || undefined,
        betaVs || undefined,
      ),
  });
  const symbols = (perf.data?.stats ?? []).map((s) => s.symbol);
  const corr = useQuery({
    queryKey: ["correlation", symbols, from, to, source],
    enabled: symbols.length > 1,
    queryFn: () => api.correlation(symbols, from, to, source || undefined),
  });
  const csv =
    `/api/reports/performance?from=${from}&to=${to}` +
    (assetClass ? `&assetClass=${assetClass}` : "") +
    (source ? `&source=${source}` : "") +
    (real ? "&real=1" : "") +
    (riskFree ? `&riskFree=${riskFree}` : "") +
    (betaVs ? `&betaVs=${betaVs}` : "") +
    "&format=csv";

  return (
    <div>
      <h1>Relatórios</h1>
      <section style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
          <option value="">Todas as classes</option>
          {["STOCK", "FII", "FUND", "TREASURY", "OTHER"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} title="Fonte dos preços">
          <option value="">Preferencial</option>
          <option value="BRAPI">Automático (brapi)</option>
          <option value="MANUAL">Manual</option>
        </select>
        <label title="Retorno deflacionado pelo IPCA do período">
          <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} /> Real (IPCA)
        </label>
        <input
          placeholder="Risk-free % a.a. ou CDI/SELIC"
          value={riskFree}
          onChange={(e) => setRiskFree(e.target.value)}
          title="Taxa livre de risco anual para o Sharpe"
          style={{ width: 220 }}
        />
        <select value={betaVs} onChange={(e) => setBetaVs(e.target.value)} title="Beta vs benchmark">
          <option value="">Beta: —</option>
          <option value="CDI">Beta vs CDI</option>
          <option value="SELIC">Beta vs Selic</option>
          <option value="IPCA">Beta vs IPCA</option>
        </select>
        <a href={csv}>Exportar CSV</a>
      </section>
      {perf.isError && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {(perf.error as Error).message}
        </p>
      )}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th align="left">Ativo</th>
            <th align="right">Pontos</th>
            <th align="left">Período</th>
            <th align="right">Retorno</th>
            {real && <th align="right">Real</th>}
            <th align="right">Vol. a.a.</th>
            <th align="right">Drawdown</th>
            {riskFree && <th align="right">Sharpe</th>}
            {betaVs && <th align="right">Beta</th>}
          </tr>
        </thead>
        <tbody>
          {perf.data?.stats.map((s) => (
            <tr key={s.symbol} style={{ borderTop: "1px solid #e5e7eb" }}>
              <td>
                <strong>{s.symbol}</strong>
              </td>
              <td align="right">{s.points}</td>
              <td>
                {s.startDate ?? "—"} → {s.endDate ?? "—"}
              </td>
              <td align="right">{pct(s.returnPct)}</td>
              {real && <td align="right">{pct(s.realReturnPct)}</td>}
              <td align="right">{s.volatilityAnnPct === null ? "—" : `${s.volatilityAnnPct.toFixed(1)}%`}</td>
              <td align="right">{pct(s.maxDrawdownPct)}</td>
              {riskFree && <td align="right">{s.sharpe === null ? "—" : s.sharpe.toFixed(2)}</td>}
              {betaVs && <td align="right">{s.beta === null ? "—" : s.beta.toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {perf.data && !perf.data.stats.length && (
        <p style={{ color: "#6b7280" }}>
          Sem dados no período. Cadastre ativos e sincronize ou insira preços.
        </p>
      )}
      {corr.data && corr.data.symbols.length > 1 && (
        <section style={{ marginTop: 24 }}>
          <h2>Correlação (retornos diários)</h2>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th />
                {corr.data.symbols.map((s) => (
                  <th key={s} style={{ padding: "4px 8px" }}>
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corr.data.symbols.map((a, i) => (
                <tr key={a}>
                  <th align="left" style={{ padding: "4px 8px" }}>
                    {a}
                  </th>
                  {corr.data!.matrix[i]!.map((v, j) => (
                    <td
                      key={j}
                      align="right"
                      style={{
                        padding: "4px 8px",
                        background: v === null ? undefined : `rgba(37,99,235,${Math.abs(v) * 0.25})`,
                      }}
                    >
                      {v === null ? "—" : v.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
