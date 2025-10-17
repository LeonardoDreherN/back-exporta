// backend/services/ups/tracking.js
const fetch = global.fetch || ((...a) => import('node-fetch').then(m => m.default(...a)));

const UPS_BASE = process.env.UPS_BASE_URL || 'https://onlinetools.ups.com';
const UPS_CLIENT_ID = process.env.UPS_CLIENT_ID || '';
const UPS_CLIENT_SECRET = process.env.UPS_CLIENT_SECRET || '';
const UPS_TRACK_LOCALE = process.env.UPS_TRACK_LOCALE || 'en_US';

// cache bobo de token em memória
let _token = null;
let _tokenExpTs = 0;

async function getAccessToken() {
    const now = Date.now();
    if (_token && now < _tokenExpTs - 60_000) return _token; // reaproveita até 1min antes de expirar

    const url = `${UPS_BASE}/security/v1/oauth/token`;
    const body = new URLSearchParams({ grant_type: 'client_credentials' });

    const r = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-merchant-id': 'intrex-app',              // opcional; algo que identifique sua app
            'Authorization': 'Basic ' + Buffer.from(`${UPS_CLIENT_ID}:${UPS_CLIENT_SECRET}`).toString('base64'),
        },
        body,
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
        const info = (j && JSON.stringify(j)) || r.statusText;
        const err = new Error(`UPS OAuth falhou: ${info}`);
        err.http = r.status;
        err.details = j;
        throw err;
    }

    _token = j.access_token;
    _tokenExpTs = Date.now() + ((j.expires_in || 3600) * 1000);
    return _token;
}

/**
 * Consulta detalhes de rastreamento por número.
 * @param {string} trackingNumber ex: "1Z..." ou número de 18 dígitos
 */
async function getByNumber(trackingNumber) {
    const tn = String(trackingNumber || '').trim();
    if (!tn) {
        const e = new Error('Tracking vazio');
        e.http = 400;
        throw e;
    }

    const token = await getAccessToken();

    // UPS REST Tracking
    const url = `${UPS_BASE}/api/track/v1/details/${encodeURIComponent(tn)}?locale=${encodeURIComponent(UPS_TRACK_LOCALE)}`;

    const r = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'transId': `intrex-${Date.now()}`,     // recomendado pela UPS
            'transactionSrc': 'intrex-app',        // recomendado pela UPS
            'Accept': 'application/json',
        },
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
        const err = new Error(
            j?.response?.errors?.[0]?.message ||
            j?.Fault?.detail?.Errors?.ErrorDetail?.PrimaryErrorCode?.Description ||
            `UPS Track falhou (${r.status})`
        );
        err.http = r.status;
        err.details = j;
        throw err;
    }

    return j; // retorno bruto da UPS; o controller pode reduzir/formatar se quiser
}

// Alias útil caso seu controller chame outro nome
const byNumber = getByNumber;

function fromUPS(evt = {}) {
    const code = String(evt.statusCode || '').toUpperCase();
    const text = [evt.statusDescription, evt.description, evt.activity]
        .filter(Boolean)
        .join(' ')
        .toUpperCase();

    if (code === 'D' || text.includes('DELIVER')) return 'ENTREGUE';
    if (
        code === 'I' ||
        text.includes('IN TRANSIT') ||
        text.includes('PICKUP') ||
        text.includes('DEPART') ||
        text.includes('ARRIV') ||
        text.includes('CLEARING') ||
        text.includes('RELEASE')
    ) return 'EM_TRANSITO';

    return 'CRIADO';
}

function normalize(carrier, evt) {
    if (carrier === 'UPS') return fromUPS(evt);
    return 'CRIADO';
}

function normalizeUpsStatusFromTimeline(events) {
    if (!Array.isArray(events) || events.length === 0) return "CRIADO";

    for (const ev of events) {
        const code = String(ev?.statusCode || "").toUpperCase();
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(" ").toUpperCase();
        if (code === "D" || text.includes("DELIVERED") || text.includes("PROOF OF DELIVERY")) {
            return "ENTREGUE";
        }
    }

    const transitKeywords = [
        "IN TRANSIT", "OUT FOR DELIVERY", "PICKUP SCAN", "ORIGIN SCAN",
        "DEPARTED FROM FACILITY", "ARRIVED AT FACILITY", "DEPARTURE SCAN", "ARRIVAL SCAN",
        "WE HAVE YOUR PACKAGE", "ON THE WAY",
        "PENDING RELEASE FROM A GOVERNMENT AGENCY", "RELEASED BY THE GOVERNMENT AGENCY",
        "CLEARING AGENCY", "AWAITING FINAL RELEASE", "SUBMIT FOR CLEARANCE",
        "IMPORT SCAN", "EXPORT SCAN", "BROKERAGE", "CONTACT WITH THE SENDER"
    ];

    for (const ev of events) {
        const code = String(ev?.statusCode || "").toUpperCase();
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(" ").toUpperCase();
        if (code === "I") return "EM_TRANSITO";
        if (transitKeywords.some(k => text.includes(k))) return "EM_TRANSITO";
    }

    const createdKeywords = [
        "LABEL", "SHIPPER CREATED A LABEL", "HAS NOT RECEIVED THE PACKAGE", "RECEIVED THE INFORMATION NEEDED"
    ];
    for (const ev of events) {
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(" ").toUpperCase();
        if (createdKeywords.some(k => text.includes(k))) return "CRIADO";
    }
    return "CRIADO";
}

module.exports = { getByNumber, byNumber, normalize, normalizeUpsStatusFromTimeline };
