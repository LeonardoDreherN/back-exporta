const { Op } = require('sequelize');
const crypto = require('crypto');
const db = require('../models');
const { normalizarPrefixo, prefixoValido, sugerirPrefixo } = require('../services/shopify/pedidoRef');

const CLIENTE_LIST_ATTRS = [
  'id', 'razaoSocial', 'emailPrincipal', 'telefoneCelular', 'plano', 'status',
  'tipoConta', 'cnpj', 'tipoDocumento', 'createdAt', 'lastLoginAt',
  // Bloqueio de operacao: a lista precisa mostrar, senao o admin so descobre
  // abrindo cliente por cliente.
  'enviosBloqueados', 'enviosBloqueadosMotivo', 'enviosBloqueadosEm',
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

    // Uma conta pode ter mais de uma loja Shopify (InfoShopifies tem UNIQUE em
    // shopDomain, nao em id_cliente). O `integracoes.shopify` abaixo mostra so
    // a primeira; `lojasShopify` lista todas com o prefixo de pedido, que e o
    // que evita a colisao de numero entre as lojas.
    const lojasShopifyRows = await db.InfoShopify.findAll({
      where: { id_cliente: id },
      attributes: ['id', 'shopDomain', 'prefixoPedido', 'apiVersion', 'createdAt'],
      order: [['createdAt', 'ASC']],
      raw: true,
    });

    const lojasShopify = lojasShopifyRows.map((l) => ({
      id: l.id,
      shopDomain: l.shopDomain,
      prefixoPedido: l.prefixoPedido || null,
      apiVersion: l.apiVersion,
      // Com duas lojas e nenhum prefixo, o pedido da segunda loja e descartado
      // em silencio quando o numero coincide.
      precisaPrefixo: lojasShopifyRows.length > 1 && !l.prefixoPedido,
      prefixoSugerido: l.prefixoPedido ? null : sugerirPrefixo(l.shopDomain),
    }));

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
            totalLojas: lojasShopify.length,
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
        lojasShopify,
        historico,
      },
    });
  } catch (err) {
    console.error('[AdminClientes] getClienteDetail erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar detalhe do cliente' });
  }
};

/**
 * PATCH /admin/clientes/:id/envios
 * Liga ou desliga o bloqueio de operacao. Diferente de `status`: o cliente
 * continua entrando na plataforma, vendo os envios em andamento e baixando
 * documento do que ja despachou — so nao cria cotacao nem despacha.
 */
const updateEnviosBloqueados = async (req, res) => {
  try {
    const { id } = req.params;
    const { bloqueado, motivo } = req.body || {};

    if (typeof bloqueado !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Informe bloqueado: true ou false' });
    }

    const cliente = await db.Cliente.findByPk(id);
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente nao encontrado' });

    const anterior = cliente.enviosBloqueados;

    await cliente.update({
      enviosBloqueados: bloqueado,
      // O motivo aparece para o cliente na tela, entao so faz sentido guardar
      // enquanto o bloqueio existe.
      enviosBloqueadosMotivo: bloqueado ? (String(motivo || '').trim().slice(0, 200) || null) : null,
      enviosBloqueadosEm: bloqueado ? new Date() : null,
    });

    const { logAdminAction } = require('../services/audit');
    await logAdminAction({
      adminUserId: req.adminUser?.id,
      action: bloqueado ? 'client.envios_bloqueados' : 'client.envios_liberados',
      entityType: 'Cliente',
      entityId: cliente.id,
      clienteId: cliente.id,
      metadata: { anterior, novo: bloqueado, motivo: cliente.enviosBloqueadosMotivo },
      req,
    });

    return res.json({
      ok: true,
      data: {
        id: cliente.id,
        enviosBloqueados: cliente.enviosBloqueados,
        enviosBloqueadosMotivo: cliente.enviosBloqueadosMotivo,
        enviosBloqueadosEm: cliente.enviosBloqueadosEm,
      },
    });
  } catch (err) {
    console.error('[AdminClientes] updateEnviosBloqueados erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar o bloqueio de envios' });
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

// Gera (ou rotaciona) a chave usada por uma plataforma externa do cliente
// para chamar /api/public-quote e /api/public-orders. A chave só é exibida
// nesta resposta — o banco guarda apenas o valor atual, sem histórico.
const regeneratePublicApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await db.Cliente.findByPk(id);
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });

    const publicApiKey = crypto.randomBytes(24).toString('hex');
    await cliente.update({ publicApiKey });

    const { logAdminAction } = require('../services/audit');
    await logAdminAction({
      adminUserId: req.adminUser?.id,
      action: 'client.public_api_key_regenerated',
      entityType: 'Cliente',
      entityId: cliente.id,
      clienteId: cliente.id,
      req,
    });

    return res.json({ ok: true, data: { id: cliente.id, publicApiKey } });
  } catch (err) {
    console.error('[AdminClientes] regeneratePublicApiKey erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao gerar API key' });
  }
};

/**
 * Prefixo de pedido de uma loja Shopify do cliente.
 *
 * A Shopify numera pedido por loja: duas lojas da mesma conta chegam as duas
 * ao 1007 e o UNIQUE (cliente_id, pedido_ref) descarta o segundo. O prefixo
 * torna a ref unica na entrada (MOMI-1007).
 *
 * Prefixo vazio/null volta a gravar a ref crua — e o que as contas de uma
 * loja so usam, para nao mudar o formato no meio do historico.
 */
const updateShopifyPrefixo = async (req, res) => {
  try {
    const { id } = req.params;
    const { shopDomain, prefixoPedido } = req.body || {};

    const dominio = String(shopDomain || '').trim().toLowerCase();
    if (!dominio) {
      return res.status(400).json({ ok: false, error: 'Informe shopDomain' });
    }

    const loja = await db.InfoShopify.findOne({ where: { id_cliente: id, shopDomain: dominio } });
    if (!loja) {
      return res.status(404).json({ ok: false, error: 'Loja nao encontrada para este cliente' });
    }

    // string vazia => remove o prefixo (volta a ref crua)
    const novo = prefixoPedido === null || String(prefixoPedido ?? '').trim() === ''
      ? null
      : normalizarPrefixo(prefixoPedido);

    if (!prefixoValido(novo)) {
      return res.status(400).json({ ok: false, error: 'Prefixo invalido: use de 1 a 8 letras ou numeros (ex.: MOMI)' });
    }

    // Dois prefixos iguais na mesma conta nao resolvem nada: a colisao volta.
    if (novo) {
      const conflito = await db.InfoShopify.findOne({
        where: { id_cliente: id, prefixoPedido: novo, shopDomain: { [Op.ne]: dominio } },
        attributes: ['shopDomain'],
        raw: true,
      });
      if (conflito) {
        return res.status(409).json({
          ok: false,
          error: `O prefixo ${novo} ja esta em uso na loja ${conflito.shopDomain} desta conta`,
        });
      }
    }

    const anterior = loja.prefixoPedido || null;
    await loja.update({ prefixoPedido: novo });

    const { logAdminAction } = require('../services/audit');
    await logAdminAction({
      adminUserId: req.adminUser?.id,
      action: 'client.shopify_prefixo_pedido',
      entityType: 'InfoShopify',
      entityId: loja.id,
      clienteId: Number(id),
      metadata: { shopDomain: dominio, anterior, novo },
      req,
    });

    return res.json({
      ok: true,
      data: { shopDomain: loja.shopDomain, prefixoPedido: loja.prefixoPedido },
      // Refs ja gravadas nao sao reescritas: o prefixo vale para o que entrar
      // a partir de agora.
      aviso: 'O prefixo vale para os pedidos importados a partir de agora; as refs ja gravadas continuam como estao.',
    });
  } catch (err) {
    console.error('[AdminClientes] updateShopifyPrefixo erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar o prefixo de pedido da loja' });
  }
};

module.exports = {
  updateEnviosBloqueados, listClientes, getClienteDetail, updateClienteStatus, regeneratePublicApiKey,
  updateShopifyPrefixo };
