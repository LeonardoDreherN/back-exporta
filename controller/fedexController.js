// backend/controller/fedexController.js
const axios = require('axios');
const { iso2Country, splitEndereco } = require('../services/cotacoesHelpers');
const { createShipment } = require('../services/fedex/shippingFedex');
// const Cotacao = require('../models/Cotacao');
// const { salvarEtiquetaNaStorage, salvarInvoiceNaStorage } = require('./CotacaoController');
const { quoteRates, loadPedidoImport } = require('../services/fedex/ratingFedex');
const { extractFedexBreakdown } = require('../services/fedex/cotacaoFedex');
const db = require('../models');
// const { accountNumber } = require('../config/fedex');
// const { getToken, baseUrl } = require('../services/fedex/authFedex');
const { getClienteAtual } = require('./ClientesController');
const tracking = require('../services/fedex/trackingFedex');
const { accountNumber } = require('../config/fedex');
const { createPickup } = require('../services/fedex/pickupFedex');

// ========== HELPERS ==========
const onlyDigits = (s) => String(s || '').replace(/\D+/g, '');
const cleanZip = (s) =>
    String(s || '')
        .replace(/['"`\s]/g, '')
        .replace(/\D/g, '');

const FEDEX_STREETLINE_MAX = 35;
const FEDEX_STREETLINES_MAX_LINES = 3;

function normalizeSpaces(s) {
    return String(s || '')
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .trim();
}

function splitByWordsMaxLen(text, maxLen) {
    const t = normalizeSpaces(text);
    if (!t) return [];
    const words = t.split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
        if (!cur) { cur = w; continue; }
        if ((cur + ' ' + w).length <= maxLen) cur = cur + ' ' + w;
        else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);

    // fallback: se algum pedaÃ§o ainda passar, corta bruto
    return out.flatMap((ln) => {
        if (ln.length <= maxLen) return [ln];
        const parts = [];
        for (let i = 0; i < ln.length; i += maxLen) parts.push(ln.slice(i, i + maxLen));
        return parts;
    });
}

function buildFedexStreetLines(...lines) {
    const raw = lines.map(normalizeSpaces).filter(Boolean);
    const expanded = raw.flatMap((ln) => splitByWordsMaxLen(ln, FEDEX_STREETLINE_MAX));
    return expanded.slice(0, FEDEX_STREETLINES_MAX_LINES);
}

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
 * Monta endereÃ§o simplificado para o serviÃ§o de rate FedEx
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
 * Monta packages para o serviÃ§o de rate FedEx
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

function safeStr(v, fallback = '') {
    if (v === null || v === undefined) return fallback;
    return String(v);
}

function firstNonEmpty(...vals) {
    for (const v of vals) {
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (s) return s;
    }
    return '';
}

function mapEnderecoToFedexParty(raw, fallback) {
    if (!raw || typeof raw !== 'object') return fallback;
    if (raw.contact && raw.address) return raw; // ja esta no formato FedEx

    const base = fallback || {};
    const contact = { ...(base.contact || {}) };
    const address = { ...(base.address || {}) };

    const name = firstNonEmpty(raw.nome, raw.name);
    const company = firstNonEmpty(raw.empresa, raw.company);
    const phone = firstNonEmpty(raw.telefone, raw.phone);
    const email = firstNonEmpty(raw.email);

    if (name) {
        contact.personName = name;
        if (!company) contact.companyName = name;
    }
    if (company) contact.companyName = company;
    if (phone) contact.phoneNumber = phone;
    if (email) contact.emailAddress = email;

    const rua = firstNonEmpty(raw.rua, raw.street, raw.address1);
    const numero = firstNonEmpty(raw.numero, raw.number);
    const line1 = normalizeSpaces([rua, numero].filter(Boolean).join(', '));
    const line2 = firstNonEmpty(raw.complemento, raw.address2, raw.complement);

    const baseStreetLines = Array.isArray(address.streetLines) ? address.streetLines : [];
    const fallbackLine1 = baseStreetLines[0] || '';
    const fallbackLine2 = baseStreetLines[1] || '';
    const streetLines = buildFedexStreetLines(line1 || fallbackLine1, line2 || fallbackLine2);
    if (streetLines.length) address.streetLines = streetLines;

    const city = firstNonEmpty(raw.cidade, raw.city);
    const hasStateField =
        Object.prototype.hasOwnProperty.call(raw, 'estado') ||
        Object.prototype.hasOwnProperty.call(raw, 'state') ||
        Object.prototype.hasOwnProperty.call(raw, 'province') ||
        Object.prototype.hasOwnProperty.call(raw, 'stateOrProvinceCode');
    const state = firstNonEmpty(raw.estado, raw.state, raw.province, raw.stateOrProvinceCode);
    const postal = firstNonEmpty(raw.cep, raw.postalCode, raw.zip);
    const country = firstNonEmpty(raw.pais, raw.countryCode, raw.country);

    if (city) address.city = city;
    if (hasStateField) {
        address.stateOrProvinceCode = state ? String(state).toUpperCase() : undefined;
    }
    if (postal) address.postalCode = cleanPostal(country, postal);
    if (country) address.countryCode = iso2Country(country) || address.countryCode;
    if (typeof raw.residential === 'boolean') address.residential = raw.residential;

    let tins = base.tins;
    const tax = firstNonEmpty(
        raw.cnpjOuTaxId,
        raw.taxId,
        raw.tax_id,
        raw.cnpjCpf,
        raw.cnpj,
        raw.cpf
    );
    if (tax) {
        const first = Array.isArray(tins) && tins[0] ? { ...tins[0] } : {};
        first.number = safeStr(tax);
        tins = [first].concat(Array.isArray(tins) ? tins.slice(1) : []);
    }

    return { ...base, contact, address, tins };
}

function normalizePackagesForShip(packages = [], pesoTotalPedidoKg) {
    const pkgs = Array.isArray(packages) ? packages : [];
    if (!pkgs.length) {
        return [{
            weight: { units: 'KG', value: 1 },
            dimensions: { length: 20, width: 10, height: 10, units: 'CM' }
        }];
    }

    return pkgs.map((p, idx) => {
        const weightKg = Number(pesoTotalPedidoKg);
        if (!Number.isFinite(weightKg) || weightKg <= 0) {
            throw new Error('pesoTotalPedidoKg invÃ¡lido (precisa ser > 0).');
        }

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

function round3(n) {
    return Math.round((Number(n) || 0) * 1000) / 1000;
}

function getBoxDimsCm(cx = {}) {
    // ajuste aqui pros nomes reais do seu model "Caixas"
    const length = Number(cx.lengthCm ?? cx.comprimentoCm ?? cx.comprimento ?? cx.length ?? 0);
    const width = Number(cx.widthCm ?? cx.larguraCm ?? cx.largura ?? cx.width ?? 0);
    const height = Number(cx.heightCm ?? cx.alturaCm ?? cx.altura ?? cx.height ?? 0);

    return { length, width, height };
}

function boxVolumeScore(cx = {}) {
    const d = getBoxDimsCm(cx);
    const vol = (d.length > 0 && d.width > 0 && d.height > 0) ? (d.length * d.width * d.height) : 0;
    return vol > 0 ? vol : 1; // se nÃ£o tiver dimensÃ£o, score 1 (divide igual)
}

function distributePedidoWeightAcrossCaixas(totalKg, caixas = []) {
    const total = Number(totalKg);
    if (!Number.isFinite(total) || total <= 0) throw new Error('pesoTotalPedidoKg invÃ¡lido (precisa ser > 0).');
    if (!Array.isArray(caixas) || !caixas.length) throw new Error('Nenhuma caixa para dividir peso.');

    const scores = caixas.map(boxVolumeScore);
    const sum = scores.reduce((a, b) => a + b, 0) || 1;

    // distribui + arredonda
    let parts = caixas.map((cx, i) => ({
        ...cx,
        weightKg: round3(total * (scores[i] / sum)),
    }));

    // garante soma exata ajustando a Ãºltima caixa
    const sumRounded = parts.reduce((acc, p) => acc + (Number(p.weightKg) || 0), 0);
    const diff = round3(total - sumRounded);
    parts[parts.length - 1].weightKg = round3((parts[parts.length - 1].weightKg || 0) + diff);

    return parts;
}

function mapClienteToFedexShipper(cliente) {
    const line1 = [cliente.enderecoRua, cliente.enderecoNumero].filter(Boolean).join(', ');
    return {
        contact: {
            personName: cliente.razaoSocial || cliente.nomeFantasia || 'Shipper',
            companyName: cliente.razaoSocial || cliente.nomeFantasia || 'Shipper Company',
            phoneNumber: String(cliente.telefoneCelular || cliente.telefone || '11999999999'),
            emailAddress: cliente.emailPrincipal || cliente.email || ""
        },
        address: {
            streetLines: buildFedexStreetLines(
                line1 || 'Rua Teste, 123',
                cliente.enderecoComplemento || cliente.complemento || ''
            ),
            city: cliente.enderecoCidade || 'Sao Paulo',
            stateOrProvinceCode: (cliente.enderecoEstado || 'SP').toUpperCase(),
            postalCode: cleanPostal(cliente.enderecoCEP || ''),
            countryCode: iso2Country(cliente.enderecoPais || 'BR') || 'BR',
        },
        tins: [
            {
                number: safeStr(cliente.cnpjCpf || cliente.cnpj || cliente.cpf || ''),
            }
        ]
    };
}

function mapClienteToFedexShipperIOR(cliente) {
    const line1 = [cliente.enderecoIOR, cliente.numeroIOR].filter(Boolean).join(', ');
    return {
        contact: {
            personName: cliente.nomeIOR || 'Shipper',
            companyName: cliente.nomeIOR || 'Shipper Company',
            phoneNumber: String(cliente.telefoneIOR || '11999999999'),
            emailAddress: cliente.emailIOR || ""
        },
        address: {
            streetLines: buildFedexStreetLines(
                line1 || 'Rua Teste, 123',
                cliente.complementoIOR || cliente.enderecoComplementoIOR || ''
            ),
            city: cliente.enderecoCidade || 'Sao Paulo',
            stateOrProvinceCode: (cliente.enderecoEstado || '').toUpperCase(),
            postalCode: cleanPostal(cliente.enderecoPais || 'BR', cliente.enderecoCEP || ''),
            countryCode: iso2Country(cliente.enderecoPais || 'BR') || 'BR',
        },
        tins: [
            {
                number: safeStr(cliente.state_tax_idIOR || ''),
            }
        ]
    };
}

function cleanPostal(countryCode, value) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";
    if (countryCode === "BR") return raw.replace(/\D/g, "");
    return raw.replace(/\s+/g, ""); // UK: TN235RZ
}

function mapPedidoToFedexRecipient(pedido) {
    const dest = pedido?.endereco || pedido?.shipping_address || pedido?.shippingAddress || {};
    const ruaNum = splitEndereco(dest.rua || dest.address1 || pedido.endereco || '');

    const base1 = dest.rua || dest.address1 || pedido.endereco || '';
    const base2 = dest.address2 || dest.complemento || dest.complement || '';
    const line1 =
        [ruaNum?.rua, ruaNum?.numero].filter(Boolean).join(', ') ||
        normalizeSpaces(base1) ||
        'Test Street, 456';
    const line2 =
        normalizeSpaces(base2) ||
        normalizeSpaces(ruaNum?.complemento || '');


    return {
        contact: {
            personName: dest.nome || dest.name || pedido.nomeComprador || 'Recipient',
            companyName: dest.empresa || dest.company || 'Recipient Company',
            phoneNumber: String(dest.telefone || dest.phone || pedido.telefoneComprador || '17865994231'),
            emailAddress: dest.email || pedido.emailComprador || undefined,
        },
        address: {
            streetLines: buildFedexStreetLines(line1, line2),
            city: dest.cidade || dest.city || pedido.cidade || 'Miami',
            stateOrProvinceCode: (dest.estado || dest.province || pedido.estado || '').toUpperCase(),
            postalCode: cleanPostal(dest.cep || dest.zip || pedido.CEP || ''),
            countryCode: iso2Country(dest.pais || dest.countryCode || pedido.pais || 'US') || 'US',
            residential: Boolean(dest.residential ?? false),
        },
        tins: [
            {
                tinType: 'BUSINESS_NATIONAL',
                number: safeStr(dest.cnpjCpf || dest.cnpj || dest.cpf || ''),
            }
        ],
        accountNumber: {
            value: accountNumber
        }
    };
}

function normalizeTermsOfSale(value) {
    const v = String(value || '').toUpperCase();
    if (v === 'DDP' || v === 'DDU' || v === 'DAP') return v;
    return 'DDP';
}

function buildCommoditiesFromPedido(pedido, packages = []) {
    const currency = (pedido.moeda || 'USD').toUpperCase();

    // tenta usar peso total vindo dos packages e dividir proporcionalmente se nÃ£o tiver pesoUnit
    const totalKgFromPackages = (Array.isArray(packages) ? packages : []).reduce((acc, p) => {
        const w = Number(p.weightKg ?? p.pesoKg ?? 0);
        return acc + (Number.isFinite(w) ? w : 0);
    }, 0);

    const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
    const totalQty = itens.reduce((acc, it) => acc + (Number(it.qty || 0) || 0), 0) || 1;
    const itensSemPesoUnit = itens.every((it) => Number(it.pesoUnit || 0) <= 0);

    const commodities = itens.map((it) => {
        console.log("IT: ", it)
        const qty = Number(it.qty || 1) || 1;

        const unitPrice = Number(it.preco || 0) || 0;

        const lineTotal = (unitPrice * qty); // Number(it.valorTotalLinha || 0)

        const hs = firstNonEmpty(it.hscode);
        console.log(hs)

        // peso por item: prioridade -> pesoUnit (se vier) -> rateio do total dos packages
        const pesoUnitKg = Number(it.pesoUnit || 0); // se vocÃª salvar em kg
        const weightKgRaw =
            (pesoUnitKg > 0 ? pesoUnitKg * qty : 0) ||
            (totalKgFromPackages > 0 ? (totalKgFromPackages * (qty / totalQty)) : 1);
        const weightKg = round3(weightKgRaw);

        return {
            description: (it.titulo || 'Item').slice(0, 450), // FedEx tem limites, corta por seguranÃ§a
            countryOfManufacture: 'BR',
            quantity: qty,
            quantityUnits: 'PCS',

            // (opcional) HS code se tiver
            ...(hs ? { harmonizedCode: String(hs).trim() } : {}),

            unitPrice: { amount: unitPrice, currency },
            customsValue: { amount: lineTotal, currency },
            weight: { units: 'KG', value: weightKg },
        };
    });
    const totalCommoditiesKg = commodities.reduce((acc, c) => acc + (Number(c.weight?.value) || 0), 0);

    return { commodities, currency };
}



async function buildFedexShipPayload({
    shipper,
    recipient,
    soldTo,
    packages = [],
    commodities = [],
    currency = 'USD',
    pesoTotalPedidoKg,
    invoiceNumber,
    freightTotal,
    termsOfSale
}) {
    const acct = process.env.FEDEX_ACCOUNT_NUMBER
    const requestedPackageLineItems = normalizePackagesForShip(packages, pesoTotalPedidoKg);

    const invNumber = String(invoiceNumber || `INV-${Date.now()}`);
    const freightAmount = Number(freightTotal || 0) || 0;

    try {
        const s1 = shipper?.address?.streetLines || [];
        const r1 = recipient?.address?.streetLines || [];
    } catch (_) { }

    console.log('[FEDEX][SHIP][BUILD_PAYLOAD] commodities:', commodities);

    // total da linha (preferÃªncia: customsValue vindo do builder; fallback: unit*qty)

    return {
        labelResponseOptions: 'URL_ONLY',
        // accountNumber: serÃ¡ injetado no service se nÃ£o vier; aqui pode omitir

        requestedShipment: {
            shipDateStamp: toYMDDate(new Date()),
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
            // soldTo,

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
                importerOfRecord: soldTo,
                commercialInvoice: {
                    invoiceNumber: invNumber,

                    customerReferences: [
                        { customerReferenceType: "INVOICE_NUMBER", value: invNumber }, //pedido_ref para numerar as invoices
                        // se quiser preencher PO tambÃ©m:
                        // { customerReferenceType: "PURCHASE_ORDER_NUMBER", value: "PO-123" },
                    ],

                    termsOfSale: normalizeTermsOfSale(termsOfSale),
                    paymentTerms: "Paid in Advance",
                    freightCharge: {
                        amount: freightAmount, // valor total do frete
                        currency
                    }
                },
                dutiesPayment: {
                    paymentType: 'SENDER'
                },
                isDocumentOnly: false,
                commodities: (commodities || []).map((c) => {
                    const qty = Number(c.quantity || 1) || 1;
                    const unit = Number(c.unitPrice?.amount ?? 0) || 0;

                    // total da linha: usa o que veio pronto; senÃ£o calcula unit*qty
                    const customsAmount = Number.isFinite(Number(c.customsValue?.amount))
                        ? Number(c.customsValue.amount)
                        : (unit * qty);
                    return {
                        description: c.description || 'Item',
                        countryOfManufacture: iso2Country(c.countryOfManufacture || 'BR') || 'BR',
                        quantity: Number(c.quantity || 1),
                        quantityUnits: c.quantityUnits || 'PCS',
                        ...(c.harmonizedCode ? { harmonizedCode: String(c.harmonizedCode) } : {}),
                        unitPrice: {
                            amount: unit,
                            currency: c.unitPrice?.currency || currency,
                        },
                        customsValue: {
                            amount: customsAmount,
                            currency: c.customsValue?.currency || currency,
                        },
                        weight: {
                            units: 'KG',
                            value: Number(c.weight?.value),
                        },
                    }
                }),
            },

            shippingDocumentSpecification: {
                shippingDocumentTypes: ['COMMERCIAL_INVOICE'],
                commercialInvoiceDetail: {
                    customerImageUsages: [
                        {
                            id: "IMAGE_2",
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
 * Estrutura Ã© meio variÃ¡vel, entÃ£o fazemos defensivo.
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
    let labelType = 'PNG';

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

async function loadCaixaImport(packId, clienteId) {
    const ids = Array.isArray(packId) ? packId.filter(Boolean) : [packId].filter(Boolean);
    if (!ids.length) return [];

    const rows = await db.Caixa.findAll({
        where: { id: ids, id_cliente: clienteId },
    });

    // findAll retorna array
    const caixas = rows.map(r => r.toJSON());

    // mapeia pro formato "packages" (weightKg + dimCm)
    return caixas.map((cx) => {
        const dims = getBoxDimsCm(cx);

        // ajuste pro seu campo novo: "peso" (em gramas) -> kg
        // se seu campo for "peso" em gramas:
        const pesoG = Number(cx.peso ?? cx.peso_g ?? cx.pesoG ?? 500); // default 500g
        const weightKg = round3(pesoG / 1000);

        return {
            ...cx,
            weightKg,
            dimCm: {
                length: dims.length || 20,
                width: dims.width || 10,
                height: dims.height || 10,
            },
        };
    });
}



// ========== CONTROLLER ==========

module.exports = {
    // ---------- RATE ----------
    rate: async (req, res) => {
        try {
            const cliente = await getClienteAtual(req, res);
            const { pedido_ref, packagesId, pesoTotalPedidoKg } = req.body || {};

            if (!packagesId) return res.status(400).json({ ok: false, error: 'Caixa obrigatÃ³ria.' });
            if (!pedido_ref) return res.status(400).json({ ok: false, error: 'pedido_ref Ã© obrigatÃ³rio.' });
            if (!pesoTotalPedidoKg) return res.status(400).json({ ok: false, error: 'pesoTotalPedidoKg Ã© obrigatÃ³rio.' });

            // 1) carrega N caixas
            let packages = await loadCaixaImport(packagesId, cliente.id);
            if (!packages.length) return res.status(404).json({ ok: false, error: 'Caixa(s) nÃ£o encontrada(s).' });

            // 2) divide o peso total do pedido entre as caixas (isso alimenta requestedPackageLineItems)
            packages = distributePedidoWeightAcrossCaixas(pesoTotalPedidoKg, packages);

            let pedido = await loadPedidoImport(pedido_ref, cliente.id);
            if (!pedido && req.body?.pedido_manual) {
                pedido = req.body.pedido_manual;
            }
            if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado.' });

            const shipperOverride = req.body?.shipper || req.body?.remetente || null;
            const recipientOverride = req.body?.recipient || req.body?.destinatario || null;
            const shipper = mapEnderecoToFedexParty(shipperOverride, mapClienteToFedexShipper(cliente));
            const recipient = mapEnderecoToFedexParty(recipientOverride, mapPedidoToFedexRecipient(pedido));
            const { commodities } = buildCommoditiesFromPedido(pedido, packages);

            // IMPORTANTE: quoteRates AINDA precisa de packages (pra montar requestedPackageLineItems)
            const rate_payload = await quoteRates({
                shipper,
                recipient,
                packages,
                pedido_ref,
                clienteId: cliente.id,
                commodities
            });

            const details = rate_payload.rows || [];
            const services = details.map((r) => ({
                serviceType: r.serviceType,
                carrier: r.carrier || 'FEDEX',
                currency: r.currency || 'USD',
                base: r.base || 0,
                // comentario informal: total ajuda o front a nao mandar override 0
                total: r.total || r.base || 0,
                itemized: r.itemized || [],
            }));

            return res.json({ ok: true, services, raw: rate_payload.raw });
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
            const { packagesId, pedido_ref, pesoTotalPedidoKg, rate_payload } = req.body || {};

            if (!packagesId) return res.status(400).json({ ok: false, error: 'Caixa obrigatÃ³ria.' });
            if (!pedido_ref) return res.status(400).json({ ok: false, error: 'pedido_ref Ã© obrigatÃ³rio.' });
            if (!pesoTotalPedidoKg) return res.status(400).json({ ok: false, error: 'pesoTotalPedidoKg Ã© obrigatÃ³rio.' });

            let packages = await loadCaixaImport(packagesId, cliente.id);
            if (!packages.length) return res.status(404).json({ ok: false, error: 'Caixa(s) nÃ£o encontrada(s).' });

            // divide o peso total entre caixas (peso por volume)
            packages = distributePedidoWeightAcrossCaixas(pesoTotalPedidoKg, packages);

            let pedido = await loadPedidoImport(pedido_ref, cliente.id);
            if (!pedido && req.body?.pedido_manual) {
                pedido = req.body.pedido_manual;
            }
            if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido nÃ£o encontrado.' });

            console.log(
                '[FEDEX][SHIP] pedido_ref:',
                pedido_ref,
                'itens:',
                pedido?.itens?.length,
                'first_item:',
                pedido?.itens?.[0]?.titulo,
                'hscode:',
                pedido?.itens?.[0]?.hscode
            );

            // commodities: se vocÃª nÃ£o tem peso por item, essa funÃ§Ã£o jÃ¡ vai ratear usando o totalKgFromPackages
            const { commodities, currency } = buildCommoditiesFromPedido(pedido, packages);

            let breakdown = null;
            try {
                if (rate_payload) {
                    breakdown = await extractFedexBreakdown(rate_payload, 'FEDEX_INTERNATIONAL_CONNECT_PLUS');
                }
            } catch (_) {
                breakdown = null;
            }

            const invoiceNumber = `INV-2025-${String(pedido_ref || '').trim()}`;
            const freightTotalRaw =
                (Number.isFinite(Number(breakdown?.total)) ? Number(breakdown.total) : null) ??
                req.body?.freight_total ??
                req.body?.frete_total ??
                pedido?.freight_total ??
                pedido?.frete_total ??
                pedido?.shipping_price ??
                pedido?.shippingPrice ??
                pedido?.total_frete ??
                pedido?.totalFrete ??
                pedido?.valor_frete ??
                pedido?.valorFrete ??
                0;
            const freightTotal = Number(freightTotalRaw || 0) || 0;

            const shipperOverride = req.body?.shipper || req.body?.remetente || null;
            const recipientOverride = req.body?.recipient || req.body?.destinatario || null;
            const shipper = mapEnderecoToFedexParty(shipperOverride, mapClienteToFedexShipper(cliente));
            const recipient = mapEnderecoToFedexParty(recipientOverride, mapPedidoToFedexRecipient(pedido));
            const soldTo = mapClienteToFedexShipperIOR(cliente);
            const termsOfSale =
                req.body?.triangulacao ||
                req.body?.termsOfSale ||
                req.body?.terms_of_sale ||
                'DDP';

            const payload = await buildFedexShipPayload({
                shipper,
                recipient,
                soldTo,
                packages,
                commodities,
                currency,
                pesoTotalPedidoKg,
                invoiceNumber,
                freightTotal,
                termsOfSale
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
                "";

            const tn = String(raw).trim().replace(/['"`\s]/g, "").toUpperCase();
            if (!tn) return res.status(400).json({ error: "Tracking vazio." });

            const data = await tracking.getByNumber(tn, { includeDetailedScans: true });
            return res.json(data);
        } catch (e) {
            const http = e?.http || e?.status || 400;
            const msg =
                e?.details?.errors?.[0]?.message ||
                e?.details?.error_description ||
                e?.message ||
                "Falha ao rastrear";

            console.error("[FEDEX/TRACK][ERR]", msg, e?.details || e);
            return res.status(http).json({ error: msg, details: e?.details });
        }
    },
    pickUp: async (req, res) => {
        try {
            const payload = req.body || {};
            if (!payload || typeof payload !== 'object') {
                return res.status(400).json({ ok: false, error: 'Payload de pickup obrigatÃ³rio.' });
            }

            const data = await createPickup(payload, {
                idempotencyKey: req.headers['x-idempotency-key'] || null
            });


            return res.json({ ok: true, raw: data })
        } catch (err) {
            return res.status(err.status || 500).json({
                ok: false,
                error: err.message || 'Falha no pickup FedEx',
                raw: err.upstream || null,
            })
        }
    }
};

