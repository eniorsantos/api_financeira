// Cria o banco de teste e aplica as migrations antes da suite.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgresql://finance:finance@localhost:5433/finance_test";

export default async function setup() {
  const dbName = new URL(TEST_URL).pathname.replace(/^\//, "");
  const maintUrl = TEST_URL.replace(/\/[^/]*$/, "/postgres");
  process.env.DATABASE_URL = maintUrl;
  const { PrismaClient } = await import("@prisma/client");
  const admin = new PrismaClient();
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (e) {
    if (!(e instanceof Error) || !/already exists/i.test(e.message)) throw e;
  } finally {
    await admin.$disconnect();
  }
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: "inherit",
  });
}
