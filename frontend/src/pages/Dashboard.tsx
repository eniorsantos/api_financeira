import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";
import { api } from "../lib/api";

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2"];
const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Dashboard() {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 365 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [source, setSource] = useState("");
  const [benchmark, setBenchmark] = useState("");

  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  const cmp = useQuery({
    queryKey: ["compare", picked, from, to, source, benchmark],
    enabled: picked.length > 0,
    queryFn: () => api.compare(picked, from, to, source || undefined, benchmark || undefined),
  });
  const sync = useMutation({
    mutationFn: async () => {
      // histórico por classe: ações/FIIs via stocks, fundos via NAV, Tesouro via PU
      const byClass = (cls: string[]) =>
        picked.filter(
          (s) => (assets.data ?? []).find((a) => a.symbol === s && cls.includes(a.assetClass)) !== undefined,
        );
      const res: string[] = [];
      const q = await api.syncQuotes().catch((e: Error) => `quotes: ${e.message}`);
      res.push(typeof q === "string" ? q : `cotações: ${q.updated} atualizadas`);
      const jobs: [string, string[], (s: string[]) => Promise<{ rows: number }>][] = [
        ["histórico", byClass(["STOCK", "FII"]), (s) => api.syncHistory(s)],
        ["fundos", byClass(["FUND"]), (s) => api.syncFunds(s).then((r) => ({ rows: r.nav.rows }))],
        ["tesouro", byClass(["TREASURY"]), (s) => api.syncTreasury(s)],
      ];
      for (const [label, syms, fn] of jobs) {
        if (!syms.length) continue;
        res.push(
          await fn(syms)
            .then((v) => `${label}: ${v.rows} barras`)
            .catch((e: Error) => `${label}: ${e.message}`),
        );
      }
      return res.join(" · ");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compare"] }),
  });
  const syncMacro = useMutation({
    mutationFn: () => api.syncMacro(["cdi", "selic", "ipca"]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compare"] }),
  });

  // junta as séries rebaseadas (base 100) por data para o gráfico
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    const all: Record<string, { date: string; value: number }[]> = { ...cmp.data?.rebased };
    if (cmp.data?.benchmark) all[cmp.data.benchmark.label] = cmp.data.benchmark.rebased;
    for (const [sym, pts] of Object.entries(all))
      for (const p of pts)
        byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date }), [sym]: p.value });
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [cmp.data]);
  const seriesKeys = useMemo(() => {
    const keys = [...picked];
    if (cmp.data?.benchmark && !keys.includes(cmp.data.benchmark.label)) keys.push(cmp.data.benchmark.label);
    return keys;
  }, [picked, cmp.data]);

  // drawdown running a partir das séries rebaseadas (base 100)
  const drawdownData = useMemo(() => {
    const all: Record<string, { date: string; value: number }[]> = { ...cmp.data?.rebased };
    if (cmp.data?.benchmark) all[cmp.data.benchmark.label] = cmp.data.benchmark.rebased;
    const runningMax = new Map<string, number>();
    const byDate = new Map<string, Record<string, number | string>>();
    for (const [sym, pts] of Object.entries(all)) {
      let max = 0;
      for (const p of pts) {
        max = Math.max(max, p.value);
        runningMax.set(sym, max);
        const dd = ((p.value - max) / max) * 100;
        const existing = byDate.get(p.date) ?? { date: p.date };
        byDate.set(p.date, { ...existing, [sym]: dd });
      }
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [cmp.data]);

  return (
    <div>
      <h1>Painel de Análise Financeira</h1>

      <section style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {assets.data?.map((a) => (
          <label key={a.id}>
            <input
              type="checkbox"
              checked={picked.includes(a.symbol)}
              onChange={(e) =>
                setPicked((p) => (e.target.checked ? [...p, a.symbol] : p.filter((s) => s !== a.symbol)))
              }
            />{" "}
            {a.symbol}
          </label>
        ))}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select value={source} onChange={(e) => setSource(e.target.value)} title="Fonte dos preços">
          <option value="">Preferencial</option>
          <option value="BRAPI">Automático (brapi)</option>
          <option value="MANUAL">Manual</option>
        </select>
        <select value={benchmark} onChange={(e) => setBenchmark(e.target.value)} title="Benchmark">
          <option value="">Sem benchmark</option>
          <option value="CDI">CDI</option>
          <option value="SELIC">Selic</option>
          <option value="IPCA">IPCA</option>
        </select>
        <button disabled={!picked.length || sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending ? "Sincronizando…" : "Sincronizar brapi"}
        </button>
        <button disabled={syncMacro.isPending} onClick={() => syncMacro.mutate()} title="CDI, Selic e IPCA">
          {syncMacro.isPending ? "Sincronizando…" : "Sincronizar macro"}
        </button>
        <a href={`/api/reports/performance?from=${from}&to=${to}&format=csv`}>Exportar CSV</a>
      </section>
      {sync.error && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {(sync.error as Error).message}
        </p>
      )}
      {sync.data && <p style={{ color: "#15803d" }}>{sync.data}</p>}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: 12,
          margin: "16px 0",
        }}
      >
        {cmp.data?.stats.map((s) => (
          <div key={s.symbol} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <strong>{s.symbol}</strong>
            <div>Retorno: {pct(s.returnPct)}</div>
            <div>Volatilidade a.a.: {s.volatilityAnnPct?.toFixed(1) ?? "—"}%</div>
            <div>Drawdown máx.: {pct(s.maxDrawdownPct)}</div>
          </div>
        ))}
      </section>

      <div style={{ height: 380 }}>
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={40} />
            <YAxis domain={["auto", "auto"]} />
            <Tooltip />
            <Legend />
            {seriesKeys.map((s, i) => (
              <Line key={s} dataKey={s} dot={false} stroke={COLORS[i % COLORS.length]} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {cmp.data && seriesKeys.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2>Drawdown (base 100 → running máximo)</h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={drawdownData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={40} />
                <YAxis domain={["auto", 0]} />
                <Tooltip />
                <Legend />
                {seriesKeys.map((s, i) => (
                  <Area key={s} dataKey={s} dot={false} stroke={COLORS[i % COLORS.length]} fillOpacity={0.6} connectNulls />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
      {cmp.data && <p>Ranking no período: {cmp.data.ranking.join(" › ")}</p>}
      {cmp.data?.benchmark && (
        <p>
          {cmp.data.benchmark.label} no período: {pct(cmp.data.benchmark.returnPct)} (
          {cmp.data.benchmark.points} pontos)
        </p>
      )}
    </div>
  );
}
