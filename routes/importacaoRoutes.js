// routes/importacaoRoutes.js
//
// Importação de pedidos por planilha, em dois tempos: confere e depois grava.
//
// O caminho antigo (/shopify/upload-minimal) lia o CSV e importava na mesma
// requisição, devolvendo só uma contagem. Aqui a prévia não grava nada — a
// tela mostra pedido por pedido o que está pronto, o que foi corrigido, o que
// falta e o que já existe, e só então confirma.
const express = require('express');
const { Op } = require('sequelize');

const db = require('../models');
const { readCsvBuffer } = require('../services/csvReader');
const { buildSkuMap, buildMinimalRows } = require('../services/pedidoMinimoMapper');
const {
    groupRowsByOrder,
    enrichPedidosWithProdutos,
    importPedidosInternal,
} = require('../controller/PedidoImportController');
const { classificarPedido } = require('../services/previaImportacao');
const { uploadOrder } = require('../middleware/shopifyAuth.js');

const router = express.Router();

function requireCliente(req, res, next) {
    const cid = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
    if (!cid) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });
    req.cid = Number(cid);
    next();
}

// ------------------------------------------------------------------- prévia

router.post(
    '/previa',
    requireCliente,
    uploadOrder.fields([{ name: 'file' }, { name: 'sku_master' }]),
    async (req, res) => {
        try {
            const arquivo = req?.files?.file?.[0];
            if (!arquivo) {
                return res.status(400).json({ ok: false, error: "Envie a planilha em 'file'." });
            }

            const linhasBrutas = await readCsvBuffer(arquivo.buffer);

            let skuMap = {};
            if (req.files?.sku_master?.[0]) {
                skuMap = buildSkuMap(await readCsvBuffer(req.files.sku_master[0].buffer));
            }

            const linhas = buildMinimalRows(linhasBrutas, skuMap);
            if (!linhas.length) {
                return res
                    .status(400)
                    .json({ ok: false, error: 'A planilha não tem nenhuma linha de pedido.' });
            }

            // Mesmo caminho da importação de verdade: agrupa por pedido e
            // completa HS Code/categoria pelo cadastro de produtos. Se a prévia
            // usasse outra regra, diria "pronto" e a importação reprovaria.
            let pedidos = groupRowsByOrder(linhas);
            pedidos = await enrichPedidosWithProdutos(pedidos, req.cid);

            const existentes = await db.PedidoImport.findAll({
                where: {
                    cliente_id: req.cid,
                    pedido_ref: { [Op.in]: pedidos.map((p) => p.pedido_ref) },
                },
                attributes: ['pedido_ref'],
                raw: true,
            });
            const jaImportados = new Set(existentes.map((e) => e.pedido_ref));

            const avaliados = pedidos.map((p) => {
                const resultado = classificarPedido(p, jaImportados);
                return {
                    pedido_ref: p.pedido_ref,
                    comprador: p.nomeComprador || null,
                    pais: resultado.pais,
                    pais_original: p.pais || null,
                    itens: (p.itens || []).length,
                    moeda: p.moeda || null,
                    total: p.total || 0,
                    situacao: resultado.situacao,
                    motivo: resultado.motivo,
                    correcoes: resultado.correcoes,
                };
            });

            const conta = (s) => avaliados.filter((p) => p.situacao === s).length;

            return res.json({
                ok: true,
                arquivo: { nome: arquivo.originalname, linhas: linhas.length },
                pedidos: avaliados,
                resumo: {
                    total: avaliados.length,
                    prontos: conta('PRONTO') + conta('CORRIGIDO'),
                    ajuste: conta('AJUSTE'),
                    duplicados: conta('DUPLICADO'),
                },
                // Devolvidas para a confirmação não exigir novo upload.
                linhas,
            });
        } catch (err) {
            console.error('[IMPORTACAO][PREVIA]', err?.message);
            return res
                .status(400)
                .json({ ok: false, error: err?.message || 'Não foi possível ler a planilha.' });
        }
    },
);

// --------------------------------------------------------------- confirmação

router.post('/confirmar', requireCliente, async (req, res) => {
    try {
        const { linhas, refs } = req.body || {};
        if (!Array.isArray(linhas) || !linhas.length) {
            return res.status(400).json({ ok: false, error: 'Nada para importar.' });
        }

        // A tela manda quais pedidos confirmar. Sem a lista, importa tudo que
        // veio — o próprio importPedidosInternal já pula o que é duplicado.
        const escolhidos = Array.isArray(refs) && refs.length ? new Set(refs.map(String)) : null;

        const selecionadas = escolhidos
            ? linhas.filter((l) => {
                  const ref = String(l.pedido_ref ?? l.id ?? l.orderId ?? '').replace(/^#/, '');
                  return escolhidos.has(ref);
              })
            : linhas;

        if (!selecionadas.length) {
            return res.status(400).json({ ok: false, error: 'Nenhum pedido selecionado.' });
        }

        const resultado = await importPedidosInternal(req.cid, selecionadas);
        return res.json({ ok: true, ...resultado });
    } catch (err) {
        console.error('[IMPORTACAO][CONFIRMAR]', err?.message);
        return res
            .status(500)
            .json({ ok: false, error: err?.message || 'Falha ao importar os pedidos.' });
    }
});

module.exports = router;
