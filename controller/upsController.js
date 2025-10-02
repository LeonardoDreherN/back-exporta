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
    ship: async (req, res, next) => {
        try {
            const {
                shipper = {},          // { nome, telefone, rua, numero, complemento, cidade, estado, cep, pais }
                shipTo = {},           // idem
                serviceCode,           // ex: "07"
                packages = [],         // [{ weightKg, dimCm: {height,width,length}, reference? }]
                payment = { bill: 'Shipper' },
                invoice = null,        // { currency, items: [...] } | null
                label,                 // { format?: 'PNG'|'ZPL', stockSize?: { widthIn,heightIn } }
            } = req.body || {};

            // Somente Bill Shipper habilitado
            const payBill = String(payment?.bill || 'Shipper');
            if (payBill !== 'Shipper') {
                return res.status(400).json({
                    ok: false,
                    error: 'Somente “Bill Shipper” está habilitado neste ambiente.'
                });
            }
            if (!UPS_ACCOUNT_NUMBER) {
                return res.status(400).json({
                    ok: false,
                    error: 'Defina UPS_ACCOUNT_NUMBER no .env para Bill Shipper.'
                });
            }

            const shipperCountry = iso2Country(shipper.pais);
            const shipToCountry = iso2Country(shipTo.pais);
            const { w: weightUOM, d: dimUOM } = unitsForCountry(shipperCountry);

            const addrLine = (p) => {
                const a = [[p.rua, p.numero].filter(Boolean).join(', '), p.complemento].filter(Boolean);
                return a.length ? a : [[p.rua, p.numero].filter(Boolean).join(', ')];
            };

            const upsShipper = {
                Name: shipper.nome || shipper.company || 'Shipper',
                AttentionName: shipper.nome || 'Contato',
                ShipperNumber: UPS_ACCOUNT_NUMBER,
                Phone: { Number: String(shipper.telefone || '').replace(/\D/g, '').slice(0, 15) || '0000000000' },
                Address: {
                    AddressLine: addrLine(shipper),
                    City: shipper.cidade,
                    StateProvinceCode: isoState(shipper.estado),
                    PostalCode: cleanZip(shipper.cep),
                    CountryCode: shipperCountry,
                }
            };

            const upsShipFrom = { ...upsShipper };

            const upsShipTo = {
                Name: shipTo.nome || 'Recebedor',
                AttentionName: shipTo.nome || 'Contato',
                Phone: { Number: String(shipTo.telefone || '').replace(/\D/g, '').slice(0, 15) || '0000000000' },
                Address: {
                    AddressLine: addrLine(shipTo),
                    City: shipTo.cidade,
                    StateProvinceCode: isoState(shipTo.estado),
                    PostalCode: cleanZip(shipTo.cep),
                    CountryCode: shipToCountry,
                }
            };

            const upsPackages = packages.map((p) => {
                const weight = weightUOM === 'LBS' ? kgToLbs(p.weightKg) : round2(p.weightKg);
                const h = dimUOM === 'IN' ? cmToIn(p?.dimCm?.height) : round2(p?.dimCm?.height);
                const w = dimUOM === 'IN' ? cmToIn(p?.dimCm?.width) : round2(p?.dimCm?.width);
                const l = dimUOM === 'IN' ? cmToIn(p?.dimCm?.length) : round2(p?.dimCm?.length);
                return {
                    Description: 'General merchandise',
                    Packaging: { Code: '02' },
                    Dimensions: { UnitOfMeasurement: { Code: dimUOM }, Length: String(l), Width: String(w), Height: String(h) },
                    PackageWeight: { UnitOfMeasurement: { Code: weightUOM }, Weight: String(weight) }
                };
            });

            const PaymentInformation = {
                ShipmentCharge: { Type: '01', BillShipper: { AccountNumber: UPS_ACCOUNT_NUMBER } }
            };

            let Products = undefined;
            if (invoice && Array.isArray(invoice.items) && invoice.items.length) {
                Products = invoice.items.map((it) => ({
                    Description: it.description || it.titulo || it.sku || 'Item',
                    OriginCountryCode: (it.countryOfOrigin || shipperCountry),
                    CommodityCode: it.hscode || undefined,
                    NumberOfPackagesPerCommodity: '1',
                    Unit: { Number: String(it.quantity || 1), Value: String(it.unitPrice || 0), UnitOfMeasurement: { Code: 'PCS' } },
                    Weight: it.weightKg
                        ? { UnitOfMeasurement: { Code: weightUOM }, Weight: String(weightUOM === 'LBS' ? kgToLbs(it.weightKg) : round2(it.weightKg)) }
                        : undefined,
                }));
            }

            const ShipmentRequest = {
                Request: { RequestOption: 'nonvalidate', TransactionReference: { CustomerContext: 'back-exporta' } },
                Shipment: {
                    Description: `Exporta - ${shipper.nome || ''} -> ${shipTo.nome || ''}`.slice(0, 35),
                    Shipper: upsShipper,
                    ShipFrom: upsShipFrom,
                    ShipTo: upsShipTo,
                    PaymentInformation,
                    Service: { Code: serviceCode || '07' },
                    Package: upsPackages,
                    ...(Products ? { Product: Products } : {})
                }
            };

            const LabelSpecification = {
                LabelImageFormat: { Code: (label?.format || 'PNG') },
                LabelStockSize: label?.stockSize
                    ? { Width: String(label.stockSize.widthIn || 4), Height: String(label.stockSize.heightIn || 6) }
                    : { Width: '4', Height: '6' }
            };

            const finalPayload = { ShipmentRequest, LabelSpecification };

            // chama UPS

            // ---- mapeia resposta em formato simples esperado pelo front ----
            const sr = raw?.ShipmentResponse?.ShipmentResults;
            const pkg = sr?.PackageResults;
            const list = (Array.isArray(pkg) ? pkg : [pkg]).filter(Boolean);

            const trackingNumbers = [
                ...list.map(p => p?.TrackingNumber).filter(Boolean),
            ];
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

            const raw = await shipping.createShipment(finalPayload, {
                idempotencyKey: req.headers['x-idempotency-key']
            });

            console.log("[UPS/SHIP] payload:", JSON.stringify(finalPayload, null, 2));
            console.log("[UPS/SHIP] resp:", JSON.stringify(raw, null, 2)); // <- usar raw

            return res.json({
                ok: true,
                trackingNumbers,
                label: labelB64 ? { b64: labelB64, type: labelType } : null,
                raw // opcional para debug
            });
        } catch (e) { next(e); }
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
