// utils/regrasFrete.js
// Motor de regras de frete: reprecifica rates já calculados (ex.: cotação real
// da UPS/FedEx) com base em regras de "grátis acima de X" / "% off" / "valor fixo off"
// configuradas pelo lojista. Não filtra opções, só ajusta o preço.

function transportadoraDoRate(rate) {
    return String(rate?.code || '').toUpperCase();
}

function regraCombinaComRate(regra, rate) {
    const transportadoras = Array.isArray(regra.transportadoras) ? regra.transportadoras : [];
    const codigo = transportadoraDoRate(rate);
    return transportadoras.some(t => codigo.startsWith(String(t).toUpperCase()));
}

function aplicarDesconto(preco, regra) {
    const base = Number(preco);
    if (!Number.isFinite(base)) return preco;

    if (regra.tipoDesconto === 'gratis') return 0;

    if (regra.tipoDesconto === 'percentual') {
        const pct = Math.min(100, Math.max(0, Number(regra.valorDesconto) || 0));
        return Number(Math.max(0, base * (1 - pct / 100)).toFixed(2));
    }

    if (regra.tipoDesconto === 'fixo') {
        const valor = Math.max(0, Number(regra.valorDesconto) || 0);
        return Number(Math.max(0, base - valor).toFixed(2));
    }

    return base;
}

/**
 * @param {Array} rates - rates já calculados (formato { code, name, price, currency, ... })
 * @param {{ totalPrice: number, regras: Array }} opts
 * @returns {Array} novos rates com preço ajustado (mesma ordem/quantidade)
 */
function aplicarRegrasFrete(rates, { totalPrice, regras }) {
    if (!Array.isArray(rates) || !rates.length) return rates;
    if (!Array.isArray(regras) || !regras.length) return rates;
    if (!Number.isFinite(Number(totalPrice))) return rates;

    const ativas = regras
        .filter(r => r.ativa && Number(totalPrice) >= Number(r.valorMinimo))
        .sort((a, b) => (Number(a.prioridade) || 0) - (Number(b.prioridade) || 0));

    if (!ativas.length) return rates;

    return rates.map(rate => {
        const regra = ativas.find(r => regraCombinaComRate(r, rate));
        if (!regra) return rate;
        return {
            ...rate,
            price: aplicarDesconto(rate.price, regra),
            regra_aplicada: regra.nome,
        };
    });
}

module.exports = { aplicarRegrasFrete, aplicarDesconto, regraCombinaComRate };
