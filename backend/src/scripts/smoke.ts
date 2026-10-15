// Uso: BRAPI_TOKEN=... npm run brapi:smoke   (sem token, PETR4 e VALE3 ainda funcionam)
import { BrapiClient } from "../brapi/client.js";
import { BrapiError, BrapiRateLimitError } from "../brapi/errors.js";

const client = new BrapiClient();
try {
  const q = await client.quote(["PETR4", "VALE3"]);
  console.log("=== /api/v2/stocks/quote ===");
  console.log(JSON.stringify(q, null, 2));
  const h = await client.historical(["PETR4", "VALE3"], { range: "1mo", interval: "1d" });
  console.log("=== /api/v2/stocks/historical (últimos 3 pregões de cada) ===");
  for (const r of h.results) console.log(r.symbol, JSON.stringify(r.data.historicalDataPrice.slice(0, 3)));
} catch (e) {
  if (e instanceof BrapiRateLimitError) console.error(`429 — aguarde ${e.retryAfterSeconds ?? "?"}s`);
  else if (e instanceof BrapiError) console.error(`${e.status}: ${e.message}`);
  else throw e;
  process.exit(1);
}
