function toNumSafe(v) {
    if (v == null) return undefined;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
}

const up = (s) => (typeof s === 'string' ? s.toUpperCase() : s);

module.exports = { up, toNumSafe }