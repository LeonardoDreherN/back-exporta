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

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.shopify.com;"
  );
  res.removeHeader('X-Frame-Options');
  next();
});

//saúde
app.get('/health', (_, res) => res.send('ok'))

//ROUTES DA SHOPIFY

app.get('/', (req, res) => {
  res.type('html').send(`
  <div id="root">Carregando…</div>
  <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
  <script>
    (async () => {
      const params = new URLSearchParams(location.search);
      const createApp = window.appBridge.default;
      const app = createApp({ apiKey: "${process.env.SHOPIFY_API_KEY}", host: params.get('host'), forceRedirect: true });
      const {getSessionToken} = window.appBridge.utilities;
      const token = await getSessionToken(app);
      const resp = await fetch('/shopify/produtos' + (params.get('shop') ? ('?shop=' + params.get('shop')) : ''), {
        headers: { Authorization: 'Bearer ' + token }
      });
      document.getElementById('root').textContent = await resp.text();
    })();
  </script>`);
});


app.get('/_debug/shops', async (_req, res) => {
  const rows = await db.Shop.findAll({ attributes: ['shop','scope','updatedAt'] });
  res.json(rows);
}); //confere se foi salvo no BD

const EXPORTS_DIR = path.join(__dirname, 'exports')
app.use('/exports', express.static(EXPORTS_DIR, {maxAge: '1h', etag: true}))

app.use('/shopify', shopifyModule)
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
