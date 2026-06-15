const axios = require('axios');
const { getUpsToken } = require('../upsAuth');
const cfg = require('../../config/ups');
const { v4: uuidv4 } = require('uuid');

function extractUpsMessage(err) {
    const data = err?.response?.data;
    if (!data) return null;
    return (
        data?.response?.errors?.[0]?.message ||
        data?.response?.errors?.[0]?.code ||
        data?.error_description ||
        data?.error ||
        null
    );
}

async function closeOutShipment({ gccn, shipperAccountNumber, clientId, clientSecret, merchantId }) {
    try {
        const token = await getUpsToken(false, { clientId, clientSecret, merchantId });
        const url = `${cfg.worldeaseCloseout}/${gccn}`;
        const res = await axios.post(
            url,
            { shipperAccountNumber },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    transId: uuidv4().replace(/-/g, '').slice(0, 32),
                    transactionSrc: 'intrex-exporta',
                },
                timeout: cfg.timeoutMs,
            }
        );
        return res.data;
    } catch (err) {
        const status = err?.response?.status || 500;
        console.error('[WorldEase] closeout error =>', {
            status,
            gccn,
            data: err?.response?.data,
        });
        const e = new Error(extractUpsMessage(err) || `WorldEase CloseOut failed (${status})`);
        e.status = status;
        e.upstream = err?.response?.data;
        throw e;
    }
}

async function deleteMasterShipment({ gccn, shipperAccountNumber, clientId, clientSecret, merchantId }) {
    try {
        const token = await getUpsToken(false, { clientId, clientSecret, merchantId });
        const url = `${cfg.worldeaseMaster}/${gccn}`;
        const res = await axios.delete(url, {
            data: { shipperAccountNumber },
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                transId: uuidv4().replace(/-/g, '').slice(0, 32),
                transactionSrc: 'intrex-exporta',
            },
            timeout: cfg.timeoutMs,
        });
        return res.data;
    } catch (err) {
        const status = err?.response?.status || 500;
        console.error('[WorldEase] delete error =>', {
            status,
            gccn,
            data: err?.response?.data,
        });
        const e = new Error(extractUpsMessage(err) || `WorldEase Delete failed (${status})`);
        e.status = status;
        e.upstream = err?.response?.data;
        throw e;
    }
}

async function createMasterShipment({ shipper, shipperAccountNumber, clientId, clientSecret, merchantId, destinationCountryCode = 'US', chargeType = 'PRE' }) {
    try {
        const token = await getUpsToken(false, { clientId, clientSecret, merchantId });

        const payload = {
            ShipmentRequest: {
                Request: {
                    RequestOption: 'nonvalidate',
                    SubVersion: '2205',
                    TransactionReference: { CustomerContext: 'WorldEase Master' },
                },
                Shipment: {
                    Shipper: {
                        Name: shipper.name,
                        ShipperNumber: shipperAccountNumber,
                        Address: {
                            AddressLine: [shipper.address],
                            City: shipper.city,
                            StateProvinceCode: shipper.state,
                            PostalCode: shipper.zip,
                            CountryCode: shipper.country || 'BR',
                        },
                    },
                    ShipTo: {
                        Name: 'UPS WorldEase Hub',
                        Address: {
                            AddressLine: [process.env.UPS_WE_HUB_ADDRESS || '9800 NW 21st Street'],
                            City: process.env.UPS_WE_HUB_CITY || 'MIAMI',
                            StateProvinceCode: process.env.UPS_WE_HUB_STATE || 'FL',
                            PostalCode: process.env.UPS_WE_HUB_ZIP || '33126',
                            CountryCode: destinationCountryCode,
                        },
                    },
                    PaymentInformation: {
                        ShipmentCharge: {
                            Type: '01',
                            BillShipper: { AccountNumber: shipperAccountNumber },
                        },
                    },
                    Service: { Code: process.env.UPS_WE_SERVICE_CODE || '65' },
                    Package: {
                        PackagingType: { Code: '02' },
                        PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: '1' },
                    },
                    WorldEase: {
                        DestinationCountryCode: destinationCountryCode,
                        MasterHasDocBox: '0',
                        MasterShipmentChgType: chargeType,
                    },
                },
            },
        };

        const res = await axios.post(cfg.ship, payload, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                transId: uuidv4().replace(/-/g, '').slice(0, 32),
                transactionSrc: 'intrex-exporta',
            },
            timeout: cfg.timeoutMs,
        });

        const sr = res.data?.ShipmentResponse?.ShipmentResults;
        const gccn = sr?.GCCN || null;
        const trackingNumber = sr?.PackageResults?.[0]?.TrackingNumber || sr?.ShipmentIdentificationNumber || null;

        return { gccn, trackingNumber, raw: res.data };
    } catch (err) {
        const status = err?.response?.status || 500;
        console.error('[WorldEase] createMaster error =>', {
            status,
            data: err?.response?.data,
        });
        const e = new Error(extractUpsMessage(err) || `WorldEase CreateMaster failed (${status})`);
        e.status = status;
        e.upstream = err?.response?.data;
        throw e;
    }
}

module.exports = { createMasterShipment, closeOutShipment, deleteMasterShipment };
