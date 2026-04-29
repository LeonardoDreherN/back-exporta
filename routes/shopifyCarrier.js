const express = require('express');
const router = express.Router();

const upsRating = require('../services/ups/rating');
const normUps = require('../utils/normalize/upsRate');
const { quoteRates } = require('../services/fedex/ratingFedex');

const toKg = (grams) => Number(grams || 0) / 1000;

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
        const totalPrice = Number(item.price || 0) / 100 || 1;
        const unitPrice = totalPrice / qty;
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

        const packages = buildPackages(items);
        const commodities = buildCommodities(items, currency);

        let upsQuotes = [];
try {
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

    console.log('[SHOPIFY CARRIER][UPS PAYLOAD]', JSON.stringify(upsPayload, null, 2));

    const upsResp = await upsRating.quote(upsPayload);
    upsQuotes = normUps({ raw: upsResp });
} catch (e) {
    console.error('[SHOPIFY CARRIER][UPS ERROR] status:', e?.status);
    console.error('[SHOPIFY CARRIER][UPS ERROR] message:', e?.message);
    console.error('[SHOPIFY CARRIER][UPS ERROR] details:', JSON.stringify(e?.details || e?.response?.data || null, null, 2));
}

       let fedexQuotes = [];
try {
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

    console.log('[SHOPIFY CARRIER][FEDEX PAYLOAD]', JSON.stringify(fedexPayload, null, 2));

    const fedexResp = await quoteRates(fedexPayload);
    fedexQuotes = fedexResp.rows || [];
} catch (e) {
    console.error('[SHOPIFY CARRIER][FEDEX ERROR FULL]', e?.response?.data || e);
}

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

function buildDescription(base, total, itemized = []) {
    const cur = 'USD';
    const taxes = Number((total - base).toFixed(2));
    const parts = [`Base: ${cur} ${Number(base).toFixed(2)}`];
    if (taxes > 0) parts.push(`Taxas: ${cur} ${taxes.toFixed(2)}`);
    return `- ${parts.join(' | ')} ⓘ`;
}

// UPS real
upsQuotes.forEach((q) => {
    if (!q?.total) return;

    const code = String(q.serviceCode || '').trim();

    rates.push({
        service_name: upsNameMap[code] || `UPS ${q.serviceLabel || 'International'}`,
        service_code: `UPS_${code || 'STD'}`,
        description: buildDescription(q.base, q.total, q.itemized),
        currency: q.currency || 'USD',
        total_price: String(Math.round(Number(q.total) * 100)),
    });
});

// FedEx real
fedexQuotes.forEach((q) => {
    if (!q?.total) return;

    const type = String(q.serviceType || '').trim();

    rates.push({
        service_name: fedexNameMap[type] || 'FedEx International Shipping',
        service_code: `FEDEX_${type.replace(/\s+/g, '_') || 'STD'}`,
        description: buildDescription(q.base, q.total, q.itemized),
        currency: q.currency || 'USD',
        total_price: String(Math.round(Number(q.total) * 100)),
    });
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