// services/limiteCredito/index.js
//
// Limite de exposicao por conta, com nivel que sobe conforme o cliente paga.
//
// O QUE E "EM ABERTO": a soma dos envios ja despachados e ainda nao pagos.
// Nao e o valor de um envio: dez remessas de US$ 100 expoem tanto quanto uma
// de US$ 1.000, e e a soma que vira prejuizo se o cliente sumir.
//
// A REGRA DE "PAGO" E A MESMA de services/cobrancaCotacao.js (situacaoPagamento):
//   - debito na carteira com a chave `envio:cotacao:{id}`, ou
//   - boleto Asaas em RECEIVED / CONFIRMED / RECEIVED_IN_CASH, ou
//   - marcacao manual do admin (pago_manual_em)
// As duas primeiras ja acontecem sozinhas. A terceira existe porque hoje a
// maior parte dos fretes e paga fora do sistema — sem ela, ninguem nunca
// sairia do nivel inicial.
//
// POR QUE NAO REUSAR situacaoPagamento: ela faz duas consultas POR COTACAO.
// Para somar o aberto de um cliente com 152 envios seriam 304 idas ao banco,
// em um middleware que roda a cada cotacao. Aqui a mesma regra vira uma
// consulta agregada so.

const db = require('../../models');
const { QueryTypes } = require('sequelize');

/*
 * Niveis. O limite e em USD porque `cotacoes.preco_final` e em USD (ver
 * composicaoCotacao, que le esse campo como freteUsd).
 *
 * As faixas sao calibradas pelo historico real: a mediana por envio e ~US$ 23
 * e o p90 ~US$ 40. O nivel 1, em US$ 500, segura cerca de vinte envios
 * tipicos em aberto — nao incomoda quem opera pequeno e trava o caso que
 * preocupa: conta nova que despacha muito antes de pagar nada.
 */
const NIVEIS = [
    { nivel: 1, limiteUsd: 500, rotulo: 'Inicial' },
    { nivel: 2, limiteUsd: 750, rotulo: 'Bronze' },
    { nivel: 3, limiteUsd: 2000, rotulo: 'Prata' },
    { nivel: 4, limiteUsd: 5000, rotulo: 'Ouro' },
    { nivel: 5, limiteUsd: null, rotulo: 'Sem limite' },   // null = livre
];

const NIVEL_MAXIMO = NIVEIS[NIVEIS.length - 1].nivel;

/** Status de envio que NAO contam como exposicao. */
const NAO_CONTA = ['CANCELADO'];

function nivelInfo(nivel) {
    const n = Number(nivel) || 1;
    return NIVEIS.find((x) => x.nivel === n) || NIVEIS[0];
}

/**
 * Limite efetivo do cliente, em USD.
 * O override do admin ganha do nivel — existe para o caso pontual que a
 * regra nao cobre, sem precisar promover a conta inteira.
 *
 * @returns {number|null} null = sem limite
 */
function limiteDoCliente(cliente) {
    const override = cliente?.limiteAbertoUsdOverride;
    if (override !== null && override !== undefined && override !== '') {
        const n = Number(override);
        if (Number.isFinite(n) && n >= 0) return n;
    }
    return nivelInfo(cliente?.nivelConta).limiteUsd;
}

/**
 * Soma dos envios despachados e nao pagos, em USD.
 *
 * Uma consulta so. As duas subconsultas NOT EXISTS replicam, em SQL, a mesma
 * regra que situacaoPagamento aplica em JavaScript.
 */
async function emAbertoUsd(clienteId) {
    const [linha] = await db.sequelize.query(
        `
        SELECT COALESCE(SUM(c.preco_final), 0)::float AS em_aberto,
               COUNT(*)::int                          AS envios
        FROM cotacoes c
        WHERE c.cliente_id = :clienteId
          AND (c.status_norm IS NULL OR c.status_norm::text <> ALL(ARRAY[:naoConta]::text[]))
          AND c.pago_manual_em IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM carteira_lancamentos cl
                WHERE cl.chave = 'envio:cotacao:' || c.id
          )
          AND NOT EXISTS (
                SELECT 1 FROM "AsaasBoletos" b
                WHERE b."cotacaoId" = c.id
                  AND b.status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
          )
        `,
        {
            replacements: { clienteId, naoConta: NAO_CONTA },
            type: QueryTypes.SELECT,
        },
    );

    return {
        emAbertoUsd: Number(linha?.em_aberto || 0),
        envios: Number(linha?.envios || 0),
    };
}

/**
 * Decide se um envio novo cabe no limite.
 *
 * @param {number} clienteId
 * @param {number} valorNovoUsd  valor do envio que esta sendo criado (0 quando
 *                               ainda nao se sabe — ai avalia so o acumulado)
 * @param {boolean} ignorarAtivacao  avalia mesmo com o limite desligado, para
 *                               a previa do admin
 * @returns {Promise<{permitido:boolean, motivo:string|null, limiteUsd:number|null,
 *                    emAbertoUsd:number, disponivelUsd:number|null, nivel:number,
 *                    rotulo:string, envios:number}>}
 */
async function avaliarLimite({ clienteId, valorNovoUsd = 0, ignorarAtivacao = false }) {
    const cliente = await db.Cliente.findByPk(clienteId, {
        attributes: ['id', 'nivelConta', 'limiteAbertoUsdOverride', 'limiteCreditoAtivo'],
    });

    /*
     * A regra vale conta a conta. Quem nao tem o limite ligado passa sem que
     * a exposicao seja sequer consultada — nenhuma conta muda de
     * comportamento ate alguem ligar no admin.
     *
     * `ignorarAtivacao` existe para a previa do admin: antes de ligar, o
     * operador precisa ver o que ACONTECERIA. Sem isso a simulacao devolvia
     * zero em toda conta desligada, que e exatamente quando ela e util.
     */
    if (!ignorarAtivacao && !cliente?.limiteCreditoAtivo) {
        return {
            permitido: true,
            motivo: null,
            ativo: false,
            limiteUsd: null,
            emAbertoUsd: 0,
            disponivelUsd: null,
            nivel: Number(cliente?.nivelConta) || 1,
            rotulo: nivelInfo(cliente?.nivelConta).rotulo,
            envios: 0,
        };
    }

    const nivel = Number(cliente?.nivelConta) || 1;
    const info = nivelInfo(nivel);
    const limite = limiteDoCliente(cliente);

    // Sem limite: nem consulta o aberto, que e a parte cara.
    if (limite === null) {
        return {
            permitido: true,
            motivo: null,
            ativo: true,
            limiteUsd: null,
            emAbertoUsd: 0,
            disponivelUsd: null,
            nivel,
            rotulo: info.rotulo,
            envios: 0,
        };
    }

    const { emAbertoUsd: aberto, envios } = await emAbertoUsd(clienteId);
    const novo = Math.max(0, Number(valorNovoUsd) || 0);
    const disponivel = Number((limite - aberto).toFixed(2));

    const permitido = (aberto + novo) <= limite;

    return {
        permitido,
        ativo: Boolean(cliente?.limiteCreditoAtivo),
        motivo: permitido ? null : (aberto >= limite ? 'limite_atingido' : 'envio_excede_limite'),
        limiteUsd: limite,
        emAbertoUsd: Number(aberto.toFixed(2)),
        disponivelUsd: disponivel,
        nivel,
        rotulo: info.rotulo,
        envios,
    };
}

/**
 * Nivel que o historico do cliente justifica.
 *
 * Sobe por VALOR JA PAGO, nao por quantidade de envios: dez remessas de US$ 20
 * pagas provam menos do que uma de US$ 2.000 paga. O nivel nunca cai sozinho —
 * rebaixar automaticamente quem teve um mes fraco castiga cliente bom; para
 * isso existe o override do admin.
 */
const DEGRAUS_PAGOS_USD = [0, 300, 1500, 6000, 20000];

function nivelSugerido(totalPagoUsd) {
    const pago = Number(totalPagoUsd) || 0;
    let nivel = 1;
    for (let i = 0; i < DEGRAUS_PAGOS_USD.length; i++) {
        if (pago >= DEGRAUS_PAGOS_USD[i]) nivel = i + 1;
    }
    return Math.min(nivel, NIVEL_MAXIMO);
}

/** Total ja pago pelo cliente, em USD — pela mesma regra de "pago". */
async function totalPagoUsd(clienteId) {
    const [linha] = await db.sequelize.query(
        `
        SELECT COALESCE(SUM(c.preco_final), 0)::float AS total,
               COUNT(*)::int                          AS envios
        FROM cotacoes c
        WHERE c.cliente_id = :clienteId
          AND (c.status_norm IS NULL OR c.status_norm::text <> ALL(ARRAY[:naoConta]::text[]))
          AND (
                c.pago_manual_em IS NOT NULL
             OR EXISTS (
                   SELECT 1 FROM carteira_lancamentos cl
                   WHERE cl.chave = 'envio:cotacao:' || c.id
                )
             OR EXISTS (
                   SELECT 1 FROM "AsaasBoletos" b
                   WHERE b."cotacaoId" = c.id
                     AND b.status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
                )
          )
        `,
        {
            replacements: { clienteId, naoConta: NAO_CONTA },
            type: QueryTypes.SELECT,
        },
    );

    return {
        totalPagoUsd: Number(linha?.total || 0),
        enviosPagos: Number(linha?.envios || 0),
    };
}

module.exports = {
    NIVEIS,
    NIVEL_MAXIMO,
    DEGRAUS_PAGOS_USD,
    nivelInfo,
    limiteDoCliente,
    emAbertoUsd,
    avaliarLimite,
    nivelSugerido,
    totalPagoUsd,
};
