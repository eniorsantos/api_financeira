# Módulos do projeto — referência detalhada

Tudo que existe no código, módulo a módulo: responsabilidade, API, comportamentos e testes.
Documentos de visão: [ARQUITETURA.md](ARQUITETURA.md) · contratos HTTP: [API.md](API.md) ·
banco: [MODELO-DE-DADOS.md](MODELO-DE-DADOS.md) · estado: [STATUS-E-ROADMAP.md](STATUS-E-ROADMAP.md).

## Back-end (`backend/src`)

### `auth.ts` — autenticação JWT

- Registra plugin `@fastify/jwt` com `JWT_SECRET` (padrão `dev-secret-change-in-production`).
- `requireAuth(req)` — lança erro `AUTH_REQUIRED` (401) se não houver sessão válida.
- `hashPassword()` / `comparePassword()` — bcryptjs (custo 10).
- `signToken(app, payload)` — assina JWT com expiração de 7 dias.
- Hook `onRequest` verifica JWT em todas as rotas exceto `/auth/*` e `/api/docs/*`.
- Popula `req.user` com `{ id, email }`.

### `server.ts` — bootstrap

- Importa `buildApp()` de `app.ts` e escuta em `PORT` (padrão 3333), host `0.0.0.0`.
- Não contém lógica; existe para que testes importem a app sem escutar.
- Liga o scheduler de sync com `SYNC_ENABLED=1` (`SYNC_INTERVAL_MIN`, `SYNC_HISTORY_RANGE`).

### `app.ts` — montagem (`buildApp()`)

- Cria o Fastify com logger que redige `req.headers.authorization` (token nunca vaza em log).
- Registra plugin de auth JWT (`auth.ts`).
- CORS liberado só para `WEB_ORIGIN` (padrão `http://localhost:5173`).
- Registra parser `text/csv` (corpo como string) para `POST /assets/:id/prices/import`.
- Aplica o patch `BigInt.prototype.toJSON → string` (volumes na API saem como string).
- `setErrorHandler` central (contrato de erros, ver API.md):
  `AUTH_REQUIRED`→401 · `ZodError`→400 `validation` · `BrapiRateLimitError`→429 (+`Retry-After`) ·
  `BrapiAuthError`/`BrapiPlanError`/`BrapiError`→502 · Prisma P2025→404 ·
  P2002/P2003→409 `conflict` · resto→500. Todo corpo tem `error` + `message`.
- Registra as rotas com prefixo `/api`. Reaproveitada pelos testes via `app.inject()`.
- Swagger UI em `/api/docs` (spec em `/api/docs/json`; esqueleto sem schemas por rota).

### `routes/api.ts` — REST

Helpers internos:

- `strip<T>()` — remove `| undefined` do output Zod (exigido por `exactOptionalPropertyTypes` do Prisma).
- `upsertBatch()` — upserts em lotes de 100 dentro de `$transaction` (preserva update-on-conflict).
- `pickSource()` — fonte preferencial por ativo: `?source=` explícito, senão BRAPI se houver barras no período, senão MANUAL.
- `pageOrAll()` — paginação opt-in: sem `page`/`pageSize` devolve array; com eles `{data, page, pageSize, total}`.
- `toBar()`/`toSourcedBar()` — Decimal→`number`, preserva `source` para o comparativo.
- `userId(req)` — extrai `userId` do `req.user` (lança 401 se não autenticado).

Rotas (detalhes e payloads em API.md):

- **Auth** `/auth/register`, `/auth/login`, `/auth/me`.
- **Ativos** CRUD; `symbol` normalizado (trim + maiúsculas); duplicado→409; filtra por `userId`.
- **Preços**: `GET` com `from`/`to`, `POST` unitário ou array (upsert por data, fonte MANUAL, `volume` inteiro ≥ 0), `DELETE /prices/:id`, `POST …/import` (CSV EN/PT, ISO ou DD/MM/AAAA, `{saved, errors[]}`); verifica propriedade do ativo.
- **Portfólios** CRUD + `GET /:id` + `GET /:id/position` (posição×preço médio×P&L×alocação); filtra por `userId`.
- **Transações/dividendos** CRUD (GET inclui `asset`); filtra por `userId`; verifica propriedade do portfolio/ativo.
- **Sync** `quotes`/`history`/`dividends`/`macro`/`indicators` (só `source=BRAPI`+ativos do usuário; short-circuit sem gastar quota), `/sync/funds` (`{nav, indicators}`) e `/sync/treasury` (PU→`PriceBar`); `GET /treasury/list` (catálogo ao vivo, sem persistência) e `GET /assets/:id/fund-indicators` (snapshot; 404 sem dados).
- **Comparativo** `GET /analytics/compare?symbols&from&to&source?` e **relatório** `GET /reports/performance?…&assetClass?&format=json|csv|pdf|xlsx&source?` (CSV/XLSX/PDF com colunas resumidas).
- **Benchmarks**: `compare` aceita `?benchmark=CDI|SELIC|IPCA` (anexa série acumulada + retorno); `performance` aceita `?real=1` (coluna `realReturnPct` deflacionada pelo IPCA; `null` sem dados).
- **Risco**: `compare`/`performance` aceitam `?riskFree=N|CDI|SELIC` (Sharpe por stat; CDI/Selic anualizados geometricamente no período) e `?betaVs=CDI|SELIC|IPCA` (beta por stat, retornos alinhados por data); `GET /analytics/correlation` devolve matriz de Pearson + pontos comuns.
- **Avaliação**: `GET /screener` (filtros numéricos validados, resto repassado à brapi) e `GET /fundamentals` (envelope validado, `data` opaco).
- Erros de FK/unicidade viram 409; validação Zod devolve `issues`.

### `services/analytics.ts` — funções puras (testadas)

- `periodStats(symbol, bars)`: retorno por `adjustedClose` (fallback `close`), volatilidade anualizada (σ diária·√252), drawdown máximo, melhor/pior dia; `null` com < 2 pontos; ignora `null`s.
- `rebaseTo100(bars)`: série base 100 para o gráfico.
- `compare(series)`: `{stats, ranking (por retorno), rebased}`.
- `accumulateRates(points, unit)`: fator acumulado — `percentPerDay` compõe ao dia; `percentPerYear` vira equivalente diário (÷252 dias úteis); `percent` compõe por observação (variação mensal do IPCA); unidade desconhecida → `null`.
- `accumulatedReturnPct(acc)` e `realReturnPct(nominalPct, ipcaFactor)` (`(1+n)/(1+i)−1`; `null` sem base).
- `dailyReturns()`, `sharpeRatio(rets, riskFreeAnnualPct)` (anualizado; `null` sem variância/dados), `beta(a, b)` (Cov/Var, `null` sem variância), `correlation()` (Pearson), `alignedReturns()` (interseção de datas) e `correlationMatrix()` (diagonal = 1; `null` com < 2 retornos comuns).

### `services/portfolio.ts` — carteira

- Puras: `computePositions(txs, prices)` (preço médio ponderado; vendas consomem a média limitadas ao saldo; taxas só de compra entram na base; ordena por `tradedAt`; exclui zeradas; `allocationPct` só sobre precificadas) e `portfolioTotals()` (investido total; mercado/P&L só da parte com preço).
- Com banco: `portfolioPosition(portfolioId)` — lê transações + última barra por ativo (fonte preferencial, `close` com fallback `adjustedClose`); 404 se a carteira não existir.

### `services/sync.ts` — brapi → banco

- Instância única `BrapiClient` (token só aqui). `SyncLog` por operação (`ok`/`error` + HTTP + mensagem).
- `syncQuotes(symbols?)`: 1 chamada para todos os BRAPI ativos; ignora cotação sem preço; atualiza `logoUrl` se vazio; `missing` = sem `results`.
- `syncHistory(symbols, {range,interval})`: só símbolos de ativos BRAPI (economiza quota); upsert em lotes de 100/`$transaction`.
- `syncDividends(symbols, {startDate?,endDate?})`: divide por classe — `STOCK`→`stocks/dividends`, `FII`→`fii/dividends`, resto ignorado; `cashRow()` normaliza (`DIVIDENDO`→`DIVIDEND`, `JCP`→`JCP`, `RENDIMENTO`/`AMORTIZAÇÃO`→próprios, resto→`OTHER`; sem `paymentDate`/valor válido = `skipped`); upsert idempotente + log por endpoint.
- `syncMacro(slugs, {startDate?,endDate?,limit?})`: grava `MacroPoint` (upsert por slug+data); ignora observações inválidas, conta `skipped`.
- `syncFunds(symbols, params)`: NAV de fundos (`FUND`) vira `PriceBar` (`close` = cota, fonte `BRAPI`; `symbol` null = ignorado). `syncFundIndicators(symbols)`: snapshot (preço, cota, ágio/deságio) em `FundIndicator` (1 linha por ativo).
- `syncTreasury(symbols, params)`: PU diário vira `PriceBar` (`close` = PU de venda, fonte `BRAPI`; slugs minúsculos, casa case-insensitive).
- `syncAll(historyRange?)`: quotes + histórico (STOCK/FII) + dividendos de todos os BRAPI ativos; falha por etapa não aborta.
- `services/scheduler.ts`: `startScheduler(task, intervalMs, onError?)` com guarda anti-sobreposição, `unref()` e primeira rodada imediata.

### `services/csv.ts` — importação (`parsePricesCsv`)

- Parser sem dependências (aspas, `\r\n`, comentários `#`); cabeçalho EN/PT ou ausente (detecta linha de dados); colunas por alias; datas ISO ou DD/MM/AAAA; valida via Zod (`PriceRow`, volume inteiro); retorna `{rows, errors[]}` com nº da linha.

### `brapi/client.ts` — `BrapiClient`

- `token` de `BRAPI_TOKEN`, header `Authorization: Bearer` (nunca URL/log); `baseUrl`/`fetchImpl`/`maxRetries`(2)/`sleep` injetáveis (testes).
- `quote(symbols)` (1 chamada, `symbols=A,B`), `historical(symbols, params)`, `dividends(symbols, params?)`, `fiiDividends(symbols, params?)`, `macro(slugs, params?)`, `fundsNavHistory(symbols, params?)`, `fundsIndicators(symbols)`, `fundsDividends(symbols, params?)`, `treasuryHistory(symbols, params?)`, `treasuryList(params?)`, `screener(params)`, `statistics(symbols, params?)`.
- Cache por instância (`MemoryCache` com TTL por operação: quotes 60 s, resto 10 min–1 h; `cache: false` desliga; `BRAPI_CACHE=0` no sync de produção).
- Resposta 2xx fora do schema ou não-JSON → `BrapiError` 502 (`brapi_invalid_response`, nunca 400). Erros: 400→`BrapiBadRequestError`, 401→`BrapiAuthError`, 403→`BrapiPlanError`, 404→`BrapiNotFoundError`, 429→retry com `Retry-After` (segundos ou HTTP-date; espera > 60 s ou retries esgotados → `BrapiRateLimitError` com `retryAfterSeconds`), resto→`BrapiError`.
- `parseRetryAfter()` exportado (segundos ou HTTP-date → segundos).

### `brapi/schemas.ts` — Zod das respostas

- Helpers `num`/`str` (qualquer campo pode vir `null`/ausente → `null`).
- `StockQuoteResponse`, `StockHistoricalResponse` (`date` Unix em segundos), `StockDividendsResponse` (`cashDividends` + arrays opacos p/ eventos), `FiiDividendsResponse` (**flat**, casa por `symbol`), `MacroResponse` (`results[].series{slug,unit,frequency,…}` + `observations[{date YYYY-MM-DD, value}]`), `BrapiErrorBody`, `HistoricalParams` | `DividendsParams` | `MacroParams`.

### `brapi/errors.ts` — hierarquia

- `BrapiError(message, status, code?)` base; filhas: `Auth/Plan/NotFound/BadRequest/RateLimit(retryAfterSeconds)`. O handler HTTP decide pelo `instanceof` (ordem: específicas antes da base).

### `scripts/smoke.ts` — fumaça real

- `npm run brapi:smoke`: `quote` + `historical` de PETR4/VALE3 (funcionam sem token), imprime JSON; 429/`BrapiError` com mensagem amigável e `exit 1`.

### `test/` — integração

- `setup.ts`: fixa `DATABASE_URL` do teste, instala `fetch` global simulando a brapi (quote/history/dividends/fii/macro determinísticos; 404 p/ desconhecidos).
- `global-setup.ts`: cria `finance_test` (se preciso) e roda `migrate deploy` antes da suite.
- `../routes/api.test.ts` + `../services/*.test.ts`: `app.inject()` sem rede; `beforeEach` limpa tabelas em ordem de FK.

### `prisma/` — dados

- `schema.prisma` (multilinha — o parser atual rejeita blocos de linha única): `Asset`, `PriceBar` (único por ativo+data+fonte), `QuoteSnapshot`, `Dividend` (único por ativo+pagamento+tipo+valor), `Portfolio`, `Transaction` (sem cascade p/ `Asset` → 409), `SyncLog`, `MacroPoint` (único por slug+data), `FiiIndicator` (único por ativo+referência), `FundIndicator` (snapshot único por ativo).
- `migrations/`: `…_init` (tabelas), `…_dividend_unique` (unique de dividendos), `…_macro_fii` (`MacroPoint` + `FiiIndicator`), `…_fund_snapshot` (`FundIndicator`). Gerar diff: `migrate diff --from-migrations … --shadow-database-url … --script` preservando quebras de linha; aplicar com `migrate deploy` (o `migrate dev` é interativo).

### Configs back-end

- `package.json`: `dev` (tsx watch), `build` (tsc), `typecheck`, `test` (vitest), `db:migrate`, `brapi:smoke`.
- `tsconfig.json`: `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (motiva o `strip()` e construções defensivas) + `NodeNext`.
- `vitest.config.ts`: `setupFiles`, `globalSetup`, `testTimeout` 30 s.
- `.env.example`: `DATABASE_URL` (porta **5433** — há Postgres local na 5432), `BRAPI_TOKEN`, `PORT`, `WEB_ORIGIN`.

## Front-end (`frontend/src`)

### `main.tsx` — boot

- `BrowserRouter` + `Routes` sob `Layout`: `/` Dashboard, `/ativos`, `/carteira`, `/relatorios`. Sem lazy-loading (bundle único; aviso de chunk > 500 kB conhecido).

### `lib/api.ts` — cliente tipado

- `http(path, schema, init?)`: prefixo `/api` (proxy Vite), 429 com `Retry-After` legível, erro = `message` do corpo (todo erro do back tem `message`), valida resposta com Zod.
- Schemas: `Asset`, `PriceBar` (volume string|number|null — BigInt serializado), `Portfolio`, `Position`/`PortfolioPosition`, `Transaction`/`Dividend` (Decimal→`coerce.number`, datas string, `asset` aninhado opcional), `CompareResponse`, `PerfStats`.
- Funções para todos os endpoints: assets/prices (CRUD + import CSV `text/csv`), compare/performance (+`source`, `benchmark`, `real`), portfolios/position/transactions/dividends, syncs (quotes/history/dividends).

### `pages/Layout.tsx` — navegação

- Links Dashboard/Ativos/Carteira/Relatórios com destaque da rota ativa.

### `pages/Dashboard.tsx`

- Checkboxes de ativos + período + seletor de fonte + seletor de benchmark (CDI/Selic/IPCA) + sync por classe (ações/FIIs via stocks, fundos via NAV, Tesouro via PU) e macro + link CSV; cartões de métricas, gráfico base-100 (Recharts, com linha do benchmark), **gráfico de drawdown** (área, running máximo da base 100) e ranking. Série vazia = ativo sem barras no período.

### Testes front-end

- Vitest 2 + React Testing Library + jsdom.
- Testes em `frontend/src/pages/*.test.tsx`: Dashboard, Relatórios, Avaliação.
- `setupTests.ts` com mock de `ResizeObserver` (Recharts).
- `vitest.config.ts` com `environment: jsdom`.

### Configs front-end

- `package.json` (React 18, TanStack Query, Recharts, react-router, Zod, Vitest, Testing Library), `tsconfig` estrito, `vite.config.ts` (proxy `/api`→`:3333`; token nunca chega ao browser), `index.html` (pt-BR), `vitest.config.ts`.

## Infra

- `docker-compose.yml`: `postgres:16` (5433→5432, volume `pgdata`; 5433 evita o Postgres 18 local), `backend` (build a partir de `./backend`, porta 3333, depende do db), `frontend` (build a partir de `./frontend`, porta 80, depende do backend).
- `backend/Dockerfile`: Node 22 alpine, `prisma generate`, `prisma migrate deploy`, `npm run dev`.
- `frontend/Dockerfile`: multi-stage (build com Vite + nginx para servir estático + `nginx.conf` com proxy `/api` → backend).
- `frontend/nginx.conf`: serve `/` com fallback para `index.html` (SPA) e proxy `/api` para `http://backend:3333`.
- `.env` local (não commitado): aponta p/ 5433; `BRAPI_TOKEN` vazio = só tickers livres + endpoints que exigem plano falham com 502 `brapi_plan`; `JWT_SECRET` opcional.

## Fluxos de ponta a ponta

1. **Auth**: registro/login → JWT → header `Authorization: Bearer <jwt>` em todas as requisições.
2. **Sync**: UI → `POST /api/sync/*` → `sync.ts` filtra ativos BRAPI do usuário → 1 chamada brapi → upserts em lote + `SyncLog` → UI refaz queries.
3. **Manual**: formulários → POSTs com Zod → `strip()` → Prisma (409 em conflito).
4. **Leitura analítica**: banco → `pickSource()` → funções puras → JSON/CSV/PDF/XLSX.
5. **Benchmarks**: `MacroPoint` acumulado por unidade (`accumulateRates`) → série extra no `compare` + `realReturnPct` no `performance`.

