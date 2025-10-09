// controller/upsController.js
const { default: axios } = require('axios');
const rating = require('../services/ups/rating');
const shipping = require('../services/ups/shipping');
const tracking = require('../services/ups/tracking');

// ====== CONFIG ======
const UPS_BASE = process.env.UPS_BASE || 'https://wwwcie.ups.com';
const UPS_OAUTH_TOKEN = process.env.UPS_OAUTH_TOKEN || '';
const UPS_ACCOUNT_NUMBER = process.env.UPS_ACCOUNT_NUMBER || 'JE8372';
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

// ====== ERROS (removida a duplicação) ======
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
function joinAddressLine(rua, numero) {
    const a = String(rua || '').trim();
    const b = String(numero || '').trim();
    return [a, b].filter(Boolean).join(', ');
}

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

/**
 * Traduz o NOVO payload do front (ShipmentRequest-like) para um RateRequest da UPS Rating.
 * Ignora InternationalForms/Contacts (não usados em Rating).
 */
function translateShipmentRequestToRateRequest(frontSR) {
    const S = frontSR?.Shipment || {};
    const shipper = S?.Shipper || {};
    const shipTo = S?.ShipTo || {};
    const service = S?.Service || {};
    const pkg1 = S?.Package || S?.Packages; // teu front manda 1 só

    // Extrai address minimal
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

    // Monta pacote(s)
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
    const { shipper, shipFrom, shipTo, serviceCode, payment, packages, invoice } = reqBody;

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

    const invoiceSec = invoice
        ? {
            InvoiceLineTotal: {
                CurrencyCode: invoice.currency || 'USD',
                MonetaryValue: String(
                    (invoice.items || []).reduce(
                        (sum, it) => sum + (Number(it.unitPrice || 0) * Number(it.quantity || 0)),
                        0
                    )
                ),
            },
            Merchandise: (invoice.items || []).map((it) => ({
                Description: it.description || 'Item',
                Quantity: { Value: String(it.quantity || 1), UnitOfMeasurement: { Code: 'PCS' } },
                UnitPrice: { CurrencyCode: invoice.currency || 'USD', MonetaryValue: String(it.unitPrice || 0) },
                CommodityCode: it.hscode,
                CountryOfOrigin: it.countryOfOrigin || 'BR',
                Weight: it.weightKg
                    ? { UnitOfMeasurement: { Code: 'KGS' }, Weight: String(it.weightKg) }
                    : undefined,
            })),
        }
        : undefined;

    const shipperNumber = UPS_ACCOUNT_NUMBER || payment?.account || undefined;

    const shipment = {
        ShipmentRequest: {
            Request: { RequestOption: 'nonvalidate' },
            Shipment: {
                Description: 'Order',
                Shipper: { ...addr(shipper, 'Shipper'), ShipperNumber: shipperNumber },
                ShipFrom: shipFrom ? addr(shipFrom, 'ShipFrom') : addr(shipper, 'ShipFrom'),
                ShipTo: addr(shipTo, 'Recipient'),
                PaymentInformation: paymentInformation,
                Service: { Code: serviceCode },
                Package: pkgList,
                Invoice: invoiceSec,
                LabelSpecification: labelSpec,
            },
        },
    };

    return shipment;
}

// Aceita vários formatos de retorno de label
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

    // Se veio link (LabelLinksIndicator), repassa como "type:url"
    const labelHref =
        first?.ShippingLabel?.URL ||
        first?.LabelImage?.URL ||
        sr?.LabelImage?.URL ||
        null;

    return {
        ok: true,
        trackingNumbers,
        label: labelB64
            ? { b64: labelB64, type: labelType }
            : (labelHref ? { href: labelHref, type: 'URL' } : null),
        raw,
    };
}

function translateFrontShipSRToBiz(body) {
    const SR = body?.ShipmentRequest || {};
    const S = SR?.Shipment || {};

    // helper: Address UPS -> Endereco (negócio)
    const toBizAddr = (node, fallbackName = 'N/A') => {
        const A = node?.Address || {};
        const addrLines = Array.isArray(A.AddressLine) ? A.AddressLine : (A.AddressLine ? [A.AddressLine] : []);
        const line1 = (addrLines[0] || '').toString();
        const line2 = (addrLines[1] || '').toString() || undefined;

        // tenta separar "rua, numero"
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

    // payment
    const charge = S?.PaymentInformation?.ShipmentCharge;
    const type = (charge?.Type || '').toString();
    const typeToBill = (t) => (t === '01' ? 'Shipper' : t === '02' ? 'Receiver' : 'ThirdParty');
    const paymentBiz = {
        bill: typeToBill(type),
        account: (charge?.BillShipper?.AccountNumber ||
            charge?.BillReceiver?.AccountNumber ||
            charge?.BillThirdParty?.AccountNumber || '').toString() || undefined
    };

    // packages (array)
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

    // invoice (opcional) – aproveita InternationalForms
    const IF = S?.ShipmentServiceOptions?.InternationalForms;
    const invoiceBiz = IF ? {
        currency: IF.CurrencyCode || 'USD',
        items: Array.isArray(IF.Product) ? IF.Product.map((pr) => ({
            description: pr?.Description || 'Item',
            quantity: Number(pr?.Unit?.Number ?? 1) || 1,
            unitPrice: Number(pr?.UnitPrice ?? pr?.Unit?.Value ?? 0) || 0,
            hscode: pr?.CommodityCode || undefined,
            countryOfOrigin: pr?.OriginCountryCode || undefined,
            weightKg: undefined, // se tiver em outro campo, mapeie aqui
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

            // NOVO FORMATO vindo do front: body.ShipmentRequest.{Shipment,...}
            if (body?.RateRequest) {
                // usa o RateRequest que veio do front, sem traduzir
                const rr = body.RateRequest;

                // normalizadores simples para não quebrar por detalhe de formato
                const fixAddr = (node) => {
                    if (!node || !node.Address) return;
                    const A = node.Address;

                    // AddressLine precisa ser array na UPS
                    if (A.AddressLine && !Array.isArray(A.AddressLine)) {
                        A.AddressLine = [String(A.AddressLine)];
                    }

                    // CountryCode não pode faltar
                    if (!A.CountryCode) {
                        // tenta inferir de algo já presente; se nada, falha controlada
                        const cc = iso2Country(A.CountryCode) || undefined;
                        if (!cc) {
                            throw Object.assign(new Error("Missing shipper country code."), { http: 400 });
                        }
                        A.CountryCode = cc;
                    } else {
                        // garante ISO-2
                        A.CountryCode = iso2Country(A.CountryCode);
                    }
                };

                // aplica nos três pontos relevantes
                fixAddr(rr?.Shipment?.Shipper);
                fixAddr(rr?.Shipment?.ShipFrom);
                fixAddr(rr?.Shipment?.ShipTo);

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
    // ---------------- SHIP ----------------
    ship: async (req, res) => {
        const t0 = Date.now();
        try {
            // aceita os dois formatos: negócio (antigo) ou UPS ShipmentRequest (novo do front)
            let cli = req.body;
            if (cli?.ShipmentRequest?.Shipment) {
                cli = translateFrontShipSRToBiz(cli);
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
    }
};
