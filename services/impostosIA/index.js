// services/impostosIA/index.js
// Aplica o regime tarifário já apurado do destino aos itens de UMA remessa.
//
// Antes esta chamada fazia as duas coisas: descobria o regime do país E
// classificava o item. Resultado: duas cotações idênticas, no mesmo dia,
// devolveram US$ 201,89 e US$ 81,89 — cada uma redescobriu as regras por conta
// própria e chegou a conclusões diferentes sobre a mesma sobretaxa.
//
// Agora o regime vem pronto de services/regimeImportacao (apurado uma vez por
// destino, com fonte primária e conferência humana) e aqui só se resolve o que
// de fato é por remessa: qual NCM, qual alíquota, quanto dá.

const { chamarModelo, MODELO } = require('./cliente');

// Com o regime apurado em mãos, a única busca que sobra é a alíquota MFN do
// NCM — estável e fácil de achar. Sem regime, cai no modo autônomo, que
// precisa de muito mais.
const BUSCAS_COM_REGIME = 3;
const BUSCAS_SEM_REGIME = 8;

const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [
        'pais_destino', 'moeda', 'imposto_importacao', 'imposto_consumo',
        'taxas_adicionais', 'total', 'regime_vigente', 'confianca', 'fontes',
        'observacoes', 'classificacao', 'de_minimis',
    ],
    properties: {
        pais_destino: { type: 'string', description: 'ISO-2 do destino' },
        moeda: { type: 'string', description: 'Moeda dos valores, ISO-4217' },
        imposto_importacao: {
            type: 'object',
            additionalProperties: false,
            required: ['aliquota_pct', 'valor', 'base'],
            properties: {
                aliquota_pct: { type: 'number' },
                valor: { type: 'number' },
                base: { type: 'string', description: 'Sobre o que incide e como foi composta a alíquota' },
            },
        },
        imposto_consumo: {
            type: 'object',
            additionalProperties: false,
            required: ['nome', 'aliquota_pct', 'valor'],
            properties: {
                nome: { type: 'string', description: 'VAT, GST, sales tax, ou "nenhum"' },
                aliquota_pct: { type: 'number' },
                valor: { type: 'number' },
            },
        },
        taxas_adicionais: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['nome', 'valor'],
                properties: {
                    nome: { type: 'string' },
                    valor: { type: 'number' },
                },
            },
        },
        total: { type: 'number', description: 'Soma de tudo, na moeda informada' },
        // Torna visível a falha que mais dói: aplicar (ou esquecer) uma
        // sobretaxa. Sem isso o número errado chega sem rastro.
        regime_vigente: {
            type: 'array',
            description: 'Medidas efetivamente aplicadas neste cálculo',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['medida', 'em_vigor_desde', 'confirmado_hoje'],
                properties: {
                    medida: { type: 'string' },
                    em_vigor_desde: { type: 'string' },
                    confirmado_hoje: { type: 'boolean' },
                    substituiu: { type: 'string' },
                },
            },
        },
        confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
        fontes: { type: 'array', items: { type: 'string' } },
        observacoes: { type: 'string' },

        // O NCM vem do cadastro do cliente e nem sempre corresponde à
        // mercadoria: já chegou máscara capilar classificada como xampu. Sem
        // isto a alíquota errada entra no cálculo sem deixar rastro.
        classificacao: {
            type: 'array',
            description: 'Uma entrada por item, na ordem em que foram listados na pergunta',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['item', 'ncm_usado', 'diverge_do_informado', 'motivo'],
                properties: {
                    item: { type: 'number', description: 'Número do item na lista da pergunta' },
                    ncm_usado: { type: 'string', description: 'NCM/HS que você efetivamente usou no cálculo' },
                    diverge_do_informado: {
                        type: 'boolean',
                        description: 'true quando o NCM informado não corresponde à mercadoria descrita',
                    },
                    motivo: { type: 'string', description: 'Por que o informado não serve; vazio quando não diverge' },
                },
            },
        },

        // Conclusão explícita, em vez de inferir de total = 0: resposta
        // incompleta e isenção de verdade não podem virar a mesma coisa.
        de_minimis: {
            type: 'object',
            additionalProperties: false,
            required: ['aplicavel', 'limite', 'moeda'],
            properties: {
                aplicavel: {
                    type: 'boolean',
                    description: 'true apenas se a remessa fica isenta por ficar abaixo do de minimis do destino',
                },
                limite: { type: 'number', description: 'Limite do de minimis; 0 quando não há' },
                moeda: { type: 'string', description: 'Moeda do limite; vazio quando não há' },
            },
        },
    },
};

// ---- Modo 1: regime já apurado e aprovado. É o caminho normal. ----
const SISTEMA_COM_REGIME = `Você calcula o imposto de importação de UMA remessa, aplicando um regime tarifário que JÁ FOI APURADO e conferido por uma pessoa.

O regime vem pronto na pergunta. Ele é a autoridade sobre quais medidas estão em vigor: NÃO pesquise se as medidas continuam valendo, NÃO acrescente medida que não esteja lá, NÃO descarte medida que esteja lá. Essa parte já foi decidida e aprovada.

Seu trabalho é o que é específico desta remessa:
1. Classificar cada item no NCM/HS correto do destino.
2. Buscar a alíquota MFN desse NCM (o regime marca a MFN com aliquota_pct = -1 justamente porque ela depende do item).
3. Aplicar as sobretaxas do regime, respeitando o escopo e as exceções que cada medida declara. Se uma medida vale só para uma lista anexa de capítulos, verifique se o NCM do item cai nela.
4. Aplicar o imposto sobre consumo e as taxas fixas do regime quando couberem.
5. NÃO incluir frete nem taxa de desembaraço da transportadora.

Regras de saída:
- Todos os valores na moeda do valor declarado informado.
- "imposto_importacao.base" deve mostrar a composição: MFN de X% + sobretaxa de Y% = Z%.
- "regime_vigente": liste as medidas do regime que você efetivamente aplicou. Se deixou alguma de fora por escopo, diga em "observacoes" qual e por quê.
- "confianca": "alta" quando achou a alíquota do NCM específico em fonte oficial e o enquadramento nas medidas é claro; "media" quando usou alíquota de capítulo ou o escopo de alguma medida ficou dúbio; "baixa" quando estimou por analogia.
- "classificacao": para CADA item, informe o NCM que você usou. Classifique pela descrição da mercadoria, não pelo NCM informado: se o informado não corresponde ao produto descrito, use o correto, marque "diverge_do_informado" e diga em "motivo" o que não bate.
- "de_minimis.aplicavel": true somente quando a remessa fica isenta por ficar abaixo do limite do destino. Se você não conseguiu apurar o de minimis, marque false e registre em "observacoes" — não use isenção como saída para dúvida.
- Na dúvida entre dois NCM plausíveis, use o de alíquota MAIOR: subestimar gera prejuízo para quem adianta o pagamento, superestimar gera devolução.`;

// ---- Modo 2: sem regime apurado. Pior, e marcado como tal. ----
const SISTEMA_SEM_REGIME = `Você estima o imposto de importação cobrado no país de destino de uma remessa internacional expressa (courier, porta a porta).

ATENÇÃO: não há apuração de regime conferida para este destino, então você precisa levantar as regras também. Esse caminho é reconhecidamente menos confiável — seja conservador e registre a incerteza.

O usuário informa a data de hoje. Ela é a única referência de "vigente".

Como trabalhar:
1. Busque a alíquota do NCM/HS informado no país de destino.
2. Para CADA sobretaxa ou medida extraordinária, confirme em fonte primária (diário oficial, órgão emissor, tarifa oficial) se continua valendo na data de hoje. Medidas recentes têm sido revogadas, derrubadas na Justiça, expiradas ou substituídas, e fontes secundárias demoram a atualizar. Quando a medida tiver lista anexa de produtos, abra o anexo.
3. Verifique o regime de de minimis do destino na data de hoje.
4. Inclua o imposto sobre consumo do destino quando incidir sobre importação.
5. Inclua taxas alfandegárias recorrentes do país.
6. NÃO inclua frete nem taxa de desembaraço da transportadora.

Regras de saída:
- Todos os valores na moeda do valor declarado informado.
- "regime_vigente": as medidas aplicadas, com data de início e confirmação de vigência. Se descartou alguma por ter caído, diga qual e o que entrou no lugar.
- "confianca": nunca use "alta" neste modo — sem apuração conferida, o teto é "media".
- "fontes": URLs, incluindo as usadas para confirmar vigência.
- "classificacao": para CADA item, informe o NCM que você usou. Classifique pela descrição da mercadoria, não pelo NCM informado: se o informado não corresponde ao produto descrito, use o correto, marque "diverge_do_informado" e diga em "motivo" o que não bate.
- "de_minimis.aplicavel": true somente quando a remessa fica isenta por ficar abaixo do limite do destino. Se você não conseguiu apurar o de minimis, marque false e registre em "observacoes" — não use isenção como saída para dúvida.
- Quando a dúvida for de CLASSIFICAÇÃO, use a alíquota maior. Quando for de VIGÊNCIA, pesquise até saber; medida não confirmada fica de fora, com a incerteza registrada em "observacoes".`;

/** Descrição curta dos itens, do jeito que a alfândega enxerga. */
function descreverItens(commodities = []) {
    return (Array.isArray(commodities) ? commodities : [])
        .map((c, i) => {
            const ncm = c.harmonizedCode ? ` | NCM/HS ${c.harmonizedCode}` : ' | NCM/HS não informado';
            const qtd = c.quantity ? ` | ${c.quantity} un.` : '';
            const valor = c.customsValue?.amount ?? c.unitPrice?.amount;
            const origem = c.countryOfManufacture ? ` | fabricado em ${c.countryOfManufacture}` : '';
            return `${i + 1}. ${c.description || 'Mercadoria'}${ncm}${qtd}${valor ? ` | valor ${valor}` : ''}${origem}`;
        })
        .join('\n');
}

/** Renderiza o regime apurado como texto, para entrar na pergunta. */
function descreverRegime(regime) {
    if (!regime) return null;

    const linhas = ['===== REGIME APURADO E APROVADO ====='];
    if (regime.resumo) linhas.push(regime.resumo, '');

    linhas.push('MEDIDAS EM VIGOR:');
    for (const m of (regime.medidas || [])) {
        const aliq = Number(m.aliquota_pct) === -1
            ? 'alíquota depende do NCM'
            : `${m.aliquota_pct}%`;
        linhas.push(`- ${m.medida}`);
        linhas.push(`  tipo: ${m.tipo} | ${aliq} | base: ${m.base || 'não informada'}`);
        linhas.push(`  aplica a: ${m.aplica_a}`);
        if (m.excecoes) linhas.push(`  exceções: ${m.excecoes}`);
        linhas.push(`  em vigor desde ${m.em_vigor_desde}${m.expira_em ? `, expira em ${m.expira_em}` : ''}`);
    }

    const dm = regime.de_minimis;
    if (dm) {
        linhas.push('', `DE MINIMIS: ${dm.existe ? `${dm.limite} ${dm.moeda}` : 'não há / suspenso'}${dm.observacao ? ` — ${dm.observacao}` : ''}`);
    }

    const ic = regime.imposto_consumo;
    if (ic && ic.incide_na_importacao) {
        linhas.push(`IMPOSTO SOBRE CONSUMO: ${ic.nome} ${ic.aliquota_pct}%`);
    } else if (ic) {
        linhas.push(`IMPOSTO SOBRE CONSUMO: ${ic.nome || 'nenhum'} (não incide na importação)`);
    }

    const taxas = regime.raw?.escolhida?.taxas_fixas || [];
    if (taxas.length) {
        linhas.push('', 'TAXAS FIXAS DO PAÍS:');
        for (const t of taxas) {
            linhas.push(`- ${t.nome}: ${t.valor} ${t.moeda} (${t.quando})`);
        }
    }

    linhas.push('=====================================');
    return linhas.join('\n');
}

/**
 * @param {{
 *   paisDestino: string, paisOrigem?: string, commodities: any[],
 *   valorDeclarado: number, moeda?: string, incoterm?: string,
 *   regime?: object|null,
 * }} args
 */
async function estimarImpostosIA({
    paisDestino,
    paisOrigem = 'BR',
    commodities = [],
    valorDeclarado,
    moeda = 'USD',
    incoterm,
    regime = null,
    // Frete da remessa. Em boa parte do mundo a base do imposto sobre consumo
    // e CIF: na UE o IVA incide sobre mercadoria + frete + seguro + direito.
    // Sem este numero a estimativa para a Europa saia curta, porque o modelo
    // nao tinha como somar o que nunca recebeu.
    frete = null,
}) {
    if (!paisDestino) throw new Error('paisDestino é obrigatório');

    const comRegime = !!regime;
    const textoRegime = descreverRegime(regime);

    // A data vai na pergunta, não no bloco de sistema: no sistema furaria o
    // cache todo dia. E sem ela o modelo não separa "o que vale hoje" do que
    // valia no documento que a busca devolveu.
    const hoje = new Date().toISOString().slice(0, 10);

    const pergunta = [
        `Data de hoje: ${hoje}`,
        textoRegime,
        textoRegime ? '' : null,
        `Origem: ${paisOrigem}`,
        `Destino: ${paisDestino}`,
        incoterm ? `Incoterm: ${incoterm}` : null,
        `Valor declarado total (mercadoria): ${valorDeclarado} ${moeda}`,
        Number(frete) > 0
            ? `Frete da remessa: ${Number(frete).toFixed(2)} ${moeda} — some na base quando o destino tributar sobre CIF`
            : null,
        '',
        'Itens:',
        descreverItens(commodities) || '(sem detalhamento de itens)',
    ].filter((l) => l !== null && l !== undefined).join('\n');

    const { dados, meta } = await chamarModelo({
        sistema: comRegime ? SISTEMA_COM_REGIME : SISTEMA_SEM_REGIME,
        pergunta,
        schema: SCHEMA,
        maxBuscas: comRegime ? BUSCAS_COM_REGIME : BUSCAS_SEM_REGIME,
        effort: 'high',
    });

    // Sem regime conferido o teto de confiança é "media", mesmo que o modelo
    // se declare "alta": ninguém validou as regras que ele usou.
    let confianca = dados.confianca;
    if (!comRegime && confianca === 'alta') confianca = 'media';

    return {
        ...dados,
        confianca,
        provider: 'CLAUDE_OPUS_5',
        modelo: meta.modelo || MODELO,
        regime_apurado: comRegime,
        regime_id: regime?.id || null,
        duracao_ms: meta.duracao_ms,
        uso: meta.uso,
        custo_usd: meta.custo?.total_usd ?? null,
    };
}

module.exports = { estimarImpostosIA, SCHEMA, MODELO };
