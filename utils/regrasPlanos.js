// utils/regrasPlano.js
const regrasPorPlano = {
    avulsos: (p) => Number((p * 1.5).toFixed(2)),
    basico: (p) => Number((p * 1.3).toFixed(2)),
    vinte: (p) => Number((p * 1.2).toFixed(2)),
    gold: (p) => Number((p * 1.15).toFixed(2)),
    premium: (p) => Number((p * 1).toFixed(2)),
    minimo: (p) => Number((p * 1.05).toFixed(2)),
    parceiro: (p) => Number((p + 1).toFixed(2))
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

module.exports = { aplicarPlano, regrasPorPlano };
