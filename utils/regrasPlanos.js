// utils/regrasPlano.js
// Comissão zerada temporariamente para todos os planos (sem markup) até
// definirmos um mecanismo real de cobrança — clientes hoje pagam o boleto
// da transportadora direto, então a comissão embutida aqui não é recebida.
const regrasPorPlano = {
    avulsos: (p) => Number(p.toFixed(2)),
    basico: (p) => Number(p.toFixed(2)),
    vinte: (p) => Number(p.toFixed(2)),
    gold: (p) => Number(p.toFixed(2)),
    premium: (p) => Number(p.toFixed(2)),
    minimo: (p) => Number(p.toFixed(2)),
    parceiro: (p) => Number(p.toFixed(2))
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
