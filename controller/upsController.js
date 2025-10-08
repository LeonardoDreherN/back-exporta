// controller/upsController.js
const rating = require('../services/ups/rating');
const shipping = require('../services/ups/shipping');
const tracking = require('../services/ups/tracking');

const axios = require('axios')


// ====== CONFIG ======
const UPS_BASE = process.env.UPS_BASE_URL_PROD || 'https://onlinetools.ups.com';
const UPS_OAUTH_TOKEN = process.env.UPS_OAUTH_TOKEN || 'eyJraWQiOiI5NzllNmVhYy1iZmExLTQzZmQtYTliZi05NTBhYzE0OGVkNjMiLCJ0eXAiOiJKV1QiLCJhbGciOiJSUzM4NCJ9.eyJzdWIiOiJqdWxpYWV4cG9ydGFkaWdpdGFsQGdtYWlsLmNvbSIsImNsaWVudGlkIjoiWThTYldsVVVjUGtUZTdOWkVBZ0JHUU03bEdnc09RZ0F2SVUyOHUwVWlucEtVZFc4IiwiaXNzIjoiaHR0cHM6Ly9hcGlzLnVwcy5jb20iLCJ1dWlkIjoiQTgwMzIwNTgtOThGOC0xMTVDLTlGRTEtNkZBOTU5QkVERjUzIiwic2lkIjoiOTc5ZTZlYWMtYmZhMS00M2ZkLWE5YmYtOTUwYWMxNDhlZDYzIiwiYXVkIjoiSW50cmV4IiwiYXQiOiJIVGh4QlRNUDl3U0NEa1d1MmNPTG94bUFwWmF6IiwibmJmIjoxNzU5OTI1OTQ0LCJEaXNwbGF5TmFtZSI6IkludHJleCIsImV4cCI6MTc1OTk0MDM0NCwiaWF0IjoxNzU5OTI1OTQ0LCJqdGkiOiI1MWM5MmJkNC0wNDc5LTRmNjUtODk1YS04MmRiOWQwZTczNTQifQ.UKyfHsHMdjOnE5txdl2Fr94cJOkkuL4chL1Ow7a98s1MgNqrpshyjr-a8nUwL186QzHzhezBfcO1CZc2Qd5KTtKYMYijacm3SvhyZUD4vBu73xpQnN8AN6O5gJCMVdRWcOVlIFUvRAWRsGPOwvMAco-wBJVe2LcGKwT3C87W6Lepeg4No6B4iMJ8rree3t1a7pxixwOep7TIv8kmhfVULhIumUEBWKeUxCk0O0dTLE8dimHg0I0jp82Ib4kMrOCFoJHYPL366CGjGDAmsHvP5M3jnuDmn3Hlsz_CS6p6kgv43HQnY-4GXvb4yC929XFtiVhMI4I7-hI2nhIALqn-UiDvF989lj7kea6g6JPcYRLwgF59J5qB5aInfUFJkRk0DUiiEvWV5Ojja5d78llxRUPRvHLI5ZQjy2nywry5fGUrr6-bnG8YYrvv0fgL5WSK_V4NWQNqm_EjYV5Zu2K-D6bJSsV129fIk1SOTqv86IBikcpHqys6qj8nbL3MH_YymLuar_a7JpmFPUFQO4EhhczMai91lRRcmTeM2_SNy8sTEsrAtaReyRa6tCcpi1oQsgZFa1frIggKAbXeUdmq05Lmjz8_egzc_nQ-lTKXh930-uwIAIoX-RmiV4Sm2MaIK2Cts3rb8DkxihzsKzrIlOBZfy7elfYAC3i_41l9xFs'; // se usar OAuth, injete aqui
const UPS_ACCOUNT_NUMBER = process.env.UPS_ACCOUNT_NUMBER || 'JE8372'; // ex: "JE8372"
// use STUB=true para simular resposta e testar o front sem a UPS
const UPS_STUB = String(process.env.UPS_STUB || '') === 'true';


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
    };
    return map[x] || (x.length === 2 ? x : undefined);
}
function isoState(s) { return String(s || '').trim().toUpperCase(); }

function normalizeUpsError(err) {
    // status preferencialmente do upstream; senão, 400 se foi validação sua; senão, 500
    const status = err?.response?.status || 500;

    // tenta capturar mensagens comuns da UPS / axios
    const data = err?.response?.data;
    const msg =
        // sua API pode já mandar { error: "..." }
        (typeof data?.error === 'string' && data.error) ||
        // alguns retornos: { error: { message: "..." } }
        (typeof data?.error?.message === 'string' && data.error.message) ||
        // API UPS JSON (exemplos frequentes)
        data?.response?.errors?.[0]?.message ||
        data?.Fault?.detail?.Errors?.ErrorDetail?.PrimaryErrorCode?.Description ||
        data?.Fault?.reason?.Text ||
        // axios / generic
        (typeof err?.message === 'string' && err.message) ||
        'Falha ao emitir remessa';

    return { status, message: msg, raw: data };
}

// ====== HELPERS ======
function normalizeUpsError(err) {
    // Sem resposta => erro de rede/timeout/autenticação
    const status = err?.response?.status || 500;

    let message =
        err?.response?.data?.response?.errors?.[0]?.message ||
        err?.response?.data?.Fault?.detail?.Errors?.ErrorDetail?.PrimaryErrorCode?.Description ||
        err?.response?.data?.error?.message ||
        err?.response?.data?.error ||
        err?.message ||
        'Falha ao emitir remessa';

    // Para debug local, inclua err.code quando não houver response
    if (!err?.response && err?.code) {
        message = `${message} (code=${err.code})`;
    }

    const raw = err?.response?.data;
    return { status, message, raw };
}

// Concatena rua + número de forma segura
function joinAddressLine(rua, numero) {
    const a = String(rua || '').trim();
    const b = String(numero || '').trim();
    return [a, b].filter(Boolean).join(', ');
}

// Mapeia seu UpsShipRequest => payload REST da UPS (Ship v2407+)
function mapToUpsShipment(reqBody) {
    const { shipper, shipFrom, shipTo, serviceCode, payment, packages, invoice } = reqBody;

    // Address helper (UPS REST atual usa AddressKeyFormat)
    const addr = (p) => ({
        Name: p?.nome || undefined,
        Phone: { Number: p?.telefone ? String(p.telefone) : undefined },
        Address: {
            AddressLine: [joinAddressLine(p?.rua, p?.numero)].filter(Boolean),
            City: p?.cidade,
            StateProvinceCode: p?.estado?.toUpperCase(),
            PostalCode: String(p?.cep || '').replace(/\D/g, ''),
            CountryCode: p?.pais?.toUpperCase(),
        },
    });

    // Payment: Shipper / Receiver / ThirdParty
    const paymentInformation = (() => {
        const bill = payment?.bill;
        const account = payment?.account || UPS_ACCOUNT_NUMBER || undefined;

        if (bill === 'Shipper') {
            return { ShipmentCharge: { Type: '01', BillShipper: { AccountNumber: account } } };
        } else if (bill === 'Receiver') {
            return { ShipmentCharge: { Type: '02', BillReceiver: { AccountNumber: account, Address: { PostalCode: addr(shipTo).Address.PostalCode, CountryCode: addr(shipTo).Address.CountryCode } } } };
        } else { // ThirdParty
            return { ShipmentCharge: { Type: '03', BillThirdParty: { AccountNumber: account, Address: { PostalCode: addr(shipper).Address.PostalCode, CountryCode: addr(shipper).Address.CountryCode } } } };
        }
    })();

    // Pacotes
    const pkgList = (packages || []).map((p, i) => ({
        Description: p?.reference || `PKG-${i + 1}`,
        Packaging: { Code: '02' }, // Customer Supplied Package
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

    // Label (PNG 4x6)
    const labelSpec = {
        LabelImageFormat: { Code: 'PNG' },
        LabelStockSize: { Height: '6', Width: '4' }, // 4x6 em polegadas
    };

    // Commercial Invoice (opcional)
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
            // Conteúdo mínimo por item (simplificado)
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

    // Shipper Number (obrigatório p/ Bill Shipper)
    const shipperNumber = UPS_ACCOUNT_NUMBER || payment?.account || undefined;

    // Shipment (REST)
    const shipment = {
        ShipmentRequest: {
            Request: { RequestOption: 'nonvalidate' },
            Shipment: {
                Description: 'Order',
                Shipper: { ...addr(shipper), ShipperNumber: shipperNumber },
                ShipFrom: shipFrom ? addr(shipFrom) : addr(shipper),
                ShipTo: addr(shipTo),
                PaymentInformation: paymentInformation,
                Service: { Code: serviceCode }, // "07" (Express), "65" (Saver), etc.
                Package: pkgList,
                // Paperless / Invoice (opcional)
                Invoice: invoiceSec,
                // Label spec
                LabelSpecification: labelSpec,
            },
        },
    };

    return shipment;
}

// Mapeia payload UPS => sua resposta
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

    return {
        ok: true,
        trackingNumbers,
        label: labelB64 ? { b64: labelB64, type: labelType } : null,
        raw,
    };
}


module.exports = {
    // ---------------- RATE ----------------
    rate: async (req, res, next) => {
        try {
            const { shipper = {}, shipTo = {}, pickupDate, serviceCode, packages = [] } = req.body || {};

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

            // chama UPS
            const raw = await rating.quote(ratePayload);

            // ---- mapeia resposta em formato simples ----
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
            const cli = req.body;

            // validações mínimas
            const required = ['shipper', 'shipTo', 'serviceCode', 'payment', 'packages'];
            for (const k of required) {
                if (!cli?.[k]) {
                    return res.status(400).json({ ok: false, error: `Campo obrigatório ausente: ${k}` });
                }
            }
            if (!cli.payment?.bill) {
                return res.status(400).json({ ok: false, error: 'payment.bill é obrigatório' });
            }

            // fallback da conta para Bill Shipper
            if (cli.payment.bill === 'Shipper' && !cli.payment.account) {
                cli.payment.account = UPS_ACCOUNT_NUMBER;
            }

            // modo stub (teste sem UPS)
            if (UPS_STUB) {
                return res.json({
                    ok: true,
                    tookMs: Date.now() - t0,
                    trackingNumbers: ['1ZSTUB00000000001'],
                    label: {
                        type: 'PNG',
                        b64:
                            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJAgP9N8VwQQAAAABJRU5ErkJggg==', // 1x1 png
                    },
                    raw: { stub: true },
                });
            }

            // monta payload UPS
            const upsReq = mapToUpsShipment(cli);

            // chamada UPS (REST)
            const url = `${UPS_BASE}/api/shipments/v2407/ship`;
            const headers = {
                'Content-Type': 'application/json',
                // Se uso OAuth: Authorization
                ...(UPS_OAUTH_TOKEN ? { Authorization: `Bearer ${UPS_OAUTH_TOKEN}` } : {}),
                transId: req.headers['x-idempotency-key'] || `tx-${Date.now()}`,
                transactionSrc: 'exporta-digital',
            };

            const resp = await axios.post(url, upsReq, { headers, timeout: 20000 });
            const out = mapFromUpsShipment(resp.data);

            return res.status(200).json({ ...out, tookMs: Date.now() - t0 });
        } catch (err) {
            // LOG detalhado para casos sem response
            if (!err?.response) {
                console.error('[UPS ship network error]', {
                    code: err?.code,
                    message: err?.message,
                    // axios v1: toJSON traz config/headers (cuidado para não logar secrets em prod)
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
    // controller/upsController.js
    track: async (req, res, next) => {
        try {
            const raw =
                (req.params && req.params.tracking) ||
                (req.query && (req.query.tn || req.query.tracking)) ||
                "";

            const tn = String(raw).trim().replace(/['"`\s]/g, "").toUpperCase();
            if (!tn) return res.status(400).json({ error: "Tracking vazio." });

            const data = await tracking.getByNumber(tn); // <- agora EXISTE
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
