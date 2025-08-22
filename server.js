const express = require('express')
const dotenv = require('dotenv')
const db = require('./models/index.js')
const { registrarCliente, verClientes, loginCliente } = require('./controller/ClientesController.js')
const cors = require('cors')

dotenv.config()

const PORT = process.env.PORT || 3001

if (typeof fetch === "undefined") {
  global.fetch = (...args) =>
    import("node-fetch").then(({ default: f }) => f(...args));
}

const { validateCNPJ } = require("./utils/cnpj");
const { validateCNAE } = require('./utils/cnae.js')

const app = express()

app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
}))

app.use(express.json())

app.post('/registrarClientes', registrarCliente);
app.post('/login', loginCliente);
app.get('/verClientes', verClientes);

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

db.sequelize.sync()
    .then(() => {
        app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))
    })
    .catch((err) => {
        console.error('Erro ao sincronizar com o banco:', err)
    })
