const express = require('express');
const router = express.Router();

const upsRating = require('../services/ups/rating');
const normUps = require('../utils/normalize/upsRate');
const { quoteRates } = require('../services/fedex/ratingFedex');
const { prepararImpostoCheckout } = require('../services/impostosCheckout');
const db = require('../models');

const toKg = (grams) => Number(grams || 0) / 1000;

// Teto para a parte de imposto. O callback inteiro tem cerca de 10s na
// Shopify: imposto que nao chegou a tempo vira frete sem imposto com aviso,
// nunca checkout sem frete.
const IMPOSTO_TIMEOUT_MS = Number(process.env.CHECKOUT_IMPOSTO_TIMEOUT_MS) || 3000;

// ORIGEM FIXA PARA TODOS OS CÁLCULOS
const DEFAULT_ORIGIN = {
    country: 'BR',
    postal_code: '88140570',
    province: 'SC',
    city: 'Santo Amaro da Imperatriz',
    address1: 'Rua Saint German, 87',
    company_name: 'Teste Intrex Shipping',
    name: 'Exporta Digital BR',
    phone: '47992104226',
};

function normalizeFedexState(state) {
    if (!state) return undefined;

    const raw = String(state).trim().toUpperCase();

    if (raw.length <= 2) return raw;

    return undefined;
}

/** Promessa com teto de tempo. O timer e unref para nao segurar o processo. */
function comTeto(promessa, ms, rotulo) {
    let timer;
    const limite = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout ${rotulo} (${ms}ms)`)), ms);
        if (typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

function buildPackages(items = []) {
    const validItems = Array.isArray(items) ? items.filter(i => i?.requires_shipping !== false) : [];

    if (!validItems.length) {
        return [{
            weightKg: 1,
            dimCm: {
                length: 20,
                width: 15,
                height: 10,
            }
        }];
    }

    return validItems.map((item) => ({
        weightKg: toKg(item.grams || 1000) || 1,
        dimCm: {
            length: 20,
            width: 15,
            height: 10,
        }
    }));
}

function buildCommodities(items = [], currency = 'USD') {
    const validItems = Array.isArray(items) ? items.filter(i => i?.requires_shipping !== false) : [];

    if (!validItems.length) {
        return [{
            description: 'Merchandise',
            quantity: 1,
            quantityUnits: 'PCS',
            unitPrice: { amount: 1, currency },
            customsValue: { amount: 1, currency },
            weight: { units: 'KG', value: 1 },
            countryOfManufacture: 'BR',
        }];
    }

    return validItems.map((item) => {
        const qty = Number(item.quantity || 1) || 1;
        // `price` no callback da Shopify e o preco UNITARIO em centavos, com
        // `quantity` em campo separado. Antes isto era tratado como total da
        // linha e dividido pela quantidade: 3 pecas de US$ 50 declaravam
        // US$ 50 em vez de US$ 150, subdeclarando a invoice e, agora que o
        // imposto entra no preco, subestimando o imposto na mesma proporcao.
        const unitPrice = Number(item.price || 0) / 100 || 1;
        const totalPrice = unitPrice * qty;
        const weightKg = toKg(item.grams || 1000) || 1;

        return {
            description: String(item.name || item.sku || 'Item').slice(0, 100),
            quantity: qty,
            quantityUnits: 'PCS',
            unitPrice: { amount: Number(unitPrice.toFixed(2)), currency },
            customsValue: { amount: Number(totalPrice.toFixed(2)), currency },
            weight: { units: 'KG', value: Number(weightKg.toFixed(3)) },
            countryOfManufacture: 'BR',
        };
    });
}

/**
 * Cliente Intrex dono da loja que esta pedindo o frete.
 *
 * Serve so para achar o NCM do produto cadastrado e melhorar a classificacao
 * do imposto. Loja nao identificada nao impede nada: a chave de cache cai na
 * descricao do item.
 */
async function resolverClienteDaLoja(shopDomain) {
    if (!shopDomain) return null;
    try {
        const info = await db.InfoShopify.findOne({
            where: { shopDomain },
            attributes: ['id_cliente'],
        });
        return info?.id_cliente || null;
    } catch (e) {
        console.error('[SHOPIFY CARRIER] falha ao resolver loja:', shopDomain, e?.message);
        return null;
    }
}

router.get('/carrier-test', (req, res) => {
    return res.json({
        ok: true,
        route: '/shopify/carrier',
        ts: Date.now()
    });
});

router.post('/carrier', async (req, res) => {
    try {
        console.log('[SHOPIFY CARRIER] body:', JSON.stringify(req.body, null, 2));

        const rate = req.body?.rate;
        console.log('[SHOPIFY CARRIER] parsed rate:', JSON.stringify(rate, null, 2));

        if (!rate) {
            return res.status(400).json({ error: 'Missing rate object' });
        }

        const origin = { ...DEFAULT_ORIGIN };

        const dest = rate.destination || {};
        const items = Array.isArray(rate.items) ? rate.items : [];
        const currency = rate.currency || 'USD';

        const shopDomain = String(req.get('x-shopify-shop-domain') || '').trim().toLowerCase();

        const packages = buildPackages(items);
        const commodities = buildCommodities(items, currency);

        const shipperNumber = process.env.UPS_ACCOUNT_NUMBER || undefined;

        const upsPkgs = packages.map(p => ({
            PackagingType: { Code: '02' },
            PackageWeight: {
                UnitOfMeasurement: { Code: 'KGS' },
                Weight: String(Math.max(0.5, Number((p.weightKg || 1).toFixed(2)))),
            },
            Dimensions: {
                UnitOfMeasurement: { Code: 'CM' },
                Height: String(Math.round(p.dimCm?.height || 10)),
                Width: String(Math.round(p.dimCm?.width || 15)),
                Length: String(Math.round(p.dimCm?.length || 20)),
            },
        }));

        const upsPayload = {
            RateRequest: {
                Request: {
                    RequestOption: 'Rate',
                    TransactionReference: { CustomerContext: 'shopify-carrier' },
                },
                Shipment: {
                    Service: { Code: '08' },
                    Shipper: {
                        ...(shipperNumber ? { ShipperNumber: shipperNumber } : {}),
                        Address: {
                            PostalCode: origin.postal_code,
                            CountryCode: origin.country,
                            StateProvinceCode: origin.province || undefined,
                            City: origin.city || undefined,
                            AddressLine: origin.address1 ? [origin.address1] : undefined,
                        },
                    },
                    ShipTo: {
                        Address: {
                            PostalCode: dest.postal_code,
                            CountryCode: dest.country,
                            StateProvinceCode: dest.province || undefined,
                            City: dest.city || undefined,
                            AddressLine: dest.address1 ? [dest.address1] : undefined,
                        },
                    },
                    ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
                    Package: upsPkgs,
                },
            },
        };

        const fedexPayload = {
            shipper: {
                contact: {
                    personName: origin.name || 'Shipper',
                    companyName: origin.company_name || origin.name || 'Shipper',
                    phoneNumber: origin.phone || '47992104226',
                },
                address: {
                    postalCode: origin.postal_code,
                    countryCode: origin.country,
                    city: origin.city,
                    stateOrProvinceCode: normalizeFedexState(origin.province),
                    streetLines: [origin.address1 || 'Address not provided'],
                }
            },
            recipient: {
                contact: {
                    personName: dest.name || 'Recipient',
                    companyName: dest.company_name || dest.name || 'Recipient',
                    phoneNumber: dest.phone || '17865994231',
                    emailAddress: dest.email || undefined,
                },
                address: {
                    postalCode: dest.postal_code,
                    countryCode: dest.country,
                    city: dest.city,
                    stateOrProvinceCode: normalizeFedexState(dest.province),
                    streetLines: [dest.address1 || 'Address not provided'],
                    residential: false,
                }
            },
            packages,
            commodities,
            currency,
        };

        // O imposto entra junto na paralela: ele nao depende do frete para ser
        // preparado (regime + aliquota do item), so para fechar a conta. Assim
        // nao soma latencia nenhuma ao callback.
        const prepararImposto = (async () => {
            const clienteId = await resolverClienteDaLoja(shopDomain);
            return prepararImpostoCheckout({
                destino: dest.country,
                itens: items,
                moeda: currency,
                clienteId,
                db,
            });
        })();

        // O teto abaixo descarta a promessa, mas ela segue viva: sem este
        // handler extra, uma falha que chega DEPOIS do teto vira
        // unhandledRejection e derruba o processo em Node moderno.
        prepararImposto.catch(() => { });

        // UPS e FedEx em paralelo — evita estourar o timeout de ~10s da Shopify
        const [upsResult, fedexResult, impostoResult] = await Promise.allSettled([
            upsRating.quote(upsPayload),
            quoteRates(fedexPayload),
            comTeto(prepararImposto, IMPOSTO_TIMEOUT_MS, 'imposto'),
        ]);

        let upsQuotes = [];
        if (upsResult.status === 'fulfilled') {
            upsQuotes = normUps({ raw: upsResult.value });
        } else {
            console.error('[SHOPIFY CARRIER][UPS ERROR]', upsResult.reason?.message, upsResult.reason?.details || upsResult.reason?.response?.data || null);
        }

        let fedexQuotes = [];
        if (fedexResult.status === 'fulfilled') {
            fedexQuotes = fedexResult.value?.rows || [];
        } else {
            console.error('[SHOPIFY CARRIER][FEDEX ERROR]', fedexResult.reason?.response?.data || fedexResult.reason);
        }

        let imposto = { disponivel: false, motivo: 'erro' };
        if (impostoResult.status === 'fulfilled') {
            imposto = impostoResult.value;
        } else {
            console.error('[SHOPIFY CARRIER][IMPOSTO ERROR]', impostoResult.reason?.message);
        }

        console.log('[SHOPIFY CARRIER][IMPOSTO]', {
            pais: dest.country,
            disponivel: imposto.disponivel,
            motivo: imposto.motivo || null,
            confianca: imposto.confianca || null,
            fallback: imposto.tem_fallback || false,
            mercadoria_usd: imposto.valor_mercadoria_usd || null,
        });

        const rates = [];

// Mapeamento de nomes UPS
const upsNameMap = {
    '01': 'UPS Express (1-3 business days)',
    '02': 'UPS 2nd Day Air',
    '03': 'UPS Ground',
    '07': 'UPS Express (2-4 business days)',
    '08': 'UPS Worldwide Expedited (4-7 business days)',
    '11': 'UPS Standard',
    '65': 'UPS Saver (2-4 business days)',
};

// Mapeamento de nomes FedEx
const fedexNameMap = {
    FEDEX_INTERNATIONAL_CONNECT_PLUS: 'FedEx International Economy (3-7 business days)',
    INTERNATIONAL_PRIORITY: 'FedEx Express (2-4 business days)',
    INTERNATIONAL_ECONOMY: 'FedEx Economy (4-7 business days)',
};

/**
 * Fator moeda do frete -> USD, SEM nova chamada de rede.
 *
 * O cambio ja foi resolvido no preparo do imposto. Buscar outro aqui dentro do
 * callback arriscaria 8s de timeout da API de cotacao em cima dos 10s da
 * Shopify. Moeda que nao da para converter com o que esta em maos devolve null,
 * e aquele servico sai como DDU com aviso em vez de sair com imposto errado.
 */
function fatorFreteParaUsd(moedaFrete) {
    const m = String(moedaFrete || 'USD').trim().toUpperCase();
    if (m === 'USD') return 1;
    if (!imposto.disponivel) return null;
    if (m === imposto.moeda_origem) return imposto.para_usd;
    // A UPS devolve a tarifa negociada em BRL mesmo quando a loja vende em
    // dolar, por ser conta brasileira.
    if (m === 'BRL' && imposto.brl_para_usd) return imposto.brl_para_usd;
    return null;
}

const money = (v) => Number(v).toFixed(2);

/**
 * Monta o rate final de um servico, ja com imposto embutido quando ha.
 *
 * DDP por decisao de produto: o comprador paga frete + imposto no checkout e
 * nao e surpreendido na entrega. A description e o unico texto que a Shopify
 * mostra junto do servico, entao ela e que diz o que esta dentro do preco.
 */
function montarRate({ service_name, service_code, freteTotal, moedaFrete }) {
    const moeda = moedaFrete || 'USD';
    const frete = Number(freteTotal);

    if (!imposto.disponivel) {
        // Sem regime aprovado (ou sem cambio/classificacao): vende, mas avisa.
        // Silenciar aqui e exatamente onde o cliente leva prejuizo.
        return {
            service_name,
            service_code,
            description: `Shipping ${money(frete)} ${moeda} · Import duties & taxes NOT included — customs charges them on delivery`,
            currency: moeda,
            total_price: String(Math.round(frete * 100)),
        };
    }

    const fator = fatorFreteParaUsd(moeda);
    if (fator === null) {
        return {
            service_name,
            service_code,
            description: `Shipping ${money(frete)} ${moeda} · Import duties & taxes NOT included — customs charges them on delivery`,
            currency: moeda,
            total_price: String(Math.round(frete * 100)),
        };
    }

    const conta = imposto.calcular(frete * fator);
    // De volta para a moeda do frete, que e a moeda do rate.
    const impostoMoeda = Math.round((conta.total_usd / fator) * 100) / 100;

    if (conta.isento) {
        return {
            service_name,
            service_code,
            // Zero pode vir do de minimis do destino ou de aliquota zero para a
            // mercadoria. Daqui nao se sabe qual dos dois, entao o texto diz o
            // resultado e nao afirma o motivo.
            description: `Shipping ${money(frete)} ${moeda} · No import duties or taxes due for this order`,
            currency: moeda,
            total_price: String(Math.round(frete * 100)),
        };
    }

    const total = Math.round((frete + impostoMoeda) * 100) / 100;

    return {
        service_name,
        service_code,
        description: `Shipping ${money(frete)} ${moeda} + import duties & taxes ${money(impostoMoeda)} ${moeda} — included, nothing to pay on delivery`,
        currency: moeda,
        total_price: String(Math.round(total * 100)),
    };
}

// UPS real
upsQuotes.forEach((q) => {
    if (!q?.total) return;

    const code = String(q.serviceCode || '').trim();

    rates.push(montarRate({
        service_name: upsNameMap[code] || `UPS ${q.serviceLabel || 'International'}`,
        service_code: `UPS_${code || 'STD'}`,
        freteTotal: q.total,
        moedaFrete: q.currency || 'USD',
    }));
});

// FedEx real
fedexQuotes.forEach((q) => {
    if (!q?.total) return;

    const type = String(q.serviceType || '').trim();

    rates.push(montarRate({
        service_name: fedexNameMap[type] || 'FedEx International Shipping',
        service_code: `FEDEX_${type.replace(/\s+/g, '_') || 'STD'}`,
        freteTotal: q.total,
        moedaFrete: q.currency || 'USD',
    }));
});

// fallback geral se tudo falhar
if (!rates.length) {
    console.log('[FALLBACK] no rates, returning fallback');

    rates.push({
        service_name: 'Intrex Economy Shipping',
        service_code: 'INTREX_FALLBACK',
        description: 'International shipping (5-10 business days)',
        currency: 'USD',
        total_price: '2500',
    });
}

console.log('[SHOPIFY CARRIER] final rates:', JSON.stringify(rates, null, 2));
return res.json({ rates });
    } catch (err) {
        console.error('[SHOPIFY CARRIER ERROR]', err);
        return res.status(200).json({ rates: [] });
    }
});

module.exports = router;
