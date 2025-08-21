const express = require('express')
const dotenv = require('dotenv')
const db = require('./models/index.js')
const { registrarCliente, verClientes, loginCliente } = require('./controller/ClientesController.js')
// const cors = require('cors')

dotenv.config()

const PORT = process.env.PORT || 3001

const app = express()

// app.use(cors({
//     origin: 'http://localhost:5173',
//     methods: ['GET', 'POST'],
//     allowedHeaders: ['Content-Type'],
//     credentials: true
// }))

app.use(express.json())

app.post('/registrarClientes', registrarCliente);
app.post('/login', loginCliente);
app.get('/verClientes', verClientes);

db.sequelize.sync()
    .then(() => {
        app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))
    })
    .catch((err) => {
        console.error('Erro ao sincronizar com o banco:', err)
    })
