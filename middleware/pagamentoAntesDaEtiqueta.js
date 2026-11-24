// middleware/pagamentoAntesDaEtiqueta.js
// Conta de envio avulso (pessoa física, página /envio) só emite etiqueta de
// cotação já paga.
//
// O front já espera o pagamento antes de chamar a emissão, mas a emissão é uma
// rota aberta para o cliente logado: sem esta trava, bastaria chamá-la direto
// para ter a etiqueta criada na conta da Intrex sem pagar nada. Contas de
// empresa não passam por aqui (são faturadas, ou travam só o download).
//
// Vai nas rotas de shipping da UPS e da FedEx, depois da autenticação.

const db = require('../models');
const { situacaoPagamento } = require('../services/cobrancaCotacao');

function clienteDaRequisicao(req) {
    return Number(
        req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId
    );
}

/** @param {'UPS' | 'FEDEX'} carrier */
function exigirPagamentoAntesDaEtiqueta(carrier) {
    return async function (req, res, next) {
        let cliente;
        try {
            const clienteId = clienteDaRequisicao(req);
            if (!clienteId) return next();

            cliente = await db.Cliente.findByPk(clienteId, { attributes: ['id', 'envioAvulso'] });
        } catch (err) {
            // Ao contrário do bloqueio de envios, aqui a dúvida não pode
            // deixar passar: o dano seria uma etiqueta sem pagamento.
            console.error('[PAGAMENTO_ANTES_ETIQUETA] falha ao consultar cliente', err?.message);
            return res.status(503).json({ ok: false, error: 'Não foi possível conferir o pagamento. Tente de novo.' });
        }

        if (!cliente?.envioAvulso) return next();

        try {
            const cotacaoId = Number(req.body?.cotacaoId || req.query?.cotacaoId) || 0;
            const cot = cotacaoId
                ? await db.Cotacao.findOne({ where: { id: cotacaoId, cliente_id: cliente.id } })
                : null;

            if (!cot) {
                return res.status(400).json({ ok: false, error: 'Cotação do envio não informada.' });
            }

            // A cobrança foi calculada para a transportadora escolhida na
            // cotação; emitir pela outra seria um envio diferente do pago.
            if (String(cot.carrier || '').toUpperCase() !== carrier) {
                return res.status(409).json({ ok: false, error: 'A transportadora não confere com a cotação paga.' });
            }

            // Um pagamento, uma etiqueta: reemitir por cima geraria um segundo
            // envio na transportadora pago uma vez só.
            if (cot.tracking_number) {
                return res.status(409).json({ ok: false, error: 'A etiqueta desta cotação já foi emitida.' });
            }

            const pagamento = await situacaoPagamento(cot);
            if (!pagamento.pago) {
                return res.status(402).json({
                    ok: false,
                    pagamento_pendente: true,
                    error: 'A etiqueta é emitida depois que o pagamento do envio é confirmado.',
                });
            }

            return next();
        } catch (err) {
            console.error('[PAGAMENTO_ANTES_ETIQUETA] falha ao conferir', err?.message);
            return res.status(503).json({ ok: false, error: 'Não foi possível conferir o pagamento. Tente de novo.' });
        }
    };
}

module.exports = { exigirPagamentoAntesDaEtiqueta };
