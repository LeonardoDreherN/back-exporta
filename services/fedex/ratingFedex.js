// services/fedex/rates.js
const axios = require('axios');
const { getToken, baseUrl } = require('./authFedex');
const db = require('../../models');

// helpers de unidade
const kgToLb = kg => +(kg * 2.2046226218).toFixed(3);
const cmToIn = cm => +(cm * 0.3937007874).toFixed(2);

function accountNumberObj() {
    return { value: process.env.FEDEX_ACCOUNT_NUMBER };
}

async function loadPedidoImport(pedido_ref, clienteId) {
    const ref = String(pedido_ref || "").trim()
    if (!ref) return null;

    // garante multi-tenant
    const row = await db.PedidoImport.findOne({
        where: { pedido_ref: ref, cliente_id: clienteId },
        // attributes: ['id', 'cliente_id', 'moeda', 'total', 'itens'],
    });

    return row ? row.toJSON() : null;
}

function buildCommoditiesFromPedido(pedido, packages) {
    const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
    const currency = (pedido?.moeda || 'USD').toString().trim() || 'USD';

    const totalValue =
        Number(pedido?.total || 0) ||
        itens.reduce((acc, it) => acc + (Number(it.valorTotalLinha || 0) || (Number(it.preco || 0) * Number(it.qty || 0) || 0)), 0) ||
        1;

    const totalQty =
        itens.reduce((acc, it) => acc + (Number(it.qty || 0) || 0), 0) || 1;

    // peso total: soma pesoUnit(kg)*qty, se tiver; senão soma packages.weightKg
    const weightFromItemsKg = itens.reduce((acc, it) => {
        const q = Number(it.qty || 1) || 1;
        const w = Number(it.pesoUnit || 0) || 0; // kg
        return acc + (w * q);
    }, 0);

    const weightFromPackagesKg = Array.isArray(packages)
        ? packages.reduce((acc, p) => acc + (Number(p.weightKg || 0) || 0), 0)
        : 0;

    const totalWeightKg = (weightFromItemsKg || weightFromPackagesKg || 1);

    const desc =
        (itens[0]?.descricao || itens[0]?.titulo || 'Merchandise').toString().slice(0, 60);

    return {
        commodities: [{
            description: desc,
            weight: { units: 'KG', value: Number(totalWeightKg).toFixed(3) },
            quantity: totalQty,
            quantityUnits: 'PCS',
            customsValue: { amount: Number(totalValue).toFixed(2), currency },
            countryOfManufacture: 'BR',
        }],
        currency,
    };
}

function normalizePackagesForShip(packages = []) {
    const pkgs = Array.isArray(packages) ? packages : [];
    if (!pkgs.length) {
        return [{
            weight: { units: 'KG', value: 1 },
            dimensions: { length: 20, width: 10, height: 10, units: 'CM' }
        }];
    }

    return pkgs.map((p, idx) => {
        const weightKg = Number(p.weightKg ?? p.pesoKg ?? 1) || 1;

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
 * shipper/destination:
 * { countryCode, postalCode, city, stateOrProvinceCode }
 * packages: [{ weightKg, dimCm: {length,width,height} }]
*/
async function quoteRates({ shipper, recipient, packages, commodities, currency }) {
    const token = await getToken();
    const url = `${baseUrl()}/rate/v1/rates/quotes`;
    function ymdLocal(date = new Date()) {
        const d = (date instanceof Date) ? date : new Date(date);
        if (isNaN(d.getTime())) return null;

        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    const requestedPackageLineItems = normalizePackagesForShip(packages);

    const acct = String(accountNumberObj().value);

    const body = {
        accountNumber: { value: acct },
        rateRequestControlParameters: {
            returnTransitTimes: true,
            servicesNeededOnRateFailure: true,
            variableOptions: "FREIGHT_GUARANTEE",
            rateSortOrder: "SERVICENAMETRADITIONAL"
        },
        requestedShipment: {
            shipper,     // mesmo formato que você usa no SHIP (contact + address)
            recipient,   // idem

            preferredCurrency: "USD",
            rateRequestType: ["LIST", "ACCOUNT"],

            shipDateStamp: ymdLocal(),
            pickupType: "DROPOFF_AT_FEDEX_LOCATION",
            packagingType: "YOUR_PACKAGING",

            shippingChargesPayment: {
                paymentType: "SENDER",
                payor: { responsibleParty: { accountNumber: { value: acct } } }
            },

            customsClearanceDetail: {
                dutiesPayment: {
                    paymentType: "SENDER",
                    payor: { responsibleParty: { accountNumber: { value: acct } } }
                },
                commodities: (commodities || []).map((c) => ({
                    description: c.description || 'Item',
                    countryOfManufacture: 'BR',
                    quantity: Number(c.quantity || 1),
                    quantityUnits: c.quantityUnits || 'PCS',
                    ...(c.harmonizedCode ? { harmonizedCode: String(c.harmonizedCode) } : {}),
                    unitPrice: {
                        amount: Number(c.unitPrice?.amount ?? 50),
                        currency: c.unitPrice?.currency || currency || 'USD',
                    },
                    customsValue: {
                        amount: Number(c.customsValue?.amount ?? c.unitPrice?.amount ?? 50),
                        currency: c.customsValue?.currency || currency || 'USD',
                    },
                    weight: { units: 'KG', value: Number(c.weight?.value || 0.1) },
                })),
            },

            requestedPackageLineItems,
            totalPackageCount: requestedPackageLineItems.length || 1,
        },
        carrierCodes: ["FDXE"]
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
        const serviceType = 'FEDEX_INTERNATIONAL_CONNECT_PLUS';
        // tente pegar o primeiro cenário de preço calculado
        const rds = Array.isArray(svc?.ratedShipmentDetails) ? svc.ratedShipmentDetails : [];
        const rated = rds.find(r => r.rateType === 'ACCOUNT') || rds[0] || null;

        const pkg = rated?.ratedPackages?.[0]?.packageRateDetail || {};

        const toNum = (v) => {
            const n = Number(v?.amount ?? v);
            return Number.isFinite(n) ? n : null;
        };
        const sumSurcharges = (arr) =>
            Array.isArray(arr)
                ? arr.reduce((acc, s) => acc + (toNum(s?.amount) ?? 0), 0)
                : null;

        // comentario informal: esses campos mudam de nome na resposta, entao pegamos varios jeitos
        const surBRL =
            toNum(rated?.shipmentRateDetail?.totalSurcharges) ??
            sumSurcharges(rated?.shipmentRateDetail?.surcharges) ??
            sumSurcharges(rated?.shipmentRateDetail?.surCharges) ??
            toNum(pkg?.totalSurcharges) ??
            0;

        const totalBRL =
            toNum(pkg?.totalNetCharge) ??
            toNum(pkg?.netCharge) ??
            toNum(rated?.shipmentRateDetail?.totalNetCharge) ??
            toNum(rated?.totalNetCharge) ??
            toNum(rated?.totalNetFedExCharge) ??
            null;

        const freightBRL = Number.isFinite(totalBRL)
            ? totalBRL - surBRL
            : (toNum(pkg?.netFreight) ?? toNum(pkg?.baseCharge) ?? 0);

        const carrierCurrency = String(pkg?.currency || rated?.currency || 'BRL').toUpperCase();

        // taxa de câmbio que vem na resposta
        const fx = Number(rated?.shipmentRateDetail?.currencyExchangeRate?.rate);

        // fallback seguro: se não veio fx, não converte
        const rate = (Number.isFinite(fx) && fx > 0) ? fx : 1;

        const toUSD = (v) => {
            if (!Number.isFinite(v)) return 0;
            if (carrierCurrency === 'BRL') return v / rate; // BRL -> USD
            return v; // já veio USD
        };

        out.push({
            carrier: 'FEDEX',
            serviceType,
            currency: 'USD',
            base: Number(toUSD(freightBRL).toFixed(2)),
            total: Number(toUSD(totalBRL).toFixed(2)),
            itemized: [{
                code: 'FEDEX-SUR',
                amount: Number(toUSD(surBRL).toFixed(2)),
                label: 'FedEx surcharges (consolidado)',
            }],
            fx_used: carrierCurrency === 'BRL' ? rate : null,
            carrier_currency: carrierCurrency,
            raw: svc,
        });
    }
    const onlyIcp = out.filter(r => r.serviceType === 'FEDEX_INTERNATIONAL_CONNECT_PLUS');
    return { raw: data, rows: onlyIcp.length ? onlyIcp : out };
}

module.exports = {
    quoteRates,
    loadPedidoImport
};
