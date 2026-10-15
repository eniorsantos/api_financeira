# Painel de Análise Financeira

Stack 100% TypeScript, tipagem estrita ponta a ponta.

| Camada | Escolha | Por quê |
|---|---|---|
| Front-end | React 18 + Vite + TanStack Query + Recharts | Dashboard interativo, cache de requisições, gráficos |
| Validação | Zod (back e front) | Tipos inferidos do schema; respostas externas validadas em runtime |
| Back-end | Node 22 + Fastify 5 + @fastify/jwt | Rápido, tipado, simples, autenticação JWT |
| Banco | PostgreSQL 16 + Prisma 6 | Tipos gerados do schema, `Decimal` para dinheiro |
| Integração | Cliente brapi próprio (`backend/src/brapi`) | Retry de 429, erros tipados, null-safe |
| Testes | Vitest | Cliente brapi, analytics, rotas de API, componentes React |
| Infra | Docker Compose (Postgres + backend + frontend) | Todo o stack com um comando |
| CI/CD | GitHub Actions | lint, typecheck, testes, build |

## Operações brapi usadas (v2)
- `GET /api/v2/stocks/quote?symbols=A,B` — cotação (ações, FIIs, ETFs, BDRs) em 1 chamada.
- `GET /api/v2/stocks/historical?symbols=A,B&range=1y&interval=1d` — OHLCV + `adjustedClose` (base do retorno).
- `GET /api/v2/stocks/dividends`, `GET /api/v2/fii/dividends`, `GET /api/v2/funds/dividends` — proventos.
- `GET /api/v2/fii/indicators/history`, `GET /api/v2/fii/indicators` — indicadores FII.
- `GET /api/v2/funds/nav/history`, `GET /api/v2/funds/indicators` — fundos (NAV, snapshot).
- `GET /api/v2/treasury/indicators/history`, `GET /api/v2/treasury/list` — Tesouro Direto (PU, catálogo).
- `GET /api/v2/macro?symbols=selic,cdi,ipca` — macro (benchmark, retorno real IPCA).
- `GET /api/v2/stocks/screener`, `GET /api/v2/stocks/statistics` — avaliação/fundamentalista.

Próximas (mesmo padrão do cliente): indicadores avançados, PDF/XLSX de posição da carteira, proventos agregados.

## Rodando
```bash
docker compose up -d
cd backend && cp .env.example .env     # preencha BRAPI_TOKEN e JWT_SECRET
npm i && npx prisma migrate dev && npm run dev
cd ../frontend && npm i && npm run dev   # http://localhost:5173
```
Smoke test (PETR4 + VALE3, funciona até sem token): `cd backend && npm run brapi:smoke`

## Autenticação
A API exige JWT em todas as rotas exceto `/auth/*`:
- `POST /api/auth/register` — `{email, password, name?}`
- `POST /api/auth/login` — `{email, password}` → `{token, user}`
- `GET /api/auth/me` — dados do usuário (requer `Authorization: Bearer <token>`)

## Segurança do token
`BRAPI_TOKEN` é lido de `process.env` no servidor e enviado em `Authorization: Bearer` para a brapi.
Nunca vai ao front (o Vite/nginx só faz proxy de `/api`), à URL, aos logs (header redigido) ou ao git (`.env` ignorado).
`JWT_SECRET` assina os tokens de sessão do usuário; defina um valor forte em produção.

## Relatórios
`GET /api/reports/performance?format=json\|csv\|pdf\|xlsx` — exporta performance em JSON, CSV, PDF ou XLSX, com suporte a benchmark (CDI/Selic/IPCA), risk-free (Sharpe), beta e retorno real (IPCA).

Documentação completa em [`docs/`](docs/README.md). Veja `docs/STATUS-E-ROADMAP.md` para o que falta.
