const { readCsvBuffer } = require('../services/csvReader');
const { buildSkuMap, buildMinimalRows } = require('../services/pedidoMinimoMapper');
const { importPedidosInternal } = require('./PedidoImportController');

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

        console.log('[uploadOrdersMinimal] clienteId =', req.clienteId, 'linhas =', linhas.length);
        console.log('[uploadOrdersMinimal] primeira linha =', linhas[0]);

        const cliente_id = req.clienteId;

        if (!cliente_id) {
            // se isso bater, o problema é no vincularCliente / autenticarShopify
            if (!returnOnly) {
                return res
                    .status(401)
                    .json({ ok: false, error: "cliente_id ausente em req.clienteId" });
            }
            throw new Error("cliente_id ausente em req.clienteId");
        }

        const importResult = await importPedidosInternal(cliente_id, linhas);

        console.log('[uploadOrdersMinimal] importResult =', importResult);

        const payload = { ok: true, linhas, import: importResult };
        if (returnOnly) return payload;     // NÃO responde, só retorna
        return res.json(payload);           // modo direto (sem import)
    } catch (e) {
        if (returnOnly) throw e;
        return res.status(500).json({ ok: false, error: e.message });
    }
}

module.exports = { uploadOrdersMinimal };
