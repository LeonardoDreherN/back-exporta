const db = require('../../models');

/**
 * Prefixo de pedido por loja.
 *
 * A Shopify numera pedido por loja, nao por conta. Duas lojas da mesma conta
 * Intrex chegam as duas ao #1007, e o UNIQUE (cliente_id, pedido_ref) de
 * pedidos_importados descartava o segundo em silencio. O prefixo resolve na
 * entrada: a ref gravada ja nasce unica dentro do cliente.
 *
 * Prefixo NULL = ref crua, como sempre foi. Quem opera com uma loja so nao
 * muda de formato no meio do historico.
 */

const PREFIXO_RE = /^[A-Z0-9]{1,8}$/;

/** Normaliza o que o admin digitou: 'momi ' => 'MOMI'. */
function normalizarPrefixo(valor) {
    const limpo = String(valor ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return limpo || null;
}

function prefixoValido(prefixo) {
    return prefixo === null || PREFIXO_RE.test(prefixo);
}

/**
 * Sugestao a partir do dominio: 'momi-store.myshopify.com' => 'MOMI'.
 * Serve de default no cadastro; o admin pode sobrescrever.
 */
function sugerirPrefixo(shopDomain) {
    const sub = String(shopDomain || '').trim().toLowerCase().split('.')[0] || '';
    const primeiroBloco = sub.split('-')[0] || sub;
    return normalizarPrefixo(primeiroBloco.slice(0, 8));
}

/** Aplica o prefixo na ref. Sem prefixo, devolve a ref intacta. */
function aplicarPrefixo(prefixo, ref) {
    const refLimpa = String(ref ?? '').replace(/^#/, '').trim();
    if (!refLimpa) return '';
    const p = normalizarPrefixo(prefixo);
    if (!p) return refLimpa;
    // Idempotente: reimportar um pedido ja prefixado nao gera MOMI-MOMI-1007.
    if (refLimpa.toUpperCase().startsWith(`${p}-`)) return refLimpa;
    return `${p}-${refLimpa}`;
}

/** Prefixo salvo para a loja, ou null se a loja nao usa prefixo. */
async function getPrefixoDaLoja(shopDomain) {
    if (!shopDomain) return null;
    const row = await db.InfoShopify.findOne({
        where: { shopDomain },
        attributes: ['prefixoPedido'],
        raw: true,
    });
    return normalizarPrefixo(row?.prefixoPedido);
}

module.exports = {
    PREFIXO_RE,
    normalizarPrefixo,
    prefixoValido,
    sugerirPrefixo,
    aplicarPrefixo,
    getPrefixoDaLoja,
};
