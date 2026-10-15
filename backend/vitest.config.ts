import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test/setup.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    testTimeout: 30_000,
    // Arquivos sequenciais: todos usam o mesmo banco de teste (finance_test).
    // (pool padrão do Vitest 2 é 'forks', por isso singleFork e não singleThread)
    poolOptions: { forks: { singleFork: true } },
  },
});
