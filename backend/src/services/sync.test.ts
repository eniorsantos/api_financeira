import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { syncAll } from "./sync.js";

beforeEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.dividend.deleteMany();
  await prisma.priceBar.deleteMany();
  await prisma.quoteSnapshot.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.portfolio.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.macroPoint.deleteMany();
  await prisma.fiiIndicator.deleteMany();
  await prisma.fundIndicator.deleteMany();
  await prisma.user.deleteMany();
});

describe("syncAll", () => {
  it("sincroniza quotes, histórico e dividendos dos BRAPI ativos", async () => {
    await buildApp(); // garante app montada (BigInt patch)
    const user = await prisma.user.create({ data: { email: "test@test.local", passwordHash: "x" } });
    await prisma.asset.create({ data: { symbol: "PETR4", name: "P", assetClass: "STOCK", source: "BRAPI", userId: user.id } });
    await prisma.asset.create({ data: { symbol: "M1", name: "M", assetClass: "STOCK", source: "MANUAL", userId: user.id } });
    const out = await syncAll("1mo", user.id);
    expect(out.quotes).toMatchObject({ updated: 1, missing: [] });
    expect(out.history).toMatchObject({ rows: 5 });
    expect(out.dividends).toMatchObject({ rows: 3, skipped: 1 });
    expect(await prisma.syncLog.count()).toBeGreaterThanOrEqual(3);
  });
});
