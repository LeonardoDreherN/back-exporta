// controller/PedidoImportController.js
const { PedidoImport } = require("../models");
const { Op, where, fn, col } = require("sequelize");
const db = require("../models");

const s = (v) => (v ?? "").toString().trim();
const pickFirst = (...vals) => vals.find(v => s(v) !== "") ?? "";
const normalizeId = (id) => {
    const x = s(id);
    return x.startsWith("#") ? x.slice(1) : x;
};
const normSku = (v) => (v ?? "").toString().trim().toUpperCase();

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
        acc.total = item.valorTotalLinha;

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

async function loadProdutosPorSku(cliente_id, skus) {
    if (!skus.length) return new Map();

    // normaliza para UPPER para comparar de forma case-insensitive
    const skusUpper = skus.map(normSku);

    // SELECT ... WHERE id_cliente = ? AND UPPER(sku) IN (…)
    const produtos = await db.Produto.findAll({
        where: {
            id_cliente: cliente_id,
            [Op.and]: [where(fn('upper', col('sku')), { [Op.in]: skusUpper })]
        },
        attributes: [
            'sku', 'categoria', 'hscode', 'descricao', 'nome',
            'peso', 'altura', 'largura', 'profundidade',
            'cod_identificacao', 'pais_origem'
        ],
        raw: true,
    });

    const map = new Map();
    for (const p of produtos) map.set(normSku(p.sku), p);
    return map;
}

/** Preenche categoria/hscode/descricao/peso/dimensões nos itens dos pedidos */
async function enrichPedidosWithProdutos(pedidos, cliente_id) {
    const skus = Array.from(new Set(
        pedidos.flatMap(p => (p.itens || []).map(it => normSku(it.sku)).filter(Boolean))
    ));

    console.log('[enrich] skus extraidos:', skus);
    if (!skus.length) return pedidos;
    
    const prodMap = await loadProdutosPorSku(cliente_id, skus);
    console.log('[enrich] encontrados:', Array.from(prodMap.keys()));

    for (const ped of pedidos) {
        for (const it of (ped.itens || [])) {
            const prod = prodMap.get(normSku(it.sku));
            if (!prod) continue;

            if (!it.categoria) it.categoria = (prod.categoria || "").toString();
            if (!it.hscode) it.hscode = (prod.hscode || "").toString();
            if (!it.descricao) it.descricao = (prod.descricao || prod.nome || "").toString();

            if (!it.pais_origem && prod.pais_origem) it.pais_origem = prod.pais_origem;
            if (!it.cod_identificacao && prod.cod_identificacao) it.cod_identificacao = prod.cod_identificacao;

            // completa peso/dimensões se não vierem na planilha
            if (!it.pesoUnit && prod.peso != null) it.pesoUnit = String(prod.peso);
            if (!it.dim) {
                it.dim = {
                    altura: prod.altura ?? null,
                    largura: prod.largura ?? null,
                    profundidade: prod.profundidade ?? null,
                };
            }
        }
    }
    return pedidos;
}

// ---------- NOVO: função reutilizável para importar ----------
async function importPedidosInternal(cliente_id, linhas) {
    if (!cliente_id) throw new Error("cliente_id obrigatório");
    if (!Array.isArray(linhas) || !linhas.length) return { created: 0, updated: 0, grouped_orders: 0 };

    let pedidos = groupRowsByOrder(linhas);
    // ← novo: preencher categoria/hscode/descricao a partir de Produtos (por SKU)
    pedidos = await enrichPedidosWithProdutos(pedidos, cliente_id);

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
            updated;
        } else {
            await PedidoImport.create(payload);
            created;
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
