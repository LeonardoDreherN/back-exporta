const { quote: upsQuote } = require('../services/ups/rating');
const { quoteRates: fedexRates } = require('../services/fedex/ratingFedex');

// Mesma origem usada pela integracao Shopify (routes/shopifyCarrier.js). A UPS
// recusa cotacao saindo de Florianopolis 88036003 com erro 111217 ("service
// unavailable between the selected locations") em todos os servicos; saindo
// daqui ela cota normalmente.
const SHIPPER = {
    name: 'INTREX',
    phone: '47992104226',
    address: 'Rua Saint German, 87',
    city: 'Santo Amaro da Imperatriz',
    state: 'SC',
    postalCode: '88140570',
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

// ISO 3166-1 alpha-2 → chave do DEST_MAP
const ISO_TO_KEY = {
    US: 'estados unidos', CA: 'canada',   MX: 'mexico',    AR: 'argentina',
    CL: 'chile',          CO: 'colombia', PY: 'paraguai',  UY: 'uruguai',
    PE: 'peru',           EC: 'equador',  BO: 'bolivia',   VE: 'venezuela',
    PA: 'panama',         CR: 'costa rica', CU: 'cuba',    JM: 'jamaica',
    PT: 'portugal',       GB: 'reino unido', FR: 'franca', DE: 'alemanha',
    ES: 'espanha',        IT: 'italia',   NL: 'paises baixos', BE: 'belgica',
    SE: 'suecia',         NO: 'noruega', DK: 'dinamarca', FI: 'finlandia',
    CH: 'suica',          AT: 'austria', PL: 'polonia',   CZ: 'republica tcheca',
    HU: 'hungria',        RO: 'romenia', GR: 'grecia',    TR: 'turquia',
    IL: 'israel',         AE: 'emirados arabes unidos', SA: 'arabia saudita',
    EG: 'egito',          MA: 'marrocos', ZA: 'africa do sul',
    CN: 'china',          JP: 'japao',   IN: 'india',     KR: 'coreia do sul',
    SG: 'cingapura',      HK: 'hong kong', TW: 'taiwan',  TH: 'tailandia',
    MY: 'malasia',        ID: 'indonesia', PH: 'filipinas', AU: 'australia',
    NZ: 'nova zelandia',  RU: 'russia',
};

// SLA estimado por carrier (dias úteis)
const SLA = {
    UPS_PADRAO: 5,
    FEDEX_ICP:  7,
};

// Serviços internacionais da UPS consultados na cotação de checkout. O endpoint
// Shop (catálogo por rota) não funciona nesta conta: responde 111100 mesmo sem
// serviço no payload. Então cotamos cada código em paralelo e ficamos com o mais
// barato que responder. Código fora do mapa ainda é lido, com SLA padrão.
const UPS_SERVICES = {
    '07': { name: 'Worldwide Express',      slaDays: 3 },
    '08': { name: 'Worldwide Expedited',    slaDays: 5 },
    '11': { name: 'Standard',               slaDays: 7 },
    '54': { name: 'Worldwide Express Plus', slaDays: 2 },
    '65': { name: 'Worldwide Saver',        slaDays: 4 },
};

// Ordem não importa: as três consultas saem em paralelo.
const UPS_SERVICE_CODES = ['65', '08', '07'];

function normKey(s) {
    // eslint-disable-next-line no-misleading-character-class
    return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function resolveDestino(destino) {
    const raw = String(destino || '').trim();

    // ISO code (2 letras maiúsculas, ex: "US", "FR")
    if (/^[A-Z]{2}$/.test(raw)) {
        const key = ISO_TO_KEY[raw];
        return key ? DEST_MAP[key] : null;
    }

    // nome em português (com ou sem acento)
    return DEST_MAP[normKey(raw)] || null;
}

function pesoTaxavel(pesoKg, compCm, largCm, altCm) {
    const cubado = (Number(compCm) * Number(largCm) * Number(altCm)) / 5000;
    return Math.max(Number(pesoKg), cubado || 0);
}

// Converte um RatedShipment (um serviço) no formato interno de tarifa.
function ratedShipmentToRates(r) {
    const serviceCode = String(r?.Service?.Code || '').trim();
    const currency    = r?.TotalCharges?.CurrencyCode || 'USD';
    const published   = +Number(r?.TotalCharges?.MonetaryValue || 0).toFixed(2);
    const negotiated  = +Number(
        r?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ||
        r?.TotalCharges?.MonetaryValue || 0
    ).toFixed(2);
    const baseRaw     = +Number(
        r?.NegotiatedRateCharges?.BaseServiceCharge?.MonetaryValue ||
        r?.TransportationCharges?.MonetaryValue || 0
    ).toFixed(2);
    const base        = baseRaw > 0 ? baseRaw : negotiated;
    const surcharges  = +Math.max(0, negotiated - base).toFixed(2);
    const info        = UPS_SERVICES[serviceCode] ||
        { name: serviceCode ? `Internacional ${serviceCode}` : 'Internacional', slaDays: SLA.UPS_PADRAO };

    return {
        negotiated, published, currency, base, surcharges,
        slaDays: info.slaDays,
        service: info.name,
    };
}

// Do retorno do Shop, escolhe o serviço mais barato entre os disponíveis.
function extractUpsRates(upsRaw) {
    const rs  = upsRaw?.RateResponse?.RatedShipment;
    const arr = Array.isArray(rs) ? rs : (rs ? [rs] : []);

    const rates = arr
        .map(ratedShipmentToRates)
        .filter(r => r.negotiated > 0);

    if (!rates.length) return null;

    rates.sort((a, b) => a.negotiated - b.negotiated);
    return rates[0];
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
    const baseRaw    = +Number(icpRow.base || 0).toFixed(2);
    const base       = baseRaw > 0 ? baseRaw : negotiated;
    const surcharges = +Math.max(0, negotiated - base).toFixed(2);

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

    return {
        negotiated, published, currency, base, surcharges,
        slaDays: SLA.FEDEX_ICP,
        service: 'International Connect Plus',
    };
}

function buildOption(carrier, rates) {
    const total = rates.negotiated;
    return {
        carrier,
        service: rates.service,
        price: total,
        published: rates.published,
        currency: rates.currency,
        sla_days: rates.slaDays,
        // campos auxiliares para debug/transparência
        base: rates.base,
        surcharges: rates.surcharges,
        // labels prontos para renderizar no checkout
        label: `${carrier} - ${rates.currency} ${total.toFixed(2)}`,
        sla_label: `${rates.slaDays} dias úteis`,
    };
}

// Consulta cada serviço da UPS em paralelo e devolve a tarifa mais barata entre
// os que responderam. Se nenhum responder, lança um erro com o motivo de cada um,
// que é o que aparece em errors.ups.
async function cotarUps(basePayload) {
    const tentativas = await Promise.allSettled(
        UPS_SERVICE_CODES.map((code) => {
            const payload = {
                ...basePayload,
                RateRequest: {
                    ...basePayload.RateRequest,
                    Shipment: {
                        ...basePayload.RateRequest.Shipment,
                        Service: { Code: code },
                    },
                },
            };
            return upsQuote(payload);
        })
    );

    const rates  = [];
    const falhas = [];

    tentativas.forEach((t, i) => {
        const code = UPS_SERVICE_CODES[i];
        if (t.status === 'fulfilled') {
            const rate = extractUpsRates(t.value);
            if (rate) rates.push(rate);
        } else {
            falhas.push(`${code}: ${t.reason?.message || 'sem resposta'}`);
        }
    });

    if (!rates.length) {
        throw new Error(falhas.join(' | ') || 'UPS não retornou cotação');
    }

    rates.sort((a, b) => a.negotiated - b.negotiated);
    return rates[0];
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

    const destInfo = resolveDestino(destino);
    if (!destInfo) {
        return res.status(400).json({ ok: false, error: `Destino não reconhecido: ${destino}` });
    }

    const compNum = Number(comprimento) || 20;
    const largNum = Number(largura)    || 15;
    const altNum  = Number(altura)     || 10;
    const taxavel = +pesoTaxavel(pesoNum, compNum, largNum, altNum).toFixed(3);

    const shipToAddr = {
        CountryCode: destInfo.code,
        ...(destInfo.city       ? { City:              destInfo.city        } : {}),
        ...(destInfo.state      ? { StateProvinceCode: destInfo.state       } : {}),
        ...(destInfo.postalCode ? { PostalCode:        destInfo.postalCode  } : {}),
    };

    const upsPayload = {
        RateRequest: {
            Request: {
                RequestOption: 'Rate',
                TransactionReference: { CustomerContext: 'intrex-checkout-quote' },
            },
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
                // Sem ShipFrom de proposito: quando ele existe, a UPS valida a
                // origem por ele em vez de pelo endereco do Shipper. Como os dois
                // seriam iguais aqui, mandar so o Shipper (igual a integracao
                // Shopify, que cota normalmente) evita a validacao extra.
                ShipTo: { Name: 'Destinatario', Address: shipToAddr },
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
        cotarUps(upsPayload),
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

    const options = [];
    const errors  = {};

    if (upsResult.status === 'fulfilled') {
        options.push(buildOption('UPS', upsResult.value));
    } else {
        console.error('[PUBLIC QUOTE][UPS]', upsResult.reason?.message);
        errors.ups = upsResult.reason?.message || 'UPS indisponível';
    }

    if (fedexResult.status === 'fulfilled') {
        const rates = extractFedexRates(fedexResult.value);
        if (rates) options.push(buildOption('FedEx', rates));
    } else {
        console.error('[PUBLIC QUOTE][FEDEX]', fedexResult.reason?.message);
        errors.fedex = fedexResult.reason?.message || 'FedEx indisponível';
    }

    if (options.length === 0) {
        return res.status(502).json({
            ok: false,
            error: 'Não foi possível obter cotação no momento. Tente novamente em instantes.',
            errors,
        });
    }

    // ordena do mais barato ao mais caro
    options.sort((a, b) => a.price - b.price);

    return res.json({ ok: true, options, ...(Object.keys(errors).length ? { errors } : {}) });
}

module.exports = { publicQuote };
