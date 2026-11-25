// services/cobrancaCotacao.js
// Uma remessa é cobrada em três partes: frete (serviço da Intrex, já com o
// markup), desembaraço da transportadora e imposto do destino. Estavam
// espalhadas — o boleto somava de um jeito, a tela mostrava de outro e a
// carteira não somava nada. Aqui ficam a conta e a resposta de "já pagou?",
// para as três pontas lerem o mesmo número.

const db = require('../models');
const { desembaracoUsd } = require('./taxasTransportadora');
const { valorConversao } = require('../utils/dolar');
const { impostosModo } = require('./featureFlags');
const { impostoCobravelDoSnapshot } = require('./landedCost');

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
 * Chave do estorno. Mesma ideia da chave do débito: o índice único do livro
 * impede devolver o dinheiro duas vezes se o cancelamento for repetido.
 */
function chaveEstorno(cotacaoId) {
    return `estorno:cotacao:${cotacaoId}`;
}

/**
 * A MESMA regra de `situacaoPagamento`, em SQL, para quem soma muitas cotações
 * de uma vez (exposição do cliente, painel do admin) e não pode fazer uma
 * consulta por linha.
 *
 * Mora aqui de propósito, coladinha na versão em JavaScript: as duas já
 * dessincronizaram uma vez. O pagamento direto por PIX/cartão entrou em
 * `situacaoPagamento` e não entrou nas quatro cópias do SQL espalhadas pelo
 * código, então a remessa saía com a etiqueta liberada e continuava contando
 * como "em aberto" no painel. Forma de pagamento nova = mexer nas duas, lado a
 * lado, de uma vez.
 *
 * Diferença deliberada: `pago_manual_em` (a baixa manual do admin) conta aqui e
 * NÃO conta na versão em JavaScript. A baixa manual tira o envio da exposição,
 * mas não é dinheiro confirmado — e `situacaoPagamento` é quem libera etiqueta.
 *
 * Os aliases internos (cart_pg, dir_pg, bol_pg) sao feios de proposito: o
 * painel do admin ja usa `cl` para Clientes e `c` para cotacoes, e um alias
 * curto aqui sombrearia o de fora sem erro nenhum do Postgres.
 *
 * @param {string} alias alias da tabela `cotacoes` na consulta de quem chama
 * @returns {string} expressão booleana entre parênteses, pronta para WHERE/FILTER
 */
function sqlCotacaoPaga(alias = 'c') {
    return `(
        ${alias}.pago_manual_em IS NOT NULL
     OR EXISTS (SELECT 1 FROM carteira_lancamentos cart_pg
                 WHERE cart_pg.chave = 'envio:cotacao:' || ${alias}.id)
     OR EXISTS (SELECT 1 FROM pagamentos dir_pg
                 WHERE dir_pg.cotacao_id = ${alias}.id
                   AND dir_pg.finalidade = 'cotacao'
                   AND dir_pg.status = 'PAGO')
     OR EXISTS (SELECT 1 FROM "AsaasBoletos" bol_pg
                 WHERE bol_pg."cotacaoId" = ${alias}.id
                   AND bol_pg.status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'))
    )`;
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
    const desemUsd = desembaracoUsd(cotacao.carrier, cotacao.pais_dest);

    let impostoBrl = round2(num(cotacao.impostos_valor_brl));
    let impostoCobravel = cotacao.impostos_valor_brl != null;
    // Por que o imposto não entrou no total. Sem isto, "não está liberado para
    // cobrança" não dizia se o problema era a conta (modo) ou o número
    // (sanidade) — e as duas se resolvem em lugares diferentes.
    let impostoMotivo = null;

    // Cotação estimada enquanto a conta rodava em shadow guardou o imposto só
    // no snapshot — `impostos_valor_brl` ficou null de propósito. Como a
    // estimativa é idempotente, ela nunca roda de novo: sem este resgate, o
    // boleto dessas cotações sairia sem imposto para sempre.
    //
    // Quem decide é o modo de AGORA, lido do cliente, não o que estava valendo
    // quando a estimativa rodou. Conta que voltar para shadow volta a não
    // cobrar, e o resgate respeita a mesma conferência de sanidade.
    if (!impostoCobravel && cotacao.imposto_estimativa_id) {
        const cliente = await db.Cliente.findByPk(cotacao.cliente_id, {
            attributes: ['id', 'emailPrincipal', 'carteiraHabilitada'],
        });

        if (impostosModo(cliente) !== 'enforce') {
            impostoMotivo = 'modo_shadow';
        } else {
            const snap = await db.ImpostoEstimativa.findByPk(cotacao.imposto_estimativa_id, {
                attributes: ['id', 'imposto_valor_brl', 'imposto_usd_base', 'commodities_snapshot'],
            });
            const resgatado = impostoCobravelDoSnapshot(snap);

            if (resgatado != null) {
                impostoBrl = resgatado;
                impostoCobravel = true;
            } else {
                impostoMotivo = Number(snap?.imposto_valor_brl) > 0
                    ? 'sanidade_reprovada'
                    : 'snapshot_sem_valor';
            }
        }
    }

    const freteBrl = round2(freteUsd * fx);
    const desemBrl = round2(desemUsd * fx);

    return {
        fx,
        frete_usd: freteUsd,
        frete_brl: freteBrl,
        desembaraco_usd: desemUsd,
        desembaraco_brl: desemBrl,
        imposto_brl: impostoBrl,
        imposto_cobravel: impostoCobravel,
        imposto_motivo: impostoMotivo,
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

    // Pagamento direto por PIX ou cartão (envio avulso). Só conta depois que
    // o Asaas confirmou: o webhook (ou a consulta do front) marca PAGO.
    const direto = await db.Pagamento.findOne({
        where: { cotacao_id: cotacao.id, finalidade: 'cotacao', status: 'PAGO' },
        order: [['id', 'DESC']],
    });

    if (direto) {
        return {
            pago: true,
            forma: direto.metodo === 'PIX' ? 'pix' : 'cartao',
            valor_centavos: direto.valor_centavos,
            em: direto.pago_em,
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

module.exports = { composicaoCotacao, situacaoPagamento, sqlCotacaoPaga, chaveDebito, chaveEstorno };
