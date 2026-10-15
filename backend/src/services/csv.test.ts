import { describe, expect, it } from "vitest";
import { parsePricesCsv } from "./csv.js";

describe("csv", () => {
  it("com cabeçalho EN e PT-BR", () => {
    const en = parsePricesCsv("date,close,volume\n2026-01-05,10.5,100\n2026-01-06,11,\n");
    expect(en.errors).toEqual([]);
    expect(en.rows).toHaveLength(2);
    expect(en.rows[0]!.volume).toBe(100n);
    expect(en.rows[1]!.volume).toBeNull();
    const pt = parsePricesCsv("data,fechamento\n05/01/2026,10.5\n");
    expect(pt.errors).toEqual([]);
    expect(pt.rows[0]!.date.toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("sem cabeçalho e com linhas inválidas numeradas", () => {
    const r = parsePricesCsv("2026-01-05,10\nops,xx\n2026-01-06,11.5,1.5\n");
    expect(r.rows.map((x) => x.close)).toEqual([10, 11.5]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^linha 2:/);
  });

  it("vazio e cabeçalho sem date/close", () => {
    expect(parsePricesCsv("   \n").errors).toEqual(["CSV vazio"]);
    expect(parsePricesCsv("foo,bar\n1,2\n").errors).toEqual(["Cabeçalho sem colunas `date` e `close`"]);
  });
});
