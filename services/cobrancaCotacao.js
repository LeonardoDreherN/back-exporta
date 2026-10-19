// services/cobrancaCotacao.js
// Uma remessa é cobrada em três partes: frete (serviço da Intrex, já com o
// markup), desembaraço da transportadora e imposto do destino. Estavam
// espalhadas — o boleto somava de um jeito, a tela mostrava de outro e a
// carteira não somava nada. Aqui ficam a conta e a resposta de "já pagou?",
// para as três pontas lerem o mesmo número.

const db = require('../models');
const { desembaracoUsd } = require('./taxasTransportadora');
const { valorConversao } = require('../utils/dolar');

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Número vindo do Postgres como string ("57.31") ou já numérico. */
function num(v) {
    if (v === null || v === undefined) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/** Chave do débito da carteira. Única por cotação: impede cobrar duas vezes. */
function chaveDebito(cotacaoId) {
    return `envio:cotacao:${cotacaoId}`;
}

/**
 * Composição do valor da remessa, em USD e em BRL.
 *
 * O imposto entra pelo campo que a cotação carrega (`impostos_valor_brl`), que
 * em IMPOSTOS_MODO=shadow fica null de propósito — nesse modo a estimativa
 * existe e aparece na tela, mas não é cobrada. `imposto_cobravel` diz qual dos
 * dois casos é, para a tela não prometer um total que a cobrança não vai usar.
 */
async function composicaoCotacao(cotacao) {
    const fx = Number(await valorConversao()) || 0;

    const freteUsd = num(cotacao.preco_final);
    const desemUsd = desembaracoUsd(cotacao.carrier);
    const impostoBrl = round2(num(cotacao.impostos_valor_brl));

    const freteBrl = round2(freteUsd * fx);
    const desemBrl = round2(desemUsd * fx);

    return {
        fx,
        frete_usd: freteUsd,
        frete_brl: freteBrl,
        desembaraco_usd: desemUsd,
        desembaraco_brl: desemBrl,
        imposto_brl: impostoBrl,
        imposto_cobravel: cotacao.impostos_valor_brl != null,
        total_brl: round2(freteBrl + desemBrl + impostoBrl),
        total_centavos: Math.round((freteBrl + desemBrl + impostoBrl) * 100),
    };
}

/**
 * Já foi paga? Vale débito na carteira ou boleto confirmado. Boleto só conta
 * como pago quando o Asaas confirmou — emitido e não pago não libera nada.
 */
async function situacaoPagamento(cotacao) {
    const debito = await db.CarteiraLancamento.findOne({
        where: { chave: chaveDebito(cotacao.id) },
        attributes: ['id', 'valor_centavos', 'created_at'],
    });

    if (debito) {
        return {
            pago: true,
            forma: 'carteira',
            valor_centavos: Math.abs(debito.valor_centavos),
            em: debito.created_at,
        };
    }

    const boleto = await db.AsaasBoletos.findOne({
        where: { cotacaoId: cotacao.id },
        order: [['id', 'DESC']],
    });

    if (boleto && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(String(boleto.status))) {
        return {
            pago: true,
            forma: 'boleto',
            valor_centavos: Math.round(Number(boleto.value || 0) * 100),
            em: boleto.updatedAt || null,
        };
    }

    return {
        pago: false,
        forma: null,
        // Boleto emitido e ainda não pago: a tela precisa diferenciar "nada
        // feito" de "esperando compensar".
        boleto_pendente: !!boleto && String(boleto.status) === 'PENDING',
        boleto_url: boleto?.bankSlipUrl || null,
    };
}

module.exports = { composicaoCotacao, situacaoPagamento, chaveDebito };
