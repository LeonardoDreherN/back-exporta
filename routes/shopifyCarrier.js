const express = require('express');
const router = express.Router();

const { rateMulti } = require('../services/rate/multi');
const { quoteRates } = require('../services/fedex/ratingFedex');

const toKg = (grams) => Number(grams || 0) / 1000;

// Ajuste aqui com os dados reais da sua operação/origem
const DEFAULT_ORIGIN = {
    country: 'BR',
    postal_code: '89160000',
    province: 'SC',
    city: 'Rio do Sul',
    address1: 'Rua Teste, 123',
    company_name: 'Exporta Digital BR',
    name: 'Exporta Digital BR',
    phone: '11999999999',
};

// Se vier estado/província com mais de 2 caracteres, omite para a FedEx não quebrar
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

        const rawOrigin = rate.origin || {};
        const origin = {
            ...DEFAULT_ORIGIN,
            ...rawOrigin,
            country: rawOrigin.country || DEFAULT_ORIGIN.country,
            postal_code: rawOrigin.postal_code || DEFAULT_ORIGIN.postal_code,
            province: rawOrigin.province || DEFAULT_ORIGIN.province,
            city: rawOrigin.city || DEFAULT_ORIGIN.city,
            address1: rawOrigin.address1 || DEFAULT_ORIGIN.address1,
            company_name: rawOrigin.company_name || DEFAULT_ORIGIN.company_name,
            name: rawOrigin.name || DEFAULT_ORIGIN.name,
            phone: rawOrigin.phone || DEFAULT_ORIGIN.phone,
        };

        const dest = rate.destination || {};
        const items = Array.isArray(rate.items) ? rate.items : [];
        const currency = rate.currency || 'USD';

        const packages = buildPackages(items);
        const commodities = buildCommodities(items, currency);

        let upsQuotes = [];
        try {
            const upsPayload = {
                shipper: {
                    postalCode: origin.postal_code,
                    country: origin.country,
                    state: origin.province,
                    city: origin.city,
                    addressLine: origin.address1 || undefined,
                },
                shipTo: {
                    postalCode: dest.postal_code,
                    country: dest.country,
                    state: dest.province,
                    city: dest.city,
                    addressLine: dest.address1 || undefined,
                },
                serviceCode: null,
                packages,
            };

            console.log('[SHOPIFY CARRIER][UPS PAYLOAD]', JSON.stringify(upsPayload, null, 2));

            const upsResp = await rateMulti(upsPayload);
            upsQuotes = upsResp.quotes || [];
        } catch (e) {
            console.error('[SHOPIFY CARRIER][UPS ERROR FULL]', e?.response?.data || e);
        }

        let fedexQuotes = [];
        try {
            const fedexPayload = {
                shipper: {
                    contact: {
                        personName: origin.name || 'Shipper',
                        companyName: origin.company_name || origin.name || 'Shipper',
                        phoneNumber: origin.phone || '11999999999',
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
    FEDEX_INTERNATIONAL_CONNECT_PLUS: 'FedEx International Economy (3-6 business days)',
    INTERNATIONAL_PRIORITY: 'FedEx Express (2-4 business days)',
    INTERNATIONAL_ECONOMY: 'FedEx Economy (4-7 business days)',
};

// UPS
upsQuotes.forEach((q) => {
    if (!q?.total) return;

    const code = String(q.serviceCode || '').trim();

    rates.push({
        service_name: upsNameMap[code] || `UPS ${q.serviceLabel || 'International'}`,
        service_code: `UPS_${code || 'STD'}`,
        description: 'International shipping via UPS',
        currency: q.currency || 'USD',
        total_price: String(Math.round(Number(q.total) * 100)),
    });
});

// FEDEX
fedexQuotes.forEach((q) => {
    if (!q?.total) return;

    const type = String(q.serviceType || '').trim();

    rates.push({
        service_name: fedexNameMap[type] || 'FedEx International Shipping',
        service_code: `FEDEX_${type.replace(/\s+/g, '_') || 'STD'}`,
        description: 'International shipping via FedEx',
        currency: q.currency || 'USD',
        total_price: String(Math.round(Number(q.total) * 100)),
    });
});

        console.log('[SHOPIFY CARRIER] final rates:', JSON.stringify(rates, null, 2));
        if (!rates.length) {
    console.log('[FALLBACK] no rates, returning fallback');

    rates.push({
        service_name: 'Intrex Economy Shipping',
        service_code: 'INTREX_FALLBACK',
        description: 'International shipping (5-10 business days)',
        currency: 'USD',
        total_price: '2500', // $25.00
    });
}
        return res.json({ rates });
    } catch (err) {
        console.error('[SHOPIFY CARRIER ERROR]', err);
        return res.status(200).json({ rates: [] });
    }
});

module.exports = router;