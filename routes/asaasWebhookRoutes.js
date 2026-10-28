// routes/asaasWebhookRoutes.js
// Webhook de cobranças do Asaas (POST /webhooks/asaas).
//
// Duas travas: o header asaas-access-token tem que bater com
// ASAAS_WEBHOOK_TOKEN (o mesmo valor cadastrado no painel do Asaas), e o
// status nunca é lido do corpo do evento — o pagamento é reconsultado na API
// do Asaas. Um evento forjado, no máximo, faz o sistema conferir de novo.
const express = require('express');
const crypto = require('crypto');
const db = require('../models');
const { sincronizarPagamento, sincronizarBoleto } = require('../services/carteira');

const router = express.Router();

function tokenConfere(recebido) {
    const esperado = process.env.ASAAS_WEBHOOK_TOKEN || '';
    if (!esperado || !recebido) return false;
    const a = Buffer.from(String(recebido));
    const b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/', async (req, res) => {
    if (!tokenConfere(req.get('asaas-access-token'))) {
        return res.status(401).json({ ok: false });
    }

    const evento = String(req.body?.event || '');
    const paymentId = req.body?.payment?.id;

    // Responde 200 para tudo que não é nosso: o Asaas pausa a fila de
    // webhooks depois de erros seguidos, e aí nenhum pagamento confirma.
    if (!evento.startsWith('PAYMENT_') || !paymentId) return res.json({ ok: true, ignorado: true });

    try {
        const pagamento = await db.Pagamento.findOne({ where: { asaas_payment_id: String(paymentId) } });
        if (pagamento) {
            await sincronizarPagamento(pagamento);
            console.log('[ASAAS][WEBHOOK]', { evento, pagamentoId: pagamento.id, status: pagamento.status });
            return res.json({ ok: true });
        }

        // Boleto (AsaasBoletos) dispara evento no mesmo webhook. Antes caía
        // aqui como "ignorado" e o status do boleto ficava PENDING para sempre:
        // o frete era pago e o sistema nunca sabia, então a remessa seguia como
        // não paga e o cancelamento não estornava. Ver sincronizarBoleto.
        const boleto = await db.AsaasBoletos.findOne({
            where: { asaasPaymentId: String(paymentId) },
        });
        if (boleto) {
            const anterior = boleto.status;
            await sincronizarBoleto(boleto);
            console.log('[ASAAS][WEBHOOK][BOLETO]', {
                evento,
                boletoId: boleto.id,
                cotacaoId: boleto.cotacaoId,
                de: anterior,
                para: boleto.status,
            });
            return res.json({ ok: true });
        }

        // Cobrança criada fora deste sistema (ou de outro ambiente do Asaas).
        return res.json({ ok: true, ignorado: true });
    } catch (err) {
        // 500 faz o Asaas tentar de novo, que é o que queremos se a consulta
        // à API dele falhou agora.
        console.error('[ASAAS][WEBHOOK] erro', { evento, paymentId, msg: err.message });
        return res.status(500).json({ ok: false });
    }
});

module.exports = router;
