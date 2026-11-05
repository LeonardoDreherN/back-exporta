// services/impostosCheckout.js
// Imposto de importacao estimado para o checkout da loja (Shopify carrier).
//
// POR QUE ESTE MODULO EXISTE, E POR QUE NAO E O DO SIMULADOR
// ---------------------------------------------------------
// O simulador do dashboard (services/simulacao) pode chamar a IA: quem clica
// espera. O checkout nao pode. O callback de carrier service da Shopify tem
// cerca de 10s de teto — passou disso, a Shopify descarta a resposta e o
// comprador ve o frete de fallback, ou nenhum. Uma classificacao nova leva
// dezenas de segundos (busca em fonte oficial) e custa por chamada, e checkout
// e trafego anonimo: seria torneira aberta.
//
// Entao aqui o caminho do comprador NUNCA chama o modelo. Ele:
//   1. le o regime aprovado do destino (uma linha de banco);
//   2. le a classificacao do item NA CACHE (services/impostosIA/classificacao);
//   3. no miss, usa a aliquota mais alta ja apurada para aquele destino e
//      aquece o item em background, para o proximo comprador achar a cache;
//   4. se nao ha regime aprovado para o destino, devolve indisponivel — quem
//      chama mostra o frete sem imposto e avisa que a alfandega vai cobrar.
//
// O numero que sai daqui e o mesmo tipo de numero que a cobranca antecipada
// usa: bruto da alfandega + margem de seguranca por confianca
// (services/featureFlags), nao o bruto cru.

const { Op } = require('sequelize');
const { obterRegimeAprovado } = require('./regimeImportacao');
const {
    obterClassificacao,
    buscarClassificacaoCache,
    classificacaoFallbackDestino,
    chaveDoItem,
    faixaDeValor,
} = require('./impostosIA/classificacao');
const { impostosMargemPorConfianca } = require('./featureFlags');
const { valorConversao } = require('../utils/dolar');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ------------------------------------------------------------------ *
 * Orcamento de aquecimento
 *
 * O prewarm roda fora da resposta ao comprador, mas ainda e chamada paga de
 * IA disparada por trafego anonimo. Dois limites: dedup por chave (dois
 * carrinhos com a mesma camiseta nao disparam duas vezes) e teto por hora.
 * ------------------------------------------------------------------ */
const PREWARM_MAX_HORA = Number(process.env.CHECKOUT_PREWARM_MAX_HORA) || 20;
const prewarmEmAndamento = new Set();
let prewarmJanela = [];

function podeAquecer(chave) {
    if (prewarmEmAndamento.has(chave)) return false;

    const agora = Date.now();
    prewarmJanela = prewarmJanela.filter((t) => agora - t < 60 * 60 * 1000);
    if (prewarmJanela.length >= PREWARM_MAX_HORA) {
        console.warn('[CHECKOUT][IMPOSTO] teto de aquecimento por hora atingido:', PREWARM_MAX_HORA);
        return false;
    }
    return true;
}

/** Classifica em background. Erro aqui nao pode escapar: ninguem esta esperando. */
function aquecerClassificacao({ regime, ncm, descricao, valorUsd, db }) {
    const chave = `${regime.id}|${chaveDoItem({ ncm, descricao })}|${faixaDeValor(valorUsd, regime)}`;
    if (!podeAquecer(chave)) return;

    prewarmEmAndamento.add(chave);
    prewarmJanela.push(Date.now());

    obterClassificacao({ regime, ncm, descricao, valorUsd, db })
        .then(() => console.log('[CHECKOUT][IMPOSTO][AQUECIDO]', { pais: regime.pais_destino, descricao, ncm: ncm || null }))
        .catch((e) => console.error('[CHECKOUT][IMPOSTO][AQUECIMENTO FALHOU]', chave, e?.message))
        .finally(() => prewarmEmAndamento.delete(chave));
}

/* ------------------------------------------------------------------ *
 * Destinos pedidos no checkout que ainda nao tem regime aprovado
 *
 * Sem isso ninguem descobre quais paises priorizar: a venda sai sem imposto e
 * o pedido nao deixa rastro do que faltava. Fica em memoria de proposito —
 * persistir exigiria tabela nova, e o que importa e a ordem de prioridade, que
 * se reconstroi em poucas horas de trafego. Zera no deploy, e a tela diz isso.
 * ------------------------------------------------------------------ */
const demandas = new Map();

function registrarDemanda(pais, motivo) {
    const iso = String(pais || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso)) return;

    const atual = demandas.get(iso) || { pais: iso, vezes: 0, primeira: new Date().toISOString(), motivo };
    atual.vezes += 1;
    atual.ultima = new Date().toISOString();
    atual.motivo = motivo;
    demandas.set(iso, atual);
}

/** Mais pedidos primeiro: e a fila de apuracao em ordem de prejuizo evitado. */
function listarDemandas() {
    return [...demandas.values()].sort((a, b) => b.vezes - a.vezes);
}

/* ------------------------------------------------------------------ *
 * Valor da mercadoria
 * ------------------------------------------------------------------ */

/**
 * Converte o valor do carrinho para USD, que e a moeda em que o regime e a
 * classificacao raciocinam (de minimis e taxas fixas sao definidos em dolar).
 *
 * Fora de USD e BRL devolve null: chutar cambio posiciona a faixa errada e erra
 * o de minimis inteiro, o que e pior do que nao mostrar imposto.
 *
 * @returns {Promise<{ paraUsd:number, fx:number|null }|null>}
 */
async function fatorParaUsd(moeda) {
    const m = String(moeda || 'USD').trim().toUpperCase();
    if (m === 'USD') return { paraUsd: 1, fx: null };

    if (m === 'BRL') {
        const fx = Number(await valorConversao().catch(() => null));
        if (!Number.isFinite(fx) || fx <= 0) return null;
        return { paraUsd: 1 / fx, fx };
    }

    return null;
}

/**
 * Cotacao do dolar sem arriscar o callback.
 *
 * utils/dolar guarda o valor por uma hora, mas a PRIMEIRA chamada apos o
 * deploy sai para a AwesomeAPI com 8s de timeout — mais do que o callback
 * inteiro da Shopify tem de vida. Com teto curto, o pior caso e este checkout
 * sair sem converter e o seguinte ja achar a cache quente.
 */
async function cotacaoOportunista(ms = 1200) {
    let timer;
    try {
        const limite = new Promise((_, rej) => {
            timer = setTimeout(() => rej(new Error('timeout cambio')), ms);
            if (typeof timer.unref === 'function') timer.unref();
        });
        const fx = Number(await Promise.race([valorConversao(), limite]));
        return Number.isFinite(fx) && fx > 0 ? fx : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Itens do carrinho normalizados, com NCM quando a loja tem o produto
 * cadastrado.
 *
 * O payload da Shopify nao traz NCM/HS. Sem ele a chave de cache e o hash da
 * descricao, e cada nome novo de produto e um miss. Quando a loja ja cadastrou
 * o produto na Intrex (com hscode), casar por SKU/nome reaproveita a
 * classificacao de todas as lojas que vendem aquele NCM.
 *
 * `price` da Shopify e o preco UNITARIO em centavos, com `quantity` separado.
 */
async function normalizarItens({ itens, clienteId, db }) {
    const validos = (Array.isArray(itens) ? itens : []).filter((i) => i?.requires_shipping !== false);

    const base = validos.map((i) => {
        const quantidade = Math.max(1, Math.trunc(Number(i.quantity) || 1));
        const unitario = Math.max(0, Number(i.price) || 0) / 100;
        return {
            descricao: String(i.name || i.sku || 'Merchandise').slice(0, 200),
            sku: i.sku ? String(i.sku) : null,
            quantidade,
            valor: round2(unitario * quantidade),
            ncm: null,
        };
    });

    if (!clienteId || !base.length) return base;

    try {
        const skus = base.map((i) => i.sku).filter(Boolean);
        const nomes = base.map((i) => i.descricao);

        const produtos = await db.Produto.findAll({
            where: {
                id_cliente: clienteId,
                [Op.or]: [
                    ...(skus.length ? [{ sku: { [Op.in]: skus } }] : []),
                    { nome: { [Op.in]: nomes } },
                ],
            },
            attributes: ['sku', 'nome', 'hscode'],
        });

        const porSku = new Map();
        const porNome = new Map();
        for (const p of produtos) {
            if (p.hscode) {
                if (p.sku) porSku.set(String(p.sku), p.hscode);
                if (p.nome) porNome.set(String(p.nome), p.hscode);
            }
        }

        for (const item of base) {
            item.ncm = (item.sku && porSku.get(item.sku)) || porNome.get(item.descricao) || null;
        }
    } catch (e) {
        // Produto cadastrado e melhoria de precisao, nao requisito: sem ele a
        // chave cai na descricao e o checkout segue.
        console.error('[CHECKOUT][IMPOSTO] falha ao casar NCM do produto:', e?.message);
    }

    return base;
}

/* ------------------------------------------------------------------ *
 * Preparo
 * ------------------------------------------------------------------ */

/**
 * Resolve tudo o que NAO depende do frete: regime, aliquota de cada item,
 * taxas fixas e margem. O frete so entra depois, porque cada servico cotado
 * tem o seu, e em destino que tributa sobre CIF ele muda o imposto.
 *
 * @param {{
 *   destino: string, itens: any[], moeda?: string,
 *   clienteId?: number|null, db: any,
 * }} args
 * @returns {Promise<object>} `{ disponivel, motivo?, calcular(freteUsd) }`
 */
async function prepararImpostoCheckout({ destino, itens, moeda = 'USD', clienteId = null, db }) {
    const iso = String(destino || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso)) {
        return { disponivel: false, motivo: 'destino_invalido' };
    }

    const regime = await obterRegimeAprovado({ paisDestino: iso, db });
    if (!regime) {
        registrarDemanda(iso, 'sem_regime');
        return { disponivel: false, motivo: 'sem_regime', pais: iso };
    }

    const fator = await fatorParaUsd(moeda);
    if (!fator) {
        registrarDemanda(iso, 'sem_cambio');
        return { disponivel: false, motivo: 'sem_cambio', pais: iso, moeda };
    }

    // Fator BRL -> USD mesmo quando o carrinho nao e em real: a conta UPS e
    // brasileira e devolve a tarifa negociada em BRL (a FedEx ja converte
    // sozinha). Sem isto o frete da UPS nao entraria na base do imposto sobre
    // consumo e todo servico UPS sairia do checkout sem imposto.
    let brlParaUsd = null;
    if (fator.fx) {
        brlParaUsd = fator.paraUsd;
    } else {
        const fx = await cotacaoOportunista();
        if (fx) brlParaUsd = 1 / fx;
    }

    const normalizados = await normalizarItens({ itens, clienteId, db });
    const valorTotalUsd = round2(normalizados.reduce((a, i) => a + i.valor, 0) * fator.paraUsd);

    if (!normalizados.length || valorTotalUsd <= 0) {
        return { disponivel: false, motivo: 'sem_valor_declarado', pais: iso };
    }

    // A faixa do cache e por remessa: de minimis e entrada formal olham o total.
    const linhas = [];
    let algumFallback = false;

    for (const item of normalizados) {
        const valorItemUsd = round2(item.valor * fator.paraUsd);

        let classificacao = await buscarClassificacaoCache({
            regime,
            ncm: item.ncm,
            descricao: item.descricao,
            valorUsd: valorTotalUsd,
            db,
        });
        let fonte = 'cache';

        if (!classificacao) {
            // Miss: aquece para o proximo comprador achar a cache.
            aquecerClassificacao({
                regime,
                ncm: item.ncm,
                descricao: item.descricao,
                valorUsd: valorTotalUsd,
                db,
            });

            // E para ESTE comprador, o que cobrar? Nenhuma resposta e boa:
            //   'max' (default) usa a maior aliquota ja apurada no destino.
            //     Nao subestima, mas pode exagerar — nos EUA a cache vai de 25%
            //     a 57%, e um item de 25% sairia cobrado a 57%.
            //   'off' devolve o servico como DDU, com aviso de que a alfandega
            //     cobra na entrega. Nao exagera, mas o comprador leva o susto
            //     depois.
            // Fica em variavel de ambiente porque e um ajuste comercial, de
            // quem olha a taxa de conversao do checkout, e nao deve esperar
            // deploy.
            const modo = String(process.env.CHECKOUT_FALLBACK_MODO || 'max').trim().toLowerCase();
            if (modo === 'off') {
                registrarDemanda(iso, 'item_sem_classificacao');
                return {
                    disponivel: false,
                    motivo: 'item_sem_classificacao',
                    pais: iso,
                    regime_id: regime.id,
                };
            }

            classificacao = await classificacaoFallbackDestino({ regime, valorUsd: valorTotalUsd, db });
            fonte = 'fallback_destino';
            algumFallback = true;
        }

        if (!classificacao) {
            // Regime aprovado, mas nenhum item daquele pais classificado ainda.
            registrarDemanda(iso, 'sem_classificacao');
            return { disponivel: false, motivo: 'sem_classificacao', pais: iso, regime_id: regime.id };
        }

        linhas.push({
            descricao: item.descricao,
            ncm: classificacao.ncm || item.ncm || null,
            valor_usd: valorItemUsd,
            aliquota_importacao_pct: Number(classificacao.aliquota_importacao_pct) || 0,
            aliquota_consumo_pct: Number(classificacao.aliquota_consumo_pct) || 0,
            taxas_fixas_usd: Number(classificacao.taxas_fixas_usd) || 0,
            confianca: classificacao.confianca || null,
            fonte,
        });
    }

    // Taxas fixas (MPF e afins) sao POR REMESSA, nao por item: somar item a
    // item cobraria a mesma taxa varias vezes no mesmo pacote.
    const taxasFixasUsd = round2(Math.max(0, ...linhas.map((l) => l.taxas_fixas_usd)));

    // Confianca da remessa e a do pior item. Fallback de destino nao foi
    // apurado para esta mercadoria, entao vale como baixa.
    const ordem = { alta: 3, media: 2, baixa: 1 };
    let confianca = 'baixa';
    if (!algumFallback) {
        const pior = Math.min(...linhas.map((l) => ordem[String(l.confianca || '').toLowerCase()] || 1));
        confianca = pior >= 3 ? 'alta' : pior === 2 ? 'media' : 'baixa';
    }

    const margemPct = impostosMargemPorConfianca(confianca);

    /**
     * Fecha a conta para um frete concreto, em USD. Aritmetica pura: pode ser
     * chamada uma vez por servico cotado sem custo nenhum.
     */
    function calcular(freteUsd = 0) {
        const frete = Math.max(0, Number(freteUsd) || 0);
        let duties = 0;
        let consumo = 0;

        for (const l of linhas) {
            const duty = round2(l.valor_usd * (l.aliquota_importacao_pct / 100));
            // Frete rateado por valor: a base do imposto sobre consumo e CIF +
            // direito nos destinos com VAT, e o frete e da remessa inteira.
            const freteItem = valorTotalUsd > 0 ? round2(frete * (l.valor_usd / valorTotalUsd)) : 0;
            const vat = round2((l.valor_usd + freteItem + duty) * (l.aliquota_consumo_pct / 100));

            duties += duty;
            consumo += vat;
        }

        const brutoUsd = round2(duties + consumo + taxasFixasUsd);
        const comMargemUsd = round2(brutoUsd * (1 + margemPct / 100));

        return {
            duties_usd: round2(duties),
            consumo_usd: round2(consumo),
            taxas_fixas_usd: taxasFixasUsd,
            bruto_usd: brutoUsd,
            // E este que entra no preco: bruto subestimado e prejuizo de quem
            // adiantou o pagamento.
            total_usd: comMargemUsd,
            isento: brutoUsd === 0,
        };
    }

    return {
        disponivel: true,
        pais: iso,
        regime_id: regime.id,
        moeda_origem: String(moeda || 'USD').toUpperCase(),
        para_usd: fator.paraUsd,
        brl_para_usd: brlParaUsd,
        fx: fator.fx,
        valor_mercadoria_usd: valorTotalUsd,
        itens: linhas,
        confianca,
        margem_pct: margemPct,
        tem_fallback: algumFallback,
        is_estimate: true,
        calcular,
    };
}

module.exports = {
    prepararImpostoCheckout,
    listarDemandas,
    registrarDemanda,
    fatorParaUsd,
};
