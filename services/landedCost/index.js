// services/landedCost/index.js
// Estima o imposto de importação do país de destino (via FedEx EDT), aplica a
// margem de segurança e o colchão de câmbio, e converte para BRL.

const { cotarEdt, parseEdt } = require('../fedex/edtFedex');
const { valorConversao } = require('../../utils/dolar');
const { impostosMargemPct, impostosColchaoCambioPct } = require('../featureFlags');

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * @param {{
 *   destCountry?: string,
 *   incoterm?: string,
 *   currency?: string,
 *   commodities: any[],
 *   shipper: any,
 *   recipient: any,
 *   packages: any[],
 * }} args
 */
async function estimarImpostos({ destCountry, incoterm, currency = 'USD', commodities, shipper, recipient, packages }) {
    const edtResp = await cotarEdt({ shipper, recipient, packages, commodities, currency });
    const edt = parseEdt(edtResp);

    const margemPct = impostosMargemPct();
    const colchaoPct = impostosColchaoCambioPct();

    const impostoUsdBase = round2(edt.total);
    const impostoUsdComMargem = round2(impostoUsdBase * (1 + margemPct / 100));

    let fx = Number(await valorConversao());
    if (!Number.isFinite(fx) || fx <= 0) fx = 0;

    const impostoValorBrl = round2(impostoUsdComMargem * fx * (1 + colchaoPct / 100));

    return {
        provider: 'FEDEX_EDT',
        pais_destino: destCountry || null,
        incoterm: incoterm || null,
        currency: edt.currency || 'USD',
        imposto_usd_base: impostoUsdBase,
        margem_pct: margemPct,
        imposto_usd_com_margem: impostoUsdComMargem,
        fx,
        fx_fonte: 'awesomeapi',
        colchao_cambio_pct: colchaoPct,
        imposto_valor_brl: impostoValorBrl,
        breakdown: edt.breakdown || [],
        de_minimis: impostoUsdBase === 0,
        is_estimate: true,
        raw_request: edtResp.request || null,
        raw_response: edtResp.raw || null,
    };
}

module.exports = { estimarImpostos };
