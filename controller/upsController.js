// controller/upsController.js
const rating = require('../services/ups/rating');
const shipping = require('../services/ups/shipping');
const tracking = require('../services/ups/tracking');

function cleanZip(s = '') { return String(s).replace(/['"`\s]/g, '').replace(/\D/g, ''); }
function kgToLbs(kg) { const n = Number(kg) || 0; return +(n * 2.2046226218).toFixed(3); }
function cmToIn(cm) { const n = Number(cm) || 0; return +(n / 2.54).toFixed(2); }
function round2(n) { return +((Number(n) || 0).toFixed(2)); }

const UPS_ACCOUNT_NUMBER =
    process.env.UPS_ACCOUNT_NUMBER || process.env.UPS_ACCOUNT || '';

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
            // ... monte o finalPayload exatamente como já está no seu código ...

            // CHAMA A SUA SERVICE (que usa /api/shipments/v2407/ship do seu config)
            const raw = await shipping.createShipment(finalPayload, {
                idempotencyKey: req.headers['x-idempotency-key']
            });

            // MAPEIA DEPOIS
            const sr = raw?.ShipmentResponse?.ShipmentResults;
            const pkg = sr?.PackageResults;
            const list = (Array.isArray(pkg) ? pkg : [pkg]).filter(Boolean);

            const trackingNumbers = [...list.map(p => p?.TrackingNumber).filter(Boolean)];
            const master = sr?.ShipmentIdentificationNumber;
            if (!trackingNumbers.length && master) trackingNumbers.push(master);

            const first = list[0] || {};
            const labelB64 =
                first?.ShippingLabel?.GraphicImage ||
                first?.LabelImage?.GraphicImage ||
                sr?.LabelImage?.GraphicImage || null;

            const labelType =
                first?.ShippingLabel?.LabelImageFormat?.Code ||
                first?.LabelImage?.LabelImageFormat?.Code ||
                sr?.LabelImage?.LabelImageFormat?.Code || 'PNG';

            return res.status(200).json({
                ok: true,
                tookMs: Date.now() - t0,
                trackingNumbers,
                label: labelB64 ? { b64: labelB64, type: labelType } : null,
                raw
            });
        } catch (e) {
            const status = e?.response?.status || 502;
            return res.status(status).json({
                ok: false,
                error: e?.response?.data || { message: e.message || 'UPS error' }
            });
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
