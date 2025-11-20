const { readCsvBuffer } = require('../services/csvReader');
const { buildSkuMap, buildMinimalRows } = require('../services/pedidoMinimoMapper');

async function uploadOrdersMinimal(req, res, returnOnly = false) {
    try {
        if (!req?.files?.file?.[0]) {
            const msg = "Envie o arquivo CSV em 'file'";
            if (returnOnly) throw new Error(msg);
            return res.status(400).json({ ok: false, error: msg });
        }

        // 1) lê o CSV principal (Shopify)
        const ordersRows = await readCsvBuffer(req.files.file[0].buffer);

        // 2) (opcional) lê o CSV mestre de SKUs
        let skuMap = {};
        if (req.files?.sku_master?.[0]) {
            const skuRows = await readCsvBuffer(req.files.sku_master[0].buffer);
            skuMap = buildSkuMap(skuRows);
        }

        // 3) achata em linhas mínimas (uma por item)
        const linhas = buildMinimalRows(ordersRows, skuMap);

        const importResult = await require("./PedidoImportController").importPedidosInternal(cliente_id, linhas);

        const payload = { ok: true, linhas, import: importResult };
        if (returnOnly) return payload;     // NÃO responde, só retorna
        return res.json(payload);           // modo direto (sem import)
    } catch (e) {
        if (returnOnly) throw e;
        return res.status(500).json({ ok: false, error: e.message });
    }
}

module.exports = { uploadOrdersMinimal };
