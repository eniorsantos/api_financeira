# Status e Roadmap

Legenda: ✅ feito e verificado · 🟡 feito, não verificado · ❌ não feito

## 1. Verificação realizada (2026-10-14, atualizada 2026-10-15)

- ✅ 72 testes passam no back-end: 31 unitários (cliente brapi, analytics, risco, carteira, CSV, scheduler, sync) e 41 de integração das rotas (CRUD, posição, paginação, 404/409/400, sync com brapi simulada incl. syncAll, compare, benchmarks, screener, OpenAPI, CSV/PDF/XLSX) contra Postgres de teste (`finance_test`, `migrate deploy` automático no `globalSetup`).
- ✅ 3 testes de front passam (Vitest + React Testing Library: Dashboard, Relatórios, Avaliação).
- ✅ Back-end: `typecheck` limpo com o Prisma client gerado; `prisma validate` OK.
- ✅ Front-end: `typecheck` e `lint` limpos.
- ✅ Migrations executadas contra PostgreSQL 16 (Docker Compose) e versionadas em `backend/prisma/migrations/`.
- ✅ Smoke real da brapi (PETR4/VALE3 via `brapi:smoke` + API viva): `sync/quotes` (2 atualizadas), `sync/history` (44 barras), `compare` (PETR4 +14,83%, VALE3 −10,90% no mês), CSV de performance.
- ✅ Erros ao vivo verificados: 409 símbolo duplicado, 409 exclusão com transação, 400 volume fracionário (com `issues`), 404 com `message`.
- ✅ Front: `tsc -b && vite build` compila (aviso de chunk > 500 kB, apenas cosmético).
- 🟡 Rotas/sync funcionam ao vivo, mas ainda sem testes de integração automatizados.
- **Causa raiz do bloqueio anterior do Prisma:** o `schema.prisma` usava blocos em linha única (`model X { ... }`), que o parser atual rejeita (P1012). Reescrito em multilinha — `prisma generate`/`migrate` funcionam de novo.
- **Porta do banco:** compose publica `5433:5432` porque há um Postgres 18 local ocupando a 5432 (ver `docker-compose.yml` e `DATABASE_URL`).

## 2. Implementado

| Área       | Item                                                                                                                             | Estado |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Integração | Cliente `stocks/quote`, `stocks/historical`, `stocks/dividends`, `fii/dividends`, `fii/indicators`, `funds/nav/history`, `funds/indicators`, `funds/dividends`, `treasury/indicators/history`, `treasury/list`, `macro`, retry 429, erros tipados, null-safe | ✅     |
| Dados      | Schema Prisma (ativos, preços, cotações, dividendos, carteiras, transações, sync log, macro, FII indicators, fund snapshot) + unique de dividendos para o sync                                     | ✅     |
| CRUD       | Ativos, preços (POST upsert/GET/DELETE), portfólios, transações, dividendos                                                      | ✅     |
| Entrada    | Manual (`POST /assets/:id/prices`) e automática (`/sync/*`, inclui dividendos, indicadores FII, snapshot fundos, macro, Tesouro)                                                   | ✅     |
| Análise    | Retorno, volatilidade, drawdown, melhor/pior dia, ranking, base 100                                                              | ✅     |
| Carteira   | Posição por preço médio, P&L não realizado, alocação (`GET /portfolios/:id/position`)                                            | ✅     |
| Relatórios | Performance por período/classe/fonte em JSON, CSV e PDF/XLSX (benchmark, risk-free, beta, retorno real IPCA) | ✅     |
| Front      | Dashboard + páginas Ativos (CRUD + preços manuais), Carteira (transações, posição, proventos + sync) e Relatórios (tabela + CSV) | 🟡     |
| Segurança  | Token só no servidor, header redigido nos logs, autenticação JWT + multiusuário (dados com dono via userId)                    | ✅     |

## 3. NÃO desenvolvido (lacunas em relação ao pedido)

**Requisitos do pedido ainda sem cobertura**

- ❌ **Avaliação de ativos** (scorecard, P/L, P/VP, DY, comparação fundamentalista profunda). Existem só métricas de oscilação e screener da brapi (métricas Pro podem vir nulas).
- ❌ **Relatórios diversos:** performance + posição da carteira prontos. Faltam evolução patrimonial, proventos agregados, rentabilidade por classe.
- ✅ **Exportação PDF/XLSX:** `/reports/performance?format=pdf|xlsx` integrado.
- ✅ **Dividendos via API:** `stocks/dividends`, `fii/dividends` e `funds/dividends` integrados (sync idempotente).
- ✅ **Fundos de investimento, FIIs (indicadores) e Tesouro Direto via API:** `funds/nav/history`, `funds/indicators`, `fii/indicators/history`, `treasury/indicators/history`, `treasury/list` integrados (sync idempotente).
- ✅ **Métricas de carteira:** preço médio, posição, lucro/prejuízo, alocação (`services/portfolio.ts` + endpoint; sem rentabilidade ponderada por classe).
- ✅ **Autenticação/autorização e multiusuário:** JWT, login, registro, dados com dono (`userId`), rotas protegidas.

**Front-end**

- 🟡 Telas/formulários de CRUD (ativos, transações, dividendos, preços manuais, importação CSV). Falta: edição inline de ativo.
- ✅ Roteamento (react-router) com páginas Dashboard, Ativos, Carteira e Relatórios + layout. Falta: tema, responsividade refinada.
- ❌ Gráficos de candle/OHLC, volume, histograma de retornos.
- ✅ Gráfico de drawdown no Dashboard (área, running máximo da base 100).
- ❌ Tratamento visual de estados vazios, 429 com contagem regressiva, toasts.
- ✅ Testes de front (Vitest + React Testing Library: Dashboard, Relatórios, Avaliação).

**Back-end e dados**

- ~~Migrations versionadas~~ ✅ versionadas em `backend/prisma/migrations/`; **seeds** ❌.
- ✅ Agendador de sincronização in-process (`services/scheduler.ts`, `SYNC_ENABLED=1`, sem sobreposição); sem fila distribuída.
- ✅ Paginação opt-in em listagens (`/assets`, `/portfolios`, `/transactions`, `/dividends` com `?page&pageSize`).
- ✅ Testes de integração de rotas com Postgres de teste (`finance_test`) e brapi simulada.
- ✅ OpenAPI/Swagger em `/api/docs` (esqueleto: paths/métodos; sem schemas detalhados por rota).
- ✅ Dockerização do app: `Dockerfile` para backend e frontend, `docker-compose.yml` com db/backend/frontend.
- ✅ CI/CD: GitHub Actions (lint, typecheck, testes backend+frontend, build).
- 🟡 Observabilidade (métricas, tracing), healthcheck. Feito: lint/format (eslint+prettier).
- ✅ Cache em memória no `BrapiClient` (TTL por operação; `BRAPI_CACHE=0` desliga). Redis pendente.

## 4. Problemas e limitações conhecidos

1. ~~**Exclusão de ativo com transações** falha com 500~~ — **corrigido:** P2002/P2003 → 409 `conflict` (e `POST`/`PUT` com símbolo duplicado também).
2. ~~**Misturar fontes**~~ — **corrigido:** `compare`/`performance` aceitam `?source=BRAPI|MANUAL`; omitido, usam a fonte preferencial por ativo (BRAPI quando houver barras no período, senão MANUAL). `sync/history` só chama a brapi com símbolos de ativos BRAPI (sem quota para manuais) e retorna `{rows: 0}` quando não há nada a sincronizar.
3. ~~**`upsert` em laço** no sync de histórico~~ — **corrigido:** upserts em lotes de 100 dentro de `$transaction` (sync e `POST /prices`).
4. **Ticker renomeado:** o sync casa por `requestedSymbol`; o `symbol` atual retornado não é persistido nem sugerido ao usuário.
5. **Fuso/horário:** `date` Unix → `Date` UTC → coluna `DATE`; pregões podem cair em dia adjacente dependendo do horário de origem. Validar com dados reais.
6. **Respostas `quote` sem `regularMarketPrice`** são descartadas silenciosamente (só o log de sync conta `ok`).
7. **`Retry-After` > 60 s** não é aguardado; o erro sobe imediatamente.
8. **Unidades:** `volatilityAnnPct` assume 252 pregões; Tesouro/fundos com marcação mensal exigem outra frequência.
9. **Nomenclatura do token:** requisito pede `BRAPI_TOKEN`; a doc da brapi usa `BRAPI_API_KEY`.
10. **Estimativa em `number`:** métricas usam ponto flutuante; não adequadas para fins contábeis/fiscais.
11. **Aviso:** o painel não é recomendação de investimento.
12. **`volume` em preços manuais** agora exige inteiro não negativo (400 em fração) — decisão de sanidade, não do requisito.
13. **Resposta brapi fora do schema** vira 502 `brapi_invalid_response` (nunca 400, que indicaria erro do cliente).

## 5. Roadmap sugerido

**Fase 0 — Validar o que existe (concluída em 2026-10-14, exceto fonte)**

1. ~~`npx prisma migrate dev`, commitar migrations, `npm run typecheck`~~ ✅
2. ~~`npm run brapi:smoke` com PETR4/VALE3 e registrar a resposta na documentação~~ ✅ (resposta real registrada na seção 1)
3. ~~Corrigir itens 1, 2 e 3 da seção 4~~ ✅ (fonte preferencial incluída).

**Fase 1 — MVP utilizável**

- ✅ Telas de CRUD (ativos, preços manuais, transações, dividendos) + importação CSV.
- ✅ Roteamento e páginas: Dashboard, Ativos, Carteira, Relatórios.
- ✅ Cálculos de carteira (posição, preço médio, P&L, alocação).
- ✅ Dividendos via API: `stocks/dividends` e `fii/dividends`.
- ✅ Testes de integração de rotas + paginação opt-in das listagens.

**Fase 2 — Cobertura de classes de ativo (concluída)**

- ✅ FIIs: `fii/indicators/history` + snapshot `fii/indicators` (P/VP, DY, patrimônio, cotistas)
- ✅ Fundos: `funds/nav/history` (cota→`PriceBar`), `funds/indicators` (snapshot) e `funds/dividends` (proventos)
- ✅ Tesouro: `treasury/indicators/history` (PU→`PriceBar`) + `treasury/list` (catálogo para descobrir slugs)
- ✅ Macro: `macro` (Selic, CDI, IPCA) com sync + benchmark no comparativo + retorno real (descontando IPCA)
- ✅ Comparativos entre classes com benchmark e rentabilidade real (descontando IPCA) — `/analytics/compare` e `/reports/performance` com `benchmark`, `riskFree`, `betaVs`, `real`

**Fase 3 — Avaliação e relatórios (concluída)**

- ✅ Screener/avaliação (`stocks/screener` com filtros + `stocks/statistics` como envelope) e endpoints `/screener`, `/fundamentals`.
- ✅ Risco: Sharpe (com risk-free número/CDI/Selic), beta vs CDI/Selic/IPCA e matriz de correlação (API + Relatórios).
- ✅ Exportação CSV, PDF e XLSX em `/reports/performance?format=csv|pdf|xlsx`.
- ✅ Gráfico de drawdown no front (Dashboard).
- ❌ Pendente: PDF/XLSX de posição da carteira, relatório de proventos agregados, rentabilidade por classe.

**Fase 4 — Produção (em andamento)**

- ✅ Autenticação (JWT), multiusuário, dados com dono (`userId`).
- ✅ Agendador in-process + cache em memória.
- ✅ Lint/format e OpenAPI (esqueleto).
- ✅ Docker do app (backend + frontend + postgres via docker-compose).
- ✅ CI/CD (GitHub Actions: lint, typecheck, testes, build).
- ❌ Pendente: fila distribuída, Redis, observabilidade, backup do banco, Docker do app em produção, testes E2E (Playwright).

## 6. Critérios de aceite sugeridos para "MVP concluído"

- Todos os endpoints com teste de integração e sem erros de tipo.
- Usuário cadastra ativo manual e via API, vê histórico e compara ≥ 3 ativos de classes diferentes.
- Relatório de carteira exportável.
- 401/403/404/429 da brapi exibidos de forma compreensível na UI.
