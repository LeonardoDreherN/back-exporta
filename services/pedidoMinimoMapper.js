const { H, pick, pickWithKey } = require("./fieldMap");

const cleanZip = (v) => {
    // remove aspas, apóstrofos e espaços; mantém zeros à esquerda
    const s = (v ?? "").toString().trim().replace(/['"`]/g, "");
    return s.replace(/\s+/g, "");
};

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

const onlyDigits = (s) => String(s || "").replace(/\D+/g, "");
const cleanStr = (s) => String(s || "").trim();

function normZip(rawZip, country) {
    const z = onlyDigits(rawZip);
    if (!z) return "";
    const cc = String(country || "").toUpperCase();
    // BR: formata 99999-999 se possível; caso contrário, devolve dígitos
    if (cc === "BR" && z.length === 8) return `${z.slice(0, 5)}-${z.slice(5)}`;
    return z; // US e demais: só dígitos
}

function joinAddress(a1, a2) {
    const p1 = cleanStr(a1);
    const p2 = cleanStr(a2);
    if (p1 && p2) return `${p1}, ${p2}`;
    return p1 || p2 || "";
}

function buildMinimalRows(ordersRows, skuMap) {
    const out = [];
    for (const r of ordersRows) {
        const sku = cleanStr(pick(r, H.itemSKU) || "");
        const m = skuMap[sku] || {};

        const cidadePick = pickWithKey(r, H.shipCity);
        const cepPick = pickWithKey(r, H.shipZip);

        const addr1 = pick(r, H.shipAddr1);
        const addr2 = pick(r, H.shipAddr2);
        const country = cleanStr(pick(r, H.shipCountry)).toUpperCase();
        const state = cleanStr(pick(r, H.shipProv)); // pode vir nome ou código

        const quantidade = Number(pick(r, H.itemQty) || 0);
        const preco = toNum(pick(r, H.itemPrice));
        const totalCsv = toNum(pick(r, H.total));
        const valorTotal = totalCsv != null
            ? totalCsv
            : (preco != null && Number.isFinite(quantidade) ? Number((preco * quantidade).toFixed(2)) : undefined);

        out.push({
            // Produto
            titulo: cleanStr(pick(r, H.itemTitle) || m.description || ""),
            sku,
            pesoUnit: toNum(m.pesoUnit) ?? "", // tenta número; se não der, mantém string vazia
            quantidade,
            preco,
            descricao: cleanStr(m.description || ""),
            categoria: cleanStr(m.category || ""),
            hscode: cleanStr(m.hscode || ""),

            // Cliente / entrega
            nome_completo: cleanStr(pick(r, H.shipName) || ""),
            email: cleanStr(pick(r, H.email) || ""),
            rua_e_numero: joinAddress(addr1, addr2),
            cidade: cleanStr(pick(r, H.shipCity) || ""),
            estado_provincia: state,                           // se tiver province_code, seu mapeador H pode apontar pra ele
            cep: cleanZip(cepPick.value, country),              // normaliza ZIP/CEP
            pais: country,
            telefone: onlyDigits(pick(r, H.shipPhone) || ""),

            // Pedido
            id: pick(r, H.id),
            valorTotal,
            moeda: cleanStr(pick(r, H.currency) || ""),

            // debug opcional
            __debug: { cityKey: cidadePick.key, zipKey: cepPick.key }
        });
    }
    return out;
}

module.exports = { buildSkuMap, buildMinimalRows };
