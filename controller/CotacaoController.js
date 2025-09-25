// controller/CotacaoController.js
const db = require('../models');
const { Op } = require('sequelize');

// -------- helpers ---------- 
const toNum = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const stripNulls = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

async function resolvePedidoId({ clienteId, pedido_ref, pedidoImportId }) {
    if (pedidoImportId) return Number(pedidoImportId);
    if (!pedido_ref) return null;
    const p = await db.PedidoImport.findOne({ where: { cliente_id: clienteId, pedido_ref } });
    return p ? p.id : null;
}

async function getPedidoSnapshot({ clienteId, pedidoImportId }) {
    const p = await db.PedidoImport.findOne({
        where: { id: pedidoImportId, cliente_id: clienteId },
    });
    if (!p) return null;
    return stripNulls({
        id: p.id,
        ref: p.pedido_ref,
        moeda: p.moeda,
        total: toNum(p.total),
        comprador: {
            nome: p.nomeComprador,
            email: p.emailComprador,
            telefone: p.telefoneComprador,
        },
        endereco: {
            cidade: p.cidade, estado: p.estado, cep: p.CEP, pais: p.pais,
        },
        itens: Array.isArray(p.itens) ? p.itens : [],
    });
}

function _toId(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// aceita: { caixa_id }, { id }, { data: { id } }, { cod_identificacao }
async function pickCaixaIdsFromBody(body = {}, clienteId) {
    const arr = Array.isArray(body.caixas_escolhidas) ? body.caixas_escolhidas : [];
    const idsDiretos = [];
    const codigos = [];

    for (const x of arr) {
        const byId =
            _toId(x?.caixa_id) ??
            _toId(x?.id) ??
            _toId(x?.data?.id) ??
            null;
        if (byId != null) {
            idsDiretos.push(byId);
            continue;
        }
        const code = (x?.cod_identificacao || x?.codigo || x?.code || '').toString().trim();
        if (code) codigos.push(code);
    }

    // resolve por código, se houver
    let idsPorCodigo = [];
    if (codigos.length) {
        const found = await db.Caixa.findAll({
            attributes: ['id', 'cod_identificacao'],
            where: { id_cliente: clienteId, cod_identificacao: { [Op.in]: codigos } },
        });
        idsPorCodigo = found.map(r => Number(r.id)).filter(Number.isFinite);
        if (process.env.AUTH_DEBUG === '1') {
            console.log('[cotacao] codigos->ids', { codigos, idsPorCodigo, encontrados: found.map(f => f.cod_identificacao) });
        }
    }

    const out = [...new Set([...idsDiretos, ...idsPorCodigo])];
    if (process.env.AUTH_DEBUG === '1') {
        console.log('[cotacao] payload.caixas_escolhidas:', JSON.stringify(arr));
        console.log('[cotacao] ids extraidos:', out);
    }
    return out;
}

async function getCaixasSnapshots({ clienteId, caixaIds }) {
    if (!Array.isArray(caixaIds) || !caixaIds.length) return [];

    const rows = await db.Caixa.findAll({
        where: { id_cliente: clienteId, id: { [Op.in]: caixaIds } },
        order: [['id', 'ASC']],
    });

    // Diagnóstico: avisa se algum ID não foi encontrado
    if (rows.length !== caixaIds.length) {
        const encontrados = new Set(rows.map(r => Number(r.id)));
        const faltando = caixaIds.filter(id => !encontrados.has(Number(id)));
        console.warn('[cotacao] caixas não encontradas para este cliente:', faltando);
    }

    return rows.map(c => {
        const altura = toNum(c.altura);
        const largura = toNum(c.largura);
        const profundidade = toNum(c.profundidade);
        const peso = toNum(c.peso);
        return {
            id: c.id,
            id_cliente: c.id_cliente,
            cod_identificacao: c.cod_identificacao,
            descricao: c.descricao,
            dimensoes: {
                altura_cm: altura,
                largura_cm: largura,
                profundidade_cm: profundidade,
            },
            peso_kg: peso,
        }
    });
}



// -------- controllers ----------
async function criarCotacao(req, res) {
    try {
        const clienteId = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
        if (!clienteId) return res.status(401).json({ erro: 'cliente não autenticado' });

        const caixaIds = await pickCaixaIdsFromBody(req.body, clienteId);
        const { pedido_ref, pedidoImportId, moeda_emissao, moeda_pagamento, pais_remetente, pais_dest } = req.body || {};

        const pid = await resolvePedidoId({ clienteId, pedido_ref, pedidoImportId });
        if (!pid) return res.status(400).json({ erro: 'pedido não encontrado para este cliente' });
        if (!caixaIds.length) return res.status(400).json({ erro: 'nenhuma caixa válida informada' });

        const [pedidoSnap, caixasSnap] = await Promise.all([
            getPedidoSnapshot({ clienteId, pedidoImportId: pid }),
            getCaixasSnapshots({ clienteId, caixaIds }),
        ]);
        if (!pedidoSnap) return res.status(404).json({ erro: 'pedido inválido' });

        const jaExiste = await db.Cotacao.findOne({
            where: { cliente_id: clienteId, pedido_ref: pedidoSnap.ref },
            attributes: ['id'],
        });
        if (jaExiste) {
            return res.status(409).json({ erro: 'Já existe uma cotação para este pedido.' });
        }

        // cria/insere na tabela cotacoes
        const row = await db.Cotacao.create({
            cliente_id: clienteId,
            pedido: pedidoSnap,
            caixa: caixasSnap,
            pedido_ref: pedidoSnap.ref,
            moeda_emissao: moeda_emissao || pedidoSnap.moeda || null,
            moeda_pagamento: moeda_pagamento || pedidoSnap.moeda || null,
            pais_remetente: pais_remetente || null,
            pais_dest: pais_dest || (pedidoSnap.endereco ? pedidoSnap.endereco.pais : null) || null,
            preco_total: pedidoSnap.total != null ? String(pedidoSnap.total) : null,
            // se sua tabela tiver outros campos (pais_remetente, etc.), adicione aqui
        });

        return res.status(201).json({
            ok: true,
            cotacao_id: row.id,
            pedido_ref: pedidoSnap.ref,
            caixas_count: caixasSnap.length,
        });
    } catch (e) {
        console.error('[criarCotacao]', e);
        return res.status(500).json({ erro: 'erro interno ao criar cotação' });
    }
}

async function listarCotacoes(req, res) {
    try {
        const clienteId = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
        if (!clienteId) return res.status(401).json({ erro: 'cliente não autenticado' });

        const rows = await db.Cotacao.findAll({
            where: { cliente_id: clienteId },
            order: [['created_at', 'DESC']],
        });

        return res.json(rows);
    } catch (e) {
        console.error('[listarCotacoes]', e);
        return res.status(500).json({ erro: 'erro interno ao listar cotações' });
    }
}

module.exports = { criarCotacao, listarCotacoes };
