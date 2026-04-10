// deploy com FEDEX

const express = require('express');
const app = express();

const dotenv = require('dotenv');
dotenv.config();

const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const cron = require('node-cron');

const fedexCfg = require('./config/fedex');
const cfg = require('./config/ups.js');
const db = require('./models/index.js');
const uploadRouter = require('./routes/upload.js');
const { setupSwagger } = require('./swagger');

const {
  autenticarUsuario,
  vincularCliente,
  autenticarShopify,
  csrfRequired,
} = require('./middleware/auth.js');

const {
  registrarCaixa,
  verCaixas,
  excluirCaixa,
  editarCaixa,
} = require('./controller/CaixaController.js');

const {
  registrarCliente,
  verClientes,
  loginCliente,
  verClienteAtual,
} = require('./controller/ClientesController.js');

const {
  registrarLojaShopify,
} = require('./controller/ShopifyController.js');

const {
  listPedidos,
} = require('./controller/PedidoImportController.js');

const {
  uploadOrdersMinimal,
} = require('./controller/pedidosMinimalController.js');

const { uploadOrder } = require('./middleware/shopifyAuth.js');
const { pool } = require('./jobs/poolTracking.js');
const { valorConversao } = require('./utils/dolar.js');

const shopifyModule = require('./routes/shopifyRoutes.js');
const shopifyCarrierRoutes = require('./routes/shopifyCarrier.js');
const upsRoutes = require('./routes/upsRoutes.js');
const fedexRoutes = require('./routes/fedexRoutes.js');
const shipmentsRoutes = require('./routes/shipmentsRoutes.js');
const dashboardModule = require('./routes/dashboardRoutes.js');
const sse = require('./routes/SSE.js');

const { validateCNPJ } = require('./utils/cnpj');
const { validateCNAE } = require('./utils/cnae.js');
const {
  verProdutos,
  registrarProduto,
  editarProduto,
  excluirProduto,
} = require('./controller/ProdutoController.js');

const { getAccessScopesLive } = require('./utils/scopes.js');
const { refresh, logout } = require('./routes/authRoutes.js');
const { applySecurity } = require('./bootstrap/security.js');
const { applyLogging, errorHandler } = require('./bootstrap/loggin.js');

const PORT = process.env.PORT || 3001;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || '';

console.log('[FEDEX CFG][BOOT]', {
  AMBIENTE: process.env.NODE_ENV,
  base: fedexCfg.base,
  oauth: fedexCfg.oauth,
  ship: fedexCfg.ship,
});

// cron
cron.schedule('*/60 * * * *', pool);

// polyfill fetch (Node < 18)
if (typeof fetch === 'undefined') {
  global.fetch = (...args) =>
    import('node-fetch').then(({ default: f }) => f(...args));
}

// allowlist CORS
const allowlist = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// headers globais para app embedded Shopify
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    'frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.shopify.com;'
  );
  res.removeHeader('X-Frame-Options');
  next();
});

// middlewares básicos
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    const ok = allowlist.length ? allowlist.includes(origin) : true;
    return cb(null, ok);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  exposedHeaders: ['Authorization', 'Content-Disposition'],
}));

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(cookieParser());
app.use(compression({ threshold: 0 }));

applySecurity(app);
applyLogging(app);
setupSwagger(app);

// estáticos / auxiliares
app.use('/sse', sse.router);
app.use('/upload', uploadRouter);
app.use('/exports', express.static(path.join(__dirname, 'exports'), { maxAge: '1h', etag: true }));

// rotas principais
app.use('/shopify', shopifyModule);
app.use('/shopify', shopifyCarrierRoutes);
app.use('/api/ups', upsRoutes);
app.use('/api/fedex', fedexRoutes);
app.use('/api/shipments', shipmentsRoutes);
app.use('/dashboard', autenticarUsuario, vincularCliente, dashboardModule);
app.use('/api/cotacoes', autenticarUsuario, vincularCliente, require('./routes/cotacoesRoutes.js'));
app.use('/api/relatorio', autenticarUsuario, vincularCliente, require('./routes/relatorioPagamentos.js'));
app.use('/api/rate', require('./routes/rateMulti.js'));
app.use(require('./routes/debugFedex.js'));

// saúde
app.get('/health', (_, res) => res.send('ok'));
app.get('/healthz', (_, res) => res.json({ ok: true, ts: Date.now() }));

// landing root do app embedded
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Intrex Shipping</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 24px;
      margin: 0;
      background: #f6f6f7;
    }
    .card {
      background: #fff;
      padding: 24px;
      border-radius: 12px;
      max-width: 700px;
      margin: 32px auto;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
    }
    .muted {
      color: #666;
    }
  </style>
</head>
<body>
  <div class="card" id="root">Carregando...</div>

  <script>
    (async function () {
      const params = new URLSearchParams(window.location.search);
      const shop = params.get('shop') || '';
      const host = params.get('host') || '';

      if (host && window['app-bridge']?.createApp) {
        window['app-bridge'].createApp({
          apiKey: '${SHOPIFY_API_KEY}',
          host,
          forceRedirect: true
        });
      }

      try {
        const r = await fetch('/shopify/has-token?shop=' + encodeURIComponent(shop));
        const info = await r.json();

        document.getElementById('root').innerHTML = \`
          <h1>Intrex Shipping conectado</h1>
          <p><strong>Loja:</strong> \${info.shop || shop || '—'}</p>
          <p><strong>Token salvo:</strong> \${info.hasToken ? 'Sim' : 'Não'}</p>
          <p class="muted">OAuth concluído com sucesso.</p>
        \`;
      } catch (e) {
        document.getElementById('root').innerHTML = \`
          <h1>Erro</h1>
          <p class="muted">\${e.message}</p>
        \`;
      }
    })();
  </script>
</body>
</html>`);
});

// debug Shopify
app.get('/_debug/shops', async (_req, res) => {
  try {
    const rows = await db.Shop.findAll({
      attributes: ['shop', 'scope', 'accessToken', 'updatedAt'],
      raw: true,
    });

    const out = [];
    for (const r of rows) {
      let liveScopes = [];
      try {
        liveScopes = await getAccessScopesLive(r.shop, r.accessToken);
      } catch (e) {
        liveScopes = [`erro: ${e.message}`];
      }

      out.push({
        shop: r.shop,
        scope: r.scope,
        updatedAt: r.updatedAt,
        liveScopes,
      });
    }

    res.json(out);
  } catch (e) {
    res.status(500).json({ erro: 'falha debug', detalhes: e?.message });
  }
});

app.get('/_debug/scopes', async (req, res) => {
  try {
    const shop = String(req.query.shop || '').toLowerCase();
    if (!shop) return res.status(400).json({ erro: 'informe ?shop=...' });

    const row = await db.Shop.findOne({
      where: { shop },
      attributes: ['accessToken', 'scope'],
      raw: true,
    });

    if (!row) return res.status(404).json({ erro: 'token não encontrado' });

    let live = [];
    try {
      live = await getAccessScopesLive(shop, row.accessToken);
    } catch (e) {
      live = [`erro: ${e.message}`];
    }

    res.json({
      shop,
      column_scope: row.scope,
      live_scopes: live,
    });
  } catch (e) {
    res.status(500).json({ erro: 'falha debug', detalhes: e?.message });
  }
});

app.get('/_debug/whoami', autenticarUsuario, vincularCliente, (req, res) => {
  res.json({
    authHeader: !!req.headers.authorization,
    clienteId: req.clienteId ?? null,
    usuario: req.usuario ?? null,
    user: req.user ?? null,
  });
});

// clientes
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

app.post('/auth/refresh', refresh);
app.post('/auth/logout', logout);

// validadores
app.get('/validate/cnpj', async (req, res) => {
  try {
    const { cnpj, online } = req.query;
    const out = await validateCNPJ(cnpj, { online });
    return res.status(200).json(out);
  } catch (e) {
    console.error('[/validate/cnpj]', e);
    return res.status(500).json({ valid: false, reason: 'server' });
  }
});

app.get('/validate/cnae', async (req, res) => {
  try {
    const { cnae } = req.query;
    const out = await validateCNAE(cnae);
    return res.status(200).json(out);
  } catch (e) {
    console.error('[/validate/cnae]', e);
    return res.status(500).json({ valid: false, reason: 'server' });
  }
});

// caixas
app.post('/registrarCaixa', autenticarUsuario, vincularCliente, csrfRequired, registrarCaixa);
app.get('/verCaixas', autenticarUsuario, vincularCliente, verCaixas);
app.delete('/excluirCaixa/:id', autenticarUsuario, vincularCliente, csrfRequired, excluirCaixa);
app.put('/editarCaixa/:id', autenticarUsuario, vincularCliente, csrfRequired, editarCaixa);

// produtos
app.get('/verProdutos', autenticarUsuario, verProdutos);
app.post('/registrarProduto', autenticarUsuario, vincularCliente, csrfRequired, registrarProduto);
app.delete('/excluirProduto/:id', autenticarUsuario, csrfRequired, excluirProduto);
app.put('/editarProduto/:id', autenticarUsuario, csrfRequired, editarProduto);

// Shopify / conexão
app.post('/conectarLoja', autenticarUsuario, vincularCliente, csrfRequired, registrarLojaShopify);

// pedidos
app.post(
  '/shopify/import-pedidos',
  autenticarShopify,
  vincularCliente,
  csrfRequired,
  uploadOrder.fields([{ name: 'file' }, { name: 'sku_master' }]),
  async (req, res) => {
    const payload = await uploadOrdersMinimal(req, res, false);
    return payload;
  }
);

app.get('/pedidos', autenticarUsuario, vincularCliente, listPedidos);

// Asaas
app.post('/boletos', autenticarUsuario, vincularCliente, require('./controller/Asaas.js').gerarBoleto);

app.get('/dolar', async (req, res) => {
  try {
    const v = await valorConversao();
    return res.json({ valor: v });
  } catch (e) {
    console.error('[/dolar] erro:', e);
    return res.status(500).json({
      erro: 'Erro interno ao buscar dólar',
      detalhe: e?.message || String(e),
    });
  }
});

// erro / 404
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err?.response?.status || err?.status || 500;
  return res.status(status).json({
    ok: false,
    error: err?.response?.data || { message: err.message },
  });
});

app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));
app.use(errorHandler);

// start
db.sequelize.sync()
  .then(() => {
    console.log('Banco sincronizado:', PORT);
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    if (err.parent?.code === '42P07') {
      console.warn('Índice caixas_cliente_cod_uq já existia, seguindo mesmo assim.');
    } else {
      console.error('Erro ao sincronizar com o banco:', err);
    }
  });

module.exports = { app };