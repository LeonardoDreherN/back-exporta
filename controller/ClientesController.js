const db = require("../models/index.js");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const registrarCliente = async (req, res) => {
    try {
        // pega todos os campos do body
        const dadosCliente = req.body;

        // gera hash da senha antes de salvar
        const senhaHash = await bcrypt.hash(dadosCliente.senha, 10);

        // substitui a senha original pela criptografada
        dadosCliente.senha = senhaHash;

        // cria cliente no banco
        const novoCliente = await db.Cliente.create(dadosCliente);

        res.status(201).json({
            mensagem: "Cliente registrado com sucesso",
            cliente: {
                id: novoCliente.id,
                nomeFantasia: novoCliente.nomeFantasia,
                cnpj: novoCliente.cnpj,
                emailPrincipal: novoCliente.emailPrincipal,
            }
        });
    } catch (err) {
        res.status(500).json({
            erro: "Erro ao registrar cliente",
            detalhes: err.message,
        });
    }
};

const verClientes = async (req, res) => {
    try {
        const clientes = await db.Cliente.findAll({
            attributes: ["id", "nomeFantasia", "cnpj", "emailPrincipal"] // 🚫 não retorna senha
        });

        res.json(clientes);
    } catch (err) {
        res.status(500).json({
            erro: "Erro ao ver clientes",
            detalhes: err.message,
        });
    }
};

const loginCliente = async (req, res) => {
    const { emailPrincipal, senha } = req.body;

    try {
        const cliente = await db.Cliente.findOne({ where: { emailPrincipal } });

        // Se o cliente não existe OU a senha não corresponde, retorna erro 401
        // bcrypt.compare() compara a senha em texto puro com o hash salvo
        if (!cliente || !(await bcrypt.compare(senha, cliente.senha))) {
            return res.status(401).json({ erro: "Credenciais inválidas" });
        }

        // Se a senha estiver correta, gera o token JWT
        const token = jwt.sign(
            {
                id: cliente.id,
                emailPrincipal: cliente.emailPrincipal
            },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.json({
            mensagem: "Login bem-sucedido",
            usuario: {
                id: cliente.id,
                emailPrincipal: cliente.emailPrincipal
            },
            token
        });
    } catch (err) {
        console.error("Erro no login:", err);
        res.status(500).json({
            erro: "Erro interno do servidor",
            detalhes: err.message
        });
    }
};

module.exports = {
    registrarCliente,
    verClientes,
    loginCliente,
};
