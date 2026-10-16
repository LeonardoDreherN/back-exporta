// utils/regrasPlano.js
// Markup de 20% para todos os planos, aplicado sobre o valor da transportadora
// (frete + taxas). O cliente vê o valor já com o acréscimo na cotação.
const MARKUP_PCT = 20;

const comMarkup = (p) => Number((p * (1 + MARKUP_PCT / 100)).toFixed(2));

const regrasPorPlano = {
    avulsos: comMarkup,
    basico: comMarkup,
    vinte: comMarkup,
    gold: comMarkup,
    premium: comMarkup,
    minimo: comMarkup,
    parceiro: comMarkup
};

function aplicarPlano(precoBase, plano = 'basico') {
    const base = Number(precoBase);
    if (!Number.isFinite(base)) throw new Error('precoBase inválido');
    const planoKey = String(plano || 'basico').toLowerCase();
    const f = regrasPorPlano[planoKey] || regrasPorPlano.basico;
    const final = f(base);
    return {
        plano_aplicado: planoKey,
        preco_base: base,
        preco_final: final,
        ajuste: Number((final - base).toFixed(2)),
    };
}

module.exports = { aplicarPlano, regrasPorPlano, MARKUP_PCT };
