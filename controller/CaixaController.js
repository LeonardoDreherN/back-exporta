const db = require("../models");

const registrarCaixa = async (req, res) => {
    const t = await db.sequelize.transaction(); // <<< transação
    try {
        const b = req.body || {};

        const payload = {
            cod_identificacao: b.cod_identificacao,
            descricao: b.descricao,
            altura: b.altura,
            largura: b.largura,
            profundidade: b.profundidade,
            peso: b.peso,
            id_cliente: req.clienteId,
        };

        const obrigatorios = ['cod_identificacao', 'descricao', 'altura', 'largura', 'profundidade', 'peso'];
        const faltando = obrigatorios.filter(k => payload[k] === undefined || payload[k] === null || payload[k] === '');
        if (faltando.length) {
            return res.status(400).json({ erro: 'Campos obrigatórios faltando', campos: faltando });
        }

        if(payload.altura <= 0 || payload.largura <= 0 || payload.profundidade <= 0 || payload.peso <= 0) {
            return res.status(400).json({ erro: 'Dimensões e peso devem ser positivos' });
        }

        const novaCaixa = await db.sequelize.transaction(async (t) => {
            return db.Caixa.create(payload, { transaction: t });
        });

        return res.status(201).json({
            mensagem: "Caixa registrada com sucesso",
            caixa: {
                id: novaCaixa.id,
                cod_identificacao: novaCaixa.cod_identificacao,
                descricao: novaCaixa.descricao,
                altura: novaCaixa.altura,
                largura: novaCaixa.largura,
                profundidade: novaCaixa.profundidade,
                peso: novaCaixa.peso,
                id_cliente: novaCaixa.id_cliente,
            }
        });
    } catch (err) {
        // Rollback garante que nada fique salvo se deu erro depois do create
        try { await t.rollback(); } catch { }
        console.error("❌ Erro ao registrar cliente:", err);
        return res.status(500).json({ erro: "Erro interno ao registrar cliente", detalhes: err.message });
    }
};

const verCaixas = async (req, res) => {
    try {
        const caixas = await db.Caixa.findAll({
            attributes: ["id", "cod_identificacao", "descricao", "altura", "largura", "profundidade", "peso", "id_cliente"]
        });

        res.json(caixas);
    } catch (err) {
        res.status(500).json({
            erro: "Erro ao ver caixas",
            detalhes: err.message,
        });
    }
};

module.exports = { registrarCaixa, verCaixas };