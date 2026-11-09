// services/taxasTransportadora.js
// Taxas fixas da transportadora, em USD.
//
// Estavam dentro do simulador, o que fazia a simulacao e a cobranca real
// somarem coisas diferentes: o cliente via um total na simulacao e recebia
// outro no boleto. Ficam aqui para as duas pontas lerem o mesmo numero.

/**
 * Desembaraco aduaneiro cobrado pela transportadora. E fixo por transportadora
 * e so existe nos ESTADOS UNIDOS — nao vem no rate nem na estimativa de
 * imposto, entao precisa ser somado por fora. Confirmado nos surcharges reais:
 * a FedEx devolve FUEL e ANCILLARY_FEE, nenhuma linha de desembaraco.
 *
 * Ate 2026-11-09 esta funcao devolvia o valor para QUALQUER destino, e a taxa
 * entrava na cotacao, no boleto e no relatorio de remessas para Portugal,
 * Reino Unido, Singapura e todo o resto — cobranca de algo que a
 * transportadora nao cobra naquelas rotas.
 *
 * Sem `paisDestino` o comportamento antigo e mantido, com aviso no log: zerar
 * por omissao mudaria calado o numero de um chamador ainda nao ajustado, e o
 * aviso aponta qual falta.
 *
 * Os valores mudam de tempos em tempos; da para sobrescrever por env sem mexer
 * no codigo. Os nomes SIMULACAO_* sao aceitos porque ja podiam estar no Render
 * de quando isso era so do simulador.
 *
 * @param {string} carrier 'FEDEX' | 'UPS'
 * @param {string} [paisDestino] ISO-2 do destino
 * @returns {number} valor em USD; 0 fora dos EUA e para transportadora desconhecida
 */
function desembaracoUsd(carrier, paisDestino) {
    const chave = String(carrier || '').trim().toUpperCase();

    if (paisDestino === undefined || paisDestino === null) {
        console.warn('[DESEMBARACO] chamada sem pais de destino — a taxa so vale para os EUA:', chave);
    } else if (String(paisDestino).trim().toUpperCase() !== 'US') {
        return 0;
    }

    const tabela = {
        FEDEX: Number(process.env.DESEMBARACO_FEDEX_USD)
            || Number(process.env.SIMULACAO_DESEMBARACO_FEDEX_USD)
            || 15,
        UPS: Number(process.env.DESEMBARACO_UPS_USD)
            || Number(process.env.SIMULACAO_DESEMBARACO_UPS_USD)
            || 3,
    };

    const valor = tabela[chave];
    return Number.isFinite(valor) ? valor : 0;
}

module.exports = { desembaracoUsd };
