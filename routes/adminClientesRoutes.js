const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminClientesController');
const { requireAdminRole } = require('../middleware/adminAuth');

router.get('/', ctrl.listClientes);
router.get('/:id', ctrl.getClienteDetail);
router.patch('/:id/status', requireAdminRole('admin', 'operations'), ctrl.updateClienteStatus);
router.patch('/:id/envios', requireAdminRole('admin', 'operations'), ctrl.updateEnviosBloqueados);
router.post('/:id/api-key/regenerate', requireAdminRole('admin', 'operations'), ctrl.regeneratePublicApiKey);
// Prefixo de pedido por loja Shopify: evita a colisao de numero quando a mesma
// conta tem mais de uma loja (as duas chegam ao #1007).
router.patch('/:id/shopify-prefixo', requireAdminRole('admin', 'operations'), ctrl.updateShopifyPrefixo);

module.exports = router;
