// services/previaImportacao.js
//
// Confere a planilha antes de importar.
//
// Antes o upload ia direto para o banco e devolvia só "criados: 21,
// ignorados: 3". Quem exportava descobria o problema três telas depois, na
// hora de cotar, quando o pedido sem HS Code travava o Estágio 1 — e não
// tinha como saber quais dos 24 pedidos estavam furados.
//
// Aqui nada é gravado: a planilha é lida, cada pedido recebe uma situação e a
// tela decide o que importar.

/**
 * Países de destino que aparecem na operação, pelo nome como as lojas
 * escrevem. As transportadoras só aceitam ISO-2, e planilha exportada da
 * Shopify costuma vir com o nome por extenso.
 *
 * A lista é curta de propósito: país que não estiver aqui vira pendência para
 * a pessoa corrigir, em vez de um palpite que fura no despacho.
 */
const PAISES = {
    'estados unidos': 'US', 'united states': 'US', 'eua': 'US', 'usa': 'US',
    brasil: 'BR', brazil: 'BR',
    portugal: 'PT',
    espanha: 'ES', spain: 'ES',
    'reino unido': 'GB', 'united kingdom': 'GB', inglaterra: 'GB',
    alemanha: 'DE', germany: 'DE',
    franca: 'FR', 'frança': 'FR', france: 'FR',
    italia: 'IT', 'itália': 'IT', italy: 'IT',
    canada: 'CA', 'canadá': 'CA',
    mexico: 'MX', 'méxico': 'MX',
    argentina: 'AR',
    chile: 'CL',
    colombia: 'CO', 'colômbia': 'CO',
    australia: 'AU', 'austrália': 'AU',
    japao: 'JP', 'japão': 'JP', japan: 'JP',
    holanda: 'NL', 'países baixos': 'NL', netherlands: 'NL',
    suica: 'CH', 'suíça': 'CH', switzerland: 'CH',
    irlanda: 'IE', ireland: 'IE',
    'nova zelandia': 'NZ', 'nova zelândia': 'NZ',
};

/**
 * Normaliza o país para ISO-2.
 * @returns {{codigo: string|null, corrigido: boolean}}
 */
function normalizarPais(valor) {
    const bruto = String(valor ?? '').trim();
    if (!bruto) return { codigo: null, corrigido: false };

    // Já está em ISO-2.
    if (/^[A-Za-z]{2}$/.test(bruto)) {
        return { codigo: bruto.toUpperCase(), corrigido: false };
    }

    const chave = bruto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');

    const direto = PAISES[chave] || PAISES[bruto.toLowerCase()];
    if (direto) return { codigo: direto, corrigido: true };

    return { codigo: null, corrigido: false };
}

/**
 * Classifica um pedido agrupado.
 *
 * @param {object} pedido saída do groupRowsByOrder, já enriquecida
 * @param {Set<string>} jaImportados pedido_ref que o cliente já tem
 */
function classificarPedido(pedido, jaImportados) {
    const correcoes = [];
    const pendencias = [];

    if (jaImportados.has(pedido.pedido_ref)) {
        return {
            situacao: 'DUPLICADO',
            motivo: 'Este pedido já foi importado antes.',
            correcoes,
            pais: pedido.pais || null,
        };
    }

    const { codigo, corrigido } = normalizarPais(pedido.pais);
    if (codigo && corrigido) {
        correcoes.push(`País "${pedido.pais}" corrigido para ${codigo}`);
    } else if (!codigo) {
        pendencias.push(
            pedido.pais ? `País "${pedido.pais}" não reconhecido` : 'País não informado',
        );
    }

    const semHs = (pedido.itens || []).filter((i) => !String(i.hscode ?? '').trim()).length;
    if (semHs) {
        pendencias.push(`Falta HS Code em ${semHs} ${semHs === 1 ? 'item' : 'itens'}`);
    }

    if (!(pedido.itens || []).length) {
        pendencias.push('Pedido sem itens');
    }

    if (pendencias.length) {
        return {
            situacao: 'AJUSTE',
            motivo: pendencias.join(' · '),
            correcoes,
            pais: codigo,
        };
    }

    return {
        situacao: correcoes.length ? 'CORRIGIDO' : 'PRONTO',
        motivo: correcoes.join(' · ') || null,
        correcoes,
        pais: codigo,
    };
}

module.exports = { classificarPedido, normalizarPais, PAISES };
