// services/taxasTransportadora.js
// Taxas fixas da transportadora, em USD.
//
// Estavam dentro do simulador, o que fazia a simulacao e a cobranca real
// somarem coisas diferentes: o cliente via um total na simulacao e recebia
// outro no boleto. Ficam aqui para as duas pontas lerem o mesmo numero.

/**
 * Desembaraco aduaneiro cobrado pela transportadora. E fixo por transportadora
 * e vale para qualquer destino — nao vem no rate nem na estimativa de imposto,
 * entao precisa ser somado por fora. Confirmado nos surcharges reais: a FedEx
 * devolve FUEL e ANCILLARY_FEE, nenhuma linha de desembaraco.
 *
 * Os valores mudam de tempos em tempos; da para sobrescrever por env sem mexer
 * no codigo. Os nomes SIMULACAO_* sao aceitos porque ja podiam estar no Render
 * de quando isso era so do simulador.
 *
 * @param {string} carrier 'FEDEX' | 'UPS'
 * @returns {number} valor em USD, 0 para transportadora desconhecida
 */
function desembaracoUsd(carrier) {
    const chave = String(carrier || '').trim().toUpperCase();

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
