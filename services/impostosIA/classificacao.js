// services/impostosIA/classificacao.js
// Classifica um item dentro de um regime já apurado, e guarda o resultado.
//
// Separado da estimativa de cotação porque aqui o que interessa é a ALÍQUOTA,
// que não depende do valor da remessa. Uma classificação de camiseta para os
// EUA serve para todas as simulações de camiseta para os EUA — e é isso que
// torna viável mostrar imposto no simulador, que é de uso livre.

const crypto = require('crypto');
const { chamarModelo } = require('./cliente');

// Com o regime em mãos, a única pesquisa que resta é a alíquota do NCM.
const MAX_BUSCAS = 3;

const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [
        'ncm_usado', 'aliquota_importacao_pct', 'aliquota_consumo_pct',
        'taxas_fixas_usd', 'medidas_aplicadas', 'confianca', 'observacoes',
    ],
    properties: {
        ncm_usado: { type: 'string', description: 'NCM/HS que você classificou' },
        aliquota_importacao_pct: {
            type: 'number',
            description: 'Soma de MFN + sobretaxas do regime que alcançam este NCM',
        },
        aliquota_consumo_pct: {
            type: 'number',
            description: 'VAT/GST sobre a importação, 0 se não houver',
        },
        taxas_fixas_usd: {
            type: 'number',
            description: 'Soma das taxas fixas do país aplicáveis nesta faixa de valor, em USD',
        },
        medidas_aplicadas: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['medida', 'aliquota_pct'],
                properties: {
                    medida: { type: 'string' },
                    aliquota_pct: { type: 'number' },
                },
            },
        },
        confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
        observacoes: { type: 'string', description: 'Português, curto' },
    },
};

const SISTEMA = `Você classifica uma mercadoria dentro de um regime tarifário que JÁ FOI APURADO e aprovado por uma pessoa.

O regime vem pronto na pergunta e é a autoridade sobre quais medidas estão em vigor. NÃO pesquise se elas continuam valendo, NÃO acrescente medida que não esteja lá, NÃO descarte medida que esteja lá.

Seu trabalho:
1. Classificar a mercadoria no NCM/HS do destino. Se o usuário informou um NCM, confira se é plausível para a descrição e use-o; se for claramente incompatível, use o correto e diga isso em "observacoes".
2. Buscar a alíquota MFN desse NCM (o regime marca a MFN com aliquota_pct = -1 porque ela depende do item).
3. Somar as sobretaxas do regime que ALCANÇAM este NCM. Respeite o escopo e as exceções de cada medida: se ela vale só para uma lista anexa de capítulos, verifique se o NCM cai nela. Se uma sobretaxa não se aplica, não some — e explique em "observacoes".
4. "aliquota_importacao_pct" é a soma final: MFN + sobretaxas aplicáveis.
5. "taxas_fixas_usd": some as taxas fixas do regime que incidem NA FAIXA DE VALOR informada. Preste atenção à condição de cada uma (entrada formal x informal, pisos e tetos).
6. NÃO inclua frete nem taxa de desembaraço da transportadora.

Você está devolvendo ALÍQUOTAS, não valores: elas serão aplicadas a remessas de valores variados dentro da faixa informada.

"confianca": "alta" só quando achou a alíquota do NCM específico em fonte oficial e o enquadramento nas medidas é claro. Dúvida entre dois NCM plausíveis: use o de alíquota MAIOR e caia para "media".`;

/** Chave estável do item: NCM quando existe, senão hash da descrição. */
function chaveDoItem({ ncm, descricao }) {
    const digitos = String(ncm || '').replace(/\D/g, '');
    if (digitos.length >= 4) return `ncm:${digitos}`;

    const texto = String(descricao || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!texto) return 'generico';
    return `desc:${crypto.createHash('sha256').update(texto).digest('hex').slice(0, 24)}`;
}

/**
 * Faixa de valor. Os degraus vêm do próprio regime: de minimis e o limite de
 * entrada formal mudam o que é cobrado, então a alíquota não pode ser
 * reaproveitada entre eles.
 */
function faixaDeValor(valorUsd, regime) {
    const v = Number(valorUsd) || 0;
    const dm = regime?.de_minimis;

    const limiteDm = dm?.existe ? Number(dm.limite) : 0;
    const limiteFormal = Number(process.env.LIMITE_ENTRADA_FORMAL_USD) || 2500;

    if (limiteDm > 0 && v <= limiteDm) return `ate_${limiteDm}`;
    if (v <= limiteFormal) return `ate_${limiteFormal}`;
    return `acima_${limiteFormal}`;
}

/** Renderiza o regime para a pergunta. */
function descreverRegime(regime) {
    const linhas = ['===== REGIME APURADO E APROVADO ====='];
    if (regime.resumo) linhas.push(regime.resumo, '');

    linhas.push('MEDIDAS EM VIGOR:');
    for (const m of (regime.medidas || [])) {
        const aliq = Number(m.aliquota_pct) === -1 ? 'alíquota depende do NCM' : `${m.aliquota_pct}%`;
        linhas.push(`- ${m.medida}`);
        linhas.push(`  tipo: ${m.tipo} | ${aliq}`);
        linhas.push(`  aplica a: ${m.aplica_a}`);
        if (m.excecoes) linhas.push(`  exceções: ${m.excecoes}`);
    }

    const dm = regime.de_minimis;
    if (dm) linhas.push('', `DE MINIMIS: ${dm.existe ? `${dm.limite} ${dm.moeda}` : 'não há / suspenso'}${dm.observacao ? ` — ${dm.observacao}` : ''}`);

    const ic = regime.imposto_consumo;
    if (ic) {
        linhas.push(ic.incide_na_importacao
            ? `IMPOSTO SOBRE CONSUMO: ${ic.nome} ${ic.aliquota_pct}%`
            : `IMPOSTO SOBRE CONSUMO: ${ic.nome || 'nenhum'} (não incide na importação)`);
    }

    const taxas = regime.raw?.escolhida?.taxas_fixas || [];
    if (taxas.length) {
        linhas.push('', 'TAXAS FIXAS DO PAÍS:');
        for (const t of taxas) linhas.push(`- ${t.nome}: ${t.valor} ${t.moeda} (${t.quando})`);
    }

    linhas.push('=====================================');
    return linhas.join('\n');
}

/**
 * Devolve a classificação, da cache quando possível.
 *
 * @param {{ regime:object, ncm?:string, descricao?:string, valorUsd:number, db:any }} args
 * @returns {Promise<{ classificacao:object, doCache:boolean }>}
 */
async function obterClassificacao({ regime, ncm, descricao, valorUsd, db }) {
    if (!regime?.id) throw new Error('classificação exige regime aprovado');

    const chave = chaveDoItem({ ncm, descricao });
    const faixa = faixaDeValor(valorUsd, regime);

    const existente = await db.ClassificacaoImposto.findOne({
        where: { regime_id: regime.id, chave_item: chave, faixa },
    });

    if (existente) {
        // increment não recarrega a instância, mas o contador não é lido no
        // mesmo request — serve só para saber depois quais itens se repetem.
        existente.increment('usos').catch(() => { });
        return { classificacao: existente, doCache: true };
    }

    const pergunta = [
        descreverRegime(regime),
        '',
        `Destino: ${regime.pais_destino}`,
        `Origem: ${regime.pais_origem || 'BR'}`,
        `Faixa de valor da remessa: ${faixa.replace('ate_', 'até US$ ').replace('acima_', 'acima de US$ ')}`,
        '',
        'Mercadoria:',
        `- ${descricao || 'Mercadoria geral'}${ncm ? ` | NCM/HS informado: ${ncm}` : ' | NCM/HS não informado'}`,
    ].join('\n');

    const { dados, meta } = await chamarModelo({
        sistema: SISTEMA,
        pergunta,
        schema: SCHEMA,
        maxBuscas: MAX_BUSCAS,
        effort: 'high',
        maxTokens: 8000,
    });

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    // findOrCreate em vez de create: duas simulações do mesmo item podem
    // chegar juntas e a chave é única.
    const [linha] = await db.ClassificacaoImposto.findOrCreate({
        where: { regime_id: regime.id, chave_item: chave, faixa },
        defaults: {
            pais_destino: regime.pais_destino,
            regime_id: regime.id,
            chave_item: chave,
            faixa,
            ncm: dados.ncm_usado || (ncm ? String(ncm) : null),
            descricao: String(descricao || '').slice(0, 200) || null,
            aliquota_importacao_pct: num(dados.aliquota_importacao_pct),
            aliquota_consumo_pct: num(dados.aliquota_consumo_pct),
            taxas_fixas_usd: num(dados.taxas_fixas_usd),
            medidas_aplicadas: dados.medidas_aplicadas || [],
            confianca: dados.confianca || null,
            observacoes: dados.observacoes || null,
            custo_usd: meta.custo?.total_usd ?? null,
            usos: 1,
        },
    });

    console.log('[CLASSIFICACAO][NOVA]', {
        pais: regime.pais_destino,
        chave,
        faixa,
        ncm: dados.ncm_usado,
        aliquota: dados.aliquota_importacao_pct,
        confianca: dados.confianca,
        usd: meta.custo?.total_usd,
    });

    return { classificacao: linha, doCache: false };
}

/**
 * Aplica uma classificação a um valor concreto. Aritmética pura: é o que
 * permite reaproveitar a mesma classificação para valores diferentes.
 */
function aplicarClassificacao({ classificacao, valorUsd }) {
    const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
    const v = Number(valorUsd) || 0;

    const impImportacao = r2(v * (Number(classificacao.aliquota_importacao_pct) / 100));
    // O imposto sobre consumo costuma incidir sobre valor + imposto de
    // importação, não só sobre a mercadoria.
    const impConsumo = r2((v + impImportacao) * (Number(classificacao.aliquota_consumo_pct) / 100));
    const taxasFixas = r2(classificacao.taxas_fixas_usd);

    return {
        imposto_importacao_usd: impImportacao,
        imposto_consumo_usd: impConsumo,
        taxas_fixas_usd: taxasFixas,
        total_usd: r2(impImportacao + impConsumo + taxasFixas),
        aliquota_importacao_pct: Number(classificacao.aliquota_importacao_pct),
        aliquota_consumo_pct: Number(classificacao.aliquota_consumo_pct),
        confianca: classificacao.confianca,
        observacoes: classificacao.observacoes,
        ncm: classificacao.ncm,
        medidas_aplicadas: classificacao.medidas_aplicadas || [],
    };
}

module.exports = { obterClassificacao, aplicarClassificacao, chaveDoItem, faixaDeValor };
