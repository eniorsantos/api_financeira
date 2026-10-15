# Arquitetura

## Objetivo

Painel web para analisar e comparar ativos brasileiros (ações, FIIs, fundos, Tesouro Direto) pela oscilação
em um período, com dashboard interativo, histórico, relatórios, entrada manual de dados e sincronização
automática via API brapi. Tudo é persistido em banco, com CRUD.

## Stack

| Camada      | Tecnologia                                                                              | Motivo                                                                     |
| ----------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Front-end   | React 18, Vite, TanStack Query, Recharts, react-router-dom                              | SPA interativa, cache/refetch declarativo, gráficos                        |
| Validação   | Zod (back e front)                                                                      | Tipos inferidos do schema; valida entradas e respostas externas em runtime |
| Back-end    | Node 22, Fastify 5, TypeScript estrito, @fastify/jwt, bcryptjs                         | Rápido, tipado, simples de testar, autenticação JWT                        |
| Banco       | PostgreSQL 16 + Prisma 6                                                                | Tipos gerados do schema; `Decimal` para dinheiro                           |
| Integração  | Cliente próprio da brapi (`backend/src/brapi`)                                          | Retry de 429, erros tipados, tolerância a `null`                           |
| Testes      | Vitest (back + front)                                                                   | Cliente brapi, cálculos, rotas de API, componentes React                   |
| Infra local | Docker Compose (Postgres + backend + frontend)                                          | Subir todo o stack com um comando                                            |
| CI/CD       | GitHub Actions (lint, typecheck, testes, build)                                         | Validação contínua                                                         |

TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

## Diagrama

```mermaid
flowchart LR
  U[Navegador<br/>React + Recharts] -->|/api (proxy Vite / nginx)| B[Fastify API + JWT]
  B --> S[Services<br/>sync · analytics · auth]
  S --> P[(PostgreSQL<br/>via Prisma)]
  S --> C[BrapiClient]
  C -->|Authorization: Bearer BRAPI_TOKEN| X[brapi.dev /api/v2]
  U -->|Authorization: Bearer JWT| B
```

## Camadas do back-end (`backend/src`)

- `server.ts` — bootstrap Fastify, CORS, scheduler de sync, escuta em `PORT`.
- `app.ts` — montagem (`buildApp()`), plugin de auth JWT, handler global de erros (mapeia Zod, Prisma, brapi, `AUTH_REQUIRED`).
- `auth.ts` — plugin JWT (`@fastify/jwt`), `requireAuth()`, `hashPassword/comparePassword` (bcryptjs), `signToken()`.
- `routes/api.ts` — rotas REST (CRUD + sync + analytics + relatórios + auth), validação com Zod, todos os dados filtrados por `userId`.
- `services/sync.ts` — orquestra brapi → banco (cotações, histórico, dividendos, indicadores FII, snapshot fundos, macro, Tesouro), grava `SyncLog`.
- `services/analytics.ts` — funções puras: retorno, volatilidade, drawdown, base 100, ranking, Sharpe, beta, correlação.
- `services/portfolio.ts` — posição por preço médio, P&L não realizado, alocação.
- `brapi/` — `client.ts`, `schemas.ts` (Zod), `errors.ts`.
- `db.ts` — instância única do `PrismaClient`.
- `scripts/smoke.ts` — teste manual contra a brapi real.

## Decisões

1. **Token da brapi só no servidor.** O front nunca chama a brapi; o proxy expõe só `/api`.
2. **JWT para autenticação de usuários.** Login/registro em `/auth/*`; token enviado em `Authorization: Bearer <jwt>`; todos os dados filtrados por `userId`.
3. **Zod nas respostas da brapi.** Campos numéricos/texto aceitam `null` e são normalizados para `null`.
4. **Dados persistidos antes de exibir.** O dashboard lê do banco, não da brapi; poupa quota e permite histórico próprio.
5. **`adjustedClose` para retorno.** Considera proventos, desdobramentos e grupamentos.
6. **`Decimal` no banco**, `number` nos cálculos de análise (aceitável para métricas; não usar para contabilidade).
7. **Fonte por ativo** (`MANUAL`/`BRAPI`) e por barra de preço, permitindo conviver dado manual e automático.

## Relatórios

- `GET /reports/performance` suporta `format=json\|csv\|pdf\|xlsx`. CSV e XLSX gerados com `exceljs`; PDF com `pdfkit`.
- Gráfico de drawdown no front (Dashboard) mostra running máximo da série base 100.

