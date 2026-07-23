const { Op, literal, fn, col } = require('sequelize');
const db = require('../models');

const enviosPorCliente = async (req, res) => {
  try {
    const rows = await db.Cotacao.findAll({
      attributes: ['cliente_id', [fn('COUNT', col('Cotacao.id')), 'total']],
      include: [{ model: db.Cliente, as: 'cliente', attributes: ['razaoSocial'] }],
      group: ['cliente_id', 'cliente.id', 'cliente.razaoSocial'],
      order: [[literal('total'), 'DESC']],
      limit: 50,
    });

    const data = rows.map((r) => ({
      label: r.cliente?.razaoSocial || `Cliente ${r.cliente_id}`,
      value: Number(r.get('total')) || 0,
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[AdminRelatorios] enviosPorCliente erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao gerar relatório de envios por cliente' });
  }
};

const enviosPorPeriodo = async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const where = {};
    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at[Op.gte] = new Date(`${date_from}T00:00:00.000Z`);
      if (date_to) where.created_at[Op.lte] = new Date(`${date_to}T23:59:59.999Z`);
    }

    const dayExpr = literal(`date_trunc('day', created_at)`);
    const rows = await db.Cotacao.findAll({
      where,
      attributes: [[dayExpr, 'day'], [fn('COUNT', col('id')), 'total']],
      group: [dayExpr],
      order: [[dayExpr, 'ASC']],
      raw: true,
    });

    const data = rows.map((r) => ({ label: String(r.day).slice(0, 10), value: Number(r.total) || 0 }));
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[AdminRelatorios] enviosPorPeriodo erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao gerar relatório de envios por período' });
  }
};

const shopifyXNuvemshop = async (req, res) => {
  try {
    const [shopify, nuvemshop] = await Promise.all([
      db.InfoShopify.count(),
      db.InfoNuvemshop.count(),
    ]);
    return res.json({ ok: true, data: [{ label: 'Shopify', value: shopify }, { label: 'Nuvemshop', value: nuvemshop }] });
  } catch (err) {
    console.error('[AdminRelatorios] shopifyXNuvemshop erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao gerar relatório Shopify x Nuvemshop' });
  }
};

const upsXFedex = async (req, res) => {
  try {
    const [ups, fedex] = await Promise.all([
      db.Cotacao.count({ where: { carrier: 'UPS' } }),
      db.Cotacao.count({ where: { carrier: 'FEDEX' } }),
    ]);
    return res.json({ ok: true, data: [{ label: 'UPS', value: ups }, { label: 'FEDEX', value: fedex }] });
  } catch (err) {
    console.error('[AdminRelatorios] upsXFedex erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao gerar relatório UPS x FedEx' });
  }
};

const crescimentoMensal = async (req, res) => {
  try {
    const monthExpr = literal(`to_char(date_trunc('month', "createdAt"), 'YYYY-MM')`);
    const rows = await db.Cliente.findAll({
      attributes: [[monthExpr, 'mes'], [fn('COUNT', col('id')), 'total']],
      where: { createdAt: { [Op.gte]: literal(`now() - interval '12 months'`) } },
      group: [monthExpr],
      order: [[monthExpr, 'ASC']],
      raw: true,
    });
    return res.json({ ok: true, data: rows.map((r) => ({ label: r.mes, value: Number(r.total) || 0 })) });
  } catch (err) {
    console.error('[AdminRelatorios] crescimentoMensal erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao gerar relatório de crescimento mensal' });
  }
};

const paisesDestino = async (req, res) => {
  try {
    const rows = await db.Cotacao.findAll({
      attributes: ['pais_dest', [fn('COUNT', col('pais_dest')), 'total']],
      group: ['pais_dest'],
      order: [[literal('total'), 'DESC']],
      raw: true,
    });
    return res.json({ ok: true, data: rows.map((r) => ({ label: r.pais_dest || 'Não informado', value: Number(r.total) || 0 })) });
  } catch (err) {
    console.error('[AdminRelatorios] paisesDestino erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao gerar relatório de países de destino' });
  }
};

module.exports = { enviosPorCliente, enviosPorPeriodo, shopifyXNuvemshop, upsXFedex, crescimentoMensal, paisesDestino };
