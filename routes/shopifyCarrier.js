const express = require('express');
const router = express.Router();

const { rateMulti } = require('../services/rate/multi');
const { quoteRates } = require('../services/fedex/ratingFedex');

const toKg = (grams) => Number(grams || 0) / 1000;

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
        const rate = req.body?.rate;

        if (!rate) {
            return res.status(400).json({ error: 'Missing rate object' });
        }

        const origin = rate.origin || {};
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
                serviceCode: '08',
                packages,
            };

            const upsResp = await rateMulti(upsPayload);
            upsQuotes = upsResp.quotes || [];
        } catch (e) {
            console.error('[SHOPIFY CARRIER][UPS ERROR]', e.message);
        }

        let fedexQuotes = [];
        try {
            const fedexResp = await quoteRates({
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
                        stateOrProvinceCode: origin.province,
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
                        stateOrProvinceCode: dest.province,
                        streetLines: [dest.address1 || 'Address not provided'],
                        residential: false,
                    }
                },
                packages,
                commodities,
                currency,
            });

            fedexQuotes = fedexResp.rows || [];
        } catch (e) {
            console.error('[SHOPIFY CARRIER][FEDEX ERROR]', e.message);
        }

        const rates = [];

        upsQuotes.forEach((q) => {
            if (!q?.total) return;

            rates.push({
                service_name: `UPS ${q.serviceLabel || q.service || 'Express'}`,
                service_code: `UPS_${q.serviceCode || 'STD'}`,
                description: 'Entrega internacional UPS',
                currency: q.currency || 'USD',
                total_price: String(Math.round(Number(q.total) * 100)),
            });
        });

        fedexQuotes.forEach((q) => {
            if (!q?.total) return;

            rates.push({
                service_name: `FedEx ${q.serviceType || 'International'}`,
                service_code: `FEDEX_${q.serviceType || 'STD'}`,
                description: 'Entrega internacional FedEx',
                currency: q.currency || 'USD',
                total_price: String(Math.round(Number(q.total) * 100)),
            });
        });

        return res.json({ rates });
    } catch (err) {
        console.error('[SHOPIFY CARRIER ERROR]', err);
        return res.status(500).json({ rates: [] });
    }
});

module.exports = router;