// services/impostosIA/custo.js
// Converte o `usage` da resposta em dólares, para cada chamada dizer quanto
// custou no próprio log.
//
// Existe porque a pergunta "quanto vai gastar por mês" estava sendo respondida
// por estimativa. Com isso ela passa a ser respondida por leitura de log — e
// se a Anthropic mudar preço, muda-se a tabela aqui.

// Preços do Claude Opus 5, em USD por milhão de tokens.
// Fonte: platform.claude.com/docs/en/about-claude/pricing
const PRECO = {
    entrada: Number(process.env.PRECO_ENTRADA_MTOK) || 5,
    saida: Number(process.env.PRECO_SAIDA_MTOK) || 25,
    cache_leitura: Number(process.env.PRECO_CACHE_LEITURA_MTOK) || 0.5,
    cache_escrita: Number(process.env.PRECO_CACHE_ESCRITA_MTOK) || 6.25, // janela de 5 min
};

// Busca web: USD 10 por 1.000 buscas.
const PRECO_BUSCA = Number(process.env.PRECO_BUSCA_UNIT) || 0.01;

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * @param {object} uso usage normalizado (ver cliente.js)
 * @returns {{ total_usd:number, detalhe:object }}
 */
function calcularCusto(uso = {}) {
    const porMilhao = (tokens, preco) => (n(tokens) / 1e6) * preco;

    const detalhe = {
        entrada_usd: porMilhao(uso.entrada, PRECO.entrada),
        saida_usd: porMilhao(uso.saida, PRECO.saida),
        cache_leitura_usd: porMilhao(uso.cache_leitura, PRECO.cache_leitura),
        cache_escrita_usd: porMilhao(uso.cache_escrita, PRECO.cache_escrita),
        buscas_usd: n(uso.buscas) * PRECO_BUSCA,
    };

    const total = Object.values(detalhe).reduce((a, b) => a + b, 0);

    // 4 casas: uma chamada barata custa centavos, arredondar em 2 esconderia.
    const r4 = (x) => Math.round(x * 10000) / 10000;

    return {
        total_usd: r4(total),
        detalhe: Object.fromEntries(Object.entries(detalhe).map(([k, v]) => [k, r4(v)])),
    };
}

module.exports = { calcularCusto, PRECO, PRECO_BUSCA };
