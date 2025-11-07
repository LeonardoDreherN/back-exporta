// app.js
const express = require('express');
const app = express();
const dotenv = require('dotenv');
dotenv.config();
const db = require('./models/index.js');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const cfg = require('./config/ups.js')
const uploadRouter = require('./routes/upload.js');
const compression = require('compression');

const { autenticarUsuario, vincularCliente, autenticarShopify, csrfRequired } = require('./middleware/auth.js');
const { registrarCaixa, verCaixas, excluirCaixa, editarCaixa } = require('./controller/CaixaController.js');
const { registrarCliente, verClientes, loginCliente, verClienteAtual } = require('./controller/ClientesController.js');
const { verProdutosLojaShopify, registrarLojaShopify } = require('./controller/ShopifyController.js');
const { comLoja, garantirInstalada, getAccessTokenForShop } = require('./middleware/shopifyAuth.js');
const { importPedidos, listPedidos } = require('./controller/PedidoImportController.js');
const cron = require('node-cron');
const { pool } = require('./jobs/poolTracking.js');

cron.schedule('*/15 * * * *', pool)

// Módulo de rotas da Shopify (inclui auth/conexao/produtos + upload-minimal + find)
const shopifyModule = require('./routes/shopifyRoutes.js');
const upsRoutes = require('./routes/upsRoutes.js');
const sse = require('./routes/SSE.js');

const allowlist = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // Permite tools sem Origin (curl/Postman) e o próprio server-side
    if (!origin) return cb(null, true);
    const ok = allowlist.includes(origin);
    // se não estiver na lista, NÃO seta ACAO (navegador bloqueia)
    return cb(null, !!ok);
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization','x-csrf-token'],
  exposedHeaders: ['Authorization', 'Content-Disposition'],
}));

// Pré-flight padronizado
// app.options('*', cors());

const PORT = process.env.PORT || 3001;

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.shopify.com;"
  );
  res.removeHeader('X-Frame-Options');
  next();
});

// Polyfill fetch (Node < 18)
if (typeof fetch === 'undefined') {
  global.fetch = (...args) =>
    import('node-fetch').then(({ default: f }) => f(...args));
}

// Utils/validadores e controllers da sua plataforma
const { validateCNPJ } = require('./utils/cnpj');
const { validateCNAE } = require('./utils/cnae.js');
const { verProdutos, registrarProduto, editarProduto, excluirProduto } = require('./controller/ProdutoController.js');
const { getAccessScopesLive } = require('./utils/scopes.js');
const { refresh, logout } = require('./routes/authRoutes.js');
const { applySecurity } = require('./bootstrap/security.js');
const { applyLogging, errorHandler } = require('./bootstrap/loggin.js');

// Middlewares globais
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(cookieParser())
app.use('/sse', sse.router)

app.use("/exports", express.static(path.join(__dirname, "exports"), { maxAge: "1h", etag: true }));
app.use("/upload", uploadRouter)

app.use(compression({ threshold: 0 }));
applySecurity(app);
applyLogging(app);

// Monta TODAS as rotas da Shopify sob /shopify (NÃO duplicar)
app.use('/shopify', shopifyModule);
app.use('/api/ups', upsRoutes);

// Saúde
app.get('/health', (_, res) => res.send('ok'));

// --- Rota raiz (embedded landing com App Bridge) ---
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>appTest</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
  <style>
    html,body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif}
    #root{padding:24px}
    .muted{color:#6b7280}
  </style>
</head>
<body>
  <div id="root">Carregando…</div>

  <script>
  (function () {
    function shopFromHost(host) {
      try {
        var dec = atob(host || '');
        var m = dec.match(/store\\/([a-z0-9-]+)/i);
        if (m) return (m[1].toLowerCase() + '.myshopify.com');
      } catch {}
      return null;
    }

    (async function () {
      // Limpa parâmetros sensíveis
      (function () {
        var p = new URLSearchParams(location.search);
        ['hmac','timestamp','code','state','session'].forEach(function(k){ p.delete(k); });
        if (location.search.indexOf('hmac=') !== -1) {
          history.replaceState({}, '', location.pathname + (p.toString() ? '?' + p.toString() : ''));
        }
      })();

      var params = new URLSearchParams(location.search);
      var host = params.get('host');
      var shop = params.get('shop') || (host ? shopFromHost(host) : null);

      if (!host) {
        // sem host -> sobe para OAuth top-level
        window.top.location.href = location.origin + '/shopify/auth' + (shop?('?shop='+encodeURIComponent(shop)):'');
        return;
      }

      var AB = window.appBridge || window['app-bridge'];
      if (!AB || !AB.createApp) {
        window.top.location.href = location.origin + '/shopify/auth' + (shop?('?shop='+encodeURIComponent(shop)):'');
        return;
      }

      var app = AB.createApp({ apiKey: '${SHOPIFY_API_KEY}', host: host, forceRedirect: true });
      var Redirect = AB.actions.Redirect;

      // Garante instalação (sem chamar outras rotas)
      try {
        var r = await fetch('/shopify/has-token?shop=' + encodeURIComponent(shop || ''));
        var info = await r.json();
        if (!info.hasToken) {
          var target = location.origin + '/shopify/auth?shop=' + encodeURIComponent(shop) + '&host=' + encodeURIComponent(host);
          Redirect.create(app).dispatch(Redirect.Action.REMOTE, target);
          return;
        }
      } catch (e) {
        var t = location.origin + '/shopify/auth?shop=' + encodeURIComponent(shop) + '&host=' + encodeURIComponent(host);
        Redirect.create(app).dispatch(Redirect.Action.REMOTE, t);
        return;
      }

      // Boas-vindas (nenhuma chamada ao backend)
      var handle = (shop || '').replace(/\\.myshopify\\.com$/i,'');
      document.getElementById('root').innerHTML =
        '<h1>Bem-vindo(a) ao appTest</h1>' +
        '<p class="muted">Loja: <strong>' + (handle || '—') + '</strong></p>' +
        '<p class="muted">Seu app foi inicializado dentro do Admin (embedded).</p>' +
        '<a href="${process.env.FRONTEND}/login" target="_top">Voltar para a Intrex</a>';

      // Opcional: TitleBar
      try {
        var TitleBar = AB.actions.TitleBar;
        TitleBar.create(app, { title: 'appTest' });
      } catch {}
    })();
  })();
  </script>
</body>
</html>`);
});

// Debug: conferir lojas e escopos
app.get('/_debug/shops', async (_req, res) => {
  const rows = await db.Shop.findAll({ attributes: ['shop', 'scope', 'updatedAt'] });
  const out = [];
  for (const r of rows) {
    let liveScopes = 'n/a';
    try {
      liveScopes = await getAccessTokenForShop(r.shop, r.accessToken);
    } catch (e) {
      liveScopes = `erro: ${e.message}`;
    }
    out.push({ shop: r.shop, scope: r.scope, updatedAt: r.updatedAt, liveScopes });
  }
  res.json(out);
});

app.get('/_debug/scopes', async (req, res) => {
  try {
    const shop = String(req.query.shop || '').toLowerCase();
    if (!shop) return res.status(400).json({ erro: 'informe ?shop=...' });

    const row = await db.Shop.findOne({ where: { shop }, attributes: ['accessToken','scope'], raw: true });
    if (!row) return res.status(404).json({ erro: 'token não encontrado' });

    let live = [];
    try { live = await getAccessScopesLive(shop, row.accessToken); }
    catch (e) { live = [`erro: ${e.message}`]; }
    res.json({ shop, column_scope: row.scope, live_scopes: live });
  } catch (e) {
    res.status(500).json({ erro: 'falha debug', detalhes: e?.message });
  }
});

// Arquivos estáticos de /exports
const EXPORTS_DIR = path.join(__dirname, 'exports');
app.use('/exports', express.static(EXPORTS_DIR, { maxAge: '1h', etag: true }));


// --- CLIENTES (sua plataforma) ---
app.post('/registrarClientes', registrarCliente);
app.post('/login', loginCliente);
app.get('/verClientes', verClientes);
app.get('/verClienteAtual', autenticarUsuario, verClienteAtual);

app.get('/me', autenticarUsuario, async (req, res) => {
  const u = req.usuario;
  // Se quiser buscar a razão social do cliente no DB:
  // const cliente = await db.Cliente.findByPk(u.clienteId);
  return res.json({
    id: u.id,
    email: u.email,
    clienteId: u.clienteId,
    roles: u.roles || [],
    razaoSocial: u.razaoSocial, // ou cliente?.razaoSocial
  });
});
app.post('/auth/refresh', refresh)
app.post('/auth/logout', logout)

// --- VALIDADORES ---
app.get('/validate/cnpj', async (req, res) => {
  try {
    const { cnpj, online } = req.query;
    const out = await validateCNPJ(cnpj, { online }); // só DV aqui
    return res.status(200).json(out);
  } catch (e) {
    console.error('[/validate/cnpj]', e);
    res.status(500).json({ valid: false, reason: 'server' });
  }
});

app.get('/validate/cnae', async (req, res) => {
  try {
    const { cnae } = req.query;
    const out = await validateCNAE(cnae);
    return res.status(200).json(out);
  } catch (e) {
    console.error('[/validate/cnae]', e);
    res.status(500).json({ valid: false, reason: 'server' });
  }
});

// --- CAIXAS ---
app.post('/registrarCaixa', autenticarUsuario, vincularCliente, csrfRequired, registrarCaixa);
app.get('/verCaixas', autenticarUsuario, vincularCliente, verCaixas); // VINCULAR
app.delete('/excluirCaixa/:id', autenticarUsuario, vincularCliente, csrfRequired, excluirCaixa);
app.put('/editarCaixa/:id', autenticarUsuario, vincularCliente, csrfRequired, editarCaixa);

// --- PRODUTOS (sua plataforma) ---
app.get('/verProdutos', autenticarUsuario, verProdutos);
app.post('/registrarProduto', autenticarUsuario, vincularCliente, csrfRequired, registrarProduto);
app.delete('/excluirProduto/:id', autenticarUsuario, csrfRequired, excluirProduto);
app.put('/editarProduto/:id', autenticarUsuario, csrfRequired, editarProduto);

// --- SHOPIFY: conectar loja (sua plataforma) ---
app.post('/conectarLoja', autenticarUsuario, vincularCliente, csrfRequired, registrarLojaShopify);

// Rotas de produtos da Shopify (existentes)
app.get('/shopify/produtos', autenticarShopify, comLoja, garantirInstalada, verProdutosLojaShopify);

// PEDIDOS (import/list)
app.post('/import-pedidos', autenticarUsuario, vincularCliente, csrfRequired, importPedidos);
app.get('/pedidos', autenticarUsuario, vincularCliente, listPedidos);

app.get('/_debug/whoami', autenticarUsuario, vincularCliente, (req,res)=>{
  res.json({
    authHeader: !!req.headers.authorization,
    clienteId: req.clienteId ?? null,
    usuario: req.usuario ?? null,
    user: req.user ?? null,
  });
});

// API UPS
app.use('/api/cotacoes', autenticarUsuario, vincularCliente, require('./routes/cotacoesRoutes.js'));
app.use('/api/relatorio', autenticarUsuario, vincularCliente, require('./routes/relatorioPagamentos.js'))

app.use('/api/rate', require('./routes/rateMulti.js'));

// app.use('/api', upsRoutes);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err?.response?.status || err?.status || 500;
  res.status(status).json({ ok:false, error: err?.response?.data || { message: err.message } });
});

app.get("/healthz", (_, res) => res.json({ ok: true, ts: Date.now() }));
app.use((_req, res) => res.status(404).json({ error: "Not Found" }));
app.use(errorHandler);

// Start
db.sequelize.sync()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
    console.log(cfg.ship)
  })
  .catch((err) => {
    console.error('Erro ao sincronizar com o banco:', err);
  });

  module.exports = { app };