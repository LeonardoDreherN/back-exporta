const { Op, literal, fn, col } = require('sequelize');
const db = require('../models');
const { valorConversao } = require('../utils/dolar');

const tz = 'America/Sao_Paulo';
const fmtSP = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

function ymdSP(date = new Date()) {
  return fmtSP.format(date);
}

function gerarDias(start, end) {
  const dias = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (d <= e) {
    dias.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

// Resolve o período (fuso America/Sao_Paulo) a partir de ?date_from=&date_to=
// vindos do seletor de data do dashboard. Sem eles, cai no padrão de N dias.
function resolveRangeSP(query, defaultDays) {
  const { date_from, date_to } = query || {};

  if (date_from || date_to) {
    const endSP = date_to || ymdSP(new Date());
    const startSP = date_from || endSP;
    return {
      start: new Date(`${startSP}T00:00:00-03:00`),
      end: new Date(`${endSP}T23:59:59.999-03:00`),
    };
  }

  const hojeSP = ymdSP(new Date());
  const d = new Date();
  d.setDate(d.getDate() - (defaultDays - 1));
  const inicioSP = fmtSP.format(d);

  return {
    start: new Date(`${inicioSP}T00:00:00-03:00`),
    end: new Date(`${hojeSP}T23:59:59.999-03:00`),
  };
}

// Cards de estado atual (não variam com o filtro de data do dashboard):
// contagens "ao vivo" de clientes/lojas/integrações, e "envios hoje" como
// referência fixa de calendário.
const summary = async (req, res) => {
  try {
    const hojeStr = ymdSP(new Date());
    const startHoje = new Date(`${hojeStr}T00:00:00-03:00`);
    const endHoje = new Date(`${hojeStr}T23:59:59.999-03:00`);

    const [
      clientesAtivos,
      lojasShopify,
      lojasNuvemshop,
      enviosHoje,
      integracoesComErro,
      integrationStatuses,
      ultimasSincronizacoes,
    ] = await Promise.all([
      db.Cliente.count({ where: { status: 'ativo' } }),
      db.InfoShopify.count(),
      db.InfoNuvemshop.count(),
      db.Cotacao.count({ where: { created_at: { [Op.between]: [startHoje, endHoje] } } }),
      db.IntegrationStatus.count({ where: { state: { [Op.ne]: 'operational' } } }),
      db.IntegrationStatus.findAll({ attributes: ['key', 'label', 'state'], raw: true }),
      db.SyncLog.findAll({
        order: [['createdAt', 'DESC']],
        limit: 10,
        attributes: ['id', 'integration', 'status', 'message', 'createdAt'],
        raw: true,
      }),
    ]);

    const apisOnline = integrationStatuses.filter((i) => i.state === 'operational').length;

    return res.json({
      ok: true,
      data: {
        clientesAtivos,
        lojasShopify,
        lojasNuvemshop,
        enviosHoje,
        apisOnline,
        totalIntegracoes: integrationStatuses.length,
        integracoesComErro,
        ultimasSincronizacoes,
      },
    });
  } catch (err) {
    console.error('[AdminDashboard] summary erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar resumo do dashboard' });
  }
};

// Cards que seguem o filtro de data do dashboard (envios no período,
// etiquetas emitidas no período) — mesma janela usada pelos gráficos.
const periodSummary = async (req, res) => {
  try {
    const { date_from, date_to } = req.query || {};
    const where = {};
    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at[Op.gte] = new Date(`${date_from}T00:00:00-03:00`);
      if (date_to) where.created_at[Op.lte] = new Date(`${date_to}T23:59:59.999-03:00`);
    }

    const [enviosNoPeriodo, etiquetasEmitidas] = await Promise.all([
      db.Cotacao.count({ where }),
      db.Cotacao.count({ where: { ...where, etiqueta_path: { [Op.ne]: null } } }),
    ]);

    return res.json({ ok: true, data: { enviosNoPeriodo, etiquetasEmitidas } });
  } catch (err) {
    console.error('[AdminDashboard] periodSummary erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar resumo do período' });
  }
};

const enviosPorDia = async (req, res) => {
  try {
    const { start, end } = resolveRangeSP(req.query, 30);

    const dayExpr = literal(`date_trunc('day', (created_at AT TIME ZONE '${tz}'))`);

    const rows = await db.Cotacao.findAll({
      where: { created_at: { [Op.between]: [start, end] } },
      attributes: [[dayExpr, 'day'], [fn('COUNT', col('id')), 'total']],
      group: [dayExpr],
      order: [[dayExpr, 'ASC']],
      raw: true,
    });

    const map = new Map(rows.map((r) => [fmtSP.format(new Date(r.day)), Number(r.total) || 0]));
    const dias = gerarDias(start, end);
    const data = dias.map((dia) => ({ label: dia.slice(5), value: map.get(dia) ?? 0 }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[AdminDashboard] enviosPorDia erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar envios por dia' });
  }
};

const crescimentoMensal = async (req, res) => {
  try {
    const { date_from, date_to } = req.query || {};
    const end = date_to ? new Date(`${date_to}T23:59:59.999-03:00`) : new Date();
    const start = date_from
      ? new Date(`${date_from}T00:00:00-03:00`)
      : new Date(new Date(end).setMonth(end.getMonth() - 11));

    const monthExpr = literal(`to_char(date_trunc('month', "createdAt"), 'YYYY-MM')`);

    const rows = await db.Cliente.findAll({
      attributes: [[monthExpr, 'mes'], [fn('COUNT', col('id')), 'total']],
      where: { createdAt: { [Op.between]: [start, end] } },
      group: [monthExpr],
      order: [[monthExpr, 'ASC']],
      raw: true,
    });

    const data = rows.map((r) => ({ label: r.mes, value: Number(r.total) || 0 }));
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[AdminDashboard] crescimentoMensal erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar crescimento mensal' });
  }
};

const distribuicaoTransportadora = async (req, res) => {
  try {
    const { date_from, date_to } = req.query || {};
    const where = {};
    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at[Op.gte] = new Date(`${date_from}T00:00:00-03:00`);
      if (date_to) where.created_at[Op.lte] = new Date(`${date_to}T23:59:59.999-03:00`);
    }

    const [ups, fedex] = await Promise.all([
      db.Cotacao.count({ where: { ...where, carrier: 'UPS' } }),
      db.Cotacao.count({ where: { ...where, carrier: 'FEDEX' } }),
    ]);
    return res.json({ ok: true, data: [{ label: 'UPS', value: ups }, { label: 'FEDEX', value: fedex }] });
  } catch (err) {
    console.error('[AdminDashboard] distribuicaoTransportadora erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar distribuição por transportadora' });
  }
};

const novosClientes = async (req, res) => {
  try {
    const { start, end } = resolveRangeSP(req.query, 30);

    const dayExpr = literal(`date_trunc('day', ("createdAt" AT TIME ZONE '${tz}'))`);

    const rows = await db.Cliente.findAll({
      where: { createdAt: { [Op.between]: [start, end] } },
      attributes: [[dayExpr, 'day'], [fn('COUNT', col('id')), 'total']],
      group: [dayExpr],
      order: [[dayExpr, 'ASC']],
      raw: true,
    });

    const map = new Map(rows.map((r) => [fmtSP.format(new Date(r.day)), Number(r.total) || 0]));
    const dias = gerarDias(start, end);
    const data = dias.map((dia) => ({ label: dia.slice(5), value: map.get(dia) ?? 0 }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[AdminDashboard] novosClientes erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar novos clientes' });
  }
};

const pedidosImportados = async (req, res) => {
  try {
    const { start, end } = resolveRangeSP(req.query, 30);

    // PedidoImport usa underscored:true (tableName 'pedidos_importados'), a coluna
    // física é created_at, não createdAt — diferente de Cliente, que não é underscored.
    const dayExpr = literal(`date_trunc('day', (created_at AT TIME ZONE '${tz}'))`);

    const rows = await db.PedidoImport.findAll({
      where: { createdAt: { [Op.between]: [start, end] } },
      attributes: [[dayExpr, 'day'], [fn('COUNT', col('id')), 'total']],
      group: [dayExpr],
      order: [[dayExpr, 'ASC']],
      raw: true,
    });

    const map = new Map(rows.map((r) => [fmtSP.format(new Date(r.day)), Number(r.total) || 0]));
    const dias = gerarDias(start, end);
    const data = dias.map((dia) => ({ label: dia.slice(5), value: map.get(dia) ?? 0 }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[AdminDashboard] pedidosImportados erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar pedidos importados' });
  }
};

// Top clientes por valor enviado. preco_final é salvo em USD (mesma convenção
// de routes/relatorioPagamentos.js) — convertemos para BRL com a cotação do
// dólar (utils/dolar.js, cache de 1h) só para exibição; o valor "de verdade"
// guardado no banco continua em USD.
const valorPorCliente = async (req, res) => {
  try {
    const { date_from, date_to } = req.query || {};
    const where = {};
    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at[Op.gte] = new Date(`${date_from}T00:00:00-03:00`);
      if (date_to) where.created_at[Op.lte] = new Date(`${date_to}T23:59:59.999-03:00`);
    }

    const rows = await db.Cotacao.findAll({
      where,
      attributes: [
        'cliente_id',
        [fn('SUM', col('preco_final')), 'totalUsd'],
        [fn('COUNT', col('Cotacao.id')), 'envios'],
      ],
      include: [{ model: db.Cliente, as: 'cliente', attributes: ['razaoSocial'] }],
      group: ['cliente_id', 'cliente.id', 'cliente.razaoSocial'],
      order: [[literal('"totalUsd"'), 'DESC']],
      limit: 10,
    });

    let dolar = null;
    try {
      dolar = await valorConversao();
    } catch (e) {
      console.warn('[AdminDashboard] valorPorCliente: falha ao obter cotação do dólar:', e.message);
    }

    const data = rows.map((r) => {
      const totalUsd = Number(r.get('totalUsd')) || 0;
      return {
        clienteId: r.cliente_id,
        label: r.cliente?.razaoSocial || `Cliente ${r.cliente_id}`,
        envios: Number(r.get('envios')) || 0,
        totalUsd,
        value: dolar ? Math.round(totalUsd * dolar * 100) / 100 : null,
      };
    });

    return res.json({ ok: true, data, dolar });
  } catch (err) {
    console.error('[AdminDashboard] valorPorCliente erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar valor por cliente' });
  }
};

module.exports = {
  summary,
  periodSummary,
  enviosPorDia,
  crescimentoMensal,
  distribuicaoTransportadora,
  novosClientes,
  pedidosImportados,
  valorPorCliente,
};
