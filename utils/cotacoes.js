// utils/cotacoes.js
// Cotacao de outras moedas para USD, com cache.
//
// utils/dolar.js resolve USD-BRL, que era tudo de que o sistema precisava
// enquanto a conta era "quanto isso da em real". Os regimes trouxeram valores
// em outras moedas que entram no CALCULO, nao so na exibicao: o limiar de
// EUR 150 que decide se a remessa paga tarifa por NCM ou EUR 3 fixos, o
// proprio EUR 3, a Union Handling Fee de EUR 2, o limiar de GBP 135.
//
// Sem converter esses numeros nao da para saber de que lado do limiar a
// remessa esta. Quem chama trata `null` como "nao sei" e segue pelo caminho
// conservador — nunca como zero.

const axios = require('axios');

const CACHE_MS = 60 * 60 * 1000;   // uma hora, igual ao dolar
const cache = new Map();           // 'EUR' -> { valor, em }

/** Uma moeda por vez, para uma cotacao ruim nao contaminar as outras. */
async function umaMoeda(moeda) {
    const m = String(moeda || '').trim().toUpperCase();
    if (!m || m === 'USD') return 1;

    const guardado = cache.get(m);
    if (guardado && Date.now() - guardado.em < CACHE_MS) return guardado.valor;

    try {
        const { data } = await axios.get(`https://economia.awesomeapi.com.br/json/last/${m}-USD`, {
            timeout: 6000,
            headers: { 'x-api-key': process.env.AWESOMEAPI_TOKEN },
        });
        const bruto = data?.[`${m}USD`]?.bid ?? data?.[`${m}USD`]?.high;
        const valor = Number(bruto);
        if (!Number.isFinite(valor) || valor <= 0) throw new Error(`cotacao invalida para ${m}`);

        cache.set(m, { valor, em: Date.now() });
        return valor;
    } catch (err) {
        console.error('[COTACOES]', m, err?.message);
        // Cotacao velha e melhor do que nenhuma: limiar nao muda de ordem de
        // grandeza em um dia, e a alternativa e cair na IA sem necessidade.
        if (guardado) {
            console.warn('[COTACOES] usando valor antigo de', m, guardado.valor);
            return guardado.valor;
        }
        return null;
    }
}

/**
 * @param {string[]} moedas
 * @returns {Promise<Record<string, number>>} moeda -> quanto vale 1 unidade em USD.
 *          Moeda que nao resolveu simplesmente nao aparece no objeto.
 */
async function cotacoesParaUsd(moedas = []) {
    const unicas = [...new Set(moedas.map((m) => String(m || '').trim().toUpperCase()).filter(Boolean))];
    const pares = await Promise.all(unicas.map(async (m) => [m, await umaMoeda(m)]));
    return Object.fromEntries(pares.filter(([, v]) => Number.isFinite(v) && v > 0));
}

/** Moedas que os regimes usam em limiares e taxas fixas. */
const MOEDAS_DOS_REGIMES = ['EUR', 'GBP', 'CHF', 'SGD', 'AUD', 'NZD', 'CAD', 'AED', 'NOK', 'JPY', 'TWD'];

module.exports = { cotacoesParaUsd, MOEDAS_DOS_REGIMES };
