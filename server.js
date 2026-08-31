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
  loginCliente,
  verClienteAtual,
  atualizarDestinoFixo,
  atualizarRemetenteFixo,
  atualizarEnderecoEmpresa,
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
const { run: runIntegrationsHealthCheck } = require('./jobs/integrationsHealthCheck.js');
const { valorConversao } = require('./utils/dolar.js');

const nuvemshopRoutes = require('./routes/nuvemshopRoutes.js');
const { buildResumoPorStoreId } = require('./controller/NuvemshopController.js');
const shopifyModule = require('./routes/shopifyRoutes.js');
const shopifyCarrierRoutes = require('./routes/shopifyCarrier.js');
const shopifyWebhookRoutes = require('./routes/shopifyWebhookRoutes.js');
const upsRoutes = require('./routes/upsRoutes.js');
const worldeaseRoutes = require('./routes/worldeaseRoutes.js');
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
const FRONT_URL = (process.env.FRONT_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');

console.log('[FEDEX CFG][BOOT]', {
  AMBIENTE: process.env.NODE_ENV,
  base: fedexCfg.base,
  oauth: fedexCfg.oauth,
  ship: fedexCfg.ship,
});

// cron
cron.schedule('*/60 * * * *', pool);
cron.schedule('*/10 * * * *', runIntegrationsHealthCheck);

// polyfill fetch (Node < 18)
if (typeof fetch === 'undefined') {
  global.fetch = (...args) =>
    import('node-fetch').then(({ default: f }) => f(...args));
}


// headers globais para app embedded Shopify + Nuvemshop
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    'frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.shopify.com https://*.nuvemshop.com.br https://*.tiendanube.com;'
  );
  res.removeHeader('X-Frame-Options');
  next();
});

// middlewares básicos
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-api-key'],
  exposedHeaders: ['Authorization', 'Content-Disposition'],
}));

const shopifyCompliance = require('./routes/shopifyCompliance');

// IMPORTANTE: compliance webhook precisa entrar ANTES do express.json
app.use('/shopify/webhooks', shopifyCompliance);

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
app.use('/nuvemshop', nuvemshopRoutes);
app.use('/nuvemshop/webhooks', require('./routes/nuvemshopWebhookRoutes.js'));
app.use('/shopify', shopifyModule);
app.use('/shopify', shopifyCarrierRoutes);
app.use('/shopify/webhooks', shopifyWebhookRoutes);
app.use('/api/public-quote', require('./routes/publicQuoteRoute.js'));
app.use('/api/public-orders', require('./routes/publicOrdersRoute.js'));
app.use('/api/ups', autenticarUsuario, vincularCliente, upsRoutes);
app.use('/api/worldease', autenticarUsuario, vincularCliente, worldeaseRoutes);
app.use('/api/fedex', fedexRoutes);
app.use('/api/shipments', shipmentsRoutes);
app.use('/dashboard', autenticarUsuario, vincularCliente, dashboardModule);
app.use('/api/cotacoes', autenticarUsuario, vincularCliente, require('./routes/cotacoesRoutes.js'));
app.use('/api/coletas', autenticarUsuario, vincularCliente, require('./routes/coletasRoutes.js'));
app.use('/api/relatorio', autenticarUsuario, vincularCliente, require('./routes/relatorioPagamentos.js'));
app.use('/api/rate', require('./routes/rateMulti.js'));
app.use('/__fedex', autenticarUsuario, require('./routes/debugFedex.js'));

// Admin (staff interno da Intrex) — autenticação e API própria
const { autenticarAdmin } = require('./middleware/adminAuth.js');
app.use('/api/admin', require('./routes/adminAuthRoutes.js'));
app.use('/api/admin/dashboard', autenticarAdmin, require('./routes/adminDashboardRoutes.js'));
app.use('/api/admin/clientes', autenticarAdmin, require('./routes/adminClientesRoutes.js'));
app.use('/api/admin/envios', autenticarAdmin, require('./routes/adminEnviosRoutes.js'));
app.use('/api/admin/integracoes', autenticarAdmin, require('./routes/adminIntegracoesRoutes.js'));
app.use('/api/admin/comunicados', autenticarAdmin, require('./routes/adminComunicacaoRoutes.js'));
app.use('/api/admin/changelog', autenticarAdmin, require('./routes/adminChangelogRoutes.js'));
app.use('/api/admin/roadmap', autenticarAdmin, require('./routes/adminRoadmapRoutes.js'));
app.use('/api/admin/equipe', autenticarAdmin, require('./routes/adminEquipeRoutes.js'));
app.use('/api/admin/logs', autenticarAdmin, require('./routes/adminLogsRoutes.js'));
app.use('/api/admin/relatorios', autenticarAdmin, require('./routes/adminRelatoriosRoutes.js'));

// Público — página de status e banner interno da plataforma
app.use('/api/status', require('./routes/publicStatusRoutes.js'));
app.use('/api/comunicados', autenticarUsuario, vincularCliente, require('./routes/comunicadosClienteRoutes.js'));
app.use('/api/changelog', require('./routes/publicChangelogRoutes.js'));

// saúde
app.get('/health', (_, res) => res.send('ok'));
app.get('/healthz', (_, res) => res.json({ ok: true, ts: Date.now() }));

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderCardHtml({ title, body }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Intrex Shipping</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; margin: 0; background: #f6f6f7; }
    .card { background: #fff; padding: 24px; border-radius: 12px; max-width: 700px; margin: 32px auto; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .muted { color: #666; }
    .btn { display: inline-block; margin-top: 12px; padding: 10px 18px; background: #2563EB; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </div>
</body>
</html>`;
}

// landing root do app embedded na Nuvemshop (carregado no iframe do painel "Aplicativos")
async function renderNuvemshopEmbed(req, res, storeId) {
  try {
    const shopRow = await db.NuvemshopShop.findOne({
      where: { storeId },
      attributes: ['accessToken'],
      raw: true,
    });

    if (!shopRow?.accessToken) {
      return res.type('html').send(renderCardHtml({
        title: 'Loja não conectada',
        body: '<p class="muted">Não encontramos uma conexão ativa da Intrex para esta loja. Reinstale o aplicativo pela Nuvemshop.</p>',
      }));
    }

    const resumo = await buildResumoPorStoreId(storeId, shopRow.accessToken);
    const nome = resumo.store?.name || `Loja #${storeId}`;
    const carrierLabel = !resumo.carrier
      ? 'Não foi possível verificar agora'
      : !resumo.carrier.registered
        ? 'Ainda não registrado'
        : resumo.carrier.active === false
          ? 'Registrado, mas inativo'
          : 'Ativo';

    return res.type('html').send(renderCardHtml({
      title: 'Intrex conectado ✅',
      body: `
        <p><strong>Loja:</strong> ${escapeHtml(nome)}</p>
        <p><strong>Frete internacional:</strong> ${escapeHtml(carrierLabel)}</p>
        <p class="muted">Gerencie envios, cotações e produtos no painel completo da Intrex.</p>
        <a class="btn" href="${escapeHtml(FRONT_URL)}/login" target="_top">Abrir painel Intrex</a>
      `,
    }));
  } catch (e) {
    console.error('[NS EMBED]', e);
    return res.type('html').send(renderCardHtml({
      title: 'Não foi possível carregar agora',
      body: '<p class="muted">Tente novamente em instantes.</p>',
    }));
  }
}

// landing root do app embedded
app.get('/', async (req, res) => {
  const shopifyHost = req.query.host || '';
  const nuvemshopStoreId = req.query.store_id || '';

  if (!shopifyHost && nuvemshopStoreId) {
    return renderNuvemshopEmbed(req, res, String(nuvemshopStoreId));
  }

  res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Intrex Shipping</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      padding: 40px 24px;
      margin: 0;
      background: #fff;
      color: #0f172a;
    }
    .wrap { max-width: 640px; margin: 0 auto; text-align: center; }
    .logo { height: 40px; margin-bottom: 24px; }
    .skeleton { height: 16px; background: #e2e8f0; border-radius: 6px; margin: 8px auto; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
    .check {
      width: 48px; height: 48px; border-radius: 999px; background: #dcfce7; color: #16a34a;
      display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 24px;
    }
    h1 { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
    .subtitle { font-size: 14px; color: #64748b; margin: 0 0 20px; }
    .badges { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 24px; }
    .badge { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid; }
    .badge-green { background: #f0fdf4; color: #16a34a; border-color: #bbf7d0; }
    .badge-yellow { background: #fefce8; color: #a16207; border-color: #fde68a; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; text-align: left; }
    .stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
    .stat-title { font-size: 12px; font-weight: 600; color: #0f172a; text-transform: uppercase; letter-spacing: .02em; }
    .stat-subtitle { font-size: 11px; color: #94a3b8; margin-bottom: 8px; }
    .stat-value { font-size: 22px; font-weight: 800; color: #0f172a; }
    .btn {
      display: inline-flex; align-items: center; gap: 8px; background: #2563eb; color: #fff;
      text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 20px; border-radius: 10px;
      width: 100%; max-width: 400px; justify-content: center;
    }
    .muted { color: #94a3b8; font-size: 13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <img class="logo" src="https://intrex.com.br/images/intrex_logo.png" alt="Intrex" />
    <div id="root">
      <div class="skeleton" style="width:160px;"></div>
      <div class="skeleton" style="width:220px;"></div>
    </div>
  </div>

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

      const btn = '<a class="btn" href="https://intrex.com.br/login" target="_blank" rel="noopener noreferrer">Abrir painel Intrex ↗</a>';

      try {
        const r = await fetch('/shopify/resumo-embed?shop=' + encodeURIComponent(shop));
        const info = await r.json();

        const badge = (label, ok) => '<span class="badge ' + (ok ? 'badge-green' : 'badge-yellow') + '">' + label + '</span>';

        const stats = info.stats ? \`
          <div class="stats">
            <div class="stat"><div class="stat-title">Cotações</div><div class="stat-subtitle">Total</div><div class="stat-value">\${info.stats.totalCotacoes}</div></div>
            <div class="stat"><div class="stat-title">Em andamento</div><div class="stat-subtitle">Envios</div><div class="stat-value">\${info.stats.emAndamento}</div></div>
            <div class="stat"><div class="stat-title">Entregues</div><div class="stat-subtitle">Envios</div><div class="stat-value">\${info.stats.entregues}</div></div>
          </div>
        \` : '';

        document.getElementById('root').innerHTML = \`
          <div class="check">✓</div>
          <h1>Intrex Shipping conectado</h1>
          <p class="subtitle">\${info.shop || shop || '—'}</p>
          <div class="badges">
            \${badge('Token salvo: ' + (info.hasToken ? 'Sim' : 'Não'), info.hasToken)}
            \${badge('Frete internacional: ' + (info.hasCarrier ? 'Ativo' : 'Não ativo'), info.hasCarrier)}
            \${badge('Webhook de pedidos: ' + (info.hasOrdersWebhook ? 'Ativo' : 'Não ativo'), info.hasOrdersWebhook)}
          </div>
          \${stats}
          \${btn}
        \`;
      } catch (e) {
        document.getElementById('root').innerHTML = \`
          <h1>Intrex</h1>
          <p class="muted" style="margin-bottom:20px;">Não foi possível carregar o status agora.</p>
          \${btn}
        \`;
      }
    })();
  </script>
</body>
</html>`);
});

// debug Shopify
app.get('/_debug/shops', autenticarUsuario, async (_req, res) => {
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

app.get('/_debug/scopes', autenticarUsuario, async (req, res) => {
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
app.get('/verClienteAtual', autenticarUsuario, verClienteAtual);
app.put('/atualizarDestinoFixo', autenticarUsuario, vincularCliente, csrfRequired, atualizarDestinoFixo);
app.put('/atualizarRemetenteFixo', autenticarUsuario, vincularCliente, csrfRequired, atualizarRemetenteFixo);
app.put('/atualizarEnderecoEmpresa', autenticarUsuario, vincularCliente, csrfRequired, atualizarEnderecoEmpresa);

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
// Boleto por cotação (frete + imposto estimado) — feature beta, gated por allowlist no controller
app.post('/boletos/cotacao/:id', autenticarUsuario, vincularCliente, require('./controller/Asaas.js').gerarBoletoCotacao);

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
async function start() {
  try {
    await db.sequelize.sync();
  } catch (err) {
    if (err.parent?.code === '42P07') {
      // índice/relação já existe (comum quando outra instância venceu a
      // corrida do sync contra o mesmo banco) — seguro para continuar.
      console.warn('Índice caixas_cliente_cod_uq já existia, seguindo mesmo assim.');
    } else {
      console.error('Erro ao sincronizar com o banco, encerrando processo:', err);
      process.exit(1);
    }
  }

  await db.sequelize.query(
    'ALTER TABLE pedidos_importados ADD COLUMN IF NOT EXISTS shopify_order_id BIGINT'
  );
  await db.sequelize.query(
    'ALTER TABLE "Clientes" ADD COLUMN IF NOT EXISTS "publicApiKey" VARCHAR(255) UNIQUE'
  );

  console.log('Banco sincronizado:', PORT);
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}

start();

module.exports = { app };