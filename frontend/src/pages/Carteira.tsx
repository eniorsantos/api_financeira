import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../lib/api";

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const brl = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);

export default function Carteira() {
  const qc = useQueryClient();
  const [pfName, setPfName] = useState("");
  const [pfId, setPfId] = useState<string>("");

  const portfolios = useQuery({ queryKey: ["portfolios"], queryFn: api.portfolios });
  const activeId = pfId || portfolios.data?.[0]?.id || "";
  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  const txs = useQuery({ queryKey: ["transactions"], queryFn: api.transactions });
  const dividends = useQuery({ queryKey: ["dividends"], queryFn: api.dividends });

  const createPf = useMutation({
    mutationFn: () => api.createPortfolio(pfName),
    onSuccess: (p) => {
      setPfName("");
      setPfId(p.id);
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    },
  });
  const syncDiv = useMutation({
    mutationFn: async () => {
      const syms = (assets.data ?? []).filter((a) => a.source === "BRAPI").map((a) => a.symbol);
      if (!syms.length) throw new Error("Nenhum ativo BRAPI cadastrado.");
      const r = await api.syncDividends(syms);
      return `Proventos sincronizados: ${r.rows} novos, ${r.skipped} ignorados.`;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dividends"] }),
  });

  const myTxs = useMemo(
    () => (txs.data ?? []).filter((t) => t.portfolioId === activeId),
    [txs.data, activeId],
  );

  return (
    <div>
      <h1>Carteira</h1>
      <section style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <select value={activeId} onChange={(e) => setPfId(e.target.value)}>
          {(portfolios.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input placeholder="Nova carteira" value={pfName} onChange={(e) => setPfName(e.target.value)} />
        <button disabled={!pfName || createPf.isPending} onClick={() => createPf.mutate()}>
          Criar carteira
        </button>
        {createPf.isError && (
          <span role="alert" style={{ color: "#b91c1c" }}>
            {err(createPf.error)}
          </span>
        )}
      </section>

      {activeId && (
        <>
          <PositionTable portfolioId={activeId} />
          <TxSection
            portfolioId={activeId}
            txs={myTxs}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ["transactions"] });
              qc.invalidateQueries({ queryKey: ["position", activeId] });
            }}
          />
        </>
      )}

      <section style={{ marginTop: 24 }}>
        <h2>Proventos</h2>
        {syncDiv.isError && (
          <p role="alert" style={{ color: "#b91c1c" }}>
            {err(syncDiv.error)}
          </p>
        )}
        {syncDiv.data && <p style={{ color: "#15803d" }}>{syncDiv.data}</p>}
        <button disabled={syncDiv.isPending} onClick={() => syncDiv.mutate()}>
          {syncDiv.isPending ? "Sincronizando…" : "Sincronizar proventos (brapi)"}
        </button>
        <DividendsForm onChanged={() => qc.invalidateQueries({ queryKey: ["dividends"] })} />
        <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 12 }}>
          <thead>
            <tr>
              <th align="left">Ativo</th>
              <th>Tipo</th>
              <th align="right">Valor/cota</th>
              <th>Ex</th>
              <th>Pagamento</th>
              <th>Fonte</th>
            </tr>
          </thead>
          <tbody>
            {(dividends.data ?? []).map((d) => (
              <tr key={d.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                <td>{d.asset?.symbol ?? d.assetId}</td>
                <td>{d.kind}</td>
                <td align="right">{brl(d.amountPerUnit)}</td>
                <td>{d.exDate?.slice(0, 10) ?? "—"}</td>
                <td>{d.paymentDate.slice(0, 10)}</td>
                <td>{d.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PositionTable({ portfolioId }: { portfolioId: string }) {
  const position = useQuery({
    queryKey: ["position", portfolioId],
    queryFn: () => api.position(portfolioId),
  });
  if (position.isPending) return <p>Carregando posição…</p>;
  if (position.isError)
    return (
      <p role="alert" style={{ color: "#b91c1c" }}>
        {err(position.error)}
      </p>
    );
  const { positions, totalInvested, totalMarketValue, totalPnl, totalPnlPct } = position.data;
  return (
    <section>
      <h2>Posição</h2>
      {!positions.length && <p style={{ color: "#6b7280" }}>Sem posição: registre compras abaixo.</p>}
      {!!positions.length && (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th align="left">Ativo</th>
              <th align="right">Qtd</th>
              <th align="right">Preço médio</th>
              <th align="right">Investido</th>
              <th align="right">Atual</th>
              <th align="right">Mercado</th>
              <th align="right">P&L</th>
              <th align="right">%</th>
              <th align="right">Aloc.</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.assetId} style={{ borderTop: "1px solid #e5e7eb" }}>
                <td>
                  <strong>{p.symbol}</strong>
                </td>
                <td align="right">{brl(p.quantity)}</td>
                <td align="right">{brl(p.avgPrice)}</td>
                <td align="right">{brl(p.invested)}</td>
                <td align="right">{brl(p.currentPrice)}</td>
                <td align="right">{brl(p.marketValue)}</td>
                <td align="right" style={{ color: (p.pnl ?? 0) >= 0 ? "#15803d" : "#b91c1c" }}>
                  {p.pnl === null ? "—" : brl(p.pnl)}
                </td>
                <td align="right">{pct(p.pnlPct)}</td>
                <td align="right">{p.allocationPct === null ? "—" : `${p.allocationPct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid #111827" }}>
              <td>
                <strong>Total</strong>
              </td>
              <td />
              <td />
              <td align="right">
                <strong>{brl(totalInvested)}</strong>
              </td>
              <td />
              <td align="right">
                <strong>{brl(totalMarketValue)}</strong>
              </td>
              <td align="right">
                <strong>{totalPnl === null ? "—" : brl(totalPnl)}</strong>
              </td>
              <td align="right">
                <strong>{pct(totalPnlPct)}</strong>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

function TxSection({
  portfolioId,
  txs,
  onChanged,
}: {
  portfolioId: string;
  txs: {
    id: string;
    assetId: string;
    type: string;
    quantity: number;
    unitPrice: number;
    fees: number;
    tradedAt: string;
    asset?: { symbol: string };
  }[];
  onChanged: () => void;
}) {
  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  const [assetId, setAssetId] = useState("");
  const [type, setType] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fees, setFees] = useState("");
  const [tradedAt, setTradedAt] = useState(new Date().toISOString().slice(0, 10));

  const create = useMutation({
    mutationFn: () =>
      api.createTransaction({
        portfolioId,
        assetId,
        type,
        quantity: Number(quantity),
        unitPrice: Number(unitPrice),
        fees: fees ? Number(fees) : 0,
        tradedAt,
      }),
    onSuccess: () => {
      setQuantity("");
      setUnitPrice("");
      setFees("");
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteTransaction,
    onSuccess: () => onChanged(),
  });

  return (
    <section style={{ marginTop: 16 }}>
      <h2>Transações</h2>
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
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}
      >
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
          <option value="">Ativo…</option>
          {(assets.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.symbol}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as "BUY" | "SELL")}>
          <option value="BUY">Compra</option>
          <option value="SELL">Venda</option>
        </select>
        <input
          type="number"
          step="any"
          min="0"
          placeholder="Qtd"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
        <input
          type="number"
          step="any"
          min="0"
          placeholder="Preço unit."
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          required
        />
        <input
          type="number"
          step="any"
          min="0"
          placeholder="Taxas"
          value={fees}
          onChange={(e) => setFees(e.target.value)}
        />
        <input type="date" value={tradedAt} onChange={(e) => setTradedAt(e.target.value)} required />
        <button disabled={create.isPending || !assetId}>Registrar</button>
      </form>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th>Data</th>
            <th align="left">Ativo</th>
            <th>Tipo</th>
            <th align="right">Qtd</th>
            <th align="right">Preço</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {txs.map((t) => (
            <tr key={t.id} style={{ borderTop: "1px solid #e5e7eb" }}>
              <td>{t.tradedAt.slice(0, 10)}</td>
              <td>{t.asset?.symbol ?? t.assetId}</td>
              <td>{t.type === "BUY" ? "Compra" : "Venda"}</td>
              <td align="right">{brl(t.quantity)}</td>
              <td align="right">{brl(t.unitPrice)}</td>
              <td>
                <button onClick={() => remove.mutate(t.id)}>Excluir</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DividendsForm({ onChanged }: { onChanged: () => void }) {
  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  const [assetId, setAssetId] = useState("");
  const [kind, setKind] = useState("DIVIDEND");
  const [amount, setAmount] = useState("");
  const [exDate, setExDate] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));

  const create = useMutation({
    mutationFn: () =>
      api.createDividend({
        assetId,
        kind,
        amountPerUnit: Number(amount),
        ...(exDate ? { exDate } : {}),
        paymentDate,
      }),
    onSuccess: () => {
      setAmount("");
      setExDate("");
      onChanged();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}
    >
      <select value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
        <option value="">Ativo…</option>
        {(assets.data ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.symbol}
          </option>
        ))}
      </select>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        {["DIVIDEND", "JCP", "RENDIMENTO", "AMORTIZACAO", "OTHER"].map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <input
        type="number"
        step="any"
        min="0"
        placeholder="Valor/cota"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
      />
      <input
        type="date"
        value={exDate}
        onChange={(e) => setExDate(e.target.value)}
        title="Data ex (opcional)"
      />
      <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
      <button disabled={create.isPending || !assetId}>Registrar provento</button>
      {create.isError && (
        <span role="alert" style={{ color: "#b91c1c" }}>
          {err(create.error)}
        </span>
      )}
    </form>
  );
}
