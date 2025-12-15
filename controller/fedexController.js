// backend/controller/fedexController.js
const axios = require('axios');
const { iso2Country } = require('../services/cotacoesHelpers');
const { createShipment } = require('../services/fedex/shippingFedex');
const { trackNumbers } = require('../services/fedex/trackingFedex');
const Cotacao = require('../models/Cotacao');
const { salvarEtiquetaNaStorage, salvarInvoiceNaStorage } = require('./CotacaoController');
const { quoteRates } = require('../services/fedex/ratingFedex');
const db = require('../models');

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

/**
 * Traduz body "de negócio" para payload FedEx Ship (REST)
 *
 * Espera algo como:
 * {
 *   shipper: {...},
 *   recipient: {...},
 *   packages: [...],
 *   customs: {...},
 *   serviceType,
 *   shipDatestamp,
 *   pickupType,
 *   paymentType,
 *   dutiesPaymentType
 * }
 */
function buildFedexShipPayload(biz = {}) {
    const {
        shipper = {},
        recipient = {},
        packages = [],
        customs = {},
        serviceType,
        shipDatestamp,
        pickupType,
        paymentType,
        dutiesPaymentType,
    } = biz;

    const firstPkg = packages[0] || {};
    const weightKg = firstPkg.weightKg ?? firstPkg.pesoKg ?? 1;
    const dim = {
        length: firstPkg.length ?? firstPkg.lengthCm ?? firstPkg.dimCm?.length ?? 20,
        width: firstPkg.width ?? firstPkg.widthCm ?? firstPkg.dimCm?.width ?? 10,
        height: firstPkg.height ?? firstPkg.heightCm ?? firstPkg.dimCm?.height ?? 10,
    };

    const currency = customs.currency || 'USD';
    const unitAmount = customs.unitPrice ?? customs.customsValue ?? 50;

    const shipperCountry = iso2Country(shipper.countryCode || shipper.pais || 'BR') || 'BR';
    const recipientCountry = iso2Country(recipient.countryCode || recipient.pais || 'US') || 'US';
    const countryOfManufacture = iso2Country(
        customs.countryOfManufacture || shipper.countryCode || shipper.pais || 'BR'
    ) || 'BR';

    // console.log('shipper =>', shipper);
    // console.log('recipient =>', recipient);
    // console.log('packages =>', packages);


    return {
        labelResponseOptions: 'URL_ONLY',
        // accountNumber: será injetado no service se não vier; aqui pode omitir

        requestedShipment: {
            shipper: {
                contact: {
                    personName: 'Shipper',
                    phoneNumber: '1234567890',
                    companyName: 'Shipper Company',
                },
                address: {
                    streetLines: 'Rua Teste 123',
                    city: 'Sao Paulo',
                    stateOrProvinceCode: 'SP',
                    postalCode: '04795100',
                    countryCode: shipperCountry,
                },
            },

            recipients: [
                {
                    contact: {
                        personName: 'Recipient',
                        phoneNumber: '1234567890',
                        companyName: 'Recipient Company',
                    },
                    address: {
                        streetLines: 'Street Line 1',
                        city: 'Miami',
                        stateOrProvinceCode: 'FL',
                        postalCode: '33136',
                        countryCode: recipientCountry,
                    },
                },
            ],

            shipDatestamp: toYMDDate(shipDatestamp) || toYMDDate(new Date()),
            serviceType: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
            packagingType: 'YOUR_PACKAGING',
            pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
            blockInsightVisibility: false,

            shippingChargesPayment: {
                paymentType: 'SENDER',
            },

            labelSpecification: {
                imageType: 'PDF',
                labelStockType: 'PAPER_85X11_TOP_HALF_LABEL',
            },

            customsClearanceDetail: {
                dutiesPayment: 'SENDER',
                isDocumentOnly: false,
                commodities: [
                    {
                        description: 'Commodity',
                        countryOfManufacture,
                        quantity: 1,
                        quantityUnits: 'PCS',
                        unitPrice: {
                            amount: unitAmount,
                            currency,
                        },
                        customsValue: {
                            amount: unitAmount,
                            currency,
                        },
                        weight: {
                            units: 'KG',
                            value: weightKg,
                        },
                    },
                ],
            },

            shippingDocumentSpecification: {
                shippingDocumentTypes: ['COMMERCIAL_INVOICE'],
                commercialInvoiceDetail: {
                    documentFormat: {
                        stockType: 'PAPER_LETTER',
                        docType: 'PDF',
                    },
                },
            },

            requestedPackageLineItems: [
                {
                    weight: { units: 'KG', value: weightKg },
                    dimensions: {
                        length: dim.length,
                        width: dim.width,
                        height: dim.height,
                        units: 'CM',
                    },
                },
            ],
        },
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
        const t0 = Date.now();
        let cotacaoId = null;

        try {
            const body = req.body || {};
            cotacaoId = body.cotacaoId || req.query?.cotacaoId || null;
            console.log('[FEDEX/SHIP] body:', body);

            // body vem no formato "negócio"
            const fedexPayload = body?.requestedShipment
                ? body // já está no formato FedEx
                : buildFedexShipPayload(body);

            const idem = req.headers['x-idempotency-key'] || `fedex-${Date.now()}`;
            const fedexResp = await createShipment(fedexPayload, { idempotencyKey: idem });

            const docs = extractFedexShipmentDocs(fedexResp);

            // -------- salvar na tabela Cotacao, se cotacaoId vier --------
            if (cotacaoId) {
                try {
                    const row = await Cotacao.findByPk(cotacaoId);
                    if (!row) {
                        console.warn('[FEDEX/SHIP] Cotação não encontrada para salvar anexos:', cotacaoId);
                    } else {
                        const patch = {};

                        // tracking
                        if (Array.isArray(docs.trackingNumbers) && docs.trackingNumbers[0]) {
                            patch.tracking_number = docs.trackingNumbers[0];
                        }

                        if (Object.keys(patch).length) {
                            await row.update(patch);
                        }

                        // LABEL (PDF) -> Storage (se conseguir baixar)
                        if (docs.labelUrl) {
                            try {
                                const b64 = await fetchUrlAsBase64(docs.labelUrl);
                                if (b64) {
                                    const mime = labelTypeToMimeFedex(docs.labelType || 'PDF');
                                    console.log('[FEDEX/SHIP] salvando etiqueta no Storage', {
                                        cotacaoId: row.id,
                                        mime,
                                    });
                                    await salvarEtiquetaNaStorage(row.id, b64, mime);
                                }
                            } catch (e) {
                                console.error(
                                    '[FEDEX/SHIP] Falha ao baixar/salvar label FedEx, seguindo sem impedir resposta.',
                                    e?.message
                                );
                            }
                        }

                        // INVOICE (PDF) -> Storage
                        if (docs.invoiceUrl) {
                            try {
                                const b64 = await fetchUrlAsBase64(docs.invoiceUrl);
                                if (b64) {
                                    const mime = 'application/pdf';
                                    console.log('[FEDEX/SHIP] salvando invoice no Storage', {
                                        cotacaoId: row.id,
                                        mime,
                                    });
                                    await salvarInvoiceNaStorage(row.id, b64, mime);
                                }
                            } catch (e) {
                                console.error(
                                    '[FEDEX/SHIP] Falha ao baixar/salvar invoice FedEx, seguindo sem impedir resposta.',
                                    e?.message
                                );
                            }
                        }
                    }
                } catch (errSave) {
                    console.error('[FEDEX/SHIP] Falha ao salvar tracking/label/invoice na Cotacao', {
                        cotacaoId,
                        err: errSave?.message,
                    });
                }
            }

            return res.status(200).json({
                ok: true,
                trackingNumbers: docs.trackingNumbers,
                labelUrl: docs.labelUrl,
                invoiceUrl: docs.invoiceUrl,
                raw: fedexResp,
                tookMs: Date.now() - t0,
            });
        } catch (err) {
            console.error('[FEDEX/SHIP][ERR]', err);
            const { status, message, raw } = normalizeFedexError(err);
            return res.status(status).json({
                ok: false,
                error: message,
                raw,
                tookMs: Date.now() - t0,
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
