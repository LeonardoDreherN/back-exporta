// controller/upsController.js
const rating = require('../services/ups/rating');
const shipping = require('../services/ups/shipping'); // (não usado aqui, mas mantido)
const tracking = require('../services/ups/tracking');
const axios = require('axios');
const { salvarEtiquetaNaStorage, salvarInvoiceNaStorage } = require('./CotacaoController');
const Cotacao = require('../models/Cotacao');
// const { Cotacao } = db;

// ====== CONFIG ======
const UPS_BASE = process.env.UPS_BASE_URL_PROD || 'https://onlinetools.ups.com';
const UPS_ACCOUNT_NUMBER = process.env.UPS_ACCOUNT_NUMBER || "JE8372";
const UPS_STUB = String(process.env.UPS_STUB || '') === 'true';
const UPS_CLIENT_ID = process.env.UPS_CLIENT_ID || '';
const UPS_CLIENT_SECRET = process.env.UPS_CLIENT_SECRET || '';

const onlyDigits = (s) => String(s || '').replace(/\D+/g, '');
const trunc = (s, n) => (s ? String(s).slice(0, n) : undefined);
function cleanZip(s = '') { return String(s).replace(/['"`\s]/g, '').replace(/\D/g, ''); }
function kgToLbs(kg) { const n = Number(kg) || 0; return +(n * 2.2046226218).toFixed(3); }
function cmToIn(cm) { const n = Number(cm) || 0; return +(n / 2.54).toFixed(2); }
function round2(n) { return +((Number(n) || 0).toFixed(2)); }

function unitsForCountry(countryCode) {
    const cc = String(countryCode || '').toUpperCase();
    return cc === 'US' ? { w: 'LBS', d: 'IN' } : { w: 'KGS', d: 'CM' };
}

function labelTypeToMime(t) {
    const s = String(t || '').toUpperCase();
    if (s === 'PNG') return 'image/png';
    if (s === 'GIF') return 'image/gif';
    if (s === 'ZPL') return 'text/plain';
    if (s === 'URL') return 'text/uri-list';
    return 'application/octet-stream';
}

function iso2Country(c) {
    if (!c) return undefined;
    const x = String(c).trim().toUpperCase();
    const map = {
        BR: 'BR', BRA: 'BR', BRASIL: 'BR', BRAZIL: 'BR',
        US: 'US', USA: 'US', UNITEDSTATES: 'US', 'UNITED STATES': 'US',
        CA: 'CA', CANADA: 'CA',
        MX: 'MX', MEXICO: 'MX',
        AR: 'AR', ARGENTINA: 'AR', CL: 'CL', CHILE: 'CL',
    };
    return map[x] || (x.length === 2 ? x : undefined);
}
function isoState(s) { return String(s || '').trim().toUpperCase(); }

function toYMD(d) {
    if (!d) return null;
    if (d instanceof Date) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}${m}${day}`;
    }
    const s = String(d).trim();
    const m = s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
    if (m) return `${m[1]}${m[2]}${m[3]}`;
    const dd = new Date(s);
    return isNaN(dd.getTime()) ? null : toYMD(dd);
}

// ====== ERROS ======
function normalizeUpsError(err) {
    const status = err?.response?.status || 500;
    let message =
        err?.response?.data?.response?.errors?.[0]?.message ||
        err?.response?.data?.Fault?.detail?.Errors?.ErrorDetail?.PrimaryErrorCode?.Description ||
        err?.response?.data?.error?.message ||
        err?.response?.data?.error ||
        err?.message ||
        'Falha ao emitir remessa';

    if (!err?.response && err?.code) {
        message = `${message} (code=${err.code})`;
    }
    const raw = err?.response?.data;
    return { status, message, raw };
}

// Concatena rua + número
// function joinAddressLine(rua, numero) {
//     const a = String(rua || '').trim();
//     const b = String(numero || '').trim();
//     return [a, b].filter(Boolean).join(', ');
// }

let _upsTokenCache = { token: null, expTs: 0 }; // epoch ms
async function getUpsToken(force = false) {
    const now = Date.now();
    if (!force && _upsTokenCache.token && now < _upsTokenCache.expTs - 60_000) {
        return _upsTokenCache.token;
    }
    if (!UPS_CLIENT_ID || !UPS_CLIENT_SECRET) {
        throw new Error('UPS OAuth2: defina UPS_CLIENT_ID e UPS_CLIENT_SECRET no .env');
    }
    const oauthUrl = `${UPS_BASE}/security/v1/oauth/token`;
    const basic = Buffer.from(`${UPS_CLIENT_ID}:${UPS_CLIENT_SECRET}`).toString('base64');

    const resp = await axios.post(
        oauthUrl,
        'grant_type=client_credentials',
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${basic}`,
                'Accept': 'application/json',
            },
            timeout: 15000,
        }
    );

    const token = resp?.data?.access_token;
    const expiresIn = Number(resp?.data?.expires_in || 0);
    if (!token) throw new Error('UPS OAuth2: token ausente na resposta');

    _upsTokenCache = {
        token,
        expTs: Date.now() + expiresIn * 1000,
    };
    return token;
}

function pickFreightFromRate(rateRaw) {
    const rs = rateRaw?.RateResponse?.RatedShipment;
    const first = Array.isArray(rs) ? rs[0] : rs;
    if (!first) return null;

    const preferred = first?.NegotiatedRateCharges?.TotalCharge || first?.TotalCharges;
    if (!preferred?.MonetaryValue) return null;

    return {
        value: String(preferred.MonetaryValue),
        currency: String(preferred.CurrencyCode || 'USD'),
    };
}
function buildRateRequestFromCli(cli) {
    const toAddr = (p) => ({
        Address: {
            PostalCode: String(p?.cep || p?.postalCode || p?.zip || '').replace(/\D/g, ''),
            CountryCode: iso2Country(p?.pais || p?.country),
            StateProvinceCode: (p?.estado || p?.state || undefined),
            City: (p?.cidade || p?.city || undefined),
            AddressLine: [[String(p?.rua || p?.street || ''), String(p?.numero || p?.number || '')].filter(Boolean).join(', ')].filter(Boolean),
        }
    });

    const pkgList = (cli?.packages || []).map((p) => ({
        PackagingType: { Code: '02' },
        PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: String(p?.weightKg ?? 0) },
        Dimensions: p?.dimCm ? {
            UnitOfMeasurement: { Code: 'CM' },
            Length: String(p.dimCm.length ?? 0),
            Width: String(p.dimCm.width ?? 0),
            Height: String(p.dimCm.height ?? 0),
        } : undefined,
        PackageServiceOptions: {}
    }));

    return {
        RateRequest: {
            Request: { TransactionReference: { CustomerContext: 'back-exporta:ship-autofreight' } },
            Shipment: {
                Shipper: toAddr(cli?.shipper, 'Shipper'),
                ShipFrom: toAddr(cli?.shipper, 'ShipFrom'),
                ShipTo: toAddr(cli?.shipTo, 'ShipTo'),
                Service: { Code: String(cli?.serviceCode || '') },
                ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
                Package: pkgList.length ? pkgList : [{
                    PackagingType: { Code: '02' },
                    PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: '0' },
                    Dimensions: { UnitOfMeasurement: { Code: 'CM' }, Length: '0', Width: '0', Height: '0' },
                    PackageServiceOptions: {}
                }],
                PickupType: { Code: '01' },
            }
        }
    };
}


/**
 * Traduz o NOVO payload do front (ShipmentRequest-like) para um RateRequest da UPS Rating.
 * Ignora InternationalForms/Contacts (não usados em Rating).
 */
function translateShipmentRequestToRateRequest(frontSR) {
    const S = frontSR?.Shipment || {};
    const shipper = S?.Shipper || {};
    const shipTo = S?.ShipTo || {};
    const service = S?.Service || {};
    const pkg1 = S?.Package || S?.Packages;

    const addrPick = (node) => {
        const A = node?.Address || {};
        return {
            PostalCode: cleanZip(A?.PostalCode || A?.Postalcode || A?.Zip || ''),
            CountryCode: iso2Country(A?.CountryCode) || undefined,
            StateProvinceCode: A?.StateProvinceCode || A?.State || undefined,
            City: A?.City || undefined,
            AddressLine: Array.isArray(A?.AddressLine) ? A.AddressLine[0] : (A?.AddressLine || undefined),
        };
    };

    const shAddr = addrPick(shipper);
    const toAddr = addrPick(shipTo);

    const toRatePkg = (p) => {
        if (!p) return null;
        const UOMw = p?.PackageWeight?.UnitOfMeasurement?.Code || 'KGS';
        const weight = p?.PackageWeight?.Weight || '0';
        const UOMd = p?.Dimensions?.UnitOfMeasurement?.Code || 'CM';
        const H = p?.Dimensions?.Height ?? '0';
        const W = p?.Dimensions?.Width ?? '0';
        const L = p?.Dimensions?.Length ?? '0';
        return {
            PackagingType: { Code: '02' },
            PackageWeight: { UnitOfMeasurement: { Code: UOMw }, Weight: String(weight) },
            Dimensions: { UnitOfMeasurement: { Code: UOMd }, Height: String(H), Width: String(W), Length: String(L) },
            PackageServiceOptions: {}
        };
    };

    const packages = [];
    if (Array.isArray(pkg1)) {
        for (const p of pkg1) {
            const x = toRatePkg(p);
            if (x) packages.push(x);
        }
    } else {
        const x = toRatePkg(pkg1);
        if (x) packages.push(x);
    }

    return {
        RateRequest: {
            Request: { TransactionReference: { CustomerContext: 'back-exporta' } },
            Shipment: {
                Shipper: { Address: shAddr },
                ShipTo: { Address: toAddr },
                Service: { Code: service?.Code || '' },
                ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
                Package: packages.length ? packages : [{
                    PackagingType: { Code: '02' },
                    PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: '0' },
                    Dimensions: { UnitOfMeasurement: { Code: 'CM' }, Height: '0', Width: '0', Length: '0' },
                    PackageServiceOptions: {}
                }],
                PickupType: { Code: '01' },
            }
        }
    };
}

// ====== SHIP payload (REST v2407+) ======
function mapToUpsShipment(reqBody) {
    const { shipper, shipFrom, shipTo, serviceCode, payment, packages, invoice, triangulacao } = reqBody;

    const shipperTax = onlyDigits(
        shipper?.cnpjOuTaxId || shipper?.taxId || shipper?.tax_id || shipper?.ein || shipper?.vat || ""
    ).slice(0, 14);

    const addr = (p = {}, role = 'Recipient') => {
        const name = (p?.nome || p?.name || role || '').toString().trim() || role;
        const attention = (p?.atencao || p?.attention || name).toString().trim() || name;
        const phone = onlyDigits(p?.telefone || p?.phone || '');
        const countryISO2 = iso2Country(p?.pais || p?.country);
        const state = (p?.estado || p?.state || '').toString().trim().toUpperCase() || undefined;
        const postal = String(p?.cep || p?.postalCode || p?.zip || '').replace(/\D/g, '') || undefined;

        const line1 = p?.addressLine
            ? String(p.addressLine)
            : [String(p?.rua || p?.street || '').trim(), String(p?.numero || p?.number || '').trim()]
                .filter(Boolean)
                .join(', ');
        const line2 = (p?.complemento || p?.address2 || '').toString().trim();

        const lines = [line1, line2].filter(Boolean).map(s => trunc(s, 35));
        return {
            Name: trunc(name, 35),
            AttentionName: trunc(attention, 35),
            Phone: phone ? { Number: trunc(phone, 15) } : undefined,
            Address: {
                AddressLine: lines.length ? lines : [trunc('ADDRESS', 35)],
                City: trunc((p?.cidade || p?.city || '').toString().trim(), 30),
                StateProvinceCode: state,
                PostalCode: postal,
                CountryCode: countryISO2,
            },
        };
    };

    const paymentInformation = (() => {
        const bill = payment?.bill;
        const account = payment?.account || UPS_ACCOUNT_NUMBER || undefined;
        if (bill === 'Shipper') {
            return { ShipmentCharge: { Type: '01', BillShipper: { AccountNumber: account } } };
        } else if (bill === 'Receiver') {
            return { ShipmentCharge: { Type: '02', BillReceiver: { AccountNumber: account, Address: { PostalCode: addr(shipTo).Address.PostalCode, CountryCode: addr(shipTo).Address.CountryCode } } } };
        } else {
            return { ShipmentCharge: { Type: '03', BillThirdParty: { AccountNumber: account, Address: { PostalCode: addr(shipper).Address.PostalCode, CountryCode: addr(shipper).Address.CountryCode } } } };
        }
    })();

    const pkgList = (packages || []).map((p, i) => ({
        Description: p?.reference || `PKG-${i + 1}`,
        Packaging: { Code: '02' },
        PackageWeight: {
            UnitOfMeasurement: { Code: 'KGS' },
            Weight: String(p?.weightKg ?? 0),
        },
        Dimensions: p?.dimCm
            ? {
                UnitOfMeasurement: { Code: 'CM' },
                Length: String(p.dimCm.length ?? 0),
                Width: String(p.dimCm.width ?? 0),
                Height: String(p.dimCm.height ?? 0),
            }
            : undefined,
    }));

    const labelSpec = {
        LabelImageFormat: { Code: 'PNG' },
        LabelStockSize: { Height: '6', Width: '4' },
    };

    const shipperNumber = UPS_ACCOUNT_NUMBER || payment?.account || undefined;

    // Dados da invoice (se vier pelo "biz")
    const invDate = toYMD(invoice?.date || invoice?.invoiceDate) || toYMD(new Date());
    const invNumber = (invoice?.number || invoice?.invoiceNumber || `INV-${Date.now()}`).toString();

    const shipment = {
        ShipmentRequest: {
            Request: { RequestOption: 'nonvalidate' },
            Shipment: {
                Description: 'Order',
                Shipper: { ...addr(shipper, 'Shipper'), ShipperNumber: shipperNumber, TaxIdentificationNumber: shipperTax || undefined },
                ShipFrom: { ...(shipFrom ? addr(shipFrom, 'ShipFrom') : addr(shipper, 'ShipFrom')), TaxIdentificationNumber: shipperTax || undefined },
                ShipTo: addr(shipTo, 'Recipient'),
                PaymentInformation: paymentInformation,
                Service: { Code: serviceCode },
                RateInformation: { NegotiatedRatesIndicator: 'Y' },
                Package: pkgList,
                // --- Peça a Commercial Invoice (PDF) limpa (sem NAFTA/CoO) ---
                ShipmentServiceOptions: invoice ? {
                    InternationalForms: {
                        FormType: '01',
                        ImageFormat: { Code: 'PDF' },

                        InvoiceDate: invDate,
                        InvoiceNumber: invNumber,

                        CurrencyCode: invoice?.currency || 'USD',
                        TermsOfShipment: triangulacao,
                        ReasonForExport: 'SALE',

                        TaxInformation: {
                            TaxIDType: 'TAXID',          // para BR use TAXID (não use EIN)
                            TaxIDNumber: shipperTax || undefined,
                        },

                        InvoiceLineTotal: {
                            CurrencyCode: invoice?.currency || 'USD',
                            MonetaryValue: String(
                                (invoice?.items || []).reduce((sum, it) => sum + (Number(it.unitPrice || 0) * Number(it.quantity || 0)), 0)
                            ),
                        },

                        Product: (invoice?.items || []).map((it, idx) => ({
                            Description: it.description || `Item ${idx + 1}`,
                            CommodityCode: it.hscode || '00000000',
                            OriginCountryCode: it.countryOfOrigin || 'BR',
                            Unit: {
                                UnitOfMeasurement: { Code: 'PCS' },
                                Number: String(Math.max(1, Number(it.quantity || 1))),  // string
                                Value: Number(it.unitPrice || 0).toFixed(2),            // "0.00"
                            },
                            UnitPrice: Number(it.unitPrice || 0).toFixed(2),
                        })),
                        Contacts: {
                            SoldFrom: { ...addr(shipper, 'Shipper'), Option: '01', TaxIdentificationNumber: shipperTax || undefined },
                            SoldTo: { ...addr(shipTo, 'Recipient'), Option: '01' },
                            Producer: {
                                Option: '01',
                                CompanyName: addr(shipper, 'Shipper').Name,
                                Address: addr(shipper, 'Shipper').Address,
                                Phone: addr(shipper, 'Shipper').Phone,
                                TaxIdentificationNumber: shipperTax || undefined,
                            },
                        },
                    }
                } : undefined,
                LabelSpecification: labelSpec,
            },
        },
    };

    return shipment;
}

// ====== Parse do retorno (label + invoice PDF) ======
function mapFromUpsShipment(raw) {
    const sr = raw?.ShipmentResponse?.ShipmentResults;
    const pkg = sr?.PackageResults;
    const list = (Array.isArray(pkg) ? pkg : [pkg]).filter(Boolean);

    const trackingNumbers = list.map((p) => p?.TrackingNumber).filter(Boolean);
    const master = sr?.ShipmentIdentificationNumber;
    if (!trackingNumbers.length && master) trackingNumbers.push(master);

    const first = list[0] || {};
    const labelB64 =
        first?.ShippingLabel?.GraphicImage ||
        first?.LabelImage?.GraphicImage ||
        sr?.LabelImage?.GraphicImage ||
        null;

    const labelType =
        first?.ShippingLabel?.LabelImageFormat?.Code ||
        first?.LabelImage?.LabelImageFormat?.Code ||
        sr?.LabelImage?.LabelImageFormat?.Code ||
        'PNG';

    const labelHref =
        first?.ShippingLabel?.URL ||
        first?.LabelImage?.URL ||
        sr?.LabelImage?.URL ||
        null;

    // Invoice em Forms/Form
    const formsNode = sr?.Form || sr?.Forms || raw?.forms;
    const forms = Array.isArray(formsNode) ? formsNode : (formsNode ? [formsNode] : []);
    let invoice = null;

    for (const f of forms) {
        const img = f?.Image || (Array.isArray(f?.Image) ? f.Image[0] : null) || f?.FormImage || f?.Document || null;

        const formatCode =
            img?.ImageFormat?.Code ||
            img?.Format?.Code ||
            f?.FormType ||
            null;

        const b64 = img?.GraphicImage || img?.Data || null;
        const url = img?.URL || img?.Link || null;

        const isPdf = String(formatCode || '').toUpperCase() === 'PDF';
        if (isPdf) {
            if (typeof b64 === 'string' && b64.length > 50) {
                invoice = { mime: 'application/pdf', b64 };
                break;
            }
            if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
                invoice = { mime: 'application/pdf', href: url };
                break;
            }
        }
    }

    return {
        ok: true,
        trackingNumbers,
        label: labelB64
            ? { b64: labelB64, type: labelType }
            : (labelHref ? { href: labelHref, type: 'URL' } : null),
        invoice,
        raw,
    };
}

function translateFrontShipSRToBiz(body) {
    const SR = body?.ShipmentRequest || {};
    const S = SR?.Shipment || {};

    const toBizAddr = (node, fallbackName = 'N/A') => {
        const A = node?.Address || {};
        const addrLines = Array.isArray(A.AddressLine) ? A.AddressLine : (A.AddressLine ? [A.AddressLine] : []);
        const line1 = (addrLines[0] || '').toString();
        const line2 = (addrLines[1] || '').toString() || undefined;

        let rua = line1;
        let numero = '';
        const parts = line1.split(',');
        if (parts.length >= 2) {
            rua = parts[0].trim();
            numero = parts.slice(1).join(',').trim();
        }

        return {
            nome: (node?.Name || node?.AttentionName || fallbackName || '').toString(),
            telefone: (node?.Phone?.Number || '').toString(),
            rua,
            numero,
            complemento: line2,
            cidade: (A.City || '').toString(),
            estado: (A.StateProvinceCode || '').toString(),
            cep: cleanZip(A.PostalCode || A.Postalcode || A.Zip || ''),
            pais: iso2Country(A.CountryCode) || '',
            cnpjOuTaxId: (node?.TaxIdentificationNumber || '').toString(),
            email: (node?.EmailAddress || '').toString() || undefined,
        };
    };

    const shipperBiz = toBizAddr(S.Shipper, 'Shipper');
    const shipToBiz = toBizAddr(S.ShipTo, 'Recipient');
    const shipFromBiz = S.ShipFrom ? toBizAddr(S.ShipFrom, 'ShipFrom') : undefined;

    const charge = S?.PaymentInformation?.ShipmentCharge;
    const type = (charge?.Type || '').toString();
    const typeToBill = (t) => (t === '01' ? 'Shipper' : t === '02' ? 'Receiver' : 'ThirdParty');
    const paymentBiz = {
        bill: typeToBill(type),
        account: (charge?.BillShipper?.AccountNumber ||
            charge?.BillReceiver?.AccountNumber ||
            charge?.BillThirdParty?.AccountNumber || '').toString() || undefined
    };

    const srcPkgs = Array.isArray(S.Package) ? S.Package : (S.Package ? [S.Package] : []);
    const packagesBiz = srcPkgs.map((p, i) => {
        const W = p?.PackageWeight?.Weight ?? 0;
        const D = p?.Dimensions || {};
        return {
            reference: p?.Description || `PKG-${i + 1}`,
            weightKg: Number(W) || 0,
            dimCm: {
                length: Number(D?.Length ?? 0) || 0,
                width: Number(D?.Width ?? 0) || 0,
                height: Number(D?.Height ?? 0) || 0,
            },
        };
    });

    const IF = S?.ShipmentServiceOptions?.InternationalForms;
    const invoiceBiz = IF ? {
        currency: IF.CurrencyCode || 'USD',
        date: IF.InvoiceDate || undefined,
        number: IF.InvoiceNumber || undefined,
        items: Array.isArray(IF.Product) ? IF.Product.map((pr) => ({
            description: pr?.Description || 'Item',
            quantity: Number(pr?.Unit?.Number ?? 1) || 1,
            unitPrice: Number(pr?.UnitPrice ?? pr?.Unit?.Value ?? 0) || 0,
            hscode: pr?.CommodityCode || undefined,
            countryOfOrigin: pr?.OriginCountryCode || undefined,
            weightKg: undefined,
        })) : [],
    } : null;

    return {
        shipper: shipperBiz,
        shipFrom: shipFromBiz,
        shipTo: shipToBiz,
        serviceCode: (S?.Service?.Code || '').toString(),
        payment: paymentBiz,
        packages: packagesBiz,
        invoice: invoiceBiz && invoiceBiz.items.length ? invoiceBiz : null,
    };
}

module.exports = {
    // ---------------- RATE ----------------
    rate: async (req, res, next) => {
        try {
            const body = req.body || {};

            if (body?.RateRequest) {
                const rr = body.RateRequest;

                const fixAddr = (node) => {
                    if (!node || !node.Address) return;
                    const A = node.Address;
                    if (A.AddressLine && !Array.isArray(A.AddressLine)) {
                        A.AddressLine = [String(A.AddressLine)];
                    }
                    if (!A.CountryCode) {
                        const cc = iso2Country(A.CountryCode) || undefined;
                        if (!cc) {
                            throw Object.assign(new Error('Missing shipper country code.'), { http: 400 });
                        }
                        A.CountryCode = cc;
                    } else {
                        A.CountryCode = iso2Country(A.CountryCode);
                    }
                };

                fixAddr(rr?.Shipment?.Shipper, 'Shipper');
                fixAddr(rr?.Shipment?.ShipFrom, 'ShipFrom');
                fixAddr(rr?.Shipment?.ShipTo, 'ShipTo');

                const raw = await rating.quote({ RateRequest: rr });

                const rs = raw?.RateResponse?.RatedShipment;
                const items = Array.isArray(rs) ? rs : (rs ? [rs] : []);
                const services = items.map(it => ({
                    serviceCode: it?.Service?.Code || null,
                    serviceName: it?.Service?.Description || null,
                    total: Number(it?.TotalCharges?.MonetaryValue || 0),
                    currency: it?.TotalCharges?.CurrencyCode || null,
                    negotiated: it?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue
                        ? Number(it.NegotiatedRateCharges.TotalCharge.MonetaryValue)
                        : null,
                    delivery: {
                        date: it?.GuaranteedDelivery?.DeliveryDateTime || null,
                        businessDays: it?.GuaranteedDelivery?.BusinessDaysInTransit || null,
                    }
                }));

                return res.json({ ok: true, services, raw });
            }

            // FORMATO ANTIGO (compatibilidade)
            const { shipper = {}, shipTo = {}, pickupDate, serviceCode, packages = [] } = body;

            const shipperCountry = iso2Country(shipper.country);
            const shipToCountry = iso2Country(shipTo.country);

            const safeShipper = {
                postalCode: cleanZip(shipper.postalCode),
                country: shipperCountry,
                state: shipper.state || undefined,
                city: shipper.city || undefined,
                addressLine: shipper.addressLine || undefined,
            };
            const safeShipTo = {
                postalCode: cleanZip(shipTo.postalCode),
                country: shipToCountry,
                state: shipTo.state || undefined,
                city: shipTo.city || undefined,
                addressLine: shipTo.addressLine || undefined,
            };

            if (!safeShipper.postalCode || !safeShipTo.postalCode) {
                return res.status(400).json({
                    ok: false,
                    error: 'Cadastro/pedido sem CEP/ZIP.',
                    debug: { shipper: safeShipper, shipTo: safeShipTo }
                });
            }

            const { w: weightUOM, d: dimUOM } = unitsForCountry(safeShipper.country);

            const pkgs = packages.map(p => {
                const weight = weightUOM === 'LBS' ? kgToLbs(p.weightKg) : round2(p.weightKg);
                const height = dimUOM === 'IN' ? cmToIn(p.dimCm?.height) : round2(p.dimCm?.height);
                const width = dimUOM === 'IN' ? cmToIn(p.dimCm?.width) : round2(p.dimCm?.width);
                const length = dimUOM === 'IN' ? cmToIn(p.dimCm?.length) : round2(p.dimCm?.length);
                return {
                    PackagingType: { Code: '02' },
                    PackageWeight: { UnitOfMeasurement: { Code: weightUOM }, Weight: String(weight) },
                    Dimensions: { UnitOfMeasurement: { Code: dimUOM }, Height: String(height), Width: String(width), Length: String(length) },
                    PackageServiceOptions: {}
                };
            });

            const ratePayload = {
                RateRequest: {
                    Request: { TransactionReference: { CustomerContext: 'back-exporta' } },
                    Shipment: {
                        Shipper: {
                            ShipperNumber: UPS_ACCOUNT_NUMBER || undefined,
                            Address: {
                                PostalCode: safeShipper.postalCode,
                                CountryCode: safeShipper.country,
                                StateProvinceCode: safeShipper.state,
                                City: safeShipper.city,
                                AddressLine: safeShipper.addressLine
                            }
                        },
                        ShipTo: {
                            Address: {
                                PostalCode: safeShipTo.postalCode,
                                CountryCode: safeShipTo.country,
                                StateProvinceCode: safeShipTo.state,
                                City: safeShipTo.city,
                                AddressLine: safeShipTo.addressLine
                            }
                        },
                        Service: { Code: serviceCode },
                        ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
                        Package: pkgs,
                        PickupType: { Code: '01' },
                        DeliveryTimeInformation: pickupDate ? {
                            PackageBillType: '03',
                            Pickup: { Date: String(pickupDate).replace(/-/g, '') }
                        } : undefined
                    }
                }
            };

            const raw = await rating.quote(ratePayload);

            console.log("[DBG][BACK/RATE] RatedShipment[0]:",
                JSON.stringify(
                    Array.isArray(raw?.RateResponse?.RatedShipment)
                        ? raw.RateResponse.RatedShipment[0]
                        : raw?.RateResponse?.RatedShipment,
                    null, 2
                )
            );

            const rs = raw?.RateResponse?.RatedShipment;
            const items = Array.isArray(rs) ? rs : (rs ? [rs] : []);
            const services = items.map(it => ({
                serviceCode: it?.Service?.Code || null,
                serviceName: it?.Service?.Description || null,
                total: Number(it?.TotalCharges?.MonetaryValue || 0),
                currency: it?.TotalCharges?.CurrencyCode || null,
                negotiated: it?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue
                    ? Number(it.NegotiatedRateCharges.TotalCharge.MonetaryValue)
                    : null,
                delivery: {
                    date: it?.GuaranteedDelivery?.DeliveryDateTime || null,
                    businessDays: it?.GuaranteedDelivery?.BusinessDaysInTransit || null,
                }
            }));

            return res.json({ ok: true, services, raw });
        } catch (e) { next(e); }
    },

    // ---------------- SHIP ----------------
    ship: async (req, res) => {
        const t0 = Date.now();
        try {
            // aceita os dois formatos: negócio (antigo) ou UPS ShipmentRequest (novo do front)
            const originalIF = req.body?.ShipmentRequest?.Shipment?.ShipmentServiceOptions?.InternationalForms;
            console.log('[UPS/SHIP][REQ][IF]:', JSON.stringify(originalIF, null, 2));

            // Sanitizadores locais
            function padQtyStr(n) {
                const x = parseInt(String(n ?? '').replace(/\D+/g, ''), 10);
                if (!x || x < 1) return '1';
                return String(Math.min(x, 9999999));
            }
            function moneyStr(v) {
                const n = Number(v);
                return isNaN(n) ? '0.00' : n.toFixed(2);
            }
            const fixAddr = (node) => {
                if (!node || !node.Address) return;
                const A = node.Address;
                if (A.StateProvinceCode) A.StateProvinceCode = String(A.StateProvinceCode).toUpperCase();
                if (A.PostalCode) A.PostalCode = cleanZip(A.PostalCode);
                if (A.CountryCode) {
                    A.CountryCode = iso2Country(A.CountryCode);
                } else {
                    const fallback =
                        role === 'Shipper' || role === 'ShipFrom' ? 'BR'
                            : role === 'ShipTo' ? 'US'
                                : undefined;

                    if (!fallback) {
                        throw Object.assign(new Error(`Missing ${role.toLowerCase()} country code.`), { http: 400 });
                    }
                    A.CountryCode = fallback;
                }
                if (A.AddressLine && !Array.isArray(A.AddressLine)) A.AddressLine = [String(A.AddressLine)];
                if (Array.isArray(A.AddressLine)) A.AddressLine = A.AddressLine.map(s => String(s).slice(0, 35)).slice(0, 2);
            };
            function cleanCiDesc(s, fallback = 'Item') {
                const out = String(s || '')
                    .replace(/[^A-Za-z0-9 ]+/g, ' ') // só alfanumérico + espaço
                    .replace(/\s+/g, ' ')            // colapsa espaços
                    .trim()
                    .slice(0, 35);                   // limite UPS
                return out || fallback;
            }
            function sanitizeCommercialInvoice(IFraw, shipperTax) {
                if (!IFraw || typeof IFraw !== 'object') return null;
                const IF = { ...IFraw };

                // Força CI em PDF
                IF.FormType = '01';
                IF.ImageFormat = { Code: 'PDF' };

                // Remove campos de NAFTA/CoO
                delete IF.FormGroupIdName;
                delete IF.BlanketPeriod;

                // Data/número/defaults
                IF.InvoiceDate = toYMD(IF.InvoiceDate) || toYMD(new Date());
                IF.InvoiceNumber = String(IF.InvoiceNumber || `INV-${Date.now()}`);
                IF.CurrencyCode = IF.CurrencyCode || 'USD';
                IF.TermsOfShipment = IF.TermsOfShipment || 'DAP';
                IF.ReasonForExport = IF.ReasonForExport || 'SALE';
                IF.TaxInformation = {
                    TaxIDType: 'TAXID',
                    TaxIDNumber: onlyDigits((IF.TaxInformation?.TaxIDNumber || shipperTax || '')).slice(0, 14) || undefined
                };

                const fcRaw = IFraw?.FreightCharges;
                if (fcRaw && (fcRaw.MonetaryValue != null && fcRaw.MonetaryValue !== '')) {
                    const val = moneyStr(fcRaw.MonetaryValue);
                    IF.FreightCharges = { CurrencyCode: fcRaw.CurrencyCode || IF.CurrencyCode || 'USD', MonetaryValue: val };
                }
                // Contatos
                IF.Contacts = IF.Contacts || {};
                IF.Contacts.SoldFrom = IF.Contacts.SoldFrom || {};
                IF.Contacts.SoldFrom.Option = '01';
                IF.Contacts.SoldFrom.TaxIdentificationNumber =
                    onlyDigits((IF.Contacts.SoldFrom.TaxIdentificationNumber || shipperTax || '')).slice(0, 14) || undefined;
                fixAddr(IF.Contacts.SoldFrom);
                IF.Contacts.SoldFrom = IF.Contacts.SoldFrom || {};
                IF.Contacts.SoldFrom.Option = '01';
                IF.Contacts.SoldFrom.TaxIdentificationNumber =
                    onlyDigits((IF.Contacts.SoldFrom.TaxIdentificationNumber || shipperTax || '')).slice(0, 14) || undefined;
                fixAddr(IF.Contacts.SoldFrom);

                // Produtos (formatos estritos)
                if (Array.isArray(IF.Product)) {
                    IF.Product = IF.Product.map((p, i) => {
                        const qty = padQtyStr(p?.Unit?.Number ?? p?.Quantity ?? 1);
                        const val = moneyStr(p?.Unit?.Value ?? p?.UnitPrice ?? 0);
                        console.log('[DBG] IF sanitized:', JSON.stringify(IF, null, 2));
                        return {
                            Description: cleanCiDesc(p?.Description, `Item ${i + 1}`), // <<< aqui
                            CommodityCode: p?.CommodityCode || '00000000',
                            OriginCountryCode: iso2Country(p?.OriginCountryCode || 'BR'),
                            Unit: {
                                UnitOfMeasurement: { Code: p?.Unit?.UnitOfMeasurement?.Code || 'PCS' },
                                Number: qty,   // string numérica 1..7 dígitos
                                Value: val,    // "0.00"
                            },
                            UnitPrice: val,
                        };
                    });
                }

                // Total coerente
                try {
                    const total = (IF.Product || []).reduce((acc, it) => {
                        const n = parseInt(it?.Unit?.Number || '1', 10) || 1;
                        const v = Number(it?.Unit?.Value || it?.UnitPrice || 0) || 0;
                        return acc + n * v;
                    }, 0);
                    IF.InvoiceLineTotal = { CurrencyCode: IF.CurrencyCode, MonetaryValue: moneyStr(total) };
                } catch { /* noop */ }

                return IF;
            }

            let cli = req.body;
            if (cli?.ShipmentRequest?.Shipment) {
                cli = translateFrontShipSRToBiz(cli);
            }

            let rateReq;

            if (req.body?.RateRequest) {
                // (caso raro: se o front já tiver mandado um RateRequest específico)
                rateReq = { RateRequest: req.body.RateRequest };
            } else if (req.body?.ShipmentRequest) {
                // traduz o ShipmentRequest "novo" para RateRequest
                rateReq = translateShipmentRequestToRateRequest(req.body.ShipmentRequest);
            } else {
                // monta a partir do formato "negócio" (cli)
                rateReq = buildRateRequestFromCli(cli);
            }

            // chama a UPS Rating (negotiated preferido)
            let freightFromRate = null;
            try {
                const rateRaw = await rating.quote(rateReq);
                freightFromRate = pickFreightFromRate(rateRaw);
            } catch (e) {
                console.warn('[UPS/SHIP] Falha ao recalcular Rate para FreightCharges (seguindo sem frete na CI).', e?.message);
            }

            const required = ['shipper', 'shipTo', 'serviceCode', 'payment', 'packages'];
            for (const k of required) {
                if (!cli?.[k]) {
                    return res.status(400).json({ ok: false, error: `Campo obrigatório ausente: ${k}` });
                }
            }
            if (!cli.payment?.bill) {
                return res.status(400).json({ ok: false, error: 'payment.bill é obrigatório' });
            }
            if (cli.payment.bill === 'Shipper' && !cli.payment.account) {
                cli.payment.account = UPS_ACCOUNT_NUMBER;
            }

            if (UPS_STUB) {
                return res.json({
                    ok: true,
                    tookMs: Date.now() - t0,
                    trackingNumbers: ['1ZSTUB00000000001'],
                    label: {
                        type: 'PNG',
                        b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJAgP9N8VwQQAAAABJRU5ErkJggg==',
                    },
                    raw: { stub: true },
                });
            }

            const upsReq = mapToUpsShipment(cli);

            // Se o front mandou IF, injeta sanitizado (sobrepõe o base)
            if (originalIF) {
                const shipperTax = onlyDigits(
                    upsReq?.ShipmentRequest?.Shipment?.Shipper?.TaxIdentificationNumber || ''
                ).slice(0, 14);

                const IFok = sanitizeCommercialInvoice(originalIF, shipperTax);
                if (IFok) {
                    upsReq.ShipmentRequest.Shipment.ShipmentServiceOptions = {
                        ...(upsReq.ShipmentRequest.Shipment.ShipmentServiceOptions || {}),
                        InternationalForms: IFok,
                    };
                }
            }

            const IFnode = (
                upsReq?.ShipmentRequest?.Shipment?.ShipmentServiceOptions?.InternationalForms ||
                (upsReq.ShipmentRequest.Shipment.ShipmentServiceOptions = { InternationalForms: {} }, upsReq.ShipmentRequest.Shipment.ShipmentServiceOptions.InternationalForms)
            );

            // Se já veio FreightCharges do front, mantemos.
            // Caso contrário, usamos o valor do Rate (preferindo negotiated).
            if (!IFnode.FreightCharges && freightFromRate?.value) {
                IFnode.FreightCharges = {
                    CurrencyCode: freightFromRate.currency || (IFnode.CurrencyCode || 'USD'),
                    MonetaryValue: String(freightFromRate.value),
                };
            }

            // Log final do que vai pra UPS
            console.log('[UPS/SHIP][UPS_REQ][IF]:', JSON.stringify(
                upsReq?.ShipmentRequest?.Shipment?.ShipmentServiceOptions?.InternationalForms, null, 2
            ));

            const url = `${UPS_BASE}/api/shipments/v2407/ship`;
            const transId = req.headers['x-idempotency-key'] || `tx-${Date.now()}`;
            let token = await getUpsToken();

            const doPost = async (bearer) => axios.post(url, upsReq, {
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Authorization": `Bearer ${bearer}`,
                    "transId": transId,
                    "transactionSrc": "exporta-digital",
                },
                timeout: 20000,
            });

            let resp;
            try {
                resp = await doPost(token);
            } catch (e) {
                const status = e?.response?.status;
                if (status === 401) {
                    token = await getUpsToken(true);
                    resp = await doPost(token);
                } else {
                    throw e;
                }
            }

            const out = mapFromUpsShipment(resp.data);

            // >>> SALVAR NO BANCO SE vier cotacaoId:
            const cotacaoId = req.body?.cotacaoId || req.query?.cotacaoId || null;
            if (cotacaoId) {
                try {
                    const row = await Cotacao.findByPk(cotacaoId);
                    if (!row) {
                        console.warn('[UPS/SHIP] Cotação não encontrada para salvar anexos:', cotacaoId);
                    } else {
                        const patch = {};

                        // tracking
                        if (Array.isArray(out.trackingNumbers) && out.trackingNumbers[0]) {
                            patch.tracking_number = out.trackingNumbers[0];
                        }

                        if (Object.keys(patch).length) {
                            await row.update(patch);
                        }

                        // ===== LABEL → Supabase Storage =====
                        if (out.label?.b64 && out.label?.type) {
                            const mime = labelTypeToMime(out.label.type);
                            console.log('[UPS/SHIP] salvando etiqueta no Supabase', { cotacaoId: row.id, mime });
                            await salvarEtiquetaNaStorage(row.id, out.label.b64, mime);
                        }

                        // ===== INVOICE → Supabase Storage =====
                        if (out.invoice?.b64) {
                            const mime = out.invoice.mime || 'application/pdf';
                            console.log('[UPS/SHIP] salvando invoice no Supabase', { cotacaoId: row.id, mime });
                            await salvarInvoiceNaStorage(row.id, out.invoice.b64, mime);
                        }
                    }
                } catch (errSave) {
                    console.error('[UPS/SHIP] Falha ao salvar label/invoice na Cotacao', {
                        cotacaoId,
                        err: errSave?.message,
                    });
                }
            }


            return res.status(200).json({ ...out, tookMs: Date.now() - t0 });
        } catch (err) {
            if (!err?.response) {
                console.error('[UPS ship network error]', {
                    code: err?.code,
                    message: err?.message,
                    json: typeof err?.toJSON === 'function' ? err.toJSON() : undefined,
                });
            } else {
                console.error('[UPS ship HTTP error]', {
                    status: err?.response?.status,
                    data: err?.response?.data,
                });
            }
            const { status, message, raw } = normalizeUpsError(err);
            return res.status(status).json({ ok: false, error: message, raw });
        }
    },

    // ---------------- TRACK ----------------
    track: async (req, res, next) => {
        try {
            const raw =
                (req.params && req.params.tracking) ||
                (req.query && (req.query.tn || req.query.tracking)) ||
                "";
            const tn = String(raw).trim().replace(/['"`\s]/g, "").toUpperCase();
            if (!tn) return res.status(400).json({ error: "Tracking vazio." });

            const data = await tracking.getByNumber(tn);
            return res.json(data);
        } catch (e) {
            const http = e?.http || e?.status || 400;
            const msg =
                e?.details?.response?.errors?.[0]?.message ||
                e?.details?.Fault?.detail?.Errors?.ErrorDetail?.PrimaryErrorCode?.Description ||
                e?.message || "Falha ao rastrear";

            console.error("[UPS/TRACK][ERR]", msg, e?.details || e);
            return res.status(http).json({ error: msg, details: e?.details });
        }
    },

    // ---------------- PICKUP ----------------
    pickup: async (req, res) => {
        try {
            const body = req.body || {};
            const { PickupCreationRequest } = body;

            if (!PickupCreationRequest) {
                return res.status(400).json({ ok: false, error: 'PickupCreationRequest é obrigatório.' });
            }

            const info = PickupCreationRequest.PickupDateInfo || {};
            const pickupDateRaw = info.PickupDate || "";
            const readyRaw = info.ReadyTime || "";
            const closeRaw = info.CloseTime || "";

            const data_coleta = String(pickupDateRaw).replace(/\D/g, ""); // ex: 20250211
            const ready_hora = String(readyRaw).replace(/\D/g, "");       // ex: 0900
            const close_hora = String(closeRaw).replace(/\D/g, "");       // ex: 1700

            if (!data_coleta) {
                return res.status(400).json({ ok: false, error: 'PickupDate inválido.' });
            }
            if (!ready_hora) {
                return res.status(400).json({ ok: false, error: 'ReadyTime inválido.' });
            }
            if (!close_hora) {
                return res.status(400).json({ ok: false, error: 'CloseTime inválido.' });
            }

            const upsReq = { PickupCreationRequest };

            const url = `${UPS_BASE}/api/pickupcreation/v2407/pickup`;
            const transId = req.headers['x-idempotency-key'] || `pickup-${Date.now()}`;
            let token = await getUpsToken();

            const doPost = async (bearer) =>
                axios.post(url, upsReq, {
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "Authorization": `Bearer ${bearer}`,
                        "transId": transId,
                        "transactionSrc": "exporta-digital",
                    },
                    timeout: 20000,
                });

            let resp;
            try {
                resp = await doPost(token);
            } catch (e) {
                const status = e?.response?.status;
                if (status === 401) {
                    token = await getUpsToken(true);
                    resp = await doPost(token);
                } else {
                    throw e;
                }
            }

            const upsData = resp.data || {};

            // se veio cotacaoId, grava a data/horas na tabela
            const cotacaoId = body.cotacaoId || req.query.cotacaoId || null;
            console.log("PICKUP BODY >>>", JSON.stringify(req.body, null, 2));
            console.log("PICKUP INFO >>>", {
                cotacaoId,
                pickupDateInfo: PickupCreationRequest?.PickupDateInfo,
                data_coleta,
                ready_hora,
                close_hora,
            });
            if (cotacaoId) {
                try {
                    const row = await Cotacao.findByPk(cotacaoId);
                    if (!row) {
                        console.warn('[UPS/PICKUP] Cotação não encontrada:', cotacaoId);
                    } else {
                        await row.update({
                            data_coleta,
                            ready_hora,
                            close_hora,
                        });
                    }
                } catch (errSave) {
                    console.error('[UPS/PICKUP] Falha ao salvar data/horas na Cotacao', {
                        cotacaoId,
                        err: errSave?.message,
                    });
                }
            }

            return res.status(200).json({
                ok: true,
                pickup: upsData,
                data_coleta,
                ready_hora,
                close_hora,
            });
        } catch (err) {
            if (!err?.response) {
                console.error('[UPS/PICKUP network error]', {
                    code: err?.code,
                    message: err?.message,
                    json: typeof err?.toJSON === 'function' ? err.toJSON() : undefined,
                });
            } else {
                console.error('[UPS/PICKUP HTTP error]', {
                    status: err?.response?.status,
                    data: err?.response?.data,
                });
            }

            const { status, message, raw } = normalizeUpsError(err);
            return res.status(status).json({ ok: false, error: message, raw });
        }
    },

};
