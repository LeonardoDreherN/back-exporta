const { readCsvBuffer } = require('../services/csvReader');
const { buildSkuMap, buildMinimalRows } = require('../services/pedidoMinimoMapper');

async function uploadOrdersMinimal(req, res) {
    try {
        if (!req.files?.file?.[0]) {
            return res.status(400).json({ error: "Envie 'file' (CSV de pedidos da Shopify)" });
        }

        const ordersRows = await readCsvBuffer(req.files.file[0].buffer);

        let skuMap = {};
        if (req.files?.sku_master?.[0]) {
            const skuRows = await readCsvBuffer(req.files.sku_master[0].buffer);
            skuMap = buildSkuMap(skuRows);
        }

        const items = buildMinimalRows(ordersRows, skuMap);
        return res.json({ count: items.length, items });
    } catch (e) {
        console.error('[uploadOrdersMinimal]', e);
        return res.status(500).json({ error: 'Falha ao processar CSV', details: e.message });
    }
}

module.exports = { uploadOrdersMinimal };
