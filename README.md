# Intrex Backend

API server for the Intrex platform. Provides authentication, customer/box/product management, shipping quotes and shipments, Shopify integration, and billing support.

## Stack
- Node.js + Express
- PostgreSQL (via Sequelize)
- Integrations: UPS, FedEx, Shopify, Asaas

## Project structure
- `server.js`: app bootstrap, middleware, and route mounting
- `routes/`: API route modules
- `controller/`: request handlers and business logic
- `models/`: Sequelize models
- `services/`: carrier integrations and helpers
- `utils/`: shared helpers (validation, normalization, currency)
- `middleware/`: auth, Shopify session, uploads
- `jobs/`: scheduled jobs

## Running locally

1) Install dependencies

```bash
npm install
```

2) Create a `.env` file (see Environment Variables below)

3) Start the server

```bash
npm run dev
```

Server defaults to `http://localhost:3001`.

## Environment variables

Set these in `back-exporta/.env` (names referenced by code):

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

## Main endpoints (high level)

Auth and users:
- `POST /login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /registrarClientes`
- `GET /verClientes`
- `GET /verClienteAtual`
- `GET /me`

Validation:
- `GET /validate/cnpj`
- `GET /validate/cnae`

Boxes:
- `POST /registrarCaixa`
- `GET /verCaixas`
- `PUT /editarCaixa/:id`
- `DELETE /excluirCaixa/:id`

Products:
- `GET /verProdutos`
- `POST /registrarProduto`
- `PUT /editarProduto/:id`
- `DELETE /excluirProduto/:id`

Quotes and shipments:
- `POST /api/cotacoes`
- `GET /api/cotacoes`
- `GET /api/cotacoes/:id`
- `POST /api/shipments/compare`
- `POST /api/shipments/:id/confirm`

Shopify:
- `POST /conectarLoja`
- `POST /shopify/import-pedidos`

Health:
- `GET /health`
- `GET /healthz`

## Notes
- CSRF is required for mutation endpoints (except login/refresh).
- Cron job runs every 15 minutes: `jobs/poolTracking.js`.
