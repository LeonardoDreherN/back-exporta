const db = require("../models");

const MAX_DIM = 10000;          // cm (100 m)
const MAX_PESO_NUMERIC = 9999999.999;

function isPosNumber(x) {
  return Number.isFinite(x) && x > 0;
}

const registrarCaixa = async (req, res) => {
  if (!req.clienteId) {
    return res.status(401).json({ erro: "Cliente não autenticado" });
  }

  // const t = await db.sequelize.transaction(); // <<< transação
  try {
    const b = req.body || {};

    const altura = Number(b.altura);
    const largura = Number(b.largura);
    const comprimento = Number(b.comprimento);

    const payload = {
      cod_identificacao: b.cod_identificacao,
      descricao: b.descricao,
      altura,
      largura,
      comprimento,
      id_cliente: req.clienteId, // <<< automático do middleware
    };

    const obrigatorios = ['cod_identificacao', 'descricao', 'altura', 'largura', 'comprimento'];
    const faltando = obrigatorios.filter(k => payload[k] === undefined || payload[k] === null || payload[k] === '');
    if (faltando.length) {
      return res.status(400).json({ erro: 'Campos obrigatórios faltando', campos: faltando });
    }

    if (![altura, largura, comprimento].every(isPosNumber)) {
      return res.status(400).json({ erro: "Dimensões devem ser números positivos" });
    }
    if (altura > MAX_DIM || largura > MAX_DIM || comprimento > MAX_DIM) {
      return res.status(400).json({ erro: `Dimensões inválidas (0 < valor ≤ ${MAX_DIM} cm)` });
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
        comprimento: novaCaixa.comprimento,
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
      attributes: ["id", "cod_identificacao", "descricao", "altura", "largura", "comprimento", "id_cliente"],
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
    if (!req.clienteId) return res.status(401).json({ erro: "Não autenticado" });

    // aceita id no params ou no body
    const id = Number(req.params.id ?? req.body.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ erro: "ID inválido" });
    }

    // busca garantindo propriedade
    const caixa = await db.Caixa.findOne({ where: { id, id_cliente: req.clienteId } });
    if (!caixa) return res.status(404).json({ erro: "Caixa não encontrada" });

    // campos opcionais: só atualiza o que veio
    const {
      cod_identificacao,
      descricao,
      altura,
      largura,
      comprimento,
    } = req.body;

    const updateData = {};

    if (typeof cod_identificacao === "string" && cod_identificacao.trim()) {
      updateData.cod_identificacao = cod_identificacao.trim();
    }
    if (typeof descricao === "string" && descricao.trim()) {
      updateData.descricao = descricao.trim();
    }

    const a = altura !== undefined ? Number(altura) : undefined;
    const l = largura !== undefined ? Number(largura) : undefined;
    const p = comprimento !== undefined ? Number(comprimento) : undefined;

    if (altura !== undefined) {
      const a = Number(altura);
      if (!isPosNumber(a) || a > MAX_DIM) {
        return res.status(400).json({ erro: `Altura inválida (0 < altura ≤ ${MAX_DIM} cm)` });
      }
      updateData.altura = a;
    }
    if (largura !== undefined) {
      const l = Number(largura);
      if (!isPosNumber(l) || l > MAX_DIM) {
        return res.status(400).json({ erro: `Largura inválida (0 < largura ≤ ${MAX_DIM} cm)` });
      }
      updateData.largura = l;
    }
    if (comprimento !== undefined) {
      const p = Number(comprimento);
      if (!isPosNumber(p) || p > MAX_DIM) {
        return res.status(400).json({ erro: `Profundidade inválida (0 < comprimento ≤ ${MAX_DIM} cm)` });
      }
      updateData.comprimento = p;
    }

    await caixa.update(updateData);
    return res.status(200).json({ mensagem: "Caixa editada com sucesso", caixa });
  } catch (err) {
    console.error("❌ editarCaixa:", err);
    return res.status(500).json({ erro: "Erro ao editar caixa", detalhes: err.message });
  }
};

module.exports = { registrarCaixa, verCaixas, excluirCaixa, editarCaixa };