const n = (v) => {
    const x = Number(typeof v === "string" ? v.replace(",", ".") : v);
    return Number.isFinite(x) ? x : 0;
};

function fromSurcharges(c) {
    const s = c.surcharges || {};
    const base = n(s.base);
    const itemized = Array.isArray(s.itemized) ? s.itemized : [];
    const taxas = itemized.reduce((acc, it) => acc + n(it.value), 0);
    const totalCarrier = n(s.total) || (base + taxas + n(s.serviceOptions));
    const currency = s.currency || "USD";
    const taxas_itens = itemized.map(it => `${it.code}:${n(it.value).toFixed(2)}`).join(" | ");
    return { base, taxas, totalCarrier, currency, taxas_itens };
}

module.exports = { fromSurcharges, n }