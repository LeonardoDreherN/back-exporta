// app.js
const express = require('express');
const app = express();
const dotenv = require('dotenv');
dotenv.config();
const db = require('./models/index.js');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');

const { autenticarUsuario, vincularCliente, autenticarShopify } = require('./middleware/auth.js');
const { registrarCaixa, verCaixas, excluirCaixa, editarCaixa } = require('./controller/CaixaController.js');
const { registrarCliente, verClientes, loginCliente, verClienteAtual } = require('./controller/ClientesController.js');
const { verProdutosLojaShopify, registrarLojaShopify } = require('./controller/ShopifyController.js');
const { comLoja, garantirInstalada, getAccessTokenForShop } = require('./middleware/shopifyAuth.js');
const { criarCotacao, listarCotacoes } = require('./controller/CotacaoController.js');
const { importPedidos, listPedidos } = require('./controller/PedidoImportController.js');

// Módulo de rotas da Shopify (inclui auth/conexao/produtos + upload-minimal + find)
const shopifyModule = require('./routes/shopifyRoutes.js');

// Middlewares globais
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // necessário p/ ler campos text em multipart/form-data
const PORT = process.env.PORT || 3001;
app.use(cookieParser());

app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'authorization'],
  exposedHeaders: ['Authorization'],
  credentials: false
}));

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

// Monta TODAS as rotas da Shopify sob /shopify (NÃO duplicar)
app.use('/shopify', shopifyModule);

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

// Rotas de produtos da Shopify (existentes)
app.get('/shopify/produtos', autenticarShopify, comLoja, garantirInstalada, verProdutosLojaShopify);

// --- CLIENTES (sua plataforma) ---
app.post('/registrarClientes', registrarCliente);
app.post('/login', loginCliente);
app.get('/verClientes', autenticarUsuario, verClientes);
app.get('/verClienteAtual', autenticarUsuario, verClienteAtual);

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
app.post('/registrarCaixa', autenticarUsuario, vincularCliente, registrarCaixa);
app.get('/verCaixas', autenticarUsuario, vincularCliente, verCaixas); // VINCULAR
app.delete('/excluirCaixa/:id', autenticarUsuario, vincularCliente, excluirCaixa);
app.put('/editarCaixa/:id', autenticarUsuario, vincularCliente, editarCaixa);

// --- PRODUTOS (sua plataforma) ---
app.get('/verProdutos', autenticarUsuario, verProdutos);
app.post('/registrarProduto', autenticarUsuario, vincularCliente, registrarProduto);
app.delete('/excluirProduto/:id', autenticarUsuario, excluirProduto);
app.put('/editarProduto/:id', autenticarUsuario, editarProduto);

// --- SHOPIFY: conectar loja (sua plataforma) ---
app.post('/conectarLoja', autenticarUsuario, vincularCliente, registrarLojaShopify);

// PEDIDOS (import/list)
app.post('/import-pedidos', autenticarUsuario, vincularCliente, importPedidos);
app.get('/pedidos', autenticarUsuario, vincularCliente, listPedidos);

// COTAÇÕES (mock da transportadora + listar)
// app.post('/cotacao/mock', autenticarUsuario, vincularCliente, criarCotacao);
// app.get('/cotacoes', autenticarUsuario, vincularCliente, listarCotacoes);

app.get('/api/cotacoes', autenticarUsuario, vincularCliente, listarCotacoes);
app.post('/api/cotacoes', autenticarUsuario, vincularCliente, criarCotacao);

app.get('/_debug/whoami', autenticarUsuario, vincularCliente, (req,res)=>{
  res.json({
    authHeader: !!req.headers.authorization,
    clienteId: req.clienteId ?? null,
    usuario: req.usuario ?? null,
    user: req.user ?? null,
  });
});

// Start
db.sequelize.sync()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
  })
  .catch((err) => {
    console.error('Erro ao sincronizar com o banco:', err);
  });
