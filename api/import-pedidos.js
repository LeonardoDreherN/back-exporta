// POST /api/import-pedidos
// Body: { cliente_id: "cli_123", linhas: [...] }  ← "linhas" é o array que você enviou
const { PedidoImport } = require('../models');
const { Op } = require('sequelize');

const ALLOW = process.env.FRONTEND_URL || '*';
const s = (v) => (v ?? '').toString().trim();
const pickFirst = (...vals) => vals.find(v => s(v) !== '') ?? '';
const normalizeId = (id) => {
    const x = s(id);
    return x.startsWith('#') ? x.slice(1) : x;
};

function groupRowsByOrder(rows) {
    const byId = new Map();
    for (const r of rows) {
        const idRaw = r.id ?? r.orderId ?? '';
        if (!idRaw) continue;
        const pedido_ref = normalizeId(idRaw);

        if (!byId.has(pedido_ref)) {
            byId.set(pedido_ref, {
                pedido_ref,
                origem: 'CSV',
                moeda: '', total: 0,
                nomeComprador: '', emailComprador: '', telefoneComprador: '',
                endereco: '', cidade: '', estado: '', CEP: '', pais: '',
                itens: [], raw_json: [],
            });
        }
        const acc = byId.get(pedido_ref);

        const item = {
            sku: s(r.sku),
            titulo: s(r.titulo),
            qty: Number(r.quantidade || 0),
            preco: Number(r.preco || 0),
            categoria: s(r.categoria),
            hscode: s(r.hscode),
            descricao: s(r.descricao),
            pesoUnit: s(r.pesoUnit),
            valorTotalLinha: Number(r.valorTotal || (Number(r.preco || 0) * Number(r.quantidade || 0))),
            moedaLinha: s(r.moeda),
            __debug: r.__debug ?? null,
        };
        acc.itens.push(item);

        if (!acc.moeda) acc.moeda = s(r.moeda);
        acc.total += item.valorTotalLinha;

        acc.nomeComprador = pickFirst(acc.nomeComprador, r.nome_completo);
        acc.emailComprador = pickFirst(acc.emailComprador, r.email);
        acc.telefoneComprador = pickFirst(acc.telefoneComprador, r.telefone);

        acc.endereco = pickFirst(acc.endereco, r.rua_e_numero);
        acc.cidade = pickFirst(acc.cidade, r.cidade);
        acc.estado = pickFirst(acc.estado, r.estado_provincia);
        acc.CEP = pickFirst(acc.CEP, r.cep);
        acc.pais = pickFirst(acc.pais, r.pais);

        acc.raw_json.push(r);
    }
    return Array.from(byId.values()).map(p => ({ ...p, total: Number(p.total.toFixed(2)) }));
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOW);
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cliente-id');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        const clienteFromHeader = s(req.headers['x-cliente-id']);
        const clienteFromBody = s(req.body?.cliente_id);
        const cliente_id = clienteFromHeader || clienteFromBody;
        if (!cliente_id) return res.status(400).json({ ok: false, error: 'cliente_id obrigatório' });

        const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : req.body;
        if (!Array.isArray(linhas) || linhas.length === 0) {
            return res.status(400).json({ ok: false, error: 'Envie "linhas" como array com as linhas do pedido' });
        }

        const pedidos = groupRowsByOrder(linhas);
        const keys = pedidos.map(p => ({ cliente_id, pedido_ref: p.pedido_ref }));

        // Descobre quais já existem
        const existentes = await PedidoImport.findAll({
            where: {
                cliente_id,
                pedido_ref: { [Op.in]: pedidos.map(p => p.pedido_ref) }
            },
            attributes: ['pedido_ref']
        });
        const setExist = new Set(existentes.map(x => x.pedido_ref));

        let created = 0, updated = 0;
        for (const p of pedidos) {
            const payload = {
                cliente_id,
                pedido_ref: p.pedido_ref,
                origem: p.origem,
                moeda: p.moeda || null,
                total: p.total || null,
                nomeComprador: p.nomeComprador || null,
                emailComprador: p.emailComprador || null,
                telefoneComprador: p.telefoneComprador || null,
                endereco: p.endereco || null,
                cidade: p.cidade || null,
                estado: p.estado || null,
                CEP: p.CEP || null,
                pais: p.pais || null,
                itens: p.itens,
                raw_json: p.raw_json,
            };

            if (setExist.has(p.pedido_ref)) {
                await PedidoImport.update(payload, { where: { cliente_id, pedido_ref: p.pedido_ref } });
                updated++;
            } else {
                await PedidoImport.create(payload);
                created++;
            }
        }

        return res.status(200).json({ ok: true, cliente_id, grouped_orders: pedidos.length, created, updated });
    } catch (e) {
        return res.status(400).json({ ok: false, error: e?.message || 'bad request' });
    }
};
