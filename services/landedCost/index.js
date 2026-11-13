// services/landedCost/index.js
// Estima o imposto de importação do país de destino, aplica a margem de
// segurança e o colchão de câmbio, e converte para BRL.
//
// A fonte era o EDT da FedEx. Nesta conta o EDT devolve resposta sem nenhum
// campo de imposto — só frete —, então o parser registrava 0,00 e marcava
// de_minimis, o que é falso. Agora quem estima é o Claude com busca na web
// (services/impostosIA), que consulta a tarifa vigente e devolve as fontes.
// O formato de retorno é o mesmo de antes, para não mexer em quem consome.

const crypto = require('crypto');
const { estimarImpostosIA } = require('../impostosIA');
const { obterRegimeAprovado } = require('../regimeImportacao');
const { calcularPeloRegime } = require('../regimeImportacao/calculoDireto');
const { cotacoesParaUsd } = require('../../utils/cotacoes');
const { valorConversao } = require('../../utils/dolar');
const {
    impostosMargemPorConfianca,
    impostosColchaoCambioPct,
    impostosModo,
    impostosBetaHabilitado,
} = require('../featureFlags');

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/** Valor declarado total = soma do customsValue das linhas. */
function somarValorDeclarado(commodities = []) {
    const linhas = Array.isArray(commodities) ? commodities : [];
    return round2(linhas.reduce((acc, c) => {
        const linha = c?.customsValue?.amount != null
            ? num(c.customsValue.amount)
            : num(c?.unitPrice?.amount) * (num(c?.quantity) || 1);
        return acc + linha;
    }, 0));
}

/** Achata a resposta da IA nas linhas que o snapshot guarda. */
function montarBreakdown(ia, moeda) {
    const linhas = [];

    const imp = ia?.imposto_importacao;
    if (imp && (num(imp.valor) > 0 || num(imp.aliquota_pct) > 0)) {
        linhas.push({
            nome: 'Imposto de importação',
            aliquota_pct: num(imp.aliquota_pct),
            valor: round2(imp.valor),
            moeda,
            base: imp.base || null,
        });
    }

    const consumo = ia?.imposto_consumo;
    if (consumo && String(consumo.nome || '').toLowerCase() !== 'nenhum' && num(consumo.valor) > 0) {
        linhas.push({
            nome: consumo.nome,
            aliquota_pct: num(consumo.aliquota_pct),
            valor: round2(consumo.valor),
            moeda,
        });
    }

    const extras = Array.isArray(ia?.taxas_adicionais) ? ia.taxas_adicionais : [];
    for (const taxa of extras) {
        if (num(taxa?.valor) <= 0) continue;
        linhas.push({ nome: taxa.nome || 'Taxa alfandegária', valor: round2(taxa.valor), moeda });
    }

    return linhas;
}

/**
 * shipper/recipient/packages continuam aceitos porque o chamador antigo ainda
 * os passa; o estimador atual não precisa deles.
 *
 * @param {{
 *   destCountry?: string,
 *   incoterm?: string,
 *   currency?: string,
 *   commodities: any[],
 * }} args
 */
// Imposto maior que este múltiplo do valor declarado é erro de cálculo, não
// tributo: casa decimal trocada, ou o valor da mercadoria somado dentro do
// imposto. Nenhum regime do mundo cobra 150% em courier porta a porta, então
// o número passa a ser registrado para conferência em vez de virar boleto.
const LIMITE_IMPOSTO_SOBRE_DECLARADO = Number(process.env.IMPOSTO_LIMITE_MULTIPLO) || 1.5;

function conferirSanidade({ impostoUsdBase, valorDeclarado }) {
    if (!Number.isFinite(impostoUsdBase) || impostoUsdBase < 0) {
        return { ok: false, motivo: 'valor_invalido' };
    }
    if (!(valorDeclarado > 0)) {
        // Sem valor declarado não há com o que comparar; segue, mas registrado.
        return { ok: true, motivo: 'sem_valor_declarado' };
    }
    if (impostoUsdBase > valorDeclarado * LIMITE_IMPOSTO_SOBRE_DECLARADO) {
        return { ok: false, motivo: 'acima_do_limite' };
    }
    return { ok: true, motivo: null };
}

/*
 * Atalho sem IA, quando o regime ja responde sozinho.
 *
 * Havia um buraco entre os fluxos: a simulacao fechava a conta direto do
 * regime quando nenhuma medida dependia do NCM, mas a cotacao — que e onde o
 * dinheiro e cobrado — chamava a IA SEMPRE. Entao um destino ja apurado e
 * aprovado, de regra aritmetica, ficava refem de saldo na conta de IA: sem
 * credito, nenhum imposto aparecia para o cliente e nada entrava na cobranca
 * antecipada.
 *
 * Devolve null quando nao da para fechar sozinho, e ai quem chama segue para
 * a IA como antes. Os casos de null:
 *   - sem regime aprovado;
 *   - alguma medida aplicavel depende do NCM (`aliquota_pct: -1`);
 *   - a remessa tem itens de capitulos diferentes do HS, porque ai o escopo
 *     por capitulo pode valer para um item e nao para o outro, e uma conta so
 *     mentiria para algum deles;
 *   - cotacao em BRL sem cambio, que impediria posicionar as faixas de valor.
 */
async function tentarPeloRegime({ destCountry, incoterm, moeda, commodities, valorDeclarado, regime, frete }) {
    if (!regime) return null;

    const ncms = (Array.isArray(commodities) ? commodities : [])
        .map((c) => String(c?.harmonizedCode || '').replace(/\D/g, ''))
        .filter(Boolean);
    const capitulos = [...new Set(ncms.map((n) => n.slice(0, 2)))];
    if (capitulos.length > 1) return null;
    const ncm = ncms[0] || null;

    let fx = Number(await valorConversao());
    if (!Number.isFinite(fx) || fx <= 0) fx = 0;

    // O calculo direto raciocina em USD: as faixas e as taxas fixas do regime
    // sao definidas na moeda do destino e comparadas em dolar.
    let valorUsd = num(valorDeclarado);
    if (moeda === 'BRL') {
        if (!fx) return null;
        valorUsd = round2(valorUsd / fx);
    }
    // `frete` chega sempre em USD (preco_final da cotacao).
    const freteUsd = num(frete);

    const moedasDoRegime = new Set();
    for (const m of (regime.medidas || [])) {
        if (m.moeda_fixo) moedasDoRegime.add(m.moeda_fixo);
        if (m.moeda_limite) moedasDoRegime.add(m.moeda_limite);
    }
    if (regime.de_minimis?.moeda) moedasDoRegime.add(regime.de_minimis.moeda);

    const cotacoes = {
        BRL: fx ? 1 / fx : undefined,
        ...(moedasDoRegime.size ? await cotacoesParaUsd([...moedasDoRegime]) : {}),
    };

    const direto = calcularPeloRegime({ regime, valorUsd, freteUsd, cotacoes, ncm });
    if (!direto) return null;

    // A confianca aqui e a do REGIME, nao a de uma classificacao: e o regime
    // que esta determinando o numero.
    const margemPct = impostosMargemPorConfianca(regime.confianca);
    const colchaoPct = impostosColchaoCambioPct();

    const impostoUsdBase = round2(direto.total_usd);
    const impostoUsdComMargem = round2(impostoUsdBase * (1 + margemPct / 100));
    const impostoValorBrl = round2(impostoUsdComMargem * fx * (1 + colchaoPct / 100));

    // O breakdown vai na moeda da cotacao, como o da IA.
    const naMoeda = (usd) => (moeda === 'BRL' ? round2(num(usd) * fx) : round2(usd));
    const breakdown = [];
    if (direto.imposto_importacao_usd > 0 || direto.aliquota_importacao_pct > 0) {
        breakdown.push({
            nome: 'Imposto de importação',
            aliquota_pct: direto.aliquota_importacao_pct,
            valor: naMoeda(direto.imposto_importacao_usd),
            moeda,
            base: 'Valor declarado',
        });
    }
    if (direto.imposto_consumo_usd > 0) {
        breakdown.push({
            nome: regime.imposto_consumo?.nome || 'Imposto sobre consumo',
            aliquota_pct: direto.aliquota_consumo_pct,
            valor: naMoeda(direto.imposto_consumo_usd),
            moeda,
        });
    }
    if (direto.taxas_fixas_usd > 0) {
        breakdown.push({
            nome: 'Taxas fixas do destino',
            valor: naMoeda(direto.taxas_fixas_usd),
            moeda,
        });
    }

    console.info('[IMPOSTO][REGIME] calculado sem IA', {
        pais: destCountry,
        regime_id: regime.id,
        ncm,
        imposto_usd: impostoUsdBase,
    });

    return {
        provider: 'REGIME',
        pais_destino: destCountry || null,
        incoterm: incoterm || null,
        currency: moeda,
        imposto_usd_base: impostoUsdBase,
        margem_pct: margemPct,
        imposto_usd_com_margem: impostoUsdComMargem,
        fx,
        fx_fonte: 'awesomeapi',
        colchao_cambio_pct: colchaoPct,
        imposto_valor_brl: impostoValorBrl,
        breakdown,
        de_minimis: direto.isento_por_de_minimis === true,
        is_estimate: true,
        confianca: regime.confianca || null,
        // Nao houve classificacao: as aliquotas nao dependem do item.
        classificacao: [],
        divergencias: [],
        sanidade: conferirSanidade({ impostoUsdBase, valorDeclarado }),
        regime_apurado: true,
        regime_id: regime.id,
        regime_vigente: Array.isArray(regime.medidas) ? regime.medidas : [],
        fontes: Array.isArray(regime.fontes) ? regime.fontes : [],
        observacoes: 'Calculado direto do regime apurado e aprovado: nenhuma medida deste destino '
            + 'depende do NCM do item, entao a conta e aritmetica e nao passou por IA.',
        valor_declarado: valorDeclarado,
        raw_request: {
            pais_destino: destCountry || null,
            pais_origem: 'BR',
            incoterm: incoterm || null,
            moeda,
            valor_declarado: valorDeclarado,
            commodities,
            regime_id: regime.id,
            via: 'calculoDireto',
        },
        raw_response: direto,
    };
}

async function estimarImpostos({ destCountry, incoterm, currency = 'USD', commodities, regime = null, frete = null }) {
    const moeda = String(currency || 'USD').toUpperCase();
    const valorDeclarado = somarValorDeclarado(commodities);

    // Primeiro tenta fechar pelo regime. So chama a IA se ela for mesmo
    // necessaria — ela custa dinheiro e, sem saldo, derruba a estimativa de
    // destino cujas regras ja estao apuradas.
    const direto = await tentarPeloRegime({
        destCountry, incoterm, moeda, commodities, valorDeclarado, regime, frete,
    });
    if (direto) return direto;

    const ia = await estimarImpostosIA({
        paisDestino: destCountry,
        paisOrigem: 'BR',
        commodities,
        valorDeclarado,
        moeda,
        incoterm,
        regime,
        frete,
    });

    // A folga sai do nível de confiança que a própria estimativa declara: não
    // faz sentido cobrar a mesma margem de quem achou a alíquota do NCM em
    // fonte oficial e de quem estimou por analogia.
    const margemPct = impostosMargemPorConfianca(ia?.confianca);
    const colchaoPct = impostosColchaoCambioPct();

    let fx = Number(await valorConversao());
    if (!Number.isFinite(fx) || fx <= 0) fx = 0;

    // O snapshot guarda a base em USD. Se a cotação foi feita em real, desfaz
    // a conversão aqui, em vez de gravar BRL num campo chamado _usd_.
    const totalNaMoeda = round2(ia?.total);
    let impostoUsdBase = totalNaMoeda;
    if (moeda === 'BRL') impostoUsdBase = fx ? round2(totalNaMoeda / fx) : 0;

    const impostoUsdComMargem = round2(impostoUsdBase * (1 + margemPct / 100));
    const impostoValorBrl = round2(impostoUsdComMargem * fx * (1 + colchaoPct / 100));

    const sanidade = conferirSanidade({ impostoUsdBase, valorDeclarado });

    return {
        provider: ia.provider,
        pais_destino: destCountry || ia.pais_destino || null,
        incoterm: incoterm || null,
        currency: moeda,
        imposto_usd_base: impostoUsdBase,
        margem_pct: margemPct,
        imposto_usd_com_margem: impostoUsdComMargem,
        fx,
        fx_fonte: 'awesomeapi',
        colchao_cambio_pct: colchaoPct,
        imposto_valor_brl: impostoValorBrl,
        breakdown: montarBreakdown(ia, moeda),
        // Conclusão explícita da estimativa. Inferir de total === 0 fazia
        // resposta incompleta virar isenção — o mesmo erro do EDT, que
        // devolvia zero para todo destino.
        de_minimis: ia?.de_minimis?.aplicavel === true,
        is_estimate: true,
        confianca: ia.confianca || null,
        // O NCM que a IA usou de fato, e onde ele discorda do cadastro. É o
        // único ponto do fluxo capaz de perceber item mal classificado.
        classificacao: Array.isArray(ia.classificacao) ? ia.classificacao : [],
        divergencias: (Array.isArray(ia.classificacao) ? ia.classificacao : [])
            .filter((c) => c && c.diverge_do_informado),
        sanidade,
        regime_apurado: !!ia.regime_apurado,
        regime_id: ia.regime_id || null,
        // Sobe junto para ficar à mão na conferência: é aqui que se vê se a
        // estimativa aplicou uma sobretaxa que já tinha caído.
        regime_vigente: Array.isArray(ia.regime_vigente) ? ia.regime_vigente : [],
        fontes: Array.isArray(ia.fontes) ? ia.fontes : [],
        observacoes: ia.observacoes || null,
        valor_declarado: valorDeclarado,
        raw_request: {
            pais_destino: destCountry || null,
            pais_origem: 'BR',
            incoterm: incoterm || null,
            moeda,
            valor_declarado: valorDeclarado,
            commodities,
            modelo: ia.modelo,
        },
        raw_response: ia,
    };
}

/**
 * Monta commodities a partir do pedido gravado na cotação. Versão enxuta da
 * que o fedexController usa no despacho: imposto não depende de peso.
 */
function commoditiesDoPedido(pedido) {
    const moeda = String(pedido?.moeda || 'USD').toUpperCase();
    const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];

    const commodities = itens.map((it = {}) => {
        const qty = num(it.qty ?? it.quantidade) || 1;
        const unit = num(it.preco ?? it.unitPrice ?? it.price);
        const hs = it.hscode || it.hsCode || it.hs_code || it.harmonizedCode || '';

        return {
            description: String(it.titulo || it.descricao || 'Item').slice(0, 450),
            countryOfManufacture: 'BR',
            quantity: qty,
            ...(String(hs).trim() ? { harmonizedCode: String(hs).trim() } : {}),
            unitPrice: { amount: unit, currency: moeda },
            customsValue: { amount: round2(unit * qty), currency: moeda },
        };
    });

    return { commodities, moeda };
}

/**
 * Estima e grava a estimativa de uma cotação existente. Chamado depois que a
 * documentação é emitida — é ali que a mercadoria declarada para de mudar.
 *
 * Idempotente: se a cotação já tem estimativa, não gasta outra chamada de IA.
 * Nunca lança: quem chama está respondendo um request que já deu certo.
 *
 * @param {{ cotacao: any, db: any }} args
 * @returns {Promise<{ ok: boolean, motivo?: string, estimativa_id?: number }>}
 */
async function registrarEstimativaDaCotacao({ cotacao, db }) {
    try {
        if (!cotacao?.id) return { ok: false, motivo: 'sem_cotacao' };
        if (cotacao.imposto_estimativa_id) return { ok: false, motivo: 'ja_estimado' };

        const cliente = await db.Cliente.findByPk(cotacao.cliente_id);
        if (!impostosBetaHabilitado(cliente)) return { ok: false, motivo: 'fora_da_allowlist' };

        const pedido = cotacao.pedido && typeof cotacao.pedido === 'object' ? cotacao.pedido : {};
        const { commodities, moeda } = commoditiesDoPedido(pedido);
        if (!commodities.length) return { ok: false, motivo: 'pedido_sem_itens' };

        const destino = cotacao.pais_dest
            || pedido?.pais
            || pedido?.destinatario?.pais
            || pedido?.recipient?.address?.countryCode
            || null;
        if (!destino) return { ok: false, motivo: 'sem_pais_destino' };

        // Regime aprovado e dentro da validade. Sem ele a estimativa ainda
        // sai, mas em modo autônomo — menos confiável, e marcada como tal
        // para a conferência saber que aquele número não passou pelo gate.
        const regime = await obterRegimeAprovado({ paisDestino: destino, db });
        if (!regime) {
            console.warn('[IMPOSTO][IA] sem regime aprovado para', destino, '- estimando em modo autonomo');
        }

        const est = await estimarImpostos({
            destCountry: destino,
            incoterm: pedido?.incoterm || null,
            currency: moeda,
            commodities,
            regime,
            // preco_final ja e o frete cobrado do cliente, em USD.
            frete: num(cotacao.preco_final),
        });

        const snap = await db.ImpostoEstimativa.create({
            cotacao_id: cotacao.id,
            cliente_id: cotacao.cliente_id,
            provider: est.provider,
            incoterm: est.incoterm,
            pais_origem: 'BR',
            pais_destino: destino,
            moeda: est.currency,
            commodities_snapshot: commodities,
            imposto_usd_base: est.imposto_usd_base,
            margem_pct: est.margem_pct,
            imposto_usd_com_margem: est.imposto_usd_com_margem,
            fx_usado: est.fx,
            fx_fonte: est.fx_fonte,
            colchao_cambio_pct: est.colchao_cambio_pct,
            imposto_valor_brl: est.imposto_valor_brl,
            breakdown: est.breakdown,
            de_minimis: est.de_minimis,
            is_estimate: est.is_estimate,
            modo: impostosModo(cliente),
            raw_request: est.raw_request,
            raw_response: est.raw_response,
            hash: crypto.createHash('sha256')
                .update(JSON.stringify(est.raw_response || {}))
                .digest('hex'),
        });

        // Em shadow a estimativa é gravada e fica visível, mas NÃO vai para o
        // campo que o boleto cobra: é assim que se roda em produção contra
        // envios reais sem arriscar cobrar errado de um cliente. O flag
        // existia desde o início e até aqui só rotulava o snapshot.
        const enforce = impostosModo(cliente) === 'enforce';
        const cobravel = enforce && est.sanidade?.ok !== false;

        if (!cobravel) {
            console.warn('[IMPOSTO][IA][NAO_COBRADO]', {
                cotacao_id: cotacao.id,
                modo: impostosModo(cliente),
                sanidade: est.sanidade?.motivo || null,
                brl_estimado: est.imposto_valor_brl,
            });
        }

        await db.Cotacao.update({
            impostos_valor_brl: cobravel ? est.imposto_valor_brl : null,
            impostos_moeda: 'BRL',
            impostos_estimados: est.breakdown,
            imposto_estimativa_id: snap.id,
            impostos_modo: impostosModo(cliente),
        }, { where: { id: cotacao.id } });

        if (est.divergencias?.length) {
            console.warn('[IMPOSTO][IA][NCM_DIVERGENTE]', {
                cotacao_id: cotacao.id,
                itens: est.divergencias.map((d) => ({
                    item: d.item,
                    usado: d.ncm_usado,
                    motivo: d.motivo,
                })),
            });
        }

        console.log('[IMPOSTO][IA][OK]', {
            cotacao_id: cotacao.id,
            destino,
            regime_apurado: est.regime_apurado,
            regime_id: est.regime_id,
            base_usd: est.imposto_usd_base,
            confianca: est.confianca,
            margem_pct: est.margem_pct,
            brl: est.imposto_valor_brl,
            cobrado: cobravel,
            divergencias: est.divergencias?.length || 0,
            ms: est.raw_response?.duracao_ms,
        });

        return { ok: true, estimativa_id: snap.id };
    } catch (err) {
        console.error('[IMPOSTO][IA][ERR]', cotacao?.id, err?.message);
        return { ok: false, motivo: 'erro', erro: err?.message };
    }
}

module.exports = { estimarImpostos, registrarEstimativaDaCotacao, commoditiesDoPedido };
