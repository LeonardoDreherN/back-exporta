// controller/PedidoImportController.js
const { PedidoImport } = require("../models");
const { Op } = require("sequelize");

const s = (v) => (v ?? "").toString().trim();
const pickFirst = (...vals) => vals.find(v => s(v) !== "") ?? "";
const normalizeId = (id) => {
    const x = s(id);
    return x.startsWith("#") ? x.slice(1) : x;
};

function groupRowsByOrder(rows) {
    const byId = new Map();
    for (const r of rows) {
        const raw = r.id ?? r.orderId ?? "";
        if (!raw) continue;
        const pedido_ref = normalizeId(raw);
        if (!byId.has(pedido_ref)) {
            byId.set(pedido_ref, {
                pedido_ref,
                moeda: "", total: 0,
                nomeComprador: "", emailComprador: "", telefoneComprador: "",
                endereco: "", cidade: "", estado: "", CEP: "", pais: "",
                itens: [],
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

    }
    return Array.from(byId.values()).map(p => ({ ...p, total: Number(p.total.toFixed(2)) }));
}

// ---------- NOVO: função reutilizável para importar ----------
async function importPedidosInternal(cliente_id, linhas) {
    if (!cliente_id) throw new Error("cliente_id obrigatório");
    if (!Array.isArray(linhas) || !linhas.length) return { created: 0, updated: 0, grouped_orders: 0 };

    const pedidos = groupRowsByOrder(linhas);

    const existentes = await PedidoImport.findAll({
        where: { cliente_id, pedido_ref: { [Op.in]: pedidos.map(p => p.pedido_ref) } },
        attributes: ["pedido_ref"],
    });
    const setExist = new Set(existentes.map(x => x.pedido_ref));

    let created = 0, updated = 0;
    for (const p of pedidos) {
        const payload = {
            cliente_id,
            pedido_ref: p.pedido_ref,
            // origem: p.origem,
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
            // raw_json: p.raw_json,
        };

        if (setExist.has(p.pedido_ref)) {
            await PedidoImport.update(payload, { where: { cliente_id, pedido_ref: p.pedido_ref } });
            updated++;
        } else {
            await PedidoImport.create(payload);
            created++;
        }
    }
    return { created, updated, grouped_orders: pedidos.length };
}

// ---------- Handlers HTTP existentes ----------
async function importPedidos(req, res) {
    try {
        const cliente_id = req.clienteId;
        const body = req.body;
        const linhas = Array.isArray(body?.linhas) ? body.linhas : (Array.isArray(body) ? body : null);
        if (!linhas || !linhas.length) {
            return res.status(400).json({ ok: false, error: 'Envie "linhas" como array' });
        }
        const r = await importPedidosInternal(cliente_id, linhas);
        return res.json({ ok: true, cliente_id, ...r });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
}

async function listPedidos(req, res) {
    try {
        const cliente_id = req.clienteId;
        if (!cliente_id) return res.status(401).json({ ok: false, error: "unauthenticated" });

        const q = (req.query.q || "").toString().trim();
        const where = { cliente_id };
        if (q) {
            where[Op.or] = [
                { pedido_ref: { [Op.iLike]: `%${q}%` } },
                { emailComprador: { [Op.iLike]: `%${q}%` } }, // atenção ao nome do campo no model
                { cidade: { [Op.iLike]: `%${q}%` } },
            ];
        }

        const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
        const offset = Math.max(0, Number(req.query.offset || 0));

        const rows = await PedidoImport.findAll({
            where,
            limit,
            offset,
            order: [["created_at", "DESC"]], // com underscored: created_at
            attributes: [
                "id",
                "cliente_id",
                "pedido_ref",
                "moeda",
                "total",
                "nomeComprador",
                "emailComprador",
                "telefoneComprador",
                "cidade",
                "estado",
                "CEP",
                "pais",
                "itens",
            ],
        });

        return res.json({ ok: true, itens: rows, limit, offset });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
}

module.exports = { importPedidos, listPedidos, importPedidosInternal };
