const db = require("../models");

const registrarCaixa = async (req, res) => {
    const t = await db.sequelize.transaction(); // <<< transação
    try {
        const b = req.body || {};

        const altura = Number(b.altura);
        const largura = Number(b.largura);
        const profundidade = Number(b.profundidade);
        const peso = Number(b.peso);

        const payload = {
            cod_identificacao: b.cod_identificacao,
            descricao: b.descricao,
            altura,
            largura,
            profundidade,
            peso,
            id_cliente: req.clienteId, // <<< automático do middleware
        };

        const obrigatorios = ['cod_identificacao', 'descricao', 'altura', 'largura', 'profundidade', 'peso'];
        const faltando = obrigatorios.filter(k => payload[k] === undefined || payload[k] === null || payload[k] === '');
        if (faltando.length) {
            return res.status(400).json({ erro: 'Campos obrigatórios faltando', campos: faltando });
        }

        if (payload.altura <= 0 || payload.largura <= 0 || payload.profundidade <= 0 || payload.peso <= 0) {
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
            where: { id_cliente: req.clienteId },
            attributes: ["id", "cod_identificacao", "descricao", "altura", "largura", "profundidade", "peso", "id_cliente"],
            order: [["id", "DESC"]],
        });

        res.json(caixas);
    } catch (err) {
        res.status(500).json({
            erro: "Erro ao ver caixas",
            detalhes: err.message,
        });
    }
};

const excluirCaixa = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ erro: "ID inválido" });
    }

    // garanta que a caixa pertence ao cliente autenticado
    const caixa = await db.Caixa.findOne({
      where: { id, id_cliente: req.clienteId },
    });
    if (!caixa) {
      // pode retornar 404 para “não existe/ não pertence”
      return res.status(404).json({ erro: "Caixa não encontrada" });
    }

    await caixa.destroy();

    return res.status(200).json({ mensagem: "Caixa excluída com sucesso", id: caixa.id });
  } catch (err) {
    console.error("❌ excluirCaixa:", err);
    return res.status(500).json({ erro: "Erro ao excluir caixa", detalhes: err.message });
  }
};

const editarCaixa = async (req, res) => {
  try {
    // Se usar PUT /caixas/:id, troque para Number(req.params.id)
    const id = Number(req.body.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ erro: "ID inválido" });
    }

    const { cod_identificacao, descricao, altura, largura, profundidade, peso } = req.body;

    const a = Number(altura), l = Number(largura), p = Number(profundidade), kg = Number(peso);
    if ([a, l, p, kg].some(n => !Number.isFinite(n) || n <= 0)) {
      return res.status(400).json({ erro: "Dimensões e peso devem ser positivos" });
    }

    // só edita se for do cliente autenticado
    const caixa = await db.Caixa.findOne({ where: { id, id_cliente: req.clienteId } });
    if (!caixa) {
      return res.status(404).json({ erro: "Caixa não encontrada" });
    }

    await caixa.update({
      cod_identificacao,
      descricao,
      altura: a,
      largura: l,
      profundidade: p,
      peso: kg,
    });

    return res.status(200).json({ mensagem: "Caixa editada com sucesso", caixa });
  } catch (err) {
    console.error("❌ editarCaixa:", err);
    return res.status(500).json({ erro: "Erro ao editar caixa", detalhes: err.message });
  }
};

module.exports = { registrarCaixa, verCaixas, excluirCaixa, editarCaixa };