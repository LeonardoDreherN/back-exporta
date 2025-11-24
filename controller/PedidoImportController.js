// controller/PedidoImportController.js
const { PedidoImport } = require("../models");
const { Op, where, fn, col } = require("sequelize");
const db = require("../models");
const { resolveLojaEToken } = require("./ShopifyController");


const s = (v) => (v ?? "").toString().trim();
const pickFirst = (...vals) => vals.find(v => s(v) !== "") ?? "";
const normalizeId = (id) => {
    const x = s(id);
    return x.startsWith("#") ? x.slice(1) : x;
};
const normSku = (v) => (v ?? "").toString().trim().toUpperCase();

// ===== Helpers Shopify (Pedidos via REST + enrich via GraphQL) =====
async function fetchShopifyOrdersPage({ shop, token, apiVersion, limit = 50, pageInfo }) {
    const params = new URLSearchParams({
        status: 'any',
        limit: String(Math.min(limit, 250)),
        // Campos úteis no nível do pedido e itens
        // (line_items sempre vem razoavelmente completo; filtramos no map)
        fields: [
            'id,name,current_total_price,currency',
            'email,phone',
            'shipping_address,billing_address',
            'line_items'
        ].join(',')
    });
    if (pageInfo) params.set('page_info', String(pageInfo));

    const url = `https://${shop}/admin/api/${apiVersion}/orders.json?${params.toString()}`;

    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 15000);
    try {
        const resp = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': token,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            agent: KEEPALIVE_AGENT,
            signal: ac.signal,
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            const err = new Error('Erro ao consultar pedidos na Shopify (REST)');
            err.http = resp.status;
            err.details = json?.errors || json;
            throw err;
        }
        const link = resp.headers.get('link') || resp.headers.get('Link');
        return { orders: Array.isArray(json.orders) ? json.orders : [], nextPage: proximaPaginaDoLink(link) };
    } finally {
        clearTimeout(to);
    }
}

function toGid(kind, idNum) {
    return `gid://shopify/${kind}/${String(idNum).replace(/\D+/g, '')}`;
}

async function fetchProductsAndVariantsMeta({ shop, token, apiVersion, productIds, variantIds }) {
    // UMA chamada GraphQL para cada tipo (nodes) — lotes até ~200 ids.
    const Q_NODES = `
    query($ids:[ID!]!) {
      nodes(ids:$ids) {
        ... on Product {
          id
          harmonizedSystemCode
          productType
          standardizedProductType { productTaxonomyNode { id fullName } }
          productCategory       { productTaxonomyNode { id fullName } }
          metafield(namespace:"custom", key:"category"){ value } # opcional
        }
        ... on ProductVariant {
          id
          harmonizedSystemCode
          product { id }
        }
      }
    }
  `;

    async function gql(ids) {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 15000);
        try {
            const r = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
                method: 'POST',
                headers: {
                    'X-Shopify-Access-Token': token,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: Q_NODES, variables: { ids } }),
                agent: KEEPALIVE_AGENT,
                signal: ac.signal,
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j.errors) {
                const e = new Error('GraphQL nodes falhou');
                e.http = r.status;
                e.details = j.errors || j;
                throw e;
            }
            return j.data?.nodes || [];
        } finally {
            clearTimeout(to);
        }
    }

    const pGids = [...productIds].map(id => toGid('Product', id));
    const vGids = [...variantIds].map(id => toGid('ProductVariant', id));
    const ids = [...pGids, ...vGids];
    if (!ids.length) return { productMap: new Map(), variantMap: new Map() };

    const nodes = await gql(ids);

    const productMap = new Map(); // productIdNum -> { categoryFullName, productType, hsProduct }
    const variantMap = new Map(); // variantIdNum -> { hsVariant, productIdNum }

    for (const n of nodes) {
        if (!n || !n.id) continue;
        const kind = String(n.id).includes('/ProductVariant/') ? 'variant' : 'product';
        const idNum = Number(String(n.id).split('/').pop());

        if (kind === 'product') {
            const fullName =
                n.standardizedProductType?.productTaxonomyNode?.fullName ??
                n.productCategory?.productTaxonomyNode?.fullName ??
                n.metafield?.value ?? null;

            productMap.set(idNum, {
                categoryFullName: fullName,
                productType: n.productType || null,
                hsProduct: n.harmonizedSystemCode || null,
            });
        } else {
            const pId = n.product?.id ? Number(String(n.product.id).split('/').pop()) : null;
            variantMap.set(idNum, {
                productIdNum: pId,
                hsVariant: n.harmonizedSystemCode || null,
            });
        }
    }

    return { productMap, variantMap };
}

function mapOrderToGroupedShape(order, { productMap, variantMap }) {
    // monta no mesmo formato do seu groupRowsByOrder()
    const ship = order.shipping_address || {};
    const address1 = (ship.address1 || '').trim();
    const address2 = (ship.address2 || '').trim();
    const ruaENum = address2 ? `${address1}, ${address2}` : address1;

    const countryCode = (ship.country_code || ship.country_code_v2 || ship.country || '').toString().trim();
    const province = (ship.province_code || ship.province || '').toString().trim();

    const out = {
        pedido_ref: String(order.name || order.id).replace(/^#/, ''),
        moeda: order.currency || '',
        total: Number(order.current_total_price || 0),

        nomeComprador: (ship.name || order.billing_address?.name || order.customer?.name || '').trim(),
        emailComprador: (order.email || '').trim(),
        telefoneComprador: (ship.phone || order.phone || '').trim(),

        endereco: ruaENum,                        // <<<<<<<<<<<<<< aqui
        cidade: (ship.city || '').trim(),
        estado: province,                          // código se houver
        CEP: (ship.zip || '').toString().trim(),
        pais: countryCode,                         // código se houver

        itens: [],
    };

    for (const li of (order.line_items || [])) {
        const pid = li.product_id ? Number(li.product_id) : null;
        const vid = li.variant_id ? Number(li.variant_id) : null;

        const pMeta = pid ? productMap.get(pid) : null;
        const vMeta = vid ? variantMap.get(vid) : null;

        const category =
            pMeta?.categoryFullName ??
            pMeta?.productType ?? // fallback
            '';

        const hs =
            vMeta?.hsVariant ??
            pMeta?.hsProduct ??
            '';

        out.itens.push({
            sku: (li.sku || '').trim(),
            titulo: (li.name || li.title || '').trim(),
            qty: Number(li.quantity || 0),
            preco: Number(li.price || 0),
            categoria: category || '',
            hscode: hs || '',
            descricao: (li.name || li.title || '').trim(),
            pesoUnit: li.grams ? String(li.grams / 1000) : '', // gr → kg (ajuste se quiser)
            valorTotalLinha: Number((li.price || 0) * (li.quantity || 0)),
            moedaLinha: order.currency || '',
            __debug: { pid, vid }
        });
    }

    return out;
}


// function groupRowsByOrder(rows) {
//     const byId = new Map();
//     for (const r of rows) {
//         const raw = r.id ?? r.orderId ?? "";
//         if (!raw) continue;
//         const pedido_ref = normalizeId(raw);
//         if (!byId.has(pedido_ref)) {
//             byId.set(pedido_ref, {
//                 pedido_ref,
//                 moeda: "", total: 0,
//                 nomeComprador: "", emailComprador: "", telefoneComprador: "",
//                 endereco: "", cidade: "", estado: "", CEP: "", pais: "",
//                 itens: [],
//             });
//         }
//         const acc = byId.get(pedido_ref);

//         const item = {
//             sku: s(r.sku),
//             titulo: s(r.titulo),
//             qty: Number(r.quantidade || 0),
//             preco: Number(r.preco || 0),
//             categoria: s(r.categoria),
//             hscode: s(r.hscode),
//             descricao: s(r.descricao),
//             pesoUnit: s(r.pesoUnit),
//             valorTotalLinha: Number(r.valorTotal || (Number(r.preco || 0) * Number(r.quantidade || 0))),
//             moedaLinha: s(r.moeda),
//             __debug: r.__debug ?? null,
//         };
//         acc.itens.push(item);

//         if (!acc.moeda) acc.moeda = s(r.moeda);
//         acc.total = item.valorTotalLinha;

//         acc.nomeComprador = pickFirst(acc.nomeComprador, r.nome_completo);
//         acc.emailComprador = pickFirst(acc.emailComprador, r.email);
//         acc.telefoneComprador = pickFirst(acc.telefoneComprador, r.telefone);

//         acc.endereco = pickFirst(acc.endereco, r.rua_e_numero);
//         acc.cidade = pickFirst(acc.cidade, r.cidade);
//         acc.estado = pickFirst(acc.estado, r.estado_provincia);
//         acc.CEP = pickFirst(acc.CEP, r.cep);
//         acc.pais = pickFirst(acc.pais, r.pais);

//     }
//     return Array.from(byId.values()).map(p => ({ ...p, total: Number(p.total.toFixed(2)) }));
// }

function groupRowsByOrder(rows) {
    const byId = new Map();

    rows.forEach((r, idx) => {
        // tenta várias opções de identificador do pedido
        let raw =
            r.id ??
            r.orderId ??
            r.pedido_ref ??
            r.order_name ??
            r.orderName ??
            "";

        // se mesmo assim não vier nada, gera um id sintético
        if (!raw) {
            raw = `IMPORT-${idx + 1}`;
        }

        const pedido_ref = normalizeId(raw);
        if (!pedido_ref) return;

        if (!byId.has(pedido_ref)) {
            byId.set(pedido_ref, {
                pedido_ref,
                moeda: "",
                total: 0,
                nomeComprador: "",
                emailComprador: "",
                telefoneComprador: "",
                endereco: "",
                cidade: "",
                estado: "",
                CEP: "",
                pais: "",
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
            valorTotalLinha: Number(
                r.valorTotal || (Number(r.preco || 0) * Number(r.quantidade || 0))
            ),
            moedaLinha: s(r.moeda),
            __debug: r.__debug ?? null,
        };
        acc.itens.push(item);

        if (!acc.moeda) acc.moeda = s(r.moeda);
        // aqui tem que SOMAR, não sobrescrever
        acc.total += item.valorTotalLinha;

        acc.nomeComprador = pickFirst(acc.nomeComprador, r.nome_completo);
        acc.emailComprador = pickFirst(acc.emailComprador, r.email);
        acc.telefoneComprador = pickFirst(acc.telefoneComprador, r.telefone);

        acc.endereco = pickFirst(acc.endereco, r.rua_e_numero);
        acc.cidade = pickFirst(acc.cidade, r.cidade);
        acc.estado = pickFirst(acc.estado, r.estado_provincia);
        acc.CEP = pickFirst(acc.CEP, r.cep);
        acc.pais = pickFirst(acc.pais, r.pais);
    });

    return Array.from(byId.values()).map((p) => ({
        ...p,
        total: Number((p.total || 0).toFixed(2)),
    }));
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
    console.log('[importPedidosInternal] cliente_id =', cliente_id, 'linhas =', Array.isArray(linhas) ? linhas.length : 'NÃO É ARRAY');

    if (!cliente_id) throw new Error("cliente_id obrigatório");
    if (!Array.isArray(linhas) || !linhas.length) return { created: 0, updated: 0, grouped_orders: 0 };

    let pedidos;
    // ← novo: preencher categoria/hscode/descricao a partir de Produtos (por SKU)
    if (linhas[0] && Array.isArray(linhas[0].itens)) {
        pedidos = linhas.map(p => ({
            ...p,
            pedido_ref: p.pedido_ref?.toString().replace(/^#/, "") || "",
        }));
    } else {
        // 🔧 Caso CSV, agrupa por id/orderId
        pedidos = groupRowsByOrder(linhas);
        console.log('[importPedidosInternal] usando groupRowsByOrder');
    }

    console.log('[importPedidosInternal] pedidos agrupados =', pedidos.length);
    if (pedidos[0]) console.log('[importPedidosInternal] primeiro pedido =', pedidos[0]);

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

        if (!payload.pedido_ref) {
            console.warn('[importPedidosInternal] ignorando payload sem pedido_ref:', payload);
            continue;
        }

        if (setExist.has(p.pedido_ref)) {
            await PedidoImport.update(payload, { where: { cliente_id, pedido_ref: p.pedido_ref } });
            updated++;
        } else {
            await PedidoImport.create(payload);
            created++;
        }
    }

    console.log('[importPedidosInternal] FIM: created =', created, 'updated =', updated, 'grouped_orders =', pedidos.length);

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
        console.log("#########chegou aqui importPedidos#########");
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
                "endereco",
                "cidade",
                "estado",
                "CEP",
                "pais",
                "itens",
            ],
        });
        console.log('[listPedidos] rows count =', rows.length);

        if (rows[0]) {
            console.log('[listPedidos] primeiro row =', {
                id: rows[0].id,
                cliente_id: rows[0].cliente_id,
                pedido_ref: rows[0].pedido_ref,
                total: rows[0].total,
            });
        }

        return res.json({ ok: true, itens: rows, limit, offset });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
}

// GET /shopify/pedidos (enriquecidos com categoria + HS)
async function listPedidosShopify(req, res) {
    try {
        const { shop, token, apiVersion } = await resolveLojaEToken(req);

        const limit = Math.min(Number(req.query.limit) || 20, 100); // por página
        const pageInfo = req.query.page_info ? String(req.query.page_info) : undefined;

        // 1) Busca pedidos (REST)
        const { orders, nextPage } = await fetchShopifyOrdersPage({ shop, token, apiVersion, limit, pageInfo });

        // 2) Colete ids únicos de produto/variante presentes nos line_items
        const productIds = new Set();
        const variantIds = new Set();
        for (const o of orders) {
            for (const li of (o.line_items || [])) {
                if (li.product_id) productIds.add(Number(li.product_id));
                if (li.variant_id) variantIds.add(Number(li.variant_id));
            }
        }

        // 3) Enriquecer via GraphQL (UMA chamada com nodes(ids:[...]))
        const meta = await fetchProductsAndVariantsMeta({ shop, token, apiVersion, productIds, variantIds });

        // 4) Mapear para o shape que você já usa (grouped)
        const itens = orders.map(o => mapOrderToGroupedShape(o, meta));

        return res.json({ ok: true, itens, nextPage, shop });
    } catch (e) {
        const http = e?.http || 500;
        return res.status(http).json({ ok: false, error: e.message, detalhes: e.details || undefined });
    }
}


module.exports = { importPedidos, listPedidos, importPedidosInternal, listPedidosShopify };
