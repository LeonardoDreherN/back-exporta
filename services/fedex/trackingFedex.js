// backend/services/fedex/tracking.js
// Requisitos de env (sugestão):
// FEDEX_BASE_URL=https://apis-sandbox.fedex.com  (ou https://apis.fedex.com)
// FEDEX_CLIENT_ID=...
// FEDEX_CLIENT_SECRET=...
// FEDEX_TRACK_LOCALE=en_US (opcional, se você quiser usar isso em parsing / mensagens)
// FEDEX_STUB=true (opcional)

const fetch = global.fetch || ((...a) => import('node-fetch').then(m => m.default(...a)));

const FEDEX_BASE = process.env.NODE_ENV === 'production' ? process.env.FEDEX_BASE_URL_PROD : process.env.FEDEX_BASE_URL;
const FEDEX_CLIENT_ID = process.env.FEDEX_KEY_TRACK || '';
const FEDEX_CLIENT_SECRET = process.env.FEDEX_KEY_SECRET_TRACK || '';
const FEDEX_STUB = String(process.env.FEDEX_STUB || '') === 'true';

let _token = null;
let _tokenExpTs = 0;

function cleanTN(s) {
    return String(s || '').trim().replace(/['"`\s]/g, '');
}

async function getAccessToken(force = false) {
    const now = Date.now();
    if (!force && _token && now < _tokenExpTs - 60_000) return _token;

    if (!FEDEX_CLIENT_ID || !FEDEX_CLIENT_SECRET) {
        const e = new Error('FedEx OAuth: defina FEDEX_CLIENT_ID e FEDEX_CLIENT_SECRET no .env');
        e.http = 500;
        throw e;
    }

    const url = `${FEDEX_BASE}/oauth/token`;

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: FEDEX_CLIENT_ID,
        client_secret: FEDEX_CLIENT_SECRET,
    });

    const r = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
        },
        body,
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok || !j.access_token) {
        const info = (j && JSON.stringify(j)) || r.statusText;
        const err = new Error(`FedEx OAuth falhou: ${info}`);
        err.http = r.status || 400;
        err.details = j;
        throw err;
    }

    _token = j.access_token;
    _tokenExpTs = Date.now() + ((Number(j.expires_in) || 3600) * 1000);
    return _token;
}

/**
 * FedEx Track v1
 * POST /track/v1/trackingnumbers
 *
 * Payload (o que você mandou):
 * {
 *   "trackingInfo":[{"trackingNumberInfo":{"trackingNumber":"NNN"}}],
 *   "includeDetailedScans": true
 * }
 */
async function getByNumber(trackingNumber, opts = {}) {
    const tn = cleanTN(trackingNumber);
    if (!tn) {
        const e = new Error('Tracking vazio');
        e.http = 400;
        throw e;
    }

    if (FEDEX_STUB) {
        return {
            ok: true,
            stub: true,
            output: {
                completeTrackResults: [{
                    trackResults: [{
                        trackingNumberInfo: { trackingNumber: tn },
                        latestStatusDetail: { code: 'STUB', description: 'STUB: In transit' },
                        scanEvents: []
                    }]
                }]
            }
        };
    }

    const token = await getAccessToken();
    const url = `${FEDEX_BASE}/track/v1/trackingnumbers`;

    const payload = {
        trackingInfo: [
            { trackingNumberInfo: { trackingNumber: tn } }
        ],
        includeDetailedScans: opts.includeDetailedScans !== false,
    };

    const r = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-customer-transaction-id': `intrex-${Date.now()}`,
        },
        body: JSON.stringify(payload),
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok) {
        const err = new Error(
            j?.errors?.[0]?.message ||
            j?.error_description ||
            j?.message ||
            `FedEx Track falhou (${r.status})`
        );
        err.http = r.status;
        err.details = j;
        throw err;
    }

    return j; // retorno bruto (igual UPS)
}

/**
 * Junta todos os scanEvents num array uniforme e ordenado (mais novo primeiro),
 * semelhante ao getTimelineArrayUPS.
 */
function getTimelineArrayFEDEX(json) {
    const out = json?.output || {};
    const complete = Array.isArray(out?.completeTrackResults) ? out.completeTrackResults : [];
    const events = [];

    for (const cr of complete) {
        const trs = Array.isArray(cr?.trackResults) ? cr.trackResults : [];
        for (const tr of trs) {
            const scans = Array.isArray(tr?.scanEvents) ? tr.scanEvents : [];
            for (const s of scans) {
                const dtRaw = s?.date || s?.dateTime || null;
                const dt = dtRaw ? new Date(dtRaw) : null;
                const eventTime = (dt && !isNaN(dt.getTime())) ? dt.toISOString() : null;

                events.push({
                    // campos no “padrão” que você usa em UPS
                    statusCode: tr?.latestStatusDetail?.code || tr?.statusDetail?.code || '',
                    statusDescription: tr?.latestStatusDetail?.description || tr?.statusDetail?.description || '',
                    description: s?.eventDescription || s?.derivedStatus || '',
                    activity: s?.eventDescription || s?.derivedStatus || '',
                    dateTime: dtRaw,
                    eventTime,
                    location: {
                        city: s?.scanLocation?.city || null,
                        state: s?.scanLocation?.stateOrProvinceCode || null,
                        country: s?.scanLocation?.countryCode || null,
                    },
                    raw: s,
                });
            }

            // Se NÃO veio scanEvents (às vezes acontece), pelo menos gera 1 “evento” com o latestStatus
            if (!scans.length) {
                const latest = tr?.latestStatusDetail || tr?.statusDetail || {};
                events.push({
                    statusCode: latest?.code || '',
                    statusDescription: latest?.description || latest?.statusByLocale || '',
                    description: latest?.description || '',
                    activity: latest?.description || '',
                    dateTime: null,
                    eventTime: null,
                    location: null,
                    raw: latest,
                });
            }
        }
    }

    // mais novo primeiro
    events.sort((a, b) => (Date.parse(b.eventTime || 0) - Date.parse(a.eventTime || 0)));
    return events;
}

function pickLatestFedexActivity(json) {
    const arr = getTimelineArrayFEDEX(json);
    return arr.length ? arr[0] : null;
}

/**
 * Normalização simples pro seu status_norm
 * (CRIADO / EM_TRANSITO / ENTREGUE)
 */
function fromFEDEX(evt = {}) {
    const code = String(evt?.statusCode || '').toUpperCase();
    const text = [
        evt?.statusDescription,
        evt?.description,
        evt?.activity
    ].filter(Boolean).join(' ').toUpperCase();

    // CRIADO (label / shipment info received)
    const createdHints = [
        'LABEL',
        'SHIPMENT INFORMATION SENT',
        'SHIPMENT INFORMATION RECEIVED',
        'PICKUP REQUESTED',
        'CREATED',
        'ELECTRONIC'
    ];
    if (createdHints.some(k => text.includes(k))) return 'CRIADO';

    // ENTREGUE
    const deliveredHints = [
        'DELIVERED',
        'DELIVERY',
        'SIGNED'
    ];
    if (code === 'DL' || deliveredHints.some(k => text.includes(k))) return 'ENTREGUE';

    // EM_TRANSITO
    const transitHints = [
        'IN TRANSIT',
        'AT LOCAL FEDEX FACILITY',
        'ARRIVED',
        'DEPARTED',
        'ON FEDEX VEHICLE FOR DELIVERY',
        'OUT FOR DELIVERY',
        'CUSTOMS',
        'CLEARANCE',
        'INTERNATIONAL SHIPMENT RELEASE'
    ];
    if (transitHints.some(k => text.includes(k))) return 'EM_TRANSITO';

    return 'CRIADO';
}

function normalize(carrier, evt) {
    if (carrier === 'FEDEX') return fromFEDEX(evt);
    return 'CRIADO';
}

// API compatível com o seu UPS tracking.js
async function getTimeline(carrier, trackingNumber) {
    if (carrier !== 'FEDEX') return [];
    const json = await getByNumber(trackingNumber, { includeDetailedScans: true });
    return getTimelineArrayFEDEX(json);
}

async function getLatestEvent(carrier, trackingNumber) {
    if (carrier !== 'FEDEX') return null;
    const json = await getByNumber(trackingNumber, { includeDetailedScans: true });
    return pickLatestFedexActivity(json);
}

function normalizeFedexStatusFromTimeline(events) {
    if (!Array.isArray(events) || events.length === 0) return 'CRIADO';

    for (const ev of events) {
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(' ').toUpperCase();
        const code = String(ev?.statusCode || '').toUpperCase();
        if (code === 'DL' || text.includes('DELIVERED')) return 'ENTREGUE';
    }

    for (const ev of events) {
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(' ').toUpperCase();
        if (text.includes('IN TRANSIT') || text.includes('OUT FOR DELIVERY') || text.includes('CUSTOMS')) {
            return 'EM_TRANSITO';
        }
    }

    return 'CRIADO';
}

module.exports = {
    getByNumber,
    getLatestEvent,
    getTimeline,
    normalize,
    normalizeFedexStatusFromTimeline,
};
