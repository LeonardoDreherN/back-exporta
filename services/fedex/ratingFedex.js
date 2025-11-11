// services/fedex/rates.js
const axios = require('axios');
const { getFedexToken, baseUrl } = require('./authFedex');

// helpers de unidade
const kgToLb = kg => +(kg * 2.2046226218).toFixed(3);
const cmToIn = cm => +(cm * 0.3937007874).toFixed(2);

function accountNumberObj() {
    return { value: process.env.FEDEX_ACCOUNT_NUMBER };
}

/**
 * shipper/destination:
 * { countryCode, postalCode, city, stateOrProvinceCode }
 * packages: [{ weightKg, dimCm: {length,width,height} }]
 */
async function quoteRates({ shipper, recipient, packages }) {
    const token = await getFedexToken();
    const url = `${baseUrl()}/rate/v1/rates/quotes`;

    const requestedPackageLineItems = packages.map((p, idx) => ({
        weight: { units: 'LB', value: kgToLb(p.weightKg || 0.5) },
        dimensions: {
            length: cmToIn(p.dimCm?.length || 10),
            width: cmToIn(p.dimCm?.width || 10),
            height: cmToIn(p.dimCm?.height || 10),
            units: 'IN',
        },
        groupPackageCount: 1,
        sequenceNumber: idx + 1,
    }));

    const body = {
        accountNumber: accountNumberObj(),
        requestedShipment: {
            shipper: {
                address: {
                    postalCode: shipper.postalCode,
                    countryCode: shipper.countryCode,
                    stateOrProvinceCode: shipper.stateOrProvinceCode,
                    city: shipper.city,
                },
            },
            recipient: {
                address: {
                    postalCode: recipient.postalCode,
                    countryCode: recipient.countryCode,
                    stateOrProvinceCode: recipient.stateOrProvinceCode,
                    city: recipient.city,
                    residential: false,
                },
            },
            pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
            rateRequestType: ['ACCOUNT', 'LIST'],
            packagingType: 'YOUR_PACKAGING',
            requestedPackageLineItems,
        },
    };

    const { data } = await axios.post(url, body, {
        headers: {
            Authorization: `Bearer ${token}`,
            'x-customer-transaction-id': `intrex-${Date.now()}`,
            'Content-Type': 'application/json',
        },
    });

    // Normalização genérica do retorno -> suas CompareRows
    // A estrutura varia por versão; extraia serviceType + custo total + breakdown.
    const out = [];
    const details = data?.output?.rateReplyDetails || data?.rateReplyDetails || [];
    for (const svc of details) {
        const serviceType = svc.serviceType || svc.serviceName;
        // tente pegar o primeiro cenário de preço calculado
        const rated = svc.ratedShipmentDetails?.[0] || svc.ratedShipmentDetails || svc?.ratedShipmentDetail;
        const total = rated?.totalNetCharge?.amount
            ?? rated?.shipmentRateDetail?.totalNetCharge?.amount
            ?? rated?.totalBaseCharge?.amount
            ?? null;

        // surcharges (quando expostas)
        const surs = rated?.shipmentRateDetail?.surcharges || [];
        out.push({
            carrier: 'FEDEX',
            serviceType,
            currency: rated?.totalNetCharge?.currency || 'USD',
            // ajuste ao tipo do seu grid
            base: Number(total) || 0,
            itemized: (surs || []).map(s => ({
                code: s?.surchargeType || s?.description,
                amount: s?.amount?.amount || s?.amount,
            })),
            raw: svc,
        });
    }
    return { raw: data, rows: out };
}

module.exports = { quoteRates };
