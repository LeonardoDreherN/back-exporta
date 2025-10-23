// services/ups/tracking.js
// Requisitos de env:
// UPS_BASE_URL=https://onlinetools.ups.com
// UPS_CLIENT_ID=...
// UPS_CLIENT_SECRET=...
// UPS_TRACK_LOCALE=en_US

const fetch = global.fetch || ((...a) => import('node-fetch').then(m => m.default(...a)));

const UPS_BASE = process.env.UPS_BASE_URL || 'https://onlinetools.ups.com';
const UPS_CLIENT_ID = process.env.UPS_CLIENT_ID || '';
const UPS_CLIENT_SECRET = process.env.UPS_CLIENT_SECRET || '';
const UPS_TRACK_LOCALE = process.env.UPS_TRACK_LOCALE || 'en_US';

// Cache simples de OAuth
let _token = null;
let _tokenExpTs = 0;

async function getAccessToken() {
    const now = Date.now();
    if (_token && now < _tokenExpTs - 60_000) return _token;

    const url = `${UPS_BASE}/security/v1/oauth/token`;
    const body = new URLSearchParams({ grant_type: 'client_credentials' });

    const r = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-merchant-id': 'intrex-app',
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
 * Consulta detalhes de rastreamento por número (REST v1).
 * @param {string} trackingNumber ex.: "1Z..." ou 18 dígitos
 */
async function getByNumber(trackingNumber) {
    const tn = String(trackingNumber || '').trim();
    if (!tn) {
        const e = new Error('Tracking vazio');
        e.http = 400;
        throw e;
    }

    const token = await getAccessToken();
    const url = `${UPS_BASE}/api/track/v1/details/${encodeURIComponent(tn)}?locale=${encodeURIComponent(UPS_TRACK_LOCALE)}`;

    const r = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'transId': `intrex-${Date.now()}`,
            'transactionSrc': 'intrex-app',
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

    return j; // retorno bruto
}

/**
 * Extrai e normaliza a atividade mais recente retornada pela UPS.
 * Retorna objeto com {statusCode, statusDescription, description, activity, dateTime, eventTime, raw}
 */
function pickLatestUpsActivity(json) {
    const acts = [];

    // Variante principal
    const s1 = json?.trackResponse?.shipments;
    if (Array.isArray(s1)) {
        for (const sh of s1) {
            const pkgs = sh?.packages;
            if (Array.isArray(pkgs)) {
                for (const p of pkgs) {
                    if (Array.isArray(p?.activity)) acts.push(...p.activity);
                }
            }
        }
    }

    // Algumas contas retornam no singular
    const s2 = json?.trackResponse?.shipment;
    if (Array.isArray(s2)) {
        for (const sh of s2) {
            const pkgs = sh?.package;
            if (Array.isArray(pkgs)) {
                for (const p of pkgs) {
                    if (Array.isArray(p?.activity)) acts.push(...p.activity);
                }
            }
        }
    }

    if (!acts.length) return null;

    const norm = acts.map(a => {
        let dt = null;
        if (a?.dateTime) {
            dt = new Date(a.dateTime);
        } else if (a?.date && a?.time) {
            // date=YYYYMMDD, time=HHMMSS
            const y = a.date.slice(0, 4);
            const m = a.date.slice(4, 6);
            const d = a.date.slice(6, 8);
            const hh = (a.time || '').slice(0, 2) || '00';
            const mm = (a.time || '').slice(2, 4) || '00';
            const ss = (a.time || '').slice(4, 6) || '00';
            dt = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
        }

        return {
            statusCode: a?.statusCode || a?.status?.type || a?.status?.code || '',
            statusDescription: a?.statusDescription || a?.status?.description || '',
            description: a?.description || '',
            activity: a?.activity || a?.statusDescription || '',
            dateTime: a?.dateTime || null,
            eventTime: dt ? dt.toISOString() : null,
            raw: a,
        };
    });

    norm.sort((a, b) => (Date.parse(b.eventTime || 0) - Date.parse(a.eventTime || 0)));
    return norm[0] || null;
}

/**
 * Devolve o último evento normalizado para o carrier informado.
 */
async function getLatestEvent(carrier, trackingNumber) {
    if (carrier === 'UPS') {
        const json = await getByNumber(trackingNumber);
        return pickLatestUpsActivity(json);
    }
    // Extenda aqui para outros carriers no futuro
    return null;
}

/** Normalização simples para status_norm */
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
    if (!Array.isArray(events) || events.length === 0) return 'CRIADO';

    for (const ev of events) {
        const code = String(ev?.statusCode || '').toUpperCase();
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(' ').toUpperCase();
        if (code === 'D' || text.includes('DELIVERED') || text.includes('PROOF OF DELIVERY')) {
            return 'ENTREGUE';
        }
    }

    const transitKeywords = [
        'IN TRANSIT', 'OUT FOR DELIVERY', 'PICKUP SCAN', 'ORIGIN SCAN',
        'DEPARTED FROM FACILITY', 'ARRIVED AT FACILITY', 'DEPARTURE SCAN', 'ARRIVAL SCAN',
        'WE HAVE YOUR PACKAGE', 'ON THE WAY',
        'PENDING RELEASE FROM A GOVERNMENT AGENCY', 'RELEASED BY THE GOVERNMENT AGENCY',
        'CLEARING AGENCY', 'AWAITING FINAL RELEASE', 'SUBMIT FOR CLEARANCE',
        'IMPORT SCAN', 'EXPORT SCAN', 'BROKERAGE', 'CONTACT WITH THE SENDER'
    ];

    for (const ev of events) {
        const code = String(ev?.statusCode || '').toUpperCase();
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(' ').toUpperCase();
        if (code === 'I') return 'EM_TRANSITO';
        if (transitKeywords.some(k => text.includes(k))) return 'EM_TRANSITO';
    }

    const createdKeywords = [
        'LABEL', 'SHIPPER CREATED A LABEL', 'HAS NOT RECEIVED THE PACKAGE', 'RECEIVED THE INFORMATION NEEDED'
    ];
    for (const ev of events) {
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(' ').toUpperCase();
        if (createdKeywords.some(k => text.includes(k))) return 'CRIADO';
    }
    return 'CRIADO';
}

// Alias para compatibilidade com código antigo que ainda chama getTimeline()
const getTimeline = getLatestEvent;

module.exports = {
    getByNumber,
    getLatestEvent,
    getTimeline,
    normalize,
    normalizeUpsStatusFromTimeline,
};
