const db = require("../models/index.js");

const registrarCliente = async (req, res) => {
  try {
    const novoCliente = await db.Cliente.create(req.body);
    res.status(201).json(novoCliente);
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
        attributes: ['id', 'nomeFantasia', 'cnpj', 'emailPrincipal', 'conta']
    });

    res.json(clientes);
  } catch (err) {
    res.status(500).json({
      erro: "Erro ao ver clientes",
      detalhes: err.message,
    });
  }
};

module.exports = {
  registrarCliente,
  verClientes,
};
