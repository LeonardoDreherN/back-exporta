// services/featureFlags.js
// Controle de liberação da feature de cobrança antecipada de impostos.
// Nesta fatia tudo fica atrás de uma allowlist de e-mail (conta de teste),
// para não tocar no fluxo dos clientes reais em produção.

function parseEmails(csv) {
    return String(csv || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Retorna true se o cliente está na allowlist IMPOSTOS_BETA_EMAILS.
 * @param {{ emailPrincipal?: string } | null | undefined} cliente
 */
function impostosBetaHabilitado(cliente) {
    const email = String(cliente?.emailPrincipal || '').trim().toLowerCase();
    if (!email) return false;
    return parseEmails(process.env.IMPOSTOS_BETA_EMAILS).includes(email);
}

/**
 * Modo de operação da feature: 'shadow' (só calcula e registra) ou 'enforce'.
 * Nesta fatia só rotula o snapshot; não altera comportamento.
 * @returns {'shadow' | 'enforce'}
 */
function impostosModo() {
    const m = String(process.env.IMPOSTOS_MODO || 'shadow').trim().toLowerCase();
    return m === 'enforce' ? 'enforce' : 'shadow';
}

/** Margem de segurança (%) aplicada sobre o imposto estimado. */
function impostosMargemPct() {
    const v = Number(process.env.IMPOSTOS_MARGEM_PCT);
    return Number.isFinite(v) && v >= 0 ? v : 17.5;
}

/** Colchão de câmbio (%) somado na conversão para BRL. */
function impostosColchaoCambioPct() {
    const v = Number(process.env.IMPOSTOS_COLCHAO_CAMBIO_PCT);
    return Number.isFinite(v) && v >= 0 ? v : 2;
}

module.exports = {
    impostosBetaHabilitado,
    impostosModo,
    impostosMargemPct,
    impostosColchaoCambioPct,
};
