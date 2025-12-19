const { getTimelineFedex, normalizeFedexStatusFromTimelineFedex } = require("./fedex/trackingFedex");
const { getTimeline, normalizeUpsStatusFromTimeline } = require("./ups/tracking");

function cleanTN(raw) {
    return String(raw || '').trim().replace(/['"`\s]/g, '').toUpperCase();
}

async function getStatusOnly({ carrier, trackingNumber }) {
    const tn = cleanTN(trackingNumber);
    const c = String(carrier || 'UPS').toUpperCase();

    if (!tn) return { status_norm: 'CRIADO', last_event: null, raw: null };

    if (c === 'UPS') {
        const timeline = await getTimeline('UPS', tn);
        if (!Array.isArray(timeline) || timeline.length === 0) {
            return { status_norm: 'CRIADO', last_event: null, raw: null };
        }
        const status_norm = normalizeUpsStatusFromTimeline(timeline);
        const newest = timeline[0] || null;
        const eventTime = newest?.eventTime || newest?.activityDateTime || null;
        return { status_norm, last_event: eventTime, raw: newest };
    }

    if (c === 'FEDEX') {
        const timeline = await getTimelineFedex('FEDEX', tn);
        if (!Array.isArray(timeline) || timeline.length === 0) {
            return { status_norm: 'CRIADO', last_event: null, raw: null };
        }
        const status_norm = normalizeFedexStatusFromTimelineFedex(timeline);

        const newest = timeline[0] || null;
        const eventTime = newest?.eventTime || newest?.dateTime || null;
        return { status_norm, last_event: eventTime, raw: newest };
    }

    return { status_norm: 'CRIADO', last_event: null, raw: null };
}

module.exports = { getStatusOnly };
