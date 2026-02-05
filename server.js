// server.js — COMPLETO e ATUALIZADO (Intrex + Shopify App)
const express = require("express");
const app = express();

require("dotenv").config();

const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const cron = require("node-cron");

// =====================
// DATABASE
// =====================
const db = require("./models");

// =====================
// LOG BOOT
// =====================
const fedexCfg = require("./config/fedex");
console.log("[BOOT]", {
  NODE_ENV: process.env.NODE_ENV,
  FEDEX_BASE: fedexCfg.base,
});

// =====================
// ROUTES
// =====================
const uploadRouter = require("./routes/upload");
const sse = require("./routes/SSE");

const upsRoutes = require("./routes/upsRoutes");
const fedexRoutes = require("./routes/fedexRoutes");
const shipmentsRoutes = require("./routes/shipmentsRoutes");

// Shopify
const shopifyAuthRoutes = require("./shopify/auth/routes"); // OAuth
const shopifyStatusRoutes = require("./routes/shopifyStatus"); // /shopify/has-token
const shopifyWebhooksRoutes = require("./routes/shopifyWebhooks"); // /shopify/webhooks/orders/create
const shopifyLinkRoutes = require("./routes/shopifyLink"); // ✅ você vai criar esse arquivo (link shop <-> clienteId)

// =====================
// MIDDLEWARES / AUTH
// =====================
const {
  autenticarUsuario,
  vincularCliente,
  autenticarShopify,
  csrfRequired,
} = require("./middleware/auth");

// =====================
// CONTROLLERS
// =====================
const {
  registrarCliente,
  verClientes,
  loginCliente,
  verClienteAtual,
} = require("./controller/ClientesController");

const {
  registrarCaixa,
  verCaixas,
  excluirCaixa,
  editarCaixa,
} = require("./controller/CaixaController");

const {
  verProdutos,
  registrarProduto,
  editarProduto,
  excluirProduto,
} = require("./controller/ProdutoController");

const { registrarLojaShopify } = require("./controller/ShopifyController");
const { listPedidos } = require("./controller/PedidoImportController");

const { uploadOrdersMinimal } = require("./controller/pedidosMinimalController");
const { uploadOrder } = require("./middleware/shopifyAuth");

const { pool } = require("./jobs/poolTracking");
const { valorConversao } = require("./utils/dolar");

const { validateCNPJ } = require("./utils/cnpj");
const { validateCNAE } = require("./utils/cnae");

const { refresh, logout } = require("./routes/authRoutes");
const { applySecurity } = require("./bootstrap/security");
const { applyLogging, errorHandler } = require("./bootstrap/loggin");

// =====================
// CONFIG
// =====================
const PORT = process.env.PORT || 3001;

const allowlist = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// =====================
// GLOBAL MIDDLEWARES (ORDEM IMPORTA)
// =====================

// CORS
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // postman/curl
      return cb(null, allowlist.includes(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"],
    exposedHeaders: ["Authorization", "Content-Disposition"],
  })
);

// 🔴 IMPORTANTE: rawBody PARA WEBHOOK SHOPIFY (HMAC do webhook precisa do corpo bruto)
app.use(
  "/shopify/webhooks",
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

// JSON normal (para o resto)
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

// Cookies (OAuth state / csrf)
app.use(cookieParser());

app.use(compression({ threshold: 0 }));

applySecurity(app);
applyLogging(app);

// =====================
// CRON
// =====================
cron.schedule("*/60 * * * *", pool);

// =====================
// STATIC
// =====================
app.use(
  "/exports",
  express.static(path.join(__dirname, "exports"), {
    maxAge: "1h",
    etag: true,
  })
);

// =====================
// SHOPIFY
// =====================
// OAuth + status + vínculo + webhooks
app.use("/shopify", shopifyAuthRoutes); // /shopify/auth, /shopify/auth/callback
app.use("/shopify", shopifyStatusRoutes); // /shopify/has-token

// ✅ Vínculo shop <-> clienteId (rota para o cliente logado vincular a loja)
app.use("/shopify", shopifyLinkRoutes);

// Webhooks (usa rawBody)
app.use("/shopify/webhooks", shopifyWebhooksRoutes);

// =====================
// API
// =====================
app.use("/sse", sse.router);
app.use("/upload", uploadRouter);

app.use("/api/ups", upsRoutes);
app.use("/api/fedex", fedexRoutes);
app.use("/api/shipments", shipmentsRoutes);

app.use(
  "/api/cotacoes",
  autenticarUsuario,
  vincularCliente,
  require("./routes/cotacoesRoutes")
);

app.use(
  "/api/relatorio",
  autenticarUsuario,
  vincularCliente,
  require("./routes/relatorioPagamentos")
);

app.use("/api/rate", require("./routes/rateMulti"));
app.use(require("./routes/debugFedex"));

// =====================
// HEALTH
// =====================
app.get("/health", (_req, res) => res.send("ok"));
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// =====================
// CLIENTES
// =====================
app.post("/registrarClientes", registrarCliente);
app.post("/login", loginCliente);
app.get("/verClientes", verClientes);
app.get("/verClienteAtual", autenticarUsuario, verClienteAtual);

app.get("/me", autenticarUsuario, (req, res) => {
  const u = req.usuario || req.user;
  if (!u) return res.status(401).json({ erro: "Não autenticado" });

  return res.json({
    id: u.id ?? null,
    email: u.email ?? null,
    clienteId: u.clienteId ?? null,
    roles: u.roles || [],
    razaoSocial: u.razaoSocial ?? null,
  });
});

app.post("/auth/refresh", refresh);
app.post("/auth/logout", logout);

// =====================
// VALIDADORES
// =====================
app.get("/validate/cnpj", async (req, res) => {
  try {
    const out = await validateCNPJ(req.query.cnpj);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ valid: false, reason: "server" });
  }
});

app.get("/validate/cnae", async (req, res) => {
  try {
    const out = await validateCNAE(req.query.cnae);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ valid: false, reason: "server" });
  }
});

// =====================
// CAIXAS
// =====================
app.post(
  "/registrarCaixa",
  autenticarUsuario,
  vincularCliente,
  csrfRequired,
  registrarCaixa
);
app.get("/verCaixas", autenticarUsuario, vincularCliente, verCaixas);
app.delete(
  "/excluirCaixa/:id",
  autenticarUsuario,
  vincularCliente,
  csrfRequired,
  excluirCaixa
);
app.put(
  "/editarCaixa/:id",
  autenticarUsuario,
  vincularCliente,
  csrfRequired,
  editarCaixa
);

// =====================
// PRODUTOS
// =====================
app.get("/verProdutos", autenticarUsuario, verProdutos);
app.post(
  "/registrarProduto",
  autenticarUsuario,
  vincularCliente,
  csrfRequired,
  registrarProduto
);
app.put("/editarProduto/:id", autenticarUsuario, csrfRequired, editarProduto);
app.delete(
  "/excluirProduto/:id",
  autenticarUsuario,
  csrfRequired,
  excluirProduto
);

// =====================
// SHOPIFY (sua plataforma)
// =====================
app.post(
  "/conectarLoja",
  autenticarUsuario,
  vincularCliente,
  csrfRequired,
  registrarLojaShopify
);

// Import pedidos (CSV)
app.post(
  "/shopify/import-pedidos",
  autenticarShopify,
  vincularCliente,
  csrfRequired,
  uploadOrder.fields([{ name: "file" }, { name: "sku_master" }]),
  async (req, res) => uploadOrdersMinimal(req, res, false)
);

app.get("/pedidos", autenticarUsuario, vincularCliente, listPedidos);

// =====================
// FINANCEIRO
// =====================
app.post(
  "/boletos",
  autenticarUsuario,
  vincularCliente,
  require("./controller/Asaas").gerarBoleto
);

app.get("/dolar", async (_req, res) => {
  try {
    const v = await valorConversao();
    return res.json({ valor: v });
  } catch (e) {
    return res.status(500).json({ erro: "Erro ao buscar dólar" });
  }
});

// =====================
// ERROR HANDLERS
// =====================
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err?.response?.status || 500;
  return res.status(status).json({
    ok: false,
    error: err?.message || "Internal error",
  });
});

app.use((_req, res) => res.status(404).json({ error: "Not Found" }));
app.use(errorHandler);

// =====================
// START
// =====================
db.sequelize
  .sync()
  .then(() => {
    console.log("✅ Banco sincronizado");
    app.listen(PORT, () => console.log(`🚀 Backend rodando na porta ${PORT}`));
  })
  .catch((e) => {
    console.error("❌ Erro ao sincronizar banco:", e);
  });

module.exports = { app };
