// services/fedex/edtFedex.js
// Consulta de Estimated Duties & Taxes (EDT) da FedEx: mesma chamada de rate,
// mas com edtRequestType: "ALL". Usado pela feature de cobrança antecipada de
// impostos. Não altera o fluxo de cotação/frete existente.

const { createHttp } = require('../../utils/https');
const { getToken, baseUrl } = require('./authFedex');

const http = createHttp(20000, 'fedex');

function ymdLocal(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function normalizePackages(packages = []) {
    const pkgs = Array.isArray(packages) ? packages : [];
    if (!pkgs.length) {
        return [{
            groupPackageCount: 1,
            weight: { units: 'KG', value: 1 },
            dimensions: { length: 20, width: 10, height: 10, units: 'CM' },
        }];
    }
    return pkgs.map((p, idx) => {
        const weightKg = Number(p.weightKg ?? p.pesoKg ?? p.weight?.value ?? 1) || 1;
        const length = Number(p.length ?? p.lengthCm ?? p.dimCm?.length ?? 20) || 20;
        const width = Number(p.width ?? p.widthCm ?? p.dimCm?.width ?? 10) || 10;
        const height = Number(p.height ?? p.heightCm ?? p.dimCm?.height ?? 10) || 10;
        return {
            sequenceNumber: idx + 1,
            groupPackageCount: 1,
            weight: { units: 'KG', value: weightKg },
            dimensions: { length, width, height, units: 'CM' },
        };
    });
}

/**
 * Faz a chamada de rate com EDT. Retorna o JSON bruto da FedEx.
 * @param {{ shipper:any, recipient:any, packages:any[], commodities:any[], currency?:string }} args
 */
async function cotarEdt({ shipper, recipient, packages, commodities, currency = 'USD' }) {
    const token = await getToken();
    const acct = String(process.env.FEDEX_ACCOUNT_NUMBER || '');
    const url = `${baseUrl()}/rate/v1/rates/quotes`;

    const requestedPackageLineItems = normalizePackages(packages);

    const body = {
        accountNumber: { value: acct },
        rateRequestControlParameters: {
            returnTransitTimes: false,
            servicesNeededOnRateFailure: true,
        },
        requestedShipment: {
            shipper,
            recipient,
            preferredCurrency: 'USD',
            rateRequestType: ['ACCOUNT'],
            edtRequestType: 'ALL',
            shipDateStamp: ymdLocal(),
            pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
            packagingType: 'YOUR_PACKAGING',
            shippingChargesPayment: {
                paymentType: 'SENDER',
                payor: { responsibleParty: { accountNumber: { value: acct } } },
            },
            customsClearanceDetail: {
                dutiesPayment: {
                    paymentType: 'SENDER',
                    payor: { responsibleParty: { accountNumber: { value: acct } } },
                },
                commodities: (commodities || []).map((c) => ({
                    description: c.description || 'Item',
                    countryOfManufacture: c.countryOfManufacture || 'BR',
                    quantity: Number(c.quantity || 1) || 1,
                    quantityUnits: c.quantityUnits || 'PCS',
                    ...(c.harmonizedCode ? { harmonizedCode: String(c.harmonizedCode) } : {}),
                    unitPrice: {
                        amount: Number(c.unitPrice?.amount ?? c.customsValue?.amount ?? 1) || 1,
                        currency: c.unitPrice?.currency || c.customsValue?.currency || currency || 'USD',
                    },
                    customsValue: {
                        amount: Number(c.customsValue?.amount ?? c.unitPrice?.amount ?? 1) || 1,
                        currency: c.customsValue?.currency || currency || 'USD',
                    },
                    weight: {
                        units: 'KG',
                        value: Number(c.weight?.value || 0.1) || 0.1,
                    },
                })),
            },
            requestedPackageLineItems,
            totalPackageCount: requestedPackageLineItems.length || 1,
        },
        carrierCodes: ['FDXE'],
    };

    const { data } = await http.post(url, body, {
        headers: {
            Authorization: `Bearer ${token}`,
            'x-customer-transaction-id': `intrex-edt-${Date.now()}`,
            'Content-Type': 'application/json',
        },
    });

    return { raw: data, request: body };
}

function num(v) {
    const n = Number(v && typeof v === 'object' ? (v.amount ?? v.value ?? v) : v);
    return Number.isFinite(n) ? n : null;
}

function pushItems(arr, list, tipo) {
    if (!Array.isArray(list)) return;
    for (const it of list) {
        const valor = num(it?.amount ?? it?.netCharge ?? it?.value);
        if (valor == null) continue;
        arr.push({
            tipo,
            descricao: it?.description || it?.type || it?.name || tipo,
            valor,
            moeda: it?.amount?.currency || it?.currency || 'USD',
        });
    }
}

/**
 * Extrai imposto + taxas estimados da resposta EDT.
 * Shape da FedEx varia por rota/versão — parser defensivo, sempre guarda o raw.
 * @param {{ raw:any, request?:any }} resp
 */
function parseEdt(resp) {
    const raw = resp?.raw ?? resp;
    const empty = {
        currency: 'USD', duties: 0, taxes: 0, fees: 0, total: 0,
        breakdown: [], is_estimate: true, raw_response: raw, raw_request: resp?.request ?? null,
    };
    try {
        const details = raw?.output?.rateReplyDetails || raw?.rateReplyDetails || [];
        if (!Array.isArray(details) || !details.length) return empty;

        const svc =
            details.find((d) => d?.serviceType === 'FEDEX_INTERNATIONAL_CONNECT_PLUS') ||
            details[0];
        const rsds = Array.isArray(svc?.ratedShipmentDetails) ? svc.ratedShipmentDetails : [];

        let best = null;
        for (const rsd of rsds) {
            const srd = rsd?.shipmentRateDetail || rsd || {};
            const breakdown = [];

            pushItems(breakdown, srd?.dutiesAndTaxes?.duties || srd?.duties, 'DUTY');
            pushItems(breakdown, srd?.dutiesAndTaxes?.taxes || srd?.taxes, 'TAX');
            pushItems(breakdown, srd?.ancillaryFeesAndTaxes, 'FEE');

            const sumBy = (t) => breakdown.filter((b) => b.tipo === t).reduce((a, b) => a + b.valor, 0);
            const duties = sumBy('DUTY');
            const taxes = sumBy('TAX');
            const fees = sumBy('FEE');
            const breakdownSum = breakdown.reduce((a, b) => a + b.valor, 0);

            const total =
                num(srd?.totalDutiesTaxesAndFees) ??
                num(srd?.totalDutiesAndTaxes) ??
                num(srd?.dutiesAndTaxes?.totalDutiesAndTaxes) ??
                num(srd?.dutiesAndTaxes) ??
                (breakdown.length ? breakdownSum : null);

            const currency =
                srd?.totalDutiesTaxesAndFees?.currency ||
                srd?.totalDutiesAndTaxes?.currency ||
                srd?.dutiesAndTaxes?.currency ||
                srd?.currency ||
                'USD';

            const candidate = {
                currency,
                duties: Number(duties || 0),
                taxes: Number(taxes || 0),
                fees: Number(fees || 0),
                total: Number(total || 0),
                breakdown,
                is_estimate: true,
                raw_response: raw,
                raw_request: resp?.request ?? null,
            };
            if (!best || candidate.total > best.total) best = candidate;
        }

        return best || empty;
    } catch (e) {
        console.error('[FEDEX/EDT][PARSE][ERR]', e?.message);
        return empty;
    }
}

module.exports = { cotarEdt, parseEdt };
