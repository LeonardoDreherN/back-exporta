const { Op } = require('sequelize');
const db = require('../models');

const CLIENTE_LIST_ATTRS = [
  'id', 'razaoSocial', 'emailPrincipal', 'telefoneCelular', 'plano', 'status',
  'tipoConta', 'cnpj', 'tipoDocumento', 'createdAt', 'lastLoginAt',
];

const listClientes = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const { status, plano, search, plataforma } = req.query;

    const where = {};
    if (status) where.status = status;
    if (plano) where.plano = plano;
    if (search) {
      where[Op.or] = [
        { razaoSocial: { [Op.iLike]: `%${search}%` } },
        { emailPrincipal: { [Op.iLike]: `%${search}%` } },
        { cnpj: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (plataforma === 'shopify' || plataforma === 'nuvemshop') {
      const Model = plataforma === 'shopify' ? db.InfoShopify : db.InfoNuvemshop;
      const rows = await Model.findAll({ attributes: ['id_cliente'], raw: true });
      const ids = rows.map((r) => r.id_cliente).filter(Boolean);
      where.id = { [Op.in]: ids.length ? ids : [-1] };
    }

    const { rows, count } = await db.Cliente.findAndCountAll({
      where,
      attributes: CLIENTE_LIST_ATTRS,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    const clienteIds = rows.map((c) => c.id);
    const [shopifyLinks, nuvemshopLinks, lastSyncs] = await Promise.all([
      db.InfoShopify.findAll({ where: { id_cliente: { [Op.in]: clienteIds } }, attributes: ['id_cliente'], raw: true }),
      db.InfoNuvemshop.findAll({ where: { id_cliente: { [Op.in]: clienteIds } }, attributes: ['id_cliente'], raw: true }),
      db.SyncLog.findAll({
        where: { clienteId: { [Op.in]: clienteIds } },
        attributes: ['clienteId', [db.sequelize.fn('MAX', db.sequelize.col('createdAt')), 'lastSync']],
        group: ['clienteId'],
        raw: true,
      }),
    ]);

    const shopifySet = new Set(shopifyLinks.map((r) => r.id_cliente));
    const nuvemshopSet = new Set(nuvemshopLinks.map((r) => r.id_cliente));
    const lastSyncMap = new Map(lastSyncs.map((r) => [r.clienteId, r.lastSync]));

    const data = rows.map((c) => ({
      ...c.toJSON(),
      shopifyConectado: shopifySet.has(c.id),
      nuvemshopConectado: nuvemshopSet.has(c.id),
      ultimaSincronizacao: lastSyncMap.get(c.id) || null,
    }));

    return res.json({
      ok: true,
      data,
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    });
  } catch (err) {
    console.error('[AdminClientes] listClientes erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar clientes' });
  }
};

const getClienteDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await db.Cliente.findByPk(id, {
      attributes: { exclude: ['senha'] },
    });
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });

    const [infoShopify, infoNuvemshop, pedidosImportados, cotacoes, ultimaCotacao, auditLogs, syncLogs] = await Promise.all([
      db.InfoShopify.findOne({ where: { id_cliente: id } }),
      db.InfoNuvemshop.findOne({ where: { id_cliente: id } }),
      db.PedidoImport.count({ where: { cliente_id: id } }),
      db.Cotacao.count({ where: { cliente_id: id } }),
      db.Cotacao.findOne({ where: { cliente_id: id }, order: [['createdAt', 'DESC']], attributes: ['id', 'pedido_ref', 'createdAt'] }),
      db.AdminAuditLog.findAll({ where: { clienteId: id }, order: [['createdAt', 'DESC']], limit: 20 }),
      db.SyncLog.findAll({ where: { clienteId: id }, order: [['createdAt', 'DESC']], limit: 20 }),
    ]);

    let shopifyToken = null;
    if (infoShopify?.shopDomain) {
      shopifyToken = await db.Shop.findOne({ where: { shop: infoShopify.shopDomain }, attributes: ['tokenExpiresAt', 'scope'] });
    }
    let nuvemshopToken = null;
    if (infoNuvemshop?.storeId) {
      nuvemshopToken = await db.NuvemshopShop.findOne({ where: { storeId: infoNuvemshop.storeId }, attributes: ['scope'] });
    }

    const etiquetasEmitidas = await db.Cotacao.count({ where: { cliente_id: id, etiqueta_path: { [Op.ne]: null } } });

    const historico = [
      ...auditLogs.map((l) => ({ tipo: 'auditoria', ...l.toJSON() })),
      ...syncLogs.map((l) => ({ tipo: 'sincronizacao', ...l.toJSON() })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30);

    return res.json({
      ok: true,
      data: {
        cliente,
        integracoes: {
          shopify: infoShopify ? {
            conectado: true,
            loja: infoShopify.shopDomain,
            tokenValido: !!shopifyToken,
            tokenExpiraEm: shopifyToken?.tokenExpiresAt || null,
          } : { conectado: false },
          nuvemshop: infoNuvemshop ? {
            conectado: true,
            loja: infoNuvemshop.storeId,
            tokenValido: !!nuvemshopToken,
          } : { conectado: false },
        },
        estatisticas: {
          pedidosImportados,
          enviosRealizados: cotacoes,
          etiquetasEmitidas,
          ultimoPedido: ultimaCotacao,
          ultimoAcesso: cliente.lastLoginAt,
        },
        historico,
      },
    });
  } catch (err) {
    console.error('[AdminClientes] getClienteDetail erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar detalhe do cliente' });
  }
};

const updateClienteStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['ativo', 'inativo', 'suspenso'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'Status inválido' });
    }

    const cliente = await db.Cliente.findByPk(id);
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });

    const statusAnterior = cliente.status;
    await cliente.update({ status });

    const { logAdminAction } = require('../services/audit');
    await logAdminAction({
      adminUserId: req.adminUser?.id,
      action: 'client.status_change',
      entityType: 'Cliente',
      entityId: cliente.id,
      clienteId: cliente.id,
      metadata: { statusAnterior, statusNovo: status },
      req,
    });

    return res.json({ ok: true, data: { id: cliente.id, status: cliente.status } });
  } catch (err) {
    console.error('[AdminClientes] updateClienteStatus erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar status do cliente' });
  }
};

module.exports = { listClientes, getClienteDetail, updateClienteStatus };
