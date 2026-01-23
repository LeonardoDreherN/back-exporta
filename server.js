// app.js
//deploy
const express = require('express');
const app = express();
const dotenv = require('dotenv');
dotenv.config();
const fedexCfg = require('./config/fedex'); // <--- ADICIONE

const db = require('./models/index.js');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const cfg = require('./config/ups.js')
const uploadRouter = require('./routes/upload.js');
const compression = require('compression');
const { setupSwagger } = require('./swagger');

const { autenticarUsuario, vincularCliente, autenticarShopify, csrfRequired } = require('./middleware/auth.js');
const { registrarCaixa, verCaixas, excluirCaixa, editarCaixa } = require('./controller/CaixaController.js');
const { registrarCliente, verClientes, loginCliente, verClienteAtual } = require('./controller/ClientesController.js');
const { verProdutosLojaShopify, registrarLojaShopify } = require('./controller/ShopifyController.js');
const { importPedidos, listPedidos } = require('./controller/PedidoImportController.js');
const { uploadOrdersMinimal } = require('./controller/pedidosMinimalController.js');
const { uploadOrder } = require('./middleware/shopifyAuth.js');
const cron = require('node-cron');
const { pool } = require('./jobs/poolTracking.js');
const { valorConversao } = require('./utils/dolar.js');

const dashboardModule = require('./routes/dashboardRoutes.js')

cron.schedule('*/60 * * * *', pool)

// Módulo de rotas da Shopify (inclui auth/conexao/produtos + upload-minimal + find)
// const shopifyModule = require('./routes/shopifyRoutes.js');
const upsRoutes = require('./routes/upsRoutes.js');
const fedexRoutes = require('./routes/fedexRoutes.js');
const shipmentsRoutes = require('./routes/shipmentsRoutes.js')
const sse = require('./routes/SSE.js');

const allowlist = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// const allowlist = [
//   'http://localhost:3000',
//   'http://127.0.0.1:3000',
//   process.env.FRONTEND_URL,       // ex.: https://app.intrex.com
// ].filter(Boolean); // tira undefined/vazio

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman, curl etc

    const ok = allowlist.includes(origin);
    return cb(null, ok);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  exposedHeaders: ['Authorization', 'Content-Disposition'],
}));

// Pré-flight padronizado
// app.options('*', cors());

const PORT = process.env.PORT || 3001;

// app.use((req, res, next) => {
//   res.setHeader(
//     'Content-Security-Policy',
//     "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.shopify.com;"
//   );
//   res.removeHeader('X-Frame-Options');
//   next();
// });

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
setupSwagger(app);

// Monta TODAS as rotas da Shopify sob /shopify (NÃO duplicar)
// app.use('/shopify', shopifyModule);
app.use('/api/ups', upsRoutes);
app.use('/api/fedex', fedexRoutes)
app.use('/dashboard', autenticarUsuario, vincularCliente, dashboardModule)

// Saúde
app.get('/health', (_, res) => res.send('ok'));

// --- Rota raiz (embedded landing com App Bridge) ---
// const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
// app.get('/', (req, res) => {
//   res.type('html').send(`<!doctype html>
// <html>
// <head>
//   <meta charset="utf-8" />
//   <title>appTest</title>
//   <meta name="viewport" content="width=device-width, initial-scale=1" />
//   <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
//   <style>
//     html,body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif}
//     #root{padding:24px}
//     .muted{color:#6b7280}
//   </style>
// </head>
// <body>
//   <div id="root">Carregando…</div>

//   <script>
//   (function () {
//     function shopFromHost(host) {
//       try {
//         var dec = atob(host || '');
//         var m = dec.match(/store\\/([a-z0-9-]+)/i);
//         if (m) return (m[1].toLowerCase() + '.myshopify.com');
//       } catch {}
//       return null;
//     }

//     (async function () {
//       // Limpa parâmetros sensíveis
//       (function () {
//         var p = new URLSearchParams(location.search);
//         ['hmac','timestamp','code','state','session'].forEach(function(k){ p.delete(k); });
//         if (location.search.indexOf('hmac=') !== -1) {
//           history.replaceState({}, '', location.pathname + (p.toString() ? '?' + p.toString() : ''));
//         }
//       })();

//       var params = new URLSearchParams(location.search);
//       var host = params.get('host');
//       var shop = params.get('shop') || (host ? shopFromHost(host) : null);

//       if (!host) {
//         // sem host -> sobe para OAuth top-level
//         window.top.location.href = location.origin + '/shopify/auth' + (shop?('?shop='+encodeURIComponent(shop)):'');
//         return;
//       }

//       var AB = window.appBridge || window['app-bridge'];
//       if (!AB || !AB.createApp) {
//         window.top.location.href = location.origin + '/shopify/auth' + (shop?('?shop='+encodeURIComponent(shop)):'');
//         return;
//       }

//       var app = AB.createApp({ apiKey: '${SHOPIFY_API_KEY}', host: host, forceRedirect: true });
//       var Redirect = AB.actions.Redirect;

//       // Garante instalação (sem chamar outras rotas)
//       try {
//         var r = await fetch('/shopify/has-token?shop=' + encodeURIComponent(shop || ''));
//         var info = await r.json();
//         if (!info.hasToken) {
//           var target = location.origin + '/shopify/auth?shop=' + encodeURIComponent(shop) + '&host=' + encodeURIComponent(host);
//           Redirect.create(app).dispatch(Redirect.Action.REMOTE, target);
//           return;
//         }
//       } catch (e) {
//         var t = location.origin + '/shopify/auth?shop=' + encodeURIComponent(shop) + '&host=' + encodeURIComponent(host);
//         Redirect.create(app).dispatch(Redirect.Action.REMOTE, t);
//         return;
//       }

//       // Boas-vindas (nenhuma chamada ao backend)
//       var handle = (shop || '').replace(/\\.myshopify\\.com$/i,'');
//       document.getElementById('root').innerHTML =
//         '<h1>Bem-vindo(a) ao appTest</h1>' +
//         '<p class="muted">Loja: <strong>' + (handle || '—') + '</strong></p>' +
//         '<p class="muted">Seu app foi inicializado dentro do Admin (embedded).</p>' +
//         '<a href="${process.env.FRONTEND}/login" target="_top">Voltar para a Intrex</a>';

//       // Opcional: TitleBar
//       try {
//         var TitleBar = AB.actions.TitleBar;
//         TitleBar.create(app, { title: 'appTest' });
//       } catch {}
//     })();
//   })();
//   </script>
// </body>
// </html>`);
// });

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

    const row = await db.Shop.findOne({ where: { shop }, attributes: ['accessToken', 'scope'], raw: true });
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
  const u = req.usuario || req.user;

  if (!u) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  return res.json({
    id: u.id ?? u.clienteId ?? null,
    email: u.email ?? null,
    clienteId: u.clienteId ?? null,
    roles: u.roles || [],
    razaoSocial: u.razaoSocial ?? null,
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
// app.get('/shopify/produtos', autenticarShopify, comLoja, garantirInstalada, verProdutosLojaShopify);

// PEDIDOS (import/list)
// app.post('/import-pedidos', autenticarUsuario, vincularCliente, csrfRequired, importPedidos);
app.post('/shopify/import-pedidos', autenticarShopify, vincularCliente, csrfRequired,
  uploadOrder.fields([{ name: 'file' }, { name: 'sku_master' }]), // <- AQUI entra o multer
  async (req, res) => {
    // aqui sim o req.files já vai estar preenchido
    const payload = await uploadOrdersMinimal(req, res, /* returnOnly */ false);
    return payload; // uploadOrdersMinimal já responde, então isso é só pra clareza
  });

app.get('/pedidos', autenticarUsuario, vincularCliente, listPedidos);

app.get('/_debug/whoami', autenticarUsuario, vincularCliente, (req, res) => {
  res.json({
    authHeader: !!req.headers.authorization,
    clienteId: req.clienteId ?? null,
    usuario: req.usuario ?? null,
    user: req.user ?? null,
  });
});

// API UPS
app.use('/api/shipments', shipmentsRoutes)
app.use('/api/cotacoes', autenticarUsuario, vincularCliente, require('./routes/cotacoesRoutes.js'));
// app.use('/api/cotacoesFedex', require('./routes/fedexRoutes.js'))
app.use('/api/relatorio', autenticarUsuario, vincularCliente, require('./routes/relatorioPagamentos.js'))
const debugFedex = require('./routes/debugFedex.js');
app.use(debugFedex);

app.use('/api/rate', require('./routes/rateMulti.js'));

//Asaas
app.post('/boletos', autenticarUsuario, vincularCliente, require('./controller/Asaas.js').gerarBoleto);
app.get("/dolar", async (req, res) => {
  try {
    const v = await valorConversao();
    // if (!v) {
    //   return res.status(500).json({ erro: "Falha ao obter cotação do dólar." });
    // }
    res.json({ valor: v });
  } catch (e) {
    console.error("[/dolar] erro:", e);
    return res.status(500).json({
      erro: "Erro interno ao buscar dólar",
      detalhe: e?.message || String(e),
    });
  }
});

// app.use('/api', upsRoutes);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err?.response?.status || err?.status || 500;
  res.status(status).json({ ok: false, error: err?.response?.data || { message: err.message } });
});

app.get("/healthz", (_, res) => res.json({ ok: true, ts: Date.now() }));
app.use((_req, res) => res.status(404).json({ error: "Not Found" }));
app.use(errorHandler);

// Start
db.sequelize.sync()
  .then(() => {
    console.log('Banco sincronizado: ', PORT)
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch(err => {
    if (err.parent?.code === '42P07') {
      console.warn('Índice caixas_cliente_cod_uq já existia, seguindo mesmo assim.');
    } else {
      console.error('Erro ao sincronizar com o banco:', err);
    }
  });

module.exports = { app };
