# API REST interna

Base: `http://localhost:3333/api` (front usa `/api` via proxy). JSON. **Autenticação JWT** (ver seção Auth). `BigInt` é serializado como string. Datas: ISO (`2026-01-31`).

## Auth

| Método | Rota          | Corpo                                                  |
| ------ | ------------- | ------------------------------------------------------ |
| POST   | `/auth/register` | `{email, password, name?}` → 201 `{id, email, name}` |
| POST   | `/auth/login` | `{email, password}` → 200 `{token, user{id,email,name}}` |
| GET    | `/auth/me` | (requer `Authorization: Bearer <token>`) → `{id, email, name}` |

Todas as demais rotas exigem header `Authorization: Bearer <token>` (exceto `/auth/*` e `/api/docs/*`). O usuário só acessa seus próprios dados (`userId`).


## Ativos

| Método | Rota          | Corpo                                                  |
| ------ | ------------- | ------------------------------------------------------ |
| GET    | `/assets`     | `?page&pageSize` opcionais (ver paginação)             |
| POST   | `/assets`     | `{symbol, name, assetClass, source?, currency?}` → 201 |
| GET    | `/assets/:id` | —                                                      |
| PUT    | `/assets/:id` | parcial dos campos acima                               |
| DELETE | `/assets/:id` | 204                                                    |

`symbol` é normalizado para maiúsculas.

## Paginação

`GET /assets`, `/portfolios`, `/transactions` e `/dividends` aceitam `?page=N&pageSize=M` (pageSize ≤ 100). Sem os parâmetros devolvem o array (compatível); com eles, `{data, page, pageSize, total}`.

## Preços

| Método | Rota                             | Descrição                                                                                                                                                                                        |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/assets/:id/prices?from&to`     | Série ordenada por data                                                                                                                                                                          |
| POST   | `/assets/:id/prices`             | 1 objeto ou array `{date, close, open?, high?, low?, adjustedClose?, volume?}`; upsert por data (fonte `MANUAL`); `adjustedClose` default = `close`                                              |
| POST   | `/assets/:id/prices/import`      | CSV (`Content-Type: text/csv`): `date,close[,open,high,low,adjustedClose,volume]`, com ou sem cabeçalho (EN/PT), datas ISO ou DD/MM/AAAA → 201 `{saved, errors[]}` (400 se nenhuma linha válida) |
| DELETE | `/prices/:id`                    | 204                                                                                                                                                                                              |
| GET    | `/assets/:id/indicators?from&to` | Série mensal de indicadores do FII (P/VP, DY, patrimônio, cotistas), mais recente primeiro                                                                                                       |
| GET    | `/assets/:id/fund-indicators`    | Snapshot do fundo (preço, cota, ágio/deságio, DY mensal); 404 sem snapshot                                                                                                                       |

Não há PUT: reenviar o POST para a mesma data substitui a barra inteira (campos omitidos viram `null`).

## Avaliação (brapi ao vivo, sem persistência)
| Rota | Parâmetros | Resposta |
|---|---|---|
| `GET /screener` | Filtros (`trailingPEMin/Max`, `priceToBookMin/Max`, `dividendYieldMin/Max`, `returnOnEquityMin`, `enterpriseToEbitdaMax`, `netMarginMin`, `search?`, `sortBy?`, `sortOrder?`, `page?`, `limit?` ≤ 100; extras repassados) | `{results[{symbol, name, sector, quote{lastPrice…}, metrics{P/L, P/VP, DY…}}]}` (métricas Pro podem vir nulas) |
| `GET /fundamentals` | `symbols=A,B&mode=current\|history?&period?&startDate?&endDate?` | `{results[{symbol, data}]}` (`data` opaco) |

## Portfólios, transações, dividendos
CRUD completo (POST/GET/PUT/DELETE):

- `/portfolios` — `{name}`
- `GET /portfolios/:id/position` → `{positions[], totalInvested, totalMarketValue, totalPnl, totalPnlPct}`; cada posição tem `quantity, avgPrice (preço médio), invested, currentPrice, marketValue, pnl, pnlPct, allocationPct`. Preço atual = `close` mais recente (fonte preferencial); P&L não realizado; alocação pondera só posições com preço.
- `/transactions` — `{portfolioId, assetId, type, quantity, unitPrice, fees?, tradedAt, notes?}` (GET inclui `asset`)
- `/dividends` — `{assetId, kind?, amountPerUnit, exDate?, paymentDate}` (GET inclui `asset`)

## Sincronização (brapi)

| Rota                    | Corpo                                                                        | Resposta                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /sync/quotes`     | `{symbols?: string[]}` (padrão: todos `BRAPI` ativos)                        | `{updated, missing[]}`                                                                            |
| `POST /sync/history`    | `{symbols: string[], range?="1y", interval?="1d"}`                           | `{rows}`                                                                                          |
| `POST /sync/dividends`  | `{symbols: string[], startDate?, endDate?}`                                  | `{rows, skipped}`                                                                                 |
| `POST /sync/macro`      | `{slugs: string[] (≤ 20), startDate?, endDate?, limit?}`                     | `{rows, skipped}`                                                                                 |
| `POST /sync/indicators` | `{symbols: string[], startDate?, endDate?}` (só FIIs)                        | `{rows, skipped}`                                                                                 |
| `POST /sync/funds`      | `{symbols: string[], startDate?, endDate?}` (só FUNDs)                       | `{nav: {rows, skipped}, indicators: {rows, skipped}}` (cota→`PriceBar`, snapshot→`FundIndicator`) |
| `POST /sync/treasury`   | `{symbols: string[], startDate?, endDate?}` (só TREASURYs; slugs minúsculos) | `{rows, skipped}` (PU de venda→`close`)                                                           |
| `GET /treasury/list`    | `?search&indexer?`                                                           | Catálogo ao vivo da brapi (sem persistência; para descobrir slugs)                                |

Só atua em ativos com `source = BRAPI` já cadastrados. Sem nenhum ativo BRAPI correspondente, retorna `{updated: 0, missing: []}` / `{rows: 0}` / `{rows: 0, skipped: 0}` sem consumir quota.

`sync/dividends` importa `cashDividends` (`DIVIDENDO`→`DIVIDEND`, `JCP`→`JCP`, `RENDIMENTO`→`RENDIMENTO`, `AMORTIZAÇÃO`→`AMORTIZACAO`, demais labels→`OTHER`) com `source = BRAPI`, idempotente por (ativo, pagamento, tipo, valor). Sem `paymentDate`/valor válido conta como `skipped`; eventos em ações (desdobramento etc.) não são importados.

## Análises e relatórios

| Rota                         | Parâmetros                                                                                                 | Resposta                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /analytics/compare`     | `symbols=A,B&from&to&source?&benchmark=CDI\|SELIC\|IPCA?&riskFree=N\|CDI\|SELIC?&betaVs=CDI\|SELIC\|IPCA?` | `{stats[] (+`sharpe`, `beta` quando pedidos), ranking[], rebased{SYM:[{date,value}]}, benchmark\|null}`               |
| `GET /analytics/correlation` | `symbols=A,B&from&to&source?`                                                                              | `{symbols[], matrix[][], commonPoints[][]}` (Pearson sobre retornos diários em datas comuns; `null` com < 2 retornos) |
| `GET /reports/performance`   | `from&to&assetClass?&format=json\|csv\|pdf\|xlsx&source?&real=1?&riskFree?&betaVs?`                                   | `{from,to,stats[]}` ou CSV/PDF/XLSX (`realReturnPct` sempre presente; preenchido só com `real=1` e IPCA no período)            |

`source` (`BRAPI`\|`MANUAL`, opcional): filtra as barras usadas. Omitido, vale a **fonte preferencial por ativo** — barras `BRAPI` quando existirem no período, senão `MANUAL` (evita pontos duplicados de fontes mistas).

`stats[]`: `symbol, points, startDate, endDate, returnPct, volatilityAnnPct (σ diária·√252), maxDrawdownPct, best, worst`.
Valores ficam `null` quando há menos de 2 pontos válidos.

## Erros

Todo corpo de erro tem `error` (código) e `message` (texto legível); validação inclui `issues`.

| HTTP | Corpo                                                                           | Causa                                                                                   |
| ---- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 400  | `{error:"validation", message, issues}`                                         | Falha no Zod                                                                            |
| 404  | `{error:"not_found", message}`                                                  | Registro inexistente (Prisma P2025)                                                     |
| 404  | `{error:"brapi_not_found", message}`                                            | brapi sem dados                                                                         |
| 409  | `{error:"conflict", message}`                                                   | Símbolo duplicado (P2002) ou registro em uso (P2003, ex.: excluir ativo com transações) |
| 429  | `{error:"brapi_rate_limited", message}` + `Retry-After`                         | Quota/concorrência da brapi                                                             |
| 502  | `brapi_auth` / `brapi_plan` / `brapi` / `brapi_invalid_response`, com `message` | Token inválido, plano insuficiente, resposta fora do schema, falha upstream             |
| 500  | `{error:"internal", message}`                                                   | Inesperado                                                                              |

Obs.: em `POST /assets/:id/prices`, `volume` deve ser inteiro não negativo (senão 400).
