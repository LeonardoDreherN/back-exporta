// services/ups/tracking.js
// Requisitos de env:
// UPS_BASE_URL=https://onlinetools.ups.com
// UPS_CLIENT_ID=...
// UPS_CLIENT_SECRET=...
// UPS_TRACK_LOCALE=en_US

const fetch = global.fetch || ((...a) => import('node-fetch').then(m => m.default(...a)));

const UPS_BASE = process.env.UPS_BASE_URL_PROD || 'https://onlinetools.ups.com';
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
    const code = String(evt.statusCode || evt.status?.type || '').toUpperCase();
    const text = [evt.statusDescription, evt.description, evt.activity]
        .filter(Boolean)
        .join(' ')
        .toUpperCase();

    // --- 1) Sinais fortes de "ainda criado / label criada" (prioridade máxima)
    const createdHints = [
        'LABEL',                          // "Label created", "Shipping label created"
        'SHIPPER CREATED A LABEL',
        'BILLING INFORMATION RECEIVED',   // comum na UPS
        'HAS NOT RECEIVED THE PACKAGE',   // UPS ainda não recebeu o pacote fisicamente
        'RECEIVED THE INFORMATION NEEDED' // só info, sem manuseio físico
    ];
    if (createdHints.some(k => text.includes(k))) return 'CRIADO';

    // --- 2) Entregue
    if (code === 'D' || text.includes('DELIVER')) return 'ENTREGUE';

    // --- 3) Em trânsito (mais restrito)
    // Preferimos um código "I" OU scans físicos inequívocos
    if (code === 'I') return 'EM_TRANSITO';

    const transitHints = [
        'ORIGIN SCAN',
        'DEPARTURE SCAN',
        'ARRIVAL SCAN',
        'IN TRANSIT',
        'OUT FOR DELIVERY',
        'WE HAVE YOUR PACKAGE',
        'PENDING RELEASE FROM A GOVERNMENT AGENCY',
        'RELEASED BY THE GOVERNMENT AGENCY',
        'CLEARING AGENCY',
        'AWAITING FINAL RELEASE',
        'IMPORT SCAN',
        'EXPORT SCAN',
        'BROKERAGE'
    ];
    if (transitHints.some(k => text.includes(k))) return 'EM_TRANSITO';

    // --- 4) fallback
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

    const createdKeywords = [
        'LABEL',
        'SHIPPER CREATED A LABEL',
        'BILLING INFORMATION RECEIVED',
        'HAS NOT RECEIVED THE PACKAGE',
        'RECEIVED THE INFORMATION NEEDED'
    ];

    const transitKeywords = [
        'ORIGIN SCAN',
        'DEPARTURE SCAN',
        'ARRIVAL SCAN',
        'IN TRANSIT',
        'OUT FOR DELIVERY',
        'WE HAVE YOUR PACKAGE',
        'PENDING RELEASE FROM A GOVERNMENT AGENCY',
        'RELEASED BY THE GOVERNMENT AGENCY',
        'CLEARING AGENCY',
        'AWAITING FINAL RELEASE',
        'IMPORT SCAN',
        'EXPORT SCAN',
        'BROKERAGE'
    ];
    for (const ev of events) {
        const code = String(ev?.statusCode || '').toUpperCase();
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(' ').toUpperCase();
        if (code === 'I') return 'EM_TRANSITO';
        if (transitKeywords.some(k => text.includes(k))) return 'EM_TRANSITO';
    }
    
    for (const ev of events) {
        const text = [ev?.statusDescription, ev?.description, ev?.activity]
            .filter(Boolean).join(' ').toUpperCase();
        if (createdKeywords.some(k => text.includes(k))) return 'CRIADO';
    }
    return 'CRIADO';
}

async function getTimelineArrayUPS(trackingNumber) {
    const json = await getByNumber(trackingNumber);

    // agrega todas as atividades possíveis (variação singular/plural do payload da UPS)
    const acts = [];
    const shipments = json?.trackResponse?.shipments || json?.trackResponse?.shipment || [];
    const list = Array.isArray(shipments) ? shipments : [shipments];

    for (const sh of list) {
        const pkgs = sh?.packages || sh?.package || [];
        const pkgList = Array.isArray(pkgs) ? pkgs : [pkgs];

        for (const p of pkgList) {
            if (Array.isArray(p?.activity)) acts.push(...p.activity);
        }
    }

    // sem eventos -> retorna array vazio (controller vai ignorar)
    if (!acts.length) return [];

    // normaliza cada atividade em um formato único
    const norm = acts.map(a => {
        let dt = null;
        if (a?.dateTime) {
            dt = new Date(a.dateTime);
        } else if (a?.date && a?.time) {
            const y = a.date.slice(0, 4), m = a.date.slice(4, 6), d = a.date.slice(6, 8);
            const hh = (a.time || '').slice(0, 2) || '00';
            const mm = (a.time || '').slice(2, 4) || '00';
            const ss = (a.time || '').slice(4, 6) || '00';
            dt = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
        }

        const eventTime = dt ? dt.toISOString() : null;

        return {
            statusCode: a?.statusCode || a?.status?.type || a?.status?.code || '',
            statusDescription: a?.statusDescription || a?.status?.description || '',
            description: a?.description || '',
            activity: a?.activity || a?.statusDescription || '',
            dateTime: a?.dateTime || null,
            eventTime,
            raw: a,
        };
    });

    // ordena: mais novo primeiro
    norm.sort((a, b) => (Date.parse(b.eventTime || 0) - Date.parse(a.eventTime || 0)));
    return norm;
}

// Alias para compatibilidade com código antigo que ainda chama getTimeline()
async function getTimeline(carrier, trackingNumber) {
    if (carrier === 'UPS') return getTimelineArrayUPS(trackingNumber);
    // outras carriers no futuro:
    return [];
}

// (mantém o getLatestEvent se quiser usar em outros fluxos)
async function getLatestEvent(carrier, trackingNumber) {
    const arr = await getTimeline(carrier, trackingNumber);
    return Array.isArray(arr) && arr.length ? arr[0] : null;
}

module.exports = {
    getByNumber,
    getLatestEvent,
    getTimeline,
    normalize,
    normalizeUpsStatusFromTimeline,
};
