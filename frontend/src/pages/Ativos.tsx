import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Asset } from "../lib/api";

const CLASSES = ["STOCK", "FII", "FUND", "TREASURY", "OTHER"] as const;
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Ativos() {
  const qc = useQueryClient();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<(typeof CLASSES)[number]>("STOCK");
  const [src, setSrc] = useState<"MANUAL" | "BRAPI">("MANUAL");
  const [open, setOpen] = useState<string | null>(null);

  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  const create = useMutation({
    mutationFn: () => api.createAsset({ symbol, name, assetClass, source: src }),
    onSuccess: () => {
      setSymbol("");
      setName("");
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteAsset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });

  return (
    <div>
      <h1>Ativos</h1>
      {(create.isError || remove.isError) && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {[create.error, remove.error].filter(Boolean).map(err).join(" ")}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}
      >
        <input
          placeholder="Símbolo (ex. PETR4)"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          required
        />
        <input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
        <select
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value as (typeof CLASSES)[number])}
        >
          {CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={src} onChange={(e) => setSrc(e.target.value as "MANUAL" | "BRAPI")}>
          <option value="MANUAL">Manual</option>
          <option value="BRAPI">Automático (brapi)</option>
        </select>
        <button disabled={create.isPending}>{create.isPending ? "Salvando…" : "Adicionar"}</button>
      </form>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th align="left">Símbolo</th>
            <th align="left">Nome</th>
            <th>Classe</th>
            <th>Fonte</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {assets.data?.map((a: Asset) => (
            <tr key={a.id} style={{ borderTop: "1px solid #e5e7eb" }}>
              <td>
                <strong>{a.symbol}</strong>
              </td>
              <td>{a.name}</td>
              <td>{a.assetClass}</td>
              <td>{a.source}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => setOpen(open === a.id ? null : a.id)}>
                  {open === a.id ? "Fechar" : "Preços"}
                </button>{" "}
                <button
                  onClick={() => {
                    if (confirm(`Excluir ${a.symbol}?`)) remove.mutate(a.id);
                  }}
                >
                  Excluir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <PricesManager assetId={open} />}
      {open && assets.data?.find((a) => a.id === open)?.assetClass === "FII" && (
        <IndicatorsPanel assetId={open} symbol={assets.data?.find((a) => a.id === open)?.symbol ?? ""} />
      )}
      {open && assets.data?.find((a) => a.id === open)?.assetClass === "FUND" && (
        <FundPanel assetId={open} symbol={assets.data?.find((a) => a.id === open)?.symbol ?? ""} />
      )}
    </div>
  );
}

function PricesManager({ assetId }: { assetId: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [close, setClose] = useState("");
  const [volume, setVolume] = useState("");

  const prices = useQuery({ queryKey: ["prices", assetId], queryFn: () => api.prices(assetId) });
  const add = useMutation({
    mutationFn: () =>
      api.addPrices(assetId, {
        date,
        close: Number(close),
        ...(volume ? { volume: Number(volume) } : {}),
      }),
    onSuccess: () => {
      setClose("");
      setVolume("");
      qc.invalidateQueries({ queryKey: ["prices", assetId] });
    },
  });
  const del = useMutation({
    mutationFn: api.deletePrice,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prices", assetId] }),
  });
  const imp = useMutation({
    mutationFn: async (file: File) => api.importPrices(assetId, await file.text()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prices", assetId] }),
  });

  return (
    <section style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <h3>Preços manuais</h3>
      {add.isError && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {err(add.error)}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}
      >
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <input
          type="number"
          step="any"
          min="0"
          placeholder="Fechamento"
          value={close}
          onChange={(e) => setClose(e.target.value)}
          required
        />
        <input
          type="number"
          step="1"
          min="0"
          placeholder="Volume (opcional)"
          value={volume}
          onChange={(e) => setVolume(e.target.value)}
        />
        <button disabled={add.isPending}>Salvar</button>
        <label
          style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "1px 8px", cursor: "pointer" }}
        >
          {imp.isPending ? "Importando…" : "Importar CSV"}
          <input
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) imp.mutate(f);
              e.target.value = "";
            }}
          />
        </label>
      </form>
      {imp.isError && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {err(imp.error)}
        </p>
      )}
      {imp.data && (
        <p style={{ color: imp.data.errors.length ? "#b45309" : "#15803d" }}>
          {imp.data.saved} linha(s) salva(s)
          {imp.data.errors.length ? `: ${imp.data.errors.join(" | ")}` : "."}
        </p>
      )}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th align="left">Data</th>
            <th align="right">Fechamento</th>
            <th align="right">Volume</th>
            <th>Fonte</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {prices.data?.map((p) => (
            <tr key={p.id} style={{ borderTop: "1px solid #eee" }}>
              <td>{p.date.slice(0, 10)}</td>
              <td align="right">{p.close ?? "—"}</td>
              <td align="right">{p.volume ?? "—"}</td>
              <td>{p.source}</td>
              <td>
                <button onClick={() => del.mutate(p.id)}>Excluir</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!prices.data?.length && (
        <p style={{ color: "#6b7280" }}>Sem preços. Adicione manualmente ou sincronize pela brapi.</p>
      )}
    </section>
  );
}

function IndicatorsPanel({ assetId, symbol }: { assetId: string; symbol: string }) {
  const qc = useQueryClient();
  const ind = useQuery({ queryKey: ["indicators", assetId], queryFn: () => api.indicators(assetId) });
  const sync = useMutation({
    mutationFn: () => api.syncIndicators([symbol]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicators", assetId] }),
  });
  const latest = ind.data?.[0];
  const fmtPct = (n: number | null, mult = 100) => (n === null ? "—" : `${(n * mult).toFixed(2)}%`);

  return (
    <section style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <h3>Indicadores do FII {latest ? `(${latest.referenceDate.slice(0, 7)})` : ""}</h3>
      {sync.isError && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {err(sync.error)}
        </p>
      )}
      <button disabled={sync.isPending} onClick={() => sync.mutate()}>
        {sync.isPending ? "Sincronizando…" : "Sincronizar indicadores (brapi)"}
      </button>
      {latest && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "12px 0" }}>
          <div>
            <div style={{ color: "#6b7280" }}>P/VP</div>
            <strong>{latest.priceToNav ?? "—"}</strong>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>DY 12m</div>
            <strong>{fmtPct(latest.dy12m)}</strong>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>DY 1m</div>
            <strong>{fmtPct(latest.dy1m)}</strong>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Cotistas</div>
            <strong>{latest.totalInvestors ?? "—"}</strong>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Segmento</div>
            <strong>{latest.segment ?? "—"}</strong>
          </div>
        </div>
      )}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th align="left">Ref.</th>
            <th align="right">P/VP</th>
            <th align="right">DY 12m</th>
            <th align="right">Ret. mensal</th>
            <th align="right">Cotistas</th>
          </tr>
        </thead>
        <tbody>
          {(ind.data ?? []).map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
              <td>{r.referenceDate.slice(0, 7)}</td>
              <td align="right">{r.priceToNav ?? "—"}</td>
              <td align="right">{fmtPct(r.dy12m)}</td>
              <td align="right">{fmtPct(r.monthlyReturn)}</td>
              <td align="right">{r.totalInvestors ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!ind.data?.length && <p style={{ color: "#6b7280" }}>Sem indicadores. Sincronize pela brapi.</p>}
    </section>
  );
}

function FundPanel({ assetId, symbol }: { assetId: string; symbol: string }) {
  const qc = useQueryClient();
  const snap = useQuery({
    queryKey: ["fund", assetId],
    queryFn: () => api.fundIndicators(assetId),
    retry: false,
  });
  const sync = useMutation({
    mutationFn: () => api.syncFunds([symbol]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fund", assetId] }),
  });
  const agio =
    snap.data?.priceToNav === null || snap.data?.priceToNav === undefined
      ? "—"
      : `${((snap.data.priceToNav - 1) * 100).toFixed(2)}%`;

  return (
    <section style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <h3>Snapshot do fundo</h3>
      {sync.isError && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {err(sync.error)}
        </p>
      )}
      <button disabled={sync.isPending} onClick={() => sync.mutate()}>
        {sync.isPending ? "Sincronizando…" : "Sincronizar fundo (brapi)"}
      </button>
      {snap.data ? (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "12px 0" }}>
          <div>
            <div style={{ color: "#6b7280" }}>Preço</div>
            <strong>{snap.data.price ?? "—"}</strong>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Cota patrimonial</div>
            <strong>{snap.data.navPerShare ?? "—"}</strong>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Ágio/deságio</div>
            <strong>{agio}</strong>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>DY mensal</div>
            <strong>
              {snap.data.dyMonthly === null ? "—" : `${(snap.data.dyMonthly * 100).toFixed(2)}%`}
            </strong>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Cotistas</div>
            <strong>{snap.data.totalInvestors ?? "—"}</strong>
          </div>
        </div>
      ) : (
        !snap.isPending && <p style={{ color: "#6b7280" }}>Sem snapshot. Sincronize pela brapi.</p>
      )}
    </section>
  );
}
