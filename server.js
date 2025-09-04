const dotenv = require('dotenv')
const express = require('express')
const db = require('./models/index.js')
const { autenticar, vincularCliente } = require('./middleware/auth.js')
const { registrarCaixa, verCaixas, excluirCaixa, editarCaixa } = require('./controller/CaixaController.js')
const { registrarCliente, verClientes, loginCliente, verClienteAtual } = require('./controller/ClientesController.js')
const cors = require('cors')
const app = express()
const crypto = require('crypto')

dotenv.config()

const PORT = process.env.PORT || 3001

app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authorization'],
    exposedHeaders: ['Authorization'], 
    credentials: false
}))

if (typeof fetch === "undefined") {
  global.fetch = (...args) =>
    import("node-fetch").then(({ default: f }) => f(...args));
}

const { validateCNPJ } = require("./utils/cnpj");
const { validateCNAE } = require('./utils/cnae.js')
const { verProdutos, registrarProduto, editarProduto, excluirProduto } = require('./controller/ProdutoController.js')

function isValidHmac(query) {
  // HMAC enviado pela Shopify
  const receivedHmac = String(query.hmac || '');

  // Remova hmac e signature do cálculo
  const params = { ...query };
  delete params.hmac;
  delete params.signature;

  // Monte a mensagem: chaves ordenadas alfabeticamente e unidas por &
  const message = Object.keys(params)
    .sort()
    .map((key) => {
      const value = Array.isArray(params[key]) ? params[key].join(',') : params[key];
      return `${key}=${value}`;
    })
    .join('&');

  // Gere o digest com seu API Secret
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');

  // Compare em tempo constante
  if (digest.length !== receivedHmac.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(receivedHmac, 'utf8'));
  } catch {
    return false;
  }
}

app.use(express.json())

app.get('/', (req, res) => {
  const { shop } = req.query;
  if (shop) return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
  return res.status(200).send('OK');
});

// --- início do OAuth ---
app.get('/auth', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).send('Missing shop (ex.: thiago123456.myshopify.com)');
  const state = crypto.randomBytes(16).toString('hex'); // guarde em sessão/cookie se quiser validar depois
  const redirectUri = `${process.env.HOST}/auth/callback`;
  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(process.env.SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
  res.redirect(url);
});

// --- callback: troca code por access_token ---
app.get('/auth/callback', async (req, res) => {
  try {
    const { shop, code, hmac } = req.query;
    if (!shop || !code || !hmac) return res.status(400).send('Missing params');

    if (!isValidHmac(req.query)) return res.status(401).send('Invalid HMAC');

    const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code
      })
    });
    if (!tokenResp.ok) throw new Error(await tokenResp.text());
    const { access_token, scope } = await tokenResp.json();

    // TODO: salve em DB: shop, access_token, scope, id_cliente (se tiver)
    console.log('SHOPIFY TOKEN OK ->', shop, scope);

    // página simples de sucesso
    res.status(200).send('App instalado! Token salvo. Já pode rodar o /shopify/sync/simple.');
  } catch (e) {
    console.error('OAuth error:', e);
    res.status(500).send('OAuth error');
  }
});

app.post('/registrarClientes', registrarCliente);
app.post('/login', loginCliente);
app.get('/verClientes', autenticar, verClientes);
app.get('/verClienteAtual', autenticar, verClienteAtual);

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

app.post('/registrarCaixa', autenticar, vincularCliente, registrarCaixa)
app.get('/verCaixas', autenticar, vincularCliente, verCaixas)
app.delete('/excluirCaixa/:id', autenticar, vincularCliente, excluirCaixa)
app.put(`/editarCaixa/:id`, autenticar, vincularCliente, editarCaixa)

//PRODUTOS

app.get('/verProdutos', autenticar, verProdutos)
app.post('/registrarProduto', autenticar, vincularCliente, registrarProduto)
app.delete('/excluirProduto/:id', autenticar, excluirProduto)
app.put('/editarProduto/:id', autenticar, editarProduto)

db.sequelize.sync()
    .then(() => {
        app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))
    })
    .catch((err) => {
        console.error('Erro ao sincronizar com o banco:', err)
    })
