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
        const url = `${cfg.worldeaseDelete}/${gccn}`;
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

module.exports = { closeOutShipment, deleteMasterShipment };
