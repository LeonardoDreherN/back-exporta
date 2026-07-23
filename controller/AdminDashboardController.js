const { Op, literal, fn, col } = require('sequelize');
const db = require('../models');

const tz = 'America/Sao_Paulo';

function ymdSP(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
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

const summary = async (req, res) => {
  try {
    const hojeStr = ymdSP(new Date());
    const startHoje = new Date(`${hojeStr}T00:00:00-03:00`);
    const endHoje = new Date(`${hojeStr}T23:59:59.999-03:00`);

    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [
      clientesAtivos,
      lojasShopify,
      lojasNuvemshop,
      enviosHoje,
      enviosMes,
      etiquetasEmitidas,
      integracoesComErro,
      integrationStatuses,
      ultimasSincronizacoes,
    ] = await Promise.all([
      db.Cliente.count({ where: { status: 'ativo' } }),
      db.InfoShopify.count(),
      db.InfoNuvemshop.count(),
      db.Cotacao.count({ where: { created_at: { [Op.between]: [startHoje, endHoje] } } }),
      db.Cotacao.count({ where: { created_at: { [Op.gte]: inicioMes } } }),
      db.Cotacao.count({ where: { etiqueta_path: { [Op.ne]: null } } }),
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
        enviosMes,
        etiquetasEmitidas,
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

const enviosPorDia = async (req, res) => {
  try {
    const hojeSP = ymdSP(new Date());
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const d = new Date();
    d.setDate(d.getDate() - 29);
    const inicioSP = fmt.format(d);

    const start = new Date(`${inicioSP}T00:00:00-03:00`);
    const end = new Date(`${hojeSP}T23:59:59.999-03:00`);

    const dayExpr = literal(`date_trunc('day', (created_at AT TIME ZONE '${tz}'))`);

    const rows = await db.Cotacao.findAll({
      where: { created_at: { [Op.between]: [start, end] } },
      attributes: [[dayExpr, 'day'], [fn('COUNT', col('id')), 'total']],
      group: [dayExpr],
      order: [[dayExpr, 'ASC']],
      raw: true,
    });

    const map = new Map(rows.map((r) => [fmt.format(new Date(r.day)), Number(r.total) || 0]));
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
    const monthExpr = literal(`to_char(date_trunc('month', "createdAt"), 'YYYY-MM')`);

    const rows = await db.Cliente.findAll({
      attributes: [[monthExpr, 'mes'], [fn('COUNT', col('id')), 'total']],
      where: { createdAt: { [Op.gte]: literal(`now() - interval '12 months'`) } },
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
    const [ups, fedex] = await Promise.all([
      db.Cotacao.count({ where: { carrier: 'UPS' } }),
      db.Cotacao.count({ where: { carrier: 'FEDEX' } }),
    ]);
    return res.json({ ok: true, data: [{ label: 'UPS', value: ups }, { label: 'FEDEX', value: fedex }] });
  } catch (err) {
    console.error('[AdminDashboard] distribuicaoTransportadora erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar distribuição por transportadora' });
  }
};

const novosClientes = async (req, res) => {
  try {
    const hojeSP = ymdSP(new Date());
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const d = new Date();
    d.setDate(d.getDate() - 29);
    const inicioSP = fmt.format(d);

    const start = new Date(`${inicioSP}T00:00:00-03:00`);
    const end = new Date(`${hojeSP}T23:59:59.999-03:00`);

    const dayExpr = literal(`date_trunc('day', ("createdAt" AT TIME ZONE '${tz}'))`);

    const rows = await db.Cliente.findAll({
      where: { createdAt: { [Op.between]: [start, end] } },
      attributes: [[dayExpr, 'day'], [fn('COUNT', col('id')), 'total']],
      group: [dayExpr],
      order: [[dayExpr, 'ASC']],
      raw: true,
    });

    const map = new Map(rows.map((r) => [fmt.format(new Date(r.day)), Number(r.total) || 0]));
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
    const hojeSP = ymdSP(new Date());
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const d = new Date();
    d.setDate(d.getDate() - 29);
    const inicioSP = fmt.format(d);

    const start = new Date(`${inicioSP}T00:00:00-03:00`);
    const end = new Date(`${hojeSP}T23:59:59.999-03:00`);

    const dayExpr = literal(`date_trunc('day', ("createdAt" AT TIME ZONE '${tz}'))`);

    const rows = await db.PedidoImport.findAll({
      where: { createdAt: { [Op.between]: [start, end] } },
      attributes: [[dayExpr, 'day'], [fn('COUNT', col('id')), 'total']],
      group: [dayExpr],
      order: [[dayExpr, 'ASC']],
      raw: true,
    });

    const map = new Map(rows.map((r) => [fmt.format(new Date(r.day)), Number(r.total) || 0]));
    const dias = gerarDias(start, end);
    const data = dias.map((dia) => ({ label: dia.slice(5), value: map.get(dia) ?? 0 }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[AdminDashboard] pedidosImportados erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar pedidos importados' });
  }
};

module.exports = {
  summary,
  enviosPorDia,
  crescimentoMensal,
  distribuicaoTransportadora,
  novosClientes,
  pedidosImportados,
};
