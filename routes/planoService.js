const { Cliente, QuoteSnapshots } = sequelize.models;

// regras por plano (ajuste conforme contrato)
const regrasPorPlano = require('../utils/regraPlanos').regrasPorPlano

async function calcularCotacao({ clienteId, origem, destino, pesoKg, medidas, userId }) {
    // 1) cache key (opcional)
    const cacheKey = `quote:cliente:${clienteId}:${origem}:${destino}:${pesoKg}`;

    // tenta cache
    if (global.redis) {
        const cached = await global.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    // 2) pega cliente (apenas plano)
    const cliente = await Cliente.findByPk(clienteId, { attributes: ['id', 'plano'] });
    const plano = cliente?.plano || 'basico';

    // 3) obter rate base do carrier (ex.: cotarUPS). Deve retornar objeto com negotiated/published/amount
    // Substitua pela sua função existing de cotação
    const carrierResp = await cotarCarrier({ origem, destino, pesoKg, medidas });

    const precoBase = carrierResp.negotiated ?? carrierResp.published ?? carrierResp.amount;
    if (precoBase == null) throw new Error('carrier sem preco');

    // 4) aplicar regra do plano
    const regra = regrasPorPlano[plano] || regrasPorPlano.basico;
    const { precoFinal, detalhe } = regra({ preco: Number(precoBase) });

    const breakdown = {
        plano,
        precoBase: Number(precoBase),
        precoFinal: precoFinal,
        ajuste: Number((precoFinal - Number(precoBase)).toFixed(2)),
        detalhe
    };

    // 5) salvar snapshot
    await sequelize.models.QuoteSnapshots.create({
        cliente_id: clienteId,
        payload: { origem, destino, pesoKg, medidas, requested_by: userId },
        carrier_response: carrierResp,
        plano_aplicado: plano,
        preco_base: Number(precoBase),
        preco_final: precoFinal,
        breakdown
    });

    const result = { plano_aplicado: plano, preco_base: Number(precoBase), preco_final: precoFinal, breakdown, carrier_raw: carrierResp };

    // 6) cache curto (ex.: 60s)
    if (global.redis) await global.redis.setex(cacheKey, 60, JSON.stringify(result));

    return result;
}

module.exports = { calcularCotacao };
