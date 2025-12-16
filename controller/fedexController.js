// backend/controller/fedexController.js
const axios = require('axios');
const { iso2Country, splitEndereco } = require('../services/cotacoesHelpers');
const { createShipment } = require('../services/fedex/shippingFedex');
const { trackNumbers } = require('../services/fedex/trackingFedex');
const Cotacao = require('../models/Cotacao');
// const { salvarEtiquetaNaStorage, salvarInvoiceNaStorage } = require('./CotacaoController');
const { quoteRates, loadPedidoImport } = require('../services/fedex/ratingFedex');
const db = require('../models');
// const { accountNumber } = require('../config/fedex');
// const { getToken, baseUrl } = require('../services/fedex/authFedex');
const { verClienteAtual, getClienteAtual } = require('./ClientesController');

// ========== HELPERS ==========
const onlyDigits = (s) => String(s || '').replace(/\D+/g, '');
const cleanZip = (s) =>
    String(s || '')
        .replace(/['"`\s]/g, '')
        .replace(/\D/g, '');

// FedEx: estamos usando LABEL em PDF
function labelTypeToMimeFedex(type) {
    const t = String(type || '').toUpperCase();
    if (t === 'PDF') return 'application/pdf';
    if (t === 'PNG') return 'image/png';
    return 'application/octet-stream';
}

function toYMDDate(d) {
    if (!d) return null;

    if (d instanceof Date) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    const s = String(d).trim();
    const m = s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    const dd = new Date(s);
    if (isNaN(dd.getTime())) return null;
    return toYMDDate(dd);
}

/**
 * Normaliza erro vindo da FedEx (rate / ship)
 */
function normalizeFedexError(err) {
    const status = err?.status || err?.response?.status || 500;
    const data = err?.upstream || err?.response?.data;

    const message =
        data?.errors?.[0]?.message ||
        data?.output?.alerts?.[0]?.message ||
        data?.error_description ||
        data?.error ||
        err?.message ||
        'Falha ao chamar FedEx';

    return { status, message, raw: data };
}

/**
 * Monta endereço simplificado para o serviço de rate FedEx
 * { countryCode, postalCode, city, stateOrProvinceCode }
 */
function mapToFedexRateAddress(raw = {}) {
    // Se vier no formato FedEx (com .address), usa ele
    const addr = raw.address || raw;

    const country =
        addr.enderecoPais ||
        addr.countryCode || // FedEx
        addr.country ||
        addr.pais ||
        '';

    return {
        countryCode: iso2Country(country) || '',
        postalCode: cleanZip(
            addr.postalCode || // FedEx
            addr.cep ||
            addr.enderecoCEP ||
            ''
        ),
        city: addr.city || addr.cidade || addr.enderecoCidade || undefined,
        stateOrProvinceCode:
            addr.stateOrProvinceCode || // FedEx
            addr.state ||
            addr.enderecoEstado ||
            undefined,
    };
}

/**
 * Monta packages para o serviço de rate FedEx
 * Espera packages: [{ weightKg, dimCm: {length,width,height} }]
 */
function mapToFedexRatePackages(packages = []) {
    if (!Array.isArray(packages) || !packages.length) {
        return [
            {
                weightKg: 1,
                dimCm: { length: 20, width: 10, height: 10 },
            },
        ];
    }

    return packages.map((p) => ({
        weightKg: p.weightKg ?? p.pesoKg ?? 1,
        dimCm: {
            length: p.dimCm?.length ?? p.length ?? 20,
            width: p.dimCm?.width ?? p.width ?? 10,
            height: p.dimCm?.height ?? p.height ?? 10,
        },
    }));
}

function ymdLocal(date = new Date()) {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return null;

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function safeStr(v, fallback = '') {
    if (v === null || v === undefined) return fallback;
    return String(v);
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

function extractShipArtifacts(data) {
    const output = data?.output || data;

    // tracking
    const txShipments = output?.transactionShipments || [];
    const firstTx = txShipments[0] || {};

    const trackingNumber =
        firstTx?.masterTrackingNumber ||
        firstTx?.pieceResponses?.[0]?.trackingNumber ||
        firstTx?.trackingNumber ||
        null;

    // label url(s)
    const docs = firstTx?.shipmentDocuments || [];
    const labelDocs = docs.filter(d => /LABEL/i.test(d?.contentType || d?.type || '') || /LABEL/i.test(d?.documentType || ''));
    const labelUrls = labelDocs.map(d => d?.url).filter(Boolean);

    // commercial invoice url(s)
    const ciDocs = docs.filter(d =>
        /COMMERCIAL/i.test(d?.contentType || '') ||
        /INVOICE/i.test(d?.contentType || '') ||
        /COMMERCIAL_INVOICE/i.test(d?.documentType || '')
    );
    const commercialInvoiceUrls = ciDocs.map(d => d?.url).filter(Boolean);

    return { trackingNumber, labelUrls, commercialInvoiceUrls };
}

function mapClienteToFedexShipper(cliente) {
    const line1 = [cliente.enderecoRua, cliente.enderecoNumero].filter(Boolean).join(', ');
    return {
        contact: {
            personName: cliente.razaoSocial || cliente.nomeFantasia || 'Shipper',
            companyName: cliente.razaoSocial || cliente.nomeFantasia || 'Shipper Company',
            phoneNumber: String(cliente.telefoneCelular || cliente.telefone || '11999999999'),
        },
        address: {
            streetLines: ['Rua Teste, 123'] /*[line1 || 'Rua Teste, 123'].filter(Boolean)*/,
            city: cliente.enderecoCidade || 'Sao Paulo',
            stateOrProvinceCode: (cliente.enderecoEstado || 'SP').toUpperCase(),
            postalCode: onlyDigits(cliente.enderecoCEP || '04795100'),
            countryCode: iso2Country(cliente.enderecoPais || 'BR') || 'BR',
        },
    };
}

function mapPedidoToFedexRecipient(pedido) {
    const dest = pedido?.endereco || pedido?.shipping_address || pedido?.shippingAddress || {};
    const ruaNum = splitEndereco(dest.rua || dest.address1 || pedido.endereco || '');

    const line1 = [ruaNum.rua, ruaNum.numero].filter(Boolean).join(', ') || dest.address1 || 'Test Street, 456';

    return {
        contact: {
            personName: dest.nome || dest.name || pedido.nomeComprador || 'Recipient',
            companyName: dest.empresa || dest.company || 'Recipient Company',
            phoneNumber: String(dest.telefone || dest.phone || pedido.telefoneComprador || '17865994231'),
            emailAddress: dest.email || pedido.emailComprador || undefined,
        },
        address: {
            streetLines: ["Test Street 318"] /*[line1].filter(Boolean)*/,
            city: dest.cidade || dest.city || pedido.cidade || 'Miami',
            stateOrProvinceCode: (dest.estado || dest.province || pedido.estado || 'FL').toUpperCase(),
            postalCode: onlyDigits(dest.cep || dest.zip || pedido.CEP || '33136'),
            countryCode: iso2Country(dest.pais || dest.countryCode || pedido.pais || 'US') || 'US',
            residential: Boolean(dest.residential ?? false),
        },
    };
}

function buildCommoditiesFromPedido(pedido, packages = []) {
    const currency = (pedido.moeda || 'USD').toUpperCase();

    // tenta usar peso total vindo dos packages e dividir proporcionalmente se não tiver pesoUnit
    const totalKgFromPackages = (Array.isArray(packages) ? packages : []).reduce((acc, p) => {
        const w = Number(p.weightKg ?? p.pesoKg ?? 0);
        return acc + (Number.isFinite(w) ? w : 0);
    }, 0);

    const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
    const totalQty = itens.reduce((acc, it) => acc + (Number(it.qty || 0) || 0), 0) || 1;

    const commodities = itens.map((it) => {
        const qty = Number(it.qty || 1) || 1;

        const unitPrice = Number(it.preco || 0) || 0;

        const lineTotal =
            Number(it.valorTotalLinha || 0) ||
            (unitPrice * qty);

        // peso por item: prioridade -> pesoUnit (se vier) -> rateio do total dos packages
        const pesoUnitKg = Number(it.pesoUnit || 0); // se você salvar em kg
        const weightKg =
            (pesoUnitKg > 0 ? pesoUnitKg * qty : 0) ||
            (totalKgFromPackages > 0 ? (totalKgFromPackages * (qty / totalQty)) : 1);

        return {
            description: (it.titulo || 'Item').slice(0, 450), // FedEx tem limites, corta por segurança
            countryOfManufacture: 'BR',
            quantity: qty,
            quantityUnits: 'PCS',

            // (opcional) HS code se tiver
            ...(it.hscode ? { harmonizedCode: String(it.hscode) } : {}),

            unitPrice: { amount: unitPrice, currency },
            customsValue: { amount: lineTotal, currency },
            weight: { units: 'KG', value: Number(weightKg.toFixed(3)) },
        };
    });

    return { commodities, currency };
}



async function buildFedexShipPayload({ shipper, recipient, packages = [], commodities = [], }) {
    const acct = process.env.FEDEX_ACCOUNT_NUMBER
    console.log("PEDIDO: ", recipient)
    console.log("CLIENTE: ", shipper)
    const requestedPackageLineItems = normalizePackagesForShip(packages);
    console.log("CAIXAS: ", requestedPackageLineItems)
    console.log("packs: ", packages)
    console.log("COMMODITIES: ", commodities)


    return {
        labelResponseOptions: 'URL_ONLY',
        // accountNumber: será injetado no service se não vier; aqui pode omitir

        requestedShipment: {
            shipper,
            // CLIENTE: {
            //     contact: {
            //         personName: 'Exporta-Digital',
            //         companyName: 'Exporta-Digital',
            //         phoneNumber: '48984848484'
            //     },
            //     address: {
            //         streetLines: ['Rua Teste, 123'],
            //         city: 'sao jose',
            //         stateOrProvinceCode: 'SC',
            //         postalCode: '88888888',
            //         countryCode: 'BR'
            //     }
            // }

            recipients: [recipient],
            // PEDIDO: {
            //     contact: {
            //         personName: 'Maria Garcia',
            //         companyName: 'Recipient Company',
            //         phoneNumber: '9173715659',
            //         emailAddress: '212marity@gmail.com'
            //     },
            //     address: {
            //         streetLines: ['414 Thomas S Boyland Street, Apt, 44'],
            //         city: 'Brooklyn',
            //         stateOrProvinceCode: 'NY',
            //         postalCode: '11233',
            //         countryCode: 'US',
            //         residential: false
            //     }
            // }

            shipDatestamp: toYMDDate(new Date()),
            serviceType: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
            packagingType: 'YOUR_PACKAGING',
            pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
            blockInsightVisibility: false,

            shippingChargesPayment: {
                paymentType: 'SENDER',
            },

            shipmentSpecialServices: {
                specialServiceTypes: [
                    "ELECTRONIC_TRADE_DOCUMENTS"
                ],
                etdDetail: {
                    requestedDocumentTypes: [
                        "COMMERCIAL_INVOICE"
                    ],
                    attributes: [
                        "POST_SHIPMENT_UPLOAD_REQUESTED"
                    ]
                }
            },

            labelSpecification: {
                imageType: 'PDF',
                labelStockType: 'PAPER_85X11_TOP_HALF_LABEL',
            },

            customsClearanceDetail: {
                dutiesPayment: {
                    paymentType: 'SENDER'
                },
                isDocumentOnly: false,
                commodities: (commodities || []).map((c) => ({
                    description: c.description || 'Item',
                    countryOfManufacture: iso2Country(c.countryOfManufacture || 'BR') || 'BR',
                    quantity: Number(c.quantity || 1),
                    quantityUnits: c.quantityUnits || 'PCS',
                    ...(c.harmonizedCode ? { harmonizedCode: String(c.harmonizedCode) } : {}),
                    unitPrice: {
                        amount: Number(c.unitPrice?.amount ?? 50),
                        currency: c.unitPrice?.currency || currency,
                    },
                    customsValue: {
                        amount: Number(c.customsValue?.amount ?? c.unitPrice?.amount ?? 50),
                        currency: c.customsValue?.currency || currency,
                    },
                    weight: {
                        units: 'KG',
                        value: Number(c.weight?.value ?? 1),
                    },
                })),
            },

            shippingDocumentSpecification: {
                shippingDocumentTypes: ['COMMERCIAL_INVOICE'],
                commercialInvoiceDetail: {
                    customerImageUsages: [
                        {
                            id: "IMAGE_1",
                            type: "LETTER_HEAD",
                            providedImageType: "LETTER_HEAD"
                        },
                        {
                            id: "IMAGE_2",
                            type: "SIGNATURE",
                            providedImageType: "SIGNATURE"
                        }
                    ],
                    documentFormat: {
                        stockType: "PAPER_LETTER",
                        docType: "PDF"
                    }
                }
            },

            requestedPackageLineItems,
        },
        accountNumber: {
            value: acct
        }
    };
}

/**
 * Extrai tracking, labelUrl e invoiceUrl do retorno da FedEx Ship
 * Estrutura é meio variável, então fazemos defensivo.
 */
function extractFedexShipmentDocs(data = {}) {
    const out = data.output || data;

    const txShipments = out.transactionShipments || out.transactionShipment || [];
    const shipmentsArr = Array.isArray(txShipments) ? txShipments : [txShipments];

    const shipment = shipmentsArr[0] || {};

    const trackingNumbers = [];
    if (shipment.masterTrackingNumber?.trackingNumber) {
        trackingNumbers.push(shipment.masterTrackingNumber.trackingNumber);
    }
    if (Array.isArray(shipment.pieceResponses)) {
        for (const p of shipment.pieceResponses) {
            if (p.trackingNumber) trackingNumbers.push(p.trackingNumber);
        }
    }

    let labelUrl = null;
    let labelType = 'PDF';

    if (Array.isArray(shipment.pieceResponses)) {
        for (const p of shipment.pieceResponses) {
            const docs = p.packageDocuments || p.packageDocument || [];
            const arrDocs = Array.isArray(docs) ? docs : [docs];
            for (const d of arrDocs) {
                const t = (d.type || d.docType || '').toUpperCase();
                if (t.includes('LABEL')) {
                    if (d.url) {
                        labelUrl = d.url;
                        labelType = d.imageType || d.imageFormat || 'PDF';
                        break;
                    }
                }
            }
            if (labelUrl) break;
        }
    }

    let invoiceUrl = null;
    if (Array.isArray(shipment.shipmentDocuments)) {
        for (const d of shipment.shipmentDocuments) {
            const t = (d.type || d.docType || '').toUpperCase();
            if (t.includes('COMMERCIAL_INVOICE') || t.includes('INVOICE')) {
                if (d.url) {
                    invoiceUrl = d.url;
                    break;
                }
            }
        }
    }

    // fallback ultra-defensivo
    if (!labelUrl && out.labelUrl) labelUrl = out.labelUrl;
    if (!invoiceUrl && out.invoiceUrl) invoiceUrl = out.invoiceUrl;

    return {
        trackingNumbers: [...new Set(trackingNumbers)],
        labelUrl,
        labelType,
        invoiceUrl,
    };
}

/**
 * Faz download de um URL (FedEx) e devolve base64
 */
async function fetchUrlAsBase64(url) {
    if (!url) return null;
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const buf = Buffer.from(resp.data);
    return buf.toString('base64');
}

// ========== CONTROLLER ==========

module.exports = {
    // ---------- RATE ----------
    rate: async (req, res) => {
        try {
            const body = req.body || {};

            // exemplo: cliente_id vindo do token ou do body
            const clienteId = body.clienteId || req.user?.clienteId;
            const pedidoId = body.pedidoId;              // vem do front (pedido selecionado)

            let shipper;
            let recipient;
            let packages;

            // ========= CASO 1: payload nativo FedEx (igual o do Postman) =========
            if (body.requestedShipment) {
                const rs = body.requestedShipment;

                // shipper / recipient no formato FedEx
                shipper = mapToFedexRateAddress(rs.shipper || {});
                recipient = mapToFedexRateAddress(rs.recipient || rs.shipTo || {});

                // converte requestedPackageLineItems -> formato "biz" para mapToFedexRatePackages
                const pkgsRaw = rs.requestedPackageLineItems || [];
                const pkgsBiz = pkgsRaw.map((p) => ({
                    weightKg: p.weight?.value,
                    dimCm: {
                        length: p.dimensions?.length,
                        width: p.dimensions?.width,
                        height: p.dimensions?.height,
                    },
                }));

                packages = mapToFedexRatePackages(pkgsBiz);
            } else {
                // ========= CASO 2: payload "de negócio" (shipper/shipTo/packages) =========
                let shipperRaw = body.shipper || {};
                if (clienteId && !body.shipper) {
                    const cliente = await db.Cliente.findByPk(clienteId);
                    if (cliente) {
                        shipperRaw = cliente.toJSON(); // aqui tem enderecoPais, enderecoCEP, etc.
                    }
                }

                shipper = mapToFedexRateAddress(shipperRaw);
                recipient = mapToFedexRateAddress(body.shipTo || body.recipient || {});
                packages = mapToFedexRatePackages(body.packages || []);
            }

            console.log('[FEDEX/RATE] shipper, recipient, packages:', shipper, '>>>>>>>>RECIPIENT: ', recipient);

            if (!shipper.postalCode || !recipient.postalCode) {
                return res.status(400).json({
                    ok: false,
                    error: 'Cadastro/pedido sem CEP/ZIP para FedEx.',
                    debug: { shipper, recipient },
                });
            }

            const rate_payload = await quoteRates({ shipper, recipient, packages, pedidoId, clienteId });

            const details = rate_payload.rows || [];
            const services = details.map((r) => ({
                serviceType: r.serviceType,
                carrier: r.carrier || 'FEDEX',
                currency: r.currency || 'USD',
                base: r.base || 0,
                itemized: r.itemized || [],
            }));

            return res.json({
                ok: true,
                services,
                raw: rate_payload.raw,
            });
        } catch (err) {
            console.error('[FEDEX/RATE][ERR]', err);
            const { status, message, raw } = normalizeFedexError(err);
            return res.status(status).json({ ok: false, error: message, raw });
        }
    },
    // ---------- SHIP ----------
    ship: async (req, res) => {
        try {
            const cliente = await getClienteAtual(req, res);
            const { pedidoId, packages } = req.body || {};

            if (!pedidoId) return res.status(400).json({ ok: false, error: 'pedidoId é obrigatório.' });
            if (!Array.isArray(packages) || !packages.length) {
                return res.status(400).json({ ok: false, error: 'packages é obrigatório.' });
            }

            const pedido = await loadPedidoImport(pedidoId, cliente.id);
            if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido não encontrado.' });

            const { commodities, currency } = buildCommoditiesFromPedido(pedido, packages);


            const shipper = mapClienteToFedexShipper(cliente);
            const recipient = mapPedidoToFedexRecipient(pedido);

            const payload = await buildFedexShipPayload({
                shipper,
                recipient,
                packages,
                commodities,
                currency
            });

            const data = await createShipment(payload);

            return res.json({ ok: true, raw: data });
        } catch (err) {
            return res.status(err.status || 500).json({
                ok: false,
                error: err.message || 'Falha no ship FedEx',
                raw: err.upstream || null,
            });
        }
    },

    // ---------- TRACK ----------
    track: async (req, res) => {
        try {
            const raw =
                (req.params && req.params.tracking) ||
                (req.query && (req.query.tn || req.query.tracking)) ||
                '';
            const tn = String(raw).trim().replace(/['"`\s]/g, '').toUpperCase();
            if (!tn) return res.status(400).json({ ok: false, error: 'Tracking vazio.' });

            const data = await trackNumbers([tn]);
            return res.json({ ok: true, raw: data });
        } catch (err) {
            console.error('[FEDEX/TRACK][ERR]', err);
            const { status, message, raw } = normalizeFedexError(err);
            return res.status(status).json({ ok: false, error: message, raw });
        }
    },
};
