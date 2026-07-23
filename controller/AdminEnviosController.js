const { Op } = require('sequelize');
const db = require('../models');

const listEnvios = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { cliente_id, carrier, status, pais, date_from, date_to, search } = req.query;

    const where = {};
    if (cliente_id) where.cliente_id = cliente_id;
    if (carrier) where.carrier = String(carrier).toUpperCase();
    if (status) where.status_norm = status;
    if (pais) where.pais_dest = String(pais).toUpperCase();

    if (date_from || date_to) {
      where.createdAt = {};
      if (date_from) where.createdAt[Op.gte] = new Date(`${date_from}T00:00:00.000Z`);
      if (date_to) where.createdAt[Op.lte] = new Date(`${date_to}T23:59:59.999Z`);
    }

    if (search) {
      where[Op.or] = [
        { pedido_ref: { [Op.iLike]: `%${search}%` } },
        { tracking_number: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { rows, count } = await db.Cotacao.findAndCountAll({
      where,
      attributes: {
        exclude: ['etiqueta_base64', 'invoice_base64', 'tracking_raw'],
      },
      include: [{ model: db.Cliente, as: 'cliente', attributes: ['id', 'razaoSocial', 'emailPrincipal'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return res.json({
      ok: true,
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (err) {
    console.error('[AdminEnvios] listEnvios erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar envios' });
  }
};

const getEnvioDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const cotacao = await db.Cotacao.findByPk(id, {
      attributes: { exclude: ['etiqueta_base64', 'invoice_base64'] },
      include: [{ model: db.Cliente, as: 'cliente', attributes: ['id', 'razaoSocial', 'emailPrincipal', 'cnpj'] }],
    });
    if (!cotacao) return res.status(404).json({ ok: false, error: 'Envio não encontrado' });
    return res.json({ ok: true, data: cotacao });
  } catch (err) {
    console.error('[AdminEnvios] getEnvioDetail erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar detalhe do envio' });
  }
};

module.exports = { listEnvios, getEnvioDetail };
