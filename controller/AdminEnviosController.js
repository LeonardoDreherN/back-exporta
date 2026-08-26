const { Op, fn, col, where: sequelizeWhere } = require('sequelize');
const db = require('../models');
const { valorConversao } = require('../utils/dolar');

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

// Busca exata por número de rastreio — usado pra descobrir de qual cliente
// é uma fatura da transportadora quando só se tem o tracking em mãos.
const buscarPorRastreio = async (req, res) => {
  try {
    const tracking = String(req.params.tracking || '').trim();
    if (!tracking) {
      return res.status(400).json({ ok: false, error: 'Informe o número de rastreio' });
    }

    const rows = await db.Cotacao.findAll({
      where: { tracking_number: { [Op.iLike]: tracking } },
      attributes: { exclude: ['etiqueta_base64', 'invoice_base64', 'tracking_raw'] },
      include: [{ model: db.Cliente, as: 'cliente', attributes: ['id', 'razaoSocial', 'emailPrincipal', 'cnpj'] }],
      order: [['createdAt', 'DESC']],
    });

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Nenhum envio encontrado com esse número de rastreio' });
    }

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[AdminEnvios] buscarPorRastreio erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar por rastreio' });
  }
};

// Reconciliação em lote: recebe uma lista de números de rastreio (ex.: todas
// as linhas de uma fatura da transportadora) e devolve, pra cada um, de qual
// cliente é o envio + valor, com resumo agrupado por cliente e sinalização
// de rastreios não encontrados no sistema (precisam de investigação manual).
const reconciliarLote = async (req, res) => {
  try {
    const trackingsRaw = Array.isArray(req.body?.trackings) ? req.body.trackings : [];
    const trackings = trackingsRaw.map((t) => String(t || '').trim()).filter(Boolean);

    if (!trackings.length) {
      return res.status(400).json({ ok: false, error: 'Informe ao menos um número de rastreio' });
    }
    if (trackings.length > 500) {
      return res.status(400).json({ ok: false, error: 'Máximo de 500 rastreios por vez' });
    }

    const uniqueUpper = [...new Set(trackings.map((t) => t.toUpperCase()))];

    const rows = await db.Cotacao.findAll({
      where: sequelizeWhere(fn('UPPER', col('tracking_number')), { [Op.in]: uniqueUpper }),
      attributes: ['id', 'cliente_id', 'pedido_ref', 'tracking_number', 'carrier', 'status_norm', 'preco_final', 'createdAt'],
      include: [{ model: db.Cliente, as: 'cliente', attributes: ['id', 'razaoSocial'] }],
      order: [['createdAt', 'DESC']],
    });

    const byTracking = new Map();
    for (const r of rows) {
      const key = String(r.tracking_number || '').toUpperCase();
      if (!byTracking.has(key)) byTracking.set(key, []);
      byTracking.get(key).push(r);
    }

    let dolar = null;
    try {
      dolar = await valorConversao();
    } catch (e) {
      console.warn('[AdminEnvios] reconciliarLote: falha ao obter cotação do dólar:', e.message);
    }

    const linhas = trackings.map((tracking) => {
      const matches = byTracking.get(tracking.toUpperCase()) || [];
      const match = matches[0] || null;
      const totalUsd = match?.preco_final != null ? Number(match.preco_final) : null;
      return {
        tracking,
        encontrado: !!match,
        duplicado: matches.length > 1,
        clienteId: match?.cliente_id ?? null,
        cliente: match?.cliente?.razaoSocial || null,
        pedidoRef: match?.pedido_ref ?? null,
        carrier: match?.carrier ?? null,
        status: match?.status_norm ?? null,
        valorUsd: totalUsd,
        valorBrl: dolar && totalUsd != null ? Math.round(totalUsd * dolar * 100) / 100 : null,
        data: match?.createdAt ?? null,
      };
    });

    const resumoMap = new Map();
    for (const l of linhas) {
      if (!l.encontrado) continue;
      const key = l.clienteId;
      if (!resumoMap.has(key)) {
        resumoMap.set(key, { clienteId: key, cliente: l.cliente, envios: 0, totalUsd: 0 });
      }
      const acc = resumoMap.get(key);
      acc.envios += 1;
      acc.totalUsd += l.valorUsd || 0;
    }
    const resumo = [...resumoMap.values()]
      .map((r) => ({ ...r, valorBrl: dolar ? Math.round(r.totalUsd * dolar * 100) / 100 : null }))
      .sort((a, b) => b.totalUsd - a.totalUsd);

    return res.json({
      ok: true,
      data: {
        linhas,
        resumo,
        totalInformados: trackings.length,
        totalEncontrados: linhas.filter((l) => l.encontrado).length,
        dolar,
      },
    });
  } catch (err) {
    console.error('[AdminEnvios] reconciliarLote erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao reconciliar rastreios' });
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

module.exports = { listEnvios, getEnvioDetail, buscarPorRastreio, reconciliarLote };
