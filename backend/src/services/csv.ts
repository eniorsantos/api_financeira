import { z } from "zod";

/** CSV de preços manuais: `date,close[,open,high,low,adjustedClose,volume]`.
 * Com ou sem cabeçalho (EN ou PT: data,fechamento,abertura,máxima,mínima,ajustado,volume).
 * Datas ISO (`2026-01-05`) ou BR (`05/01/2026`). Retorna linhas válidas + erros por linha.
 */
export const PriceRow = z.object({
  date: z.coerce.date(),
  close: z.coerce.number(),
  open: z.coerce.number().nullish(),
  high: z.coerce.number().nullish(),
  low: z.coerce.number().nullish(),
  adjustedClose: z.coerce.number().nullish(),
  volume: z.coerce
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => (v == null ? null : BigInt(v))),
});
export type PriceRow = z.infer<typeof PriceRow>;

const ALIAS: Record<string, string> = {
  date: "date",
  data: "date",
  close: "close",
  fechamento: "close",
  open: "open",
  abertura: "open",
  high: "high",
  maxima: "high",
  máxima: "high",
  low: "low",
  minima: "low",
  mínima: "low",
  adjustedclose: "adjustedClose",
  ajustado: "adjustedClose",
  ajuste: "adjustedClose",
  volume: "volume",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function normDate(s: string): string {
  const m = BR.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const looksLikeData = (cells: string[]) =>
  cells.length >= 2 &&
  (ISO.test(cells[0]!) || BR.test(cells[0]!)) &&
  cells[1] !== "" &&
  !Number.isNaN(Number(cells[1]));

export function parsePricesCsv(text: string): { rows: PriceRow[]; errors: string[] } {
  const rows: PriceRow[] = [];
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return { rows, errors: ["CSV vazio"] };
  let cols: string[];
  let start = 0;
  const first = splitLine(lines[0]!);
  if (looksLikeData(first)) {
    cols = ["date", "close", "open", "high", "low", "adjustedClose", "volume"];
  } else {
    cols = first.map((h) => ALIAS[h.toLowerCase()] ?? "");
    if (!cols.includes("date") || !cols.includes("close")) {
      return { rows, errors: ["Cabeçalho sem colunas `date` e `close`"] };
    }
    start = 1;
  }
  lines.slice(start).forEach((line, i) => {
    const cells = splitLine(line);
    const obj: Record<string, string> = {};
    cols.forEach((c, j) => {
      if (c && cells[j] !== undefined && cells[j] !== "") obj[c] = normDate(cells[j]!);
    });
    const parsed = PriceRow.safeParse(obj);
    if (parsed.success) rows.push(parsed.data);
    else
      errors.push(
        `linha ${i + start + 1}: ${parsed.error.issues.map((x) => `${x.path.join(".") || "linha"} (${x.code})`).join("; ")}`,
      );
  });
  return { rows, errors };
}
