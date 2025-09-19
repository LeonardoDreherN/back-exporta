const { H, pick } = require("./fieldMap");

function buildSkuMap(skuRows) {
    const map = {};
    for (const r of skuRows) {
        const sku = (r.sku || r.SKU || r.Sku || "").trim();
        if (!sku) continue;
        map[sku] = {
            description: r.description || r.Description || "",
            category: r.category || r.Category || r.product_type || r["Standard Product Type"] || "",
            hscode: r.hs_code || r.hscode || r.HS || r["HS Code"] || "",
            pesoUnit: r.unit_weight_kg || r.peso_unit_kg || r.weight_kg || ""
        };
    }
    return map;
}

const toNum = (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
};

function buildMinimalRows(ordersRows, skuMap) {
    const out = [];
    for (const r of ordersRows) {
        const sku = String(pick(r, H.itemSKU)).trim();
        const m = skuMap[sku] || {};
        out.push({
            titulo: pick(r, H.itemTitle) || m.description || "",
            sku,
            pesoUnit: m.pesoUnit || "",
            quantidade: Number(pick(r, H.itemQty) || 0),
            preco: toNum(pick(r, H.itemPrice)),
            descricao: m.description || "",
            categoria: m.category || "",
            hscode: m.hscode || "",

            nome_completo: (pick(r, H.shipName) || "").trim(),
            email: pick(r, H.email) || "",
            rua_e_numero: [pick(r, H.shipAddr1), pick(r, H.shipAddr2)].filter(Boolean).join(", "),
            estado_provincia: pick(r, H.shipProv) || "",
            pais: pick(r, H.shipCountry) || "",
            telefone: pick(r, H.shipPhone) || "",

            id: pick(r, H.id),
            valorTotal: toNum(pick(r, H.total)),
            moeda: pick(r, H.currency) || ""
        });
    }
    return out;
}

module.exports = { buildSkuMap, buildMinimalRows };
