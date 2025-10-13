// routes/cotacoes.routes.js
const express = require('express');
const router = express.Router();
// const { criarCotacao, atualizarCotacao } = require('../services/cotacoes');
const ctrl = require('../controller/CotacaoController');

function requireAuth(req, res, next) {
    const cid = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
    if (!cid) return res.status(401).json({ erro: 'unauthorized' });
    next();
}

// Cria
// router.post('/clientes/:clienteId/cotacoes', requireAuth, async (req, res) => {
//     try {
//         const { clienteId } = req.params;
//         if (Number(clienteId) !== Number(req.clienteId)) return res.status(403).json({ erro: 'forbidden' });

//         const { pedidoImportId, caixaIds } = req.body; // caixaIds = [1,2,3]
//         if (!pedidoImportId) return res.status(400).json({ erro: 'pedidoImportId é obrigatório' });

//         const cot = await criarCotacao({
//             clienteId: Number(clienteId),
//             pedidoImportId: Number(pedidoImportId),
//             caixaIds: Array.isArray(caixaIds) ? caixaIds.map(Number) : [],
//         });

//         res.status(201).json(cot); // inclui pedido{} e caixas[]
//     } catch (e) {
//         res.status(500).json({ erro: e.message || 'erro interno' });
//     }
// });

// // Atualiza
// router.put('/clientes/:clienteId/cotacoes/:id', requireAuth, async (req, res) => {
//     try {
//         const { clienteId, id } = req.params;
//         if (Number(clienteId) !== Number(req.user.clienteId)) return res.status(403).json({ erro: 'forbidden' });

//         const { pedidoImportId, caixaIds } = req.body;
//         const cot = await atualizarCotacao({
//             cotacaoId: Number(id),
//             clienteId: Number(clienteId),
//             pedidoImportId: pedidoImportId ? Number(pedidoImportId) : undefined,
//             caixaIds: Array.isArray(caixaIds) ? caixaIds.map(Number) : undefined,
//         });

//         res.json(cot);
//     } catch (e) {
//         res.status(500).json({ erro: e.message || 'erro interno' });
//     }
// });

router.get('/', requireAuth, ctrl.listCotacoes);
router.post('/', requireAuth, ctrl.createCotacaoReal);
router.post('/:id/docs', requireAuth, ctrl.attachDocs);
router.get('/:id/etiqueta', requireAuth, ctrl.downloadEtiqueta);
router.get('/:id/invoice', requireAuth, ctrl.downloadInvoice);
router.get('/status-por-pedido/:pedido_ref', requireAuth, ctrl.getCotacaoStatusByPedidoRef);

module.exports = router;
