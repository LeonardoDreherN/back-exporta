const { Op, fn, col, where: sequelizeWhere } = require('sequelize');
const db = require('../models');
const { valorConversao } = require('../utils/dolar');
const { gerarInvoiceComercial } = require('../services/invoice/gerarInvoiceComercial');
const {
  normalizarAjustes,
  aplicarAjustes,
  diferencas,
} = require('../services/invoice/ajustesInvoice');
const {
  salvarInvoiceNaStorage,
  downloadFromBucket,
  INVOICES_BUCKET,
} = require('./CotacaoController');
const { logAdminAction } = require('../services/audit');

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

/*
 * Reemite a invoice com correção de valor, descrição ou quantidade.
 *
 * A invoice sai com o que foi declarado na emissão, e às vezes o que foi
 * declarado está errado: preço digitado errado no cadastro, descrição que o
 * despachante recusa, quantidade trocada. Até aqui a única saída era anexar
 * um PDF feito à mão por fora.
 *
 * A correção não toca em `pedido`. O preço do item alimenta a estimativa de
 * imposto, a cotação das transportadoras e o formulário CPSC — reescrever o
 * pedido mudaria a base de uma remessa já cobrada e apagaria o valor que a
 * análise de acurácia do imposto compara com o imposto real. Por isso a
 * correção fica em `invoice_ajustes` e a invoice passa a ser gerada a partir
 * de pedido + ajustes. Ver services/invoice/ajustesInvoice.js.
 *
 * Só o admin faz isso, e o motivo é obrigatório: é documento aduaneiro, e o
 * de/para de cada campo vai para o AdminAuditLog.
 *
 * Reemitir é permitido em qualquer status, inclusive com a carga entregue —
 * o despachante no destino às vezes só pede a invoice corrigida depois. Vale
 * lembrar que, quando a transportadora transmitiu os valores na emissão, o
 * papel novo passa a divergir do que a alfândega recebeu: quem emite precisa
 * saber disso, e por isso `invoice_origem` é devolvida na resposta.
 */
const reemitirInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const cotacao = await db.Cotacao.findByPk(id);
    if (!cotacao) return res.status(404).json({ ok: false, error: 'Envio não encontrado' });

    const pedido = cotacao.pedido || {};
    if (!Array.isArray(pedido.itens) || !pedido.itens.length) {
      return res.status(422).json({
        ok: false,
        error: 'Pedido sem itens: não há o que declarar na invoice.',
      });
    }

    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) {
      return res.status(422).json({
        ok: false,
        error: 'Informe o motivo da correção: ele fica no log de auditoria.',
      });
    }

    const { itens, erros } = normalizarAjustes(pedido, req.body);
    if (erros.length) {
      return res.status(422).json({ ok: false, error: erros.join(' '), erros });
    }

    const ajustes = {
      itens,
      motivo,
      editado_por: { id: req.adminUser?.id ?? null, nome: req.adminUser?.name ?? null },
      editado_em: new Date().toISOString(),
    };

    const mudancas = diferencas(pedido, ajustes);
    if (!mudancas.length) {
      return res.status(422).json({
        ok: false,
        error: 'Nenhum valor mudou em relação ao pedido: não há o que reemitir.',
      });
    }

    const cliente = await db.Cliente.findByPk(cotacao.cliente_id);
    const origemAnterior = cotacao.invoice_origem;
    const pathAnterior = cotacao.invoice_path;

    const base64 = await gerarInvoiceComercial({
      cotacao: { ...cotacao.toJSON(), pedido: aplicarAjustes(pedido, ajustes) },
      cliente: cliente ? cliente.toJSON() : {},
    });

    await salvarInvoiceNaStorage(cotacao.id, base64, 'application/pdf', 'INTREX');
    await cotacao.reload();

    /*
     * salvarInvoiceNaStorage engole o próprio erro e só loga. Sem conferir
     * que o path mudou, uma falha de upload responderia "ok" e o admin
     * continuaria baixando a invoice antiga achando que corrigiu.
     */
    if (!cotacao.invoice_path || cotacao.invoice_path === pathAnterior) {
      return res.status(502).json({
        ok: false,
        error: 'A invoice foi gerada mas não subiu para o storage. Tente de novo.',
      });
    }

    // Só grava os ajustes depois que o PDF novo está no lugar: o registro da
    // correção não pode existir sem o documento que ela produziu.
    await db.Cotacao.update({ invoice_ajustes: ajustes }, { where: { id: cotacao.id } });

    await logAdminAction({
      adminUserId: req.adminUser?.id ?? null,
      action: 'invoice.reemitida',
      entityType: 'cotacao',
      entityId: cotacao.id,
      clienteId: cotacao.cliente_id,
      metadata: { motivo, mudancas, origem_anterior: origemAnterior, path_anterior: pathAnterior },
      req,
    });

    return res.json({
      ok: true,
      cotacao_id: cotacao.id,
      mudancas,
      origem_anterior: origemAnterior,
      invoice_path: cotacao.invoice_path,
    });
  } catch (err) {
    console.error('[AdminEnvios] reemitirInvoice erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao reemitir a invoice' });
  }
};

/*
 * Download da invoice pelo admin.
 *
 * A rota do cliente filtra por cliente_id e passa pela trava de pagamento,
 * então não serve aqui: o admin precisa conferir o PDF que acabou de
 * reemitir, de qualquer cliente.
 */
const baixarInvoiceAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const row = await db.Cotacao.findByPk(id, { include: [{ model: db.Cliente, as: 'cliente', attributes: ['razaoSocial'] }] });
    if (!row) return res.status(404).json({ ok: false, error: 'Envio não encontrado' });

    if (!row.invoice_path) {
      return res.status(404).json({ ok: false, error: 'Esta cotação não tem invoice salva.' });
    }

    const buf = await downloadFromBucket(INVOICES_BUCKET, row.invoice_path);
    const mime = row.invoice_mime || 'application/pdf';
    const nome = `${row.pedido_ref || 'pedido'}-IN.pdf`;

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    return res.send(buf);
  } catch (err) {
    console.error('[AdminEnvios] baixarInvoiceAdmin erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao baixar a invoice' });
  }
};

module.exports = {
  listEnvios,
  getEnvioDetail,
  buscarPorRastreio,
  reconciliarLote,
  reemitirInvoice,
  baixarInvoiceAdmin,
};
