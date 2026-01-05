# Intrex Backend

Servidor de API da plataforma Intrex. Oferece autenticacao, gestao de clientes/caixas/produtos, cotacoes e remessas, integracao com Shopify e suporte a cobranca.

## Stack
- Node.js + Express
- PostgreSQL (via Sequelize)
- Integracoes: UPS, FedEx, Shopify, Asaas

## Estrutura do projeto
- `server.js`: bootstrap do app, middlewares e montagem de rotas
- `routes/`: modulos de rotas da API
- `controller/`: handlers e logica de negocio
- `models/`: modelos do Sequelize
- `services/`: integracoes de transportadoras e helpers
- `utils/`: helpers compartilhados (validacao, normalizacao, moeda)
- `middleware/`: auth, sessao Shopify, uploads
- `jobs/`: tarefas agendadas

## Rodando localmente

1) Instale dependencias

```bash
npm install
```

2) Crie um arquivo `.env` (veja Variaveis de ambiente abaixo)

3) Inicie o servidor

```bash
npm run dev
```

Servidor padrao em `http://localhost:3001`.

## Variaveis de ambiente

Defina em `back-exporta/.env` (nomes referenciados no codigo):

- `NODE_ENV`
- `PORT`
- `CORS_ALLOWED_ORIGINS`
- `FRONTEND_URL`

Auth:
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `AUTH_DEBUG`

Database:
- `SUPABASE_DB_URL`
- `DB_PORT`

Shopify:
- `SHOPIFY_APP_URL`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_API_SCOPES`
- `SHOPIFY_VERSION`

UPS:
- `UPS_ENV`
- `UPS_BASE_URL_PROD`
- `UPS_BASE_URL_CIE`
- `UPS_ACCOUNT`
- `UPS_ACCOUNT_NUMBER`
- `UPS_CLIENT_ID`
- `UPS_CLIENT_SECRET`
- `UPS_TRACK_LOCALE`
- `UPS_STUB`

FedEx:
- `FEDEX_BASE_URL_PROD`
- `FEDEX_BASE_URL`
- `FEDEX_KEY`
- `FEDEX_KEY_SECRET`
- `FEDEX_KEY_TRACK`
- `FEDEX_KEY_SECRET_TRACK`
- `FEDEX_ACCOUNT_NUMBER`
- `FEDEX_SCOPE`
- `FEDEX_TIMEOUT_MS`
- `FEDEX_STUB`

Asaas:
- `ASAAS_TOKEN_PROD`
- `ASAAS_TOKEN_SANDBOX`

Other:
- `AWESOMEAPI_TOKEN`
- `UPLOAD_MAX_MB`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LOG_LEVEL`
- `HTTP_LOG`

## Principais endpoints (alto nivel)

Auth e usuarios:
- `POST /login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /registrarClientes`
- `GET /verClientes`
- `GET /verClienteAtual`
- `GET /me`

Validacao:
- `GET /validate/cnpj`
- `GET /validate/cnae`

Caixas:
- `POST /registrarCaixa`
- `GET /verCaixas`
- `PUT /editarCaixa/:id`
- `DELETE /excluirCaixa/:id`

Produtos:
- `GET /verProdutos`
- `POST /registrarProduto`
- `PUT /editarProduto/:id`
- `DELETE /excluirProduto/:id`

Cotacoes e remessas:
- `POST /api/cotacoes`
- `GET /api/cotacoes`
- `GET /api/cotacoes/:id`
- `POST /api/shipments/compare`
- `POST /api/shipments/:id/confirm`

Shopify:
- `POST /conectarLoja`
- `POST /shopify/import-pedidos`

Saude:
- `GET /health`
- `GET /healthz`

## Notas
- CSRF e obrigatorio para endpoints de mutacao (exceto login/refresh).
- O cron roda a cada 60 minutos: `jobs/poolTracking.js`.
