const { readCsvBuffer } = require('../services/csvReader');
const { buildSkuMap, buildMinimalRows } = require('../services/pedidoMinimoMapper');

// async function uploadOrdersMinimal(req, res) {
//     try {
//         if (!req.files?.file?.[0]) {
//             return res.status(400).json({ error: "Envie 'file' (CSV de pedidos da Shopify)" });
//         }

//         const ordersRows = await readCsvBuffer(req.files.file[0].buffer);

//         console.log('CSV rows:', ordersRows.length);
//         if (ordersRows[0]) {
//             console.log('[HEADERS]', Object.keys(ordersRows[0]));
//             console.log('[SAMPLE]', {
//                 city: ordersRows[0]['Shipping City'] || ordersRows[0]['Cidade (envio)'],
//                 zip: ordersRows[0]['Shipping Zip'] || ordersRows[0]['Shipping Postal Code'] || ordersRows[0]['CEP (envio)'],
//             });
//         }

//         let skuMap = {};
//         if (req.files?.sku_master?.[0]) {
//             const skuRows = await readCsvBuffer(req.files.sku_master[0].buffer);
//             skuMap = buildSkuMap(skuRows);
//         }

//         const items = buildMinimalRows(ordersRows, skuMap);
//         return res.json({ count: items.length, items });
//     } catch (e) {
//         console.error('[uploadOrdersMinimal]', e);
//         return res.status(500).json({ error: 'Falha ao processar CSV', details: e.message });
//     }
// }

// async function uploadOrdersMinimal(req, res, returnOnly = false) {
//     try {
//         // ... parse do CSV (pegue req.files.file etc), gere as linhas:
//         const linhas = /* ...resultado do parse... */[];

//         const payload = { ok: true, linhas };

//         if (returnOnly) {
//             // <<< NÃO responde, apenas retorna os dados
//             return payload;
//         } else {
//             // <<< Modo antigo: responde direto
//             return res.json(payload);
//         }
//     } catch (e) {
//         if (returnOnly) {
//             // deixe estourar para o caller tratar
//             throw e;
//         } else {
//             return res.status(400).json({ ok: false, error: e.message });
//         }
//     }
// }

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

        const payload = { ok: true, linhas };
        if (returnOnly) return payload;     // NÃO responde, só retorna
        return res.json(payload);           // modo direto (sem import)
    } catch (e) {
        if (returnOnly) throw e;
        return res.status(500).json({ ok: false, error: e.message });
    }
}

module.exports = { uploadOrdersMinimal };
