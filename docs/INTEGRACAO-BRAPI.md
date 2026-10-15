# Integração com a brapi

Referências: https://brapi.dev/llms.txt · https://brapi.dev/openapi.json · dicionário de campos: `GET https://brapi.dev/api/v2/dictionary`.

## Operações usadas

| Operação                                                                                               | Uso                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v2/stocks/quote?symbols=A,B`                                                                 | Cotação (ações, FIIs, ETFs, BDRs, units, índices); vários tickers por chamada                                                                                                          |
| `GET /api/v2/stocks/historical?symbols=…&range=&interval=` (ou `startDate`/`endDate`, `sortOrder`)     | OHLCV + `adjustedClose`; padrão `range=1mo&interval=1d`                                                                                                                                |
| `GET /api/v2/stocks/dividends?symbols=…` (opcional `startDate`/`endDate`)                              | Proventos em dinheiro (`cashDividends`: DIVIDENDO/JCP por ação) → `Dividend` com `source = BRAPI`; idempotente                                                                         |
| `GET /api/v2/fii/dividends?symbols=…` (opcional `startDate`/`endDate`)                                 | Rendimentos/amortizações de FIIs (resposta **flat**, casa por `symbol`) → `Dividend` (`RENDIMENTO`/`AMORTIZACAO`); idempotente                                                         |
| `GET /api/v2/macro?symbols=selic,cdi,ipca…` (opcional `startDate`/`endDate`/`limit`, ≤ 20 séries)      | Séries macro (`series{slug,unit,frequency,…}` + `observations[{date,value}]`) → `MacroPoint`; frequências variam (Selic/CDI diários, IPCA mensal). Exige token (401 sem `BRAPI_TOKEN`) |
| `GET /api/v2/fii/indicators/history?symbols=…` (opcional `startDate`/`endDate`)                        | Série mensal de indicadores de FIIs (P/VP, DY, patrimônio, cotistas; `referenceDate` no último dia do mês) → `FiiIndicator`; idempotente. Plano Pro (MXRF11/HGLG11 livres sem token)   |
| `GET /api/v2/fii/indicators?symbols=…`                                                                 | Snapshot atual do FII (mesmos campos + info do fundo, ignorada) → ponto mais recente em `FiiIndicator`. Plano Pro                                                                      |
| `GET /api/v2/funds/nav/history?symbols=…` (opcional `startDate`/`endDate`/`limit`/`page`; ou `cnpjs`)  | Cota patrimonial de fundos (FIAGRO, FI-Infra, FIF…) → `PriceBar` (`close` = NAV, fonte `BRAPI`); `symbol` null = ignorado. Plano Pro                                                   |
| `GET /api/v2/funds/indicators?symbols=…`                                                               | Snapshot do fundo (preço, cota, ágio/deságio = `priceToNav`) → `FundIndicator` (1 linha por ativo). Plano Pro                                                                          |
| `GET /api/v2/funds/dividends?symbols=…` (opcional `startDate`/`endDate`)                               | Rendimentos de fundos listados (resposta flat) → `Dividend` (`RENDIMENTO`); idempotente. Plano Pro                                                                                     |
| `GET /api/v2/treasury/indicators/history?symbols=…` (slugs minúsculos, opcional `startDate`/`endDate`) | Série diária de taxa e PU → `PriceBar` (`close` = PU de venda, fonte `BRAPI`; casa sem diferenciar maiúsculas). Plano Pro (3 títulos livres sem token)                                 |
| `GET /api/v2/treasury/list?search?&indexer?` | Catálogo de títulos (proxy ao vivo, sem persistência; para descobrir slugs) |
| `GET /api/v2/stocks/screener?…` (filtros `*Min`/`*Max`, `sortBy`, `page`, `limit`) | Ações filtradas por múltiplos (P/L, P/VP, DY, ROE…) com `metrics`; chaves Pro ausentes no Startup. Planos Startup/Pro |
| `GET /api/v2/stocks/statistics?symbols=…` (`mode`/`period`/`startDate`/`endDate`) | Envelope validado, `data` opaco (objeto/array/null conforme modo) |

Tickers inexistentes são omitidos de `results`; sem nenhum resultado → 404. Ticker antigo é trocado pelo atual
(`changed=true`, `requestedSymbol` guarda o enviado). O sync casa pelo `requestedSymbol`.

## Autenticação e variável de ambiente

- Header `Authorization: Bearer <token>`; token lido de **`BRAPI_TOKEN`** no servidor.
- Observação: a documentação da brapi cita `BRAPI_API_KEY` (usada pelos SDKs oficiais). Este projeto usa `BRAPI_TOKEN` por decisão do requisito; o cliente é próprio.
- Sem token, só PETR4, MGLU3, VALE3 e ITUB4 funcionam.
- O token nunca é logado (header redigido), nunca vai na URL nem ao front.

## Tratamento de erros (`brapi/client.ts`)

| Status             | Exceção                                 | Comportamento                                                                                                                                   |
| ------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 400                | `BrapiBadRequestError`                  | Parâmetro inválido ou acima do limite do plano                                                                                                  |
| 401                | `BrapiAuthError`                        | Token ausente/inválido → API devolve 502 `brapi_auth`                                                                                           |
| 403                | `BrapiPlanError`                        | Plano não inclui o recurso → 502 `brapi_plan`                                                                                                   |
| 404                | `BrapiNotFoundError`                    | Sync registra e retorna `missing`                                                                                                               |
| 429                | `BrapiRateLimitError`                   | Aguarda `Retry-After` (segundos ou HTTP-date) e repete até `maxRetries` (2); se a espera for > 60 s ou esgotar, propaga com `retryAfterSeconds` |
| 200 fora do schema | `BrapiError` (`brapi_invalid_response`) | Resposta validada por Zod; JSON inválido ou shape inesperado → 502 (nunca 400)                                                                  |
| outros             | `BrapiError`                            | 502                                                                                                                                             |

## Campos nulos

Todos os campos numéricos/texto dos schemas aceitam `null`/ausente e viram `null`. No sync, cotação sem `regularMarketPrice` é ignorada; barras com `null` são gravadas com `null` e ignoradas nos cálculos.

## Limites do plano

O plano define tickers por chamada, `range`/`interval` aceitos e tamanho da janela por data. `includeRaw=true` exige plano Pro (não usado). Excesso → 400/403.

## Como adicionar uma nova operação

1. Ler a página `.mdx` da operação (ex.: https://brapi.dev/docs/acoes/dividendos.mdx).
2. Criar o schema Zod em `brapi/schemas.ts` (campos `nullish`).
3. Adicionar método em `BrapiClient` usando `this.get(path, query, schema)`.
4. Teste em `client.test.ts` (sucesso, 401, 404, 429, null, resposta inválida).
5. Função em `services/sync.ts`, rota em `routes/api.ts`, registro em `SyncLog`.
