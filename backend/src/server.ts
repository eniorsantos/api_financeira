import { buildApp } from "./app.js";
import { startScheduler } from "./services/scheduler.js";
import { syncAll } from "./services/sync.js";

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3333), host: "0.0.0.0" });

if (process.env.SYNC_ENABLED === "1") {
  const minutes = Number(process.env.SYNC_INTERVAL_MIN ?? 60);
  const range = process.env.SYNC_HISTORY_RANGE ?? "1mo";
  startScheduler(
    () => syncAll(range),
    (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000,
    (e) => app.log.error(e),
  );
  app.log.info(`scheduler de sync ativo: a cada ${minutes}min (histórico ${range})`);
}
