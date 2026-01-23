// services/cotacoes.service.js
const db = require('../models'); // seu models/index.js

const toNum = (v) => (v == null ? null : Number(v));
const stripNulls = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
const CUBIC_FACTOR = 6000; // padrão internacional cm³→kg

async function buildPedidoSnapshot(pedidoImportId, clienteId) {
    const p = await db.PedidoImport.findOne({ where: { id: pedidoImportId, cliente_id: clienteId } });
    if (!p) throw new Error('Pedido não encontrado para este cliente');

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
            cidade: p.cidade,
            estado: p.estado,
            cep: p.CEP,
            pais: p.pais,
        },
        itens: Array.isArray(p.itens) ? p.itens : [],
        raw: p.toJSON(), // opcional: guarda tudo
    });
}

async function buildPedidoSnapshotManual(pedidoManual) {
    if (!pedidoManual) throw new Error('pedido_manual obrigatório');

    const pedido = pedidoManual || {};

    return stripNulls({
        id: pedido.id,
        ref: pedido.pedido_ref,
        moeda: pedido.moeda,
        total: toNum(pedido.total),
        comprador: {
            nome: pedido.nomeComprador,
            email: pedido.emailComprador,
            telefone: pedido.telefoneComprador,
        },
        endereco: {
            cidade: pedido.cidade,
            estado: pedido.estado,
            cep: pedido.CEP,
            pais: pedido.pais,
        },
        itens: Array.isArray(pedido.itens) ? pedido.itens : [],
        raw: pedido.toJSON(), // opcional: guarda tudo
    });
}

function caixaToSnapshot(c) {
    const altura = toNum(c.altura);
    const largura = toNum(c.largura);
    const profundidade = toNum(c.profundidade);
    const peso = toNum(c.peso);
    const volume_cm3 = altura * largura * profundidade;
    const peso_cubado = Number((volume_cm3 / CUBIC_FACTOR).toFixed(3));

    return {
        id: c.id,
        id_cliente: c.id_cliente,
        cod_identificacao: c.cod_identificacao,
        descricao: c.descricao,
        dimensoes: { altura_cm: altura, largura_cm: largura, profundidade_cm: profundidade },
        peso_kg: peso,
        volume_cm3,
        peso_cubado_kg: peso_cubado,
    };
}

async function buildCaixasSnapshots(caixaIds = [], clienteId) {
    if (!Array.isArray(caixaIds) || caixaIds.length === 0) return [];
    const rows = await db.Caixa.findAll({
        where: { id: caixaIds, id_cliente: clienteId },
        order: [['id', 'ASC']],
    });
    if (rows.length !== caixaIds.length) {
        // opcional: você pode falhar se alguma não existir
        // throw new Error('Alguma caixa não foi encontrada para este cliente');
    }
    return rows.map(caixaToSnapshot);
}

/**
 * Cria uma cotação consolidando snapshots
 */
async function criarCotacao({ clienteId, pedidoImportId, pedidoManual, caixaIds = [] }) {
    const [pedidoSnap, caixasSnap] = await Promise.all([
        pedidoImportId ? buildPedidoSnapshot(pedidoImportId, clienteId) : buildPedidoSnapshotManual(pedidoManual),
        buildCaixasSnapshots(caixaIds, clienteId),
    ]);

    const cot = await db.Cotacao.create({
        cliente_id: clienteId,
        pedido: pedidoSnap,
        caixas: caixasSnap,
        moeda: pedidoSnap.moeda || null,
        preco_total: pedidoSnap.total != null ? String(pedidoSnap.total) : null, // DECIMAL como string
    });

    return cot;
}

/**
 * Atualiza uma cotação existente (sobrescreve snapshots)
 */
async function atualizarCotacao({ cotacaoId, clienteId, pedidoImportId, pedidoManual, caixaIds = [] }) {
    const cot = await db.Cotacao.findOne({ where: { id: cotacaoId, cliente_id: clienteId } });
    if (!cot) throw new Error('Cotação não encontrada');

    if (pedidoImportId || pedidoManual) {
        const pedidoSnap = pedidoImportId ? await buildPedidoSnapshot(pedidoImportId, clienteId) : buildPedidoSnapshotManual(pedidoManual);
        cot.pedido = pedidoSnap;
        cot.moeda = pedidoSnap.moeda || null;
        cot.preco_total = pedidoSnap.total != null ? String(pedidoSnap.total) : null;
    }

    if (Array.isArray(caixaIds)) {
        cot.caixas = await buildCaixasSnapshots(caixaIds, clienteId);
    }

    await cot.save();
    return cot;
}

module.exports = {
    criarCotacao,
    atualizarCotacao,
};
