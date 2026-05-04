const { quote: upsQuote } = require('../services/ups/rating');
const { quoteRates: fedexRates } = require('../services/fedex/ratingFedex');

const SHIPPER = {
    name: 'INTREX',
    phone: '47992104226',
    address: 'Rua Lauro Linhares 2055',
    city: 'Florianopolis',
    state: 'SC',
    postalCode: '88036003',
    countryCode: 'BR',
};

const DEST_MAP = {
    // Americas
    'estados unidos':        { code: 'US', postalCode: '10001',   state: 'NY',  city: 'New York' },
    'canada':                { code: 'CA', postalCode: 'M5H2N2',  state: 'ON',  city: 'Toronto' },
    'mexico':                { code: 'MX', postalCode: '06600',   state: 'CMX', city: 'Ciudad de Mexico' },
    'argentina':             { code: 'AR', postalCode: 'C1000',   state: 'C',   city: 'Buenos Aires' },
    'chile':                 { code: 'CL', postalCode: '8320000', state: 'RM',  city: 'Santiago' },
    'colombia':              { code: 'CO', postalCode: '110111',  state: 'DC',  city: 'Bogota' },
    'paraguai':              { code: 'PY', postalCode: '1001',    state: '',    city: 'Asuncion' },
    'uruguai':               { code: 'UY', postalCode: '11000',   state: '',    city: 'Montevideo' },
    'peru':                  { code: 'PE', postalCode: '15001',   state: 'LIM', city: 'Lima' },
    'equador':               { code: 'EC', postalCode: '170150',  state: 'P',   city: 'Quito' },
    'bolivia':               { code: 'BO', postalCode: '',        state: '',    city: 'Santa Cruz' },
    'venezuela':             { code: 'VE', postalCode: '1010',    state: 'A',   city: 'Caracas' },
    'panama':                { code: 'PA', postalCode: '0801',    state: '',    city: 'Panama' },
    'costa rica':            { code: 'CR', postalCode: '10101',   state: 'SJ',  city: 'San Jose' },
    'cuba':                  { code: 'CU', postalCode: '10400',   state: '',    city: 'Havana' },
    'jamaica':               { code: 'JM', postalCode: 'JMAKN05', state: 'AK',  city: 'Kingston' },

    // Europa
    'portugal':              { code: 'PT', postalCode: '1000-001', state: '',    city: 'Lisboa' },
    'reino unido':           { code: 'GB', postalCode: 'EC1A1BB', state: 'ENG', city: 'London' },
    'franca':                { code: 'FR', postalCode: '75001',   state: '',    city: 'Paris' },
    'alemanha':              { code: 'DE', postalCode: '10115',   state: '',    city: 'Berlin' },
    'espanha':               { code: 'ES', postalCode: '28001',   state: '',    city: 'Madrid' },
    'italia':                { code: 'IT', postalCode: '00100',   state: '',    city: 'Roma' },
    'paises baixos':         { code: 'NL', postalCode: '1011',    state: '',    city: 'Amsterdam' },
    'belgica':               { code: 'BE', postalCode: '1000',    state: '',    city: 'Brussels' },
    'suecia':                { code: 'SE', postalCode: '11120',   state: '',    city: 'Stockholm' },
    'noruega':               { code: 'NO', postalCode: '0150',    state: '',    city: 'Oslo' },
    'dinamarca':             { code: 'DK', postalCode: '1000',    state: '',    city: 'Copenhagen' },
    'finlandia':             { code: 'FI', postalCode: '00100',   state: '',    city: 'Helsinki' },
    'suica':                 { code: 'CH', postalCode: '8001',    state: '',    city: 'Zurich' },
    'austria':               { code: 'AT', postalCode: '1010',    state: '',    city: 'Vienna' },
    'polonia':               { code: 'PL', postalCode: '00-001',  state: '',    city: 'Warsaw' },
    'republica tcheca':      { code: 'CZ', postalCode: '11000',   state: '',    city: 'Prague' },
    'hungria':               { code: 'HU', postalCode: '1051',    state: '',    city: 'Budapest' },
    'romenia':               { code: 'RO', postalCode: '010011',  state: '',    city: 'Bucharest' },
    'grecia':                { code: 'GR', postalCode: '10431',   state: '',    city: 'Athens' },
    'turquia':               { code: 'TR', postalCode: '34000',   state: '',    city: 'Istanbul' },

    // Oriente Médio / África
    'israel':                { code: 'IL', postalCode: '6100000', state: '',    city: 'Tel Aviv' },
    'emirados arabes unidos':{ code: 'AE', postalCode: '',        state: 'DU',  city: 'Dubai' },
    'arabia saudita':        { code: 'SA', postalCode: '11564',   state: 'RI',  city: 'Riyadh' },
    'egito':                 { code: 'EG', postalCode: '11511',   state: '',    city: 'Cairo' },
    'marrocos':              { code: 'MA', postalCode: '10000',   state: '',    city: 'Casablanca' },
    'africa do sul':         { code: 'ZA', postalCode: '2001',    state: 'GP',  city: 'Johannesburg' },

    // Ásia / Pacífico
    'china':                 { code: 'CN', postalCode: '100000',  state: 'BJ',  city: 'Beijing' },
    'japao':                 { code: 'JP', postalCode: '1000001', state: '13',  city: 'Tokyo' },
    'india':                 { code: 'IN', postalCode: '110001',  state: 'DL',  city: 'New Delhi' },
    'coreia do sul':         { code: 'KR', postalCode: '04524',   state: '',    city: 'Seoul' },
    'cingapura':             { code: 'SG', postalCode: '018989',  state: '',    city: 'Singapore' },
    'hong kong':             { code: 'HK', postalCode: '',        state: '',    city: 'Hong Kong' },
    'taiwan':                { code: 'TW', postalCode: '100',     state: '',    city: 'Taipei' },
    'tailandia':             { code: 'TH', postalCode: '10110',   state: '',    city: 'Bangkok' },
    'malasia':               { code: 'MY', postalCode: '50000',   state: '',    city: 'Kuala Lumpur' },
    'indonesia':             { code: 'ID', postalCode: '10110',   state: 'JK',  city: 'Jakarta' },
    'filipinas':             { code: 'PH', postalCode: '1000',    state: '',    city: 'Manila' },
    'australia':             { code: 'AU', postalCode: '2000',    state: 'NSW', city: 'Sydney' },
    'nova zelandia':         { code: 'NZ', postalCode: '1010',    state: '',    city: 'Auckland' },

    // Leste Europeu
    'russia':                { code: 'RU', postalCode: '101000',  state: '',    city: 'Moscow' },
};

function normKey(s) {
    // eslint-disable-next-line no-misleading-character-class
    return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function pesoTaxavel(pesoKg, compCm, largCm, altCm) {
    const cubado = (Number(compCm) * Number(largCm) * Number(altCm)) / 5000;
    return Math.max(Number(pesoKg), cubado || 0);
}

function extractUpsRates(upsRaw) {
    const rs = upsRaw?.RateResponse?.RatedShipment;
    const arr = Array.isArray(rs) ? rs : (rs ? [rs] : []);
    const preferred =
        arr.find(r => r?.Service?.Code === '08') ||
        arr.find(r => r?.Service?.Code === '07') ||
        arr[0];
    if (!preferred) return null;

    const currency = preferred?.TotalCharges?.CurrencyCode || 'USD';
    const published  = +Number(preferred?.TotalCharges?.MonetaryValue || 0).toFixed(2);
    const negotiated = +Number(
        preferred?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ||
        preferred?.TotalCharges?.MonetaryValue || 0
    ).toFixed(2);

    return { negotiated, published, currency };
}

function extractFedexRates(fedexResp) {
    const rows = fedexResp?.rows || [];
    const raw  = fedexResp?.raw;

    const icpRow =
        rows.find(r => r?.serviceType === 'FEDEX_INTERNATIONAL_CONNECT_PLUS') ||
        rows[0];
    if (!icpRow) return null;

    const negotiated = +Number(icpRow.total || 0).toFixed(2);
    const currency   = icpRow.currency || 'USD';

    // Extract LIST (public) rate from raw response
    let published = negotiated;
    const details = raw?.output?.rateReplyDetails || [];
    const svc = details.find(d => d?.serviceType === 'FEDEX_INTERNATIONAL_CONNECT_PLUS') || details[0];
    if (svc?.ratedShipmentDetails) {
        const listRated = svc.ratedShipmentDetails.find(r => r.rateType === 'LIST');
        if (listRated) {
            const toNum = v => { const n = Number(v?.amount ?? v); return Number.isFinite(n) ? n : null; };
            const totalRaw =
                toNum(listRated?.ratedPackages?.[0]?.packageRateDetail?.totalNetCharge) ??
                toNum(listRated?.shipmentRateDetail?.totalNetCharge) ??
                toNum(listRated?.totalNetCharge) ?? 0;

            if (totalRaw > 0) {
                const fx = Number(listRated?.shipmentRateDetail?.currencyExchangeRate?.rate);
                const carrierCurrency = String(listRated?.currency || 'USD').toUpperCase();
                published = (Number.isFinite(fx) && fx > 0 && carrierCurrency === 'BRL')
                    ? +Number(totalRaw / fx).toFixed(2)
                    : +Number(totalRaw).toFixed(2);
            }
        }
    }

    return { negotiated, published, currency };
}

async function publicQuote(req, res) {
    const { comprimento, largura, altura, peso, destino } = req.body || {};

    if (!peso || !destino) {
        return res.status(400).json({ ok: false, error: 'peso e destino são obrigatórios' });
    }

    const pesoNum = Number(String(peso).replace(',', '.'));
    if (!pesoNum || pesoNum <= 0) {
        return res.status(400).json({ ok: false, error: 'peso inválido' });
    }

    const destInfo = DEST_MAP[normKey(destino)];
    if (!destInfo) {
        return res.status(400).json({ ok: false, error: `Destino não reconhecido: ${destino}` });
    }

    const compNum = Number(comprimento) || 20;
    const largNum = Number(largura)    || 15;
    const altNum  = Number(altura)     || 10;
    const taxavel = +pesoTaxavel(pesoNum, compNum, largNum, altNum).toFixed(3);

    const shipToAddr = {
        CountryCode: destInfo.code,
        ...(destInfo.city        ? { City:                destInfo.city  } : {}),
        ...(destInfo.state       ? { StateProvinceCode:   destInfo.state } : {}),
        ...(destInfo.postalCode  ? { PostalCode:          destInfo.postalCode } : {}),
    };

    const upsPayload = {
        RateRequest: {
            Request: { TransactionReference: { CustomerContext: 'intrex-simulador-publico' } },
            Shipment: {
                Shipper: {
                    Name: SHIPPER.name,
                    ShipperNumber: process.env.UPS_ACCOUNT_NUMBER,
                    Address: {
                        AddressLine: [SHIPPER.address],
                        City: SHIPPER.city,
                        StateProvinceCode: SHIPPER.state,
                        PostalCode: SHIPPER.postalCode,
                        CountryCode: SHIPPER.countryCode,
                    },
                },
                ShipFrom: {
                    Name: SHIPPER.name,
                    Address: {
                        AddressLine: [SHIPPER.address],
                        City: SHIPPER.city,
                        StateProvinceCode: SHIPPER.state,
                        PostalCode: SHIPPER.postalCode,
                        CountryCode: SHIPPER.countryCode,
                    },
                },
                ShipTo: { Name: 'Destinatario', Address: shipToAddr },
                Service: { Code: '08' },
                ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
                Package: [{
                    PackagingType: { Code: '02' },
                    PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: String(taxavel) },
                    Dimensions: {
                        UnitOfMeasurement: { Code: 'CM' },
                        Length: String(compNum),
                        Width:  String(largNum),
                        Height: String(altNum),
                    },
                }],
            },
        },
    };

    const fedexShipper = {
        contact: { companyName: SHIPPER.name, phoneNumber: SHIPPER.phone },
        address: {
            streetLines: [SHIPPER.address],
            city: SHIPPER.city,
            stateOrProvinceCode: SHIPPER.state,
            postalCode: SHIPPER.postalCode,
            countryCode: SHIPPER.countryCode,
        },
    };

    const fedexRecipient = {
        contact: { companyName: 'Destinatario' },
        address: {
            streetLines: [destInfo.city],
            city: destInfo.city,
            ...(destInfo.state      ? { stateOrProvinceCode: destInfo.state      } : {}),
            ...(destInfo.postalCode ? { postalCode:          destInfo.postalCode  } : {}),
            countryCode: destInfo.code,
            residential: false,
        },
    };

    const [upsResult, fedexResult] = await Promise.allSettled([
        upsQuote(upsPayload),
        fedexRates({
            shipper: fedexShipper,
            recipient: fedexRecipient,
            packages: [{ weightKg: taxavel, dimCm: { length: compNum, width: largNum, height: altNum } }],
            commodities: [{
                description: 'General Merchandise',
                quantity: 1,
                quantityUnits: 'PCS',
                weight: { units: 'KG', value: taxavel },
                unitPrice:    { amount: 50, currency: 'USD' },
                customsValue: { amount: 50, currency: 'USD' },
                countryOfManufacture: 'BR',
            }],
            currency: 'USD',
        }),
    ]);

    const result = { ok: true };

    if (upsResult.status === 'fulfilled') {
        const rates = extractUpsRates(upsResult.value);
        if (rates) result.ups = rates;
    } else {
        console.error('[PUBLIC QUOTE][UPS]', upsResult.reason?.message);
        result.ups_error = upsResult.reason?.message || 'UPS indisponível';
    }

    if (fedexResult.status === 'fulfilled') {
        const rates = extractFedexRates(fedexResult.value);
        if (rates) result.fedex = rates;
    } else {
        console.error('[PUBLIC QUOTE][FEDEX]', fedexResult.reason?.message);
        result.fedex_error = fedexResult.reason?.message || 'FedEx indisponível';
    }

    if (!result.ups && !result.fedex) {
        return res.status(502).json({
            ok: false,
            error: 'Não foi possível obter cotação no momento. Tente novamente em instantes.',
            ups_error:   result.ups_error,
            fedex_error: result.fedex_error,
        });
    }

    return res.json(result);
}

module.exports = { publicQuote };
