const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminCarteiraController');
const { requireAdminRole } = require('../middleware/adminAuth');

// Leitura: qualquer admin autenticado, inclusive `support` — é o que o
// atendimento precisa para responder "o PIX caiu?".
router.get('/recargas', ctrl.listarRecargas);
router.get('/clientes/:id', ctrl.verCliente);

// Relê o status no Asaas e aplica. Não cria dinheiro (a chave única do livro
// impede crédito repetido), então o atendimento pode usar.
router.post(
    '/recargas/:id/sincronizar',
    requireAdminRole('admin', 'support', 'operations'),
    ctrl.sincronizarRecarga,
);

// Criar saldo sem dinheiro no Asaas é o único caminho do sistema para isso:
// fica só com `admin`.
router.post('/clientes/:id/ajuste', requireAdminRole('admin'), ctrl.ajustar);

router.patch(
    '/clientes/:id/habilitada',
    requireAdminRole('admin', 'operations'),
    ctrl.definirHabilitada,
);

module.exports = router;
