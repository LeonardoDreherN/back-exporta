const express = require('express')
const app = express()
const dotenv = require('dotenv')
dotenv.config()
const db = require('./models/index.js')
const cors = require('cors')
const path = require('path')
const cookieParser = require('cookie-parser');

const { autenticarUsuario, vincularCliente, autenticarShopify } = require('./middleware/auth.js')
const { registrarCaixa, verCaixas, excluirCaixa, editarCaixa } = require('./controller/CaixaController.js')
const { registrarCliente, verClientes, loginCliente, verClienteAtual } = require('./controller/ClientesController.js')
const { verProdutosLojaShopify, registrarLojaShopify } = require('./controller/ShopifyController.js')
const { comLoja, garantirInstalada } = require('./middleware/shopifyAuth.js')

const shopifyModule = require('./routes/shopifyRoutes.js')

app.use(express.json())
const PORT = process.env.PORT || 3001
app.use(cookieParser())

app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'authorization'],
  exposedHeaders: ['Authorization'],
  credentials: false
}))

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.shopify.com;"
  );
  res.removeHeader('X-Frame-Options');
  next();
});

if (typeof fetch === "undefined") {
  global.fetch = (...args) =>
    import("node-fetch").then(({ default: f }) => f(...args));
}

const { validateCNPJ } = require("./utils/cnpj");
const { validateCNAE } = require('./utils/cnae.js')
const { verProdutos, registrarProduto, editarProduto, excluirProduto } = require('./controller/ProdutoController.js')

app.use('/shopify', shopifyModule)

//saúde
app.get('/health', (_, res) => res.send('ok'))

//ROUTES DA SHOPIFY

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Shopify App</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
  <style>
    html,body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif}
  </style>
</head>
<body>
  <div id="root" style="padding:16px">Carregando…</div>

  <script>
  (async function () {
    // 1) Limpa parâmetros sensíveis
    (function () {
      var p = new URLSearchParams(location.search);
      ['hmac','timestamp','code','state','session'].forEach(function(k){ p.delete(k); });
      if (location.search.indexOf('hmac=') !== -1) {
        history.replaceState({}, '', location.pathname + (p.toString() ? '?' + p.toString() : ''));
      }
    })();

    var params = new URLSearchParams(location.search);
    var host = params.get('host');
    var shop = params.get('shop');

    // 2) Fallback se o Admin não passou "host"
    if (!host) {
      var tgt = location.origin + '/shopify/auth' + (shop ? ('?shop=' + encodeURIComponent(shop)) : '');
      window.top.location.href = tgt;
      return;
    }

    // 3) App Bridge (UMD) + fallback
    var AB = window.appBridge || window['app-bridge'];
    if (!AB || !AB.createApp) {
      var tgt2 = location.origin + '/shopify/auth' + (shop ? ('?shop=' + encodeURIComponent(shop)) : '');
      window.top.location.href = tgt2;
      return;
    }

    var app = AB.createApp({ apiKey: '${SHOPIFY_API_KEY}', host: host, forceRedirect: true });

    try {
      // 4) Session token e chamada à sua API
      var getSessionToken = AB.utilities.getSessionToken;
      var token = await getSessionToken(app);
      var url = '/shopify/produtos' + (shop ? ('?shop=' + encodeURIComponent(shop)) : '');
      var resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      document.getElementById('root').textContent = await resp.text();
    } catch (e) {
      document.getElementById('root').textContent = 'Inicializado (embedded).';
      console.error('[root] erro ao obter session token ou listar produtos:', e);
    }
  })();
  </script>
</body>
</html>`);
});


app.get('/_debug/shops', async (_req, res) => {
  const rows = await db.Shop.findAll({ attributes: ['shop', 'scope', 'updatedAt'] });
  res.json(rows);
}); //confere se foi salvo no BD

const EXPORTS_DIR = path.join(__dirname, 'exports')
app.use('/exports', express.static(EXPORTS_DIR, { maxAge: '1h', etag: true }))

app.get('/shopify/produtos', autenticarShopify, comLoja, garantirInstalada, verProdutosLojaShopify);

//CLIENTES

app.post('/registrarClientes', registrarCliente);
app.post('/login', loginCliente);
app.get('/verClientes', autenticarUsuario, verClientes);
app.get('/verClienteAtual', autenticarUsuario, verClienteAtual);

app.get('/validate/cnpj', async (req, res) => {
  try {
    const { cnpj, online } = req.query;
    const out = await validateCNPJ(cnpj, { online }); // só DV aqui
    return res.status(200).json(out)
  } catch (e) {
    console.error("[/validate/cnpj]", e);
    res.status(500).json({ valid: false, reason: "server" });
  }
});

app.get('/validate/cnae', async (req, res) => {
  try {
    const { cnae } = req.query;
    const out = await validateCNAE(cnae);
    return res.status(200).json(out)
  } catch (e) {
    console.error("[/validate/cnae]", e);
    res.status(500).json({ valid: false, reason: "server" });
  }
});

//CAIXAS

app.post('/registrarCaixa', autenticarUsuario, vincularCliente, registrarCaixa)
app.get('/verCaixas', autenticarUsuario, vincularCliente, verCaixas) //VINCULAR
app.delete('/excluirCaixa/:id', autenticarUsuario, vincularCliente, excluirCaixa)
app.put(`/editarCaixa/:id`, autenticarUsuario, vincularCliente, editarCaixa)

//PRODUTOS

app.get('/verProdutos', autenticarUsuario, verProdutos)
app.post('/registrarProduto', autenticarUsuario, vincularCliente, registrarProduto)
app.delete('/excluirProduto/:id', autenticarUsuario, excluirProduto)
app.put('/editarProduto/:id', autenticarUsuario, editarProduto)

//SHOPIFY

app.post('/conectarLoja', autenticarShopify, registrarLojaShopify)

db.sequelize.sync()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))
  })
  .catch((err) => {
    console.error('Erro ao sincronizar com o banco:', err)
  })
