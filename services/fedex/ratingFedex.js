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

async function loadPedidoImport(pedidoId, clienteId) {
    if (!pedidoId) return null;

    // garante multi-tenant
    const row = await db.PedidoImport.findOne({
        where: { id: pedidoId, cliente_id: clienteId },
        attributes: ['id', 'cliente_id', 'moeda', 'total', 'itens'],
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


/**
 * shipper/destination:
 * { countryCode, postalCode, city, stateOrProvinceCode }
 * packages: [{ weightKg, dimCm: {length,width,height} }]
*/
async function quoteRates({ shipper, recipient, packages, pedidoId, clienteId }) {
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
    
    const pedido = await loadPedidoImport(pedidoId, clienteId);
    if (!pedido) {
        const e = new Error('Pedido não encontrado para montar commodities (pedidoId inválido).');
        e.http = 400;
        throw e;
    }

    const { commodities, currency } = buildCommoditiesFromPedido(pedido, packages);
    // console.log(">><< pedido: ", pedido);
    // console.log(">><< commodities: ", commodities);
    // console.log(">><< currency: ", currency);

    // console.log(">><<: ", shipper)
    // console.log(">><<: ", recipient)
    // console.log(">><<: ", packages)

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
            shipper: {
                address: {
                    streetLines: [
                        "Rua Teste, 123" //COLOCAR A RUA REAL, VAMOS DEIXAR ASSIM PARA NAO SOLICITAR DADOS REAIS AQUI
                    ],
                    postalCode: shipper.postalCode,
                    countryCode: shipper.countryCode,
                    stateOrProvinceCode: shipper.stateOrProvinceCode,
                    city: shipper.city,
                },
            },

            recipient: {
                address: {
                    streetLines: [
                        "Test Street, 456"
                    ],
                    postalCode: recipient.postalCode,
                    countryCode: recipient.countryCode,
                    stateOrProvinceCode: recipient.stateOrProvinceCode,
                    city: recipient.city,
                    residential: false,
                },
            },

            preferredCurrency: "USD",
            rateRequestType: [
                "LIST",
                "ACCOUNT"
            ],

            shipDateStamp: ymdLocal(),
            pickupType: "DROPOFF_AT_FEDEX_LOCATION",
            packagingType: "YOUR_PACKAGING",
            shippingChargesPayment: {
                paymentType: "SENDER",
                payor: {
                    responsibleParty: {
                        accountNumber: {
                            value: acct
                        }
                    }
                }
            },
            customsClearanceDetail: {
                dutiesPayment: {
                    paymentType: "SENDER",
                    payor: {
                        responsibleParty: {
                            accountNumber: {
                                value: acct
                            }
                        }
                    }
                },
                commodities: [
                    {
                        description: "Sample Product",
                        weight: {
                            units: "KG",
                            value: "5" // peso total da mercadoria
                        },
                        quantity: 1,
                        customsValue: {
                            amount: "100", //temos que pegar do pedido, ver como faz na UPS
                            currency: "USD"
                        },
                        countryOfManufacture: "BR",
                        // unitPrice: {
                        //     amount: "100",
                        //     currency: "USD"
                        // },
                        // numberOfPieces: 1,
                        // quantityUnits: "PCS",
                        // name: "Sample Product"
                    }
                ]
            },
            requestedPackageLineItems,
            totalPackageCount: 1
        },
        carrierCodes: [
            "FDXE"
        ]
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
