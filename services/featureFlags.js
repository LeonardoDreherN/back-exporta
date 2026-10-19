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

/**
 * Margem de segurança (%) aplicada sobre o imposto estimado, quando não há
 * nível de confiança para consultar. Usada como piso/fallback.
 */
function impostosMargemPct() {
    const v = Number(process.env.IMPOSTOS_MARGEM_PCT);
    return Number.isFinite(v) && v >= 0 ? v : 17.5;
}

function pctEnv(nome, padrao) {
    const v = Number(process.env[nome]);
    return Number.isFinite(v) && v >= 0 ? v : padrao;
}

/**
 * Margem por nível de confiança que a IA declara na própria estimativa.
 *
 * Os 17,5% fixos vieram de quando a fonte era o EDT da FedEx, que não dizia
 * nada sobre a própria qualidade — então a margem tinha que cobrir o pior caso
 * sempre. A IA devolve "alta" / "media" / "baixa", e cobrar a mesma folga nos
 * três é caro para o cliente quando ela achou a alíquota do NCM em fonte
 * oficial, e pouco quando ela estimou por analogia.
 *
 * ATENÇÃO: estes números ainda não foram medidos contra imposto realmente
 * cobrado — são ponto de partida. Quando houver histórico de estimado x real,
 * ajuste por dado, não por opinião.
 *
 * @param {'alta'|'media'|'baixa'|null|undefined} confianca
 */
function impostosMargemPorConfianca(confianca) {
    const nivel = String(confianca || '').trim().toLowerCase();

    if (nivel === 'alta') return pctEnv('IMPOSTOS_MARGEM_ALTA_PCT', 8);
    if (nivel === 'media') return pctEnv('IMPOSTOS_MARGEM_MEDIA_PCT', 15);
    if (nivel === 'baixa') return pctEnv('IMPOSTOS_MARGEM_BAIXA_PCT', 25);

    // Sem nível declarado a resposta veio fora do formato, o que já é sinal
    // ruim. Cai no valor antigo, que é conservador, em vez de assumir "alta".
    return impostosMargemPct();
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
    impostosMargemPorConfianca,
    impostosColchaoCambioPct,
};
