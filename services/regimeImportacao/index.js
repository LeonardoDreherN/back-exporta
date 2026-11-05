// services/regimeImportacao/index.js
// Apura o regime tarifário vigente de um destino para mercadoria brasileira.
//
// Por que isso existe: duas cotações idênticas, no mesmo dia, deram US$ 201,89
// e US$ 81,89. A diferença era uma sobretaxa de 25% que uma rodada aplicou e a
// outra deixou de fora, por não conseguir confirmar se vestuário estava na
// lista anexa. Cada cotação estava redescobrindo, do zero e com orçamento de
// bolso, uma pergunta que é IDÊNTICA para todas as remessas do mesmo destino.
//
// Aqui a pergunta é respondida uma vez, com orçamento alto, exigindo fonte
// primária, e em DUAS rodadas independentes que precisam concordar. Se
// discordarem, ninguém cobra nada: vira pendência para conferência humana.

const { chamarModelo } = require('../impostosIA/cliente');

// Orçamento de busca alto: é uma chamada por destino a cada dias, não por
// remessa. Abrir o anexo da tarifa custa buscas, e foi exatamente o que faltou.
const MAX_BUSCAS = 20;

// Duas rodadas independentes. Cada uma das rodadas anteriores achou uma medida
// real que a outra perdeu — uma achou a Seção 301 do Brasil, a outra a de
// 'forced labor'. Rodar duas vezes e comparar transforma isso em sinal.
const RODADAS = 2;

// Regime velho é regime errado: em sete meses os EUA mudaram quatro vezes.
const VALIDADE_DIAS = Number(process.env.REGIME_VALIDADE_DIAS) || 7;

const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [
        'pais_destino', 'resumo', 'medidas', 'de_minimis', 'imposto_consumo',
        'taxas_fixas', 'medidas_descartadas', 'fontes', 'confianca', 'observacoes',
    ],
    properties: {
        pais_destino: { type: 'string' },
        resumo: {
            type: 'string',
            description: 'Um parágrafo em português, para um humano aprovar sem ler o resto',
        },
        medidas: {
            type: 'array',
            description: 'Somente o que está em vigor HOJE e incide sobre mercadoria brasileira',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['medida', 'tipo', 'aliquota_pct', 'aplica_a', 'em_vigor_desde', 'fonte_primaria'],
                properties: {
                    medida: { type: 'string' },
                    tipo: {
                        type: 'string',
                        enum: ['mfn', 'sobretaxa', 'preferencial', 'antidumping', 'outro'],
                        description: 'mfn = tarifa normal por NCM (varia por produto, deixe aliquota_pct em -1)',
                    },
                    aliquota_pct: {
                        type: 'number',
                        description: 'Use -1 quando a alíquota depende do NCM do item',
                    },
                    base: { type: 'string', description: 'FOB, CIF, valor aduaneiro...' },
                    aplica_a: {
                        type: 'string',
                        description: 'Escopo: todos os produtos, lista anexa, capítulos X e Y...',
                    },
                    excecoes: {
                        type: 'string',
                        description: 'Capítulos/NCM EXCLUÍDOS. Se houver anexo, abra o anexo e diga quais capítulos ele cobre',
                    },
                    em_vigor_desde: { type: 'string' },
                    expira_em: { type: 'string', description: 'Vazio se não tem prazo' },
                    fonte_primaria: {
                        type: 'string',
                        description: 'URL de Federal Register, USTR, CBP, HTSUS ou equivalente oficial do país',
                    },
                },
            },
        },
        de_minimis: {
            type: 'object',
            additionalProperties: false,
            required: ['existe', 'limite', 'moeda', 'observacao'],
            properties: {
                existe: { type: 'boolean' },
                limite: { type: 'number' },
                moeda: { type: 'string' },
                observacao: { type: 'string' },
            },
        },
        imposto_consumo: {
            type: 'object',
            additionalProperties: false,
            required: ['nome', 'aliquota_pct', 'incide_na_importacao'],
            properties: {
                nome: { type: 'string', description: 'VAT, GST, ou "nenhum"' },
                aliquota_pct: { type: 'number' },
                incide_na_importacao: { type: 'boolean' },
            },
        },
        taxas_fixas: {
            type: 'array',
            description: 'Taxas alfandegárias do país, como MPF nos EUA. NÃO inclua taxa de transportadora',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['nome', 'valor', 'moeda', 'quando'],
                properties: {
                    nome: { type: 'string' },
                    valor: { type: 'number' },
                    moeda: { type: 'string' },
                    quando: { type: 'string', description: 'Condição: entrada formal, informal, faixa de valor...' },
                },
            },
        },
        medidas_descartadas: {
            type: 'array',
            description: 'Medidas que você encontrou e NÃO aplicou por terem caído. Prova que foram verificadas',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['medida', 'motivo'],
                properties: {
                    medida: { type: 'string' },
                    motivo: { type: 'string', description: 'Revogada, expirada, derrubada na Justiça, substituída por...' },
                },
            },
        },
        fontes: { type: 'array', items: { type: 'string' } },
        confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
        observacoes: { type: 'string' },
    },
};

const SISTEMA = `Você apura o regime tarifário de importação em vigor num país de destino, para mercadoria originária do Brasil chegando por courier expresso.

Esta apuração vale para MUITAS remessas e serve de base para cobrar o cliente adiantado. Um erro aqui se repete em todas elas. Trabalhe como quem vai assinar embaixo.

O usuário informa a data de hoje. Ela é a única referência de "vigente".

Método obrigatório:
1. Levante TODAS as medidas que incidem sobre mercadoria brasileira: tarifa normal (MFN), sobretaxas, medidas emergenciais, ações comerciais, antidumping.
2. Para CADA uma, confirme em FONTE PRIMÁRIA se ainda vale na data de hoje. Fonte primária é o diário oficial do país (Federal Register nos EUA), o órgão que editou a medida (USTR, CBP), ou a tarifa oficial (HTSUS). Tracker de despachante, blog de escritório de advocacia e notícia NÃO servem para confirmar vigência — eles demoram a atualizar e já causaram erro grave aqui. Use-os no máximo para descobrir que a medida existe, nunca para concluir que ela vale.
3. Quando uma medida tiver lista anexa de produtos incluídos ou excluídos, ABRA O ANEXO e diga quais capítulos do Sistema Harmonizado ele cobre. Não aceite descrição de terceiro sobre o anexo. Esta é a falha mais cara: uma apuração anterior deixou uma sobretaxa de 25% de fora por não ter conferido o anexo, e subestimou o imposto em 60%.
4. Toda medida que você encontrou mas NÃO aplicou precisa aparecer em "medidas_descartadas", com o motivo. Se você não listou nada ali, provavelmente não procurou o suficiente: medidas recentes vêm sendo revogadas, expirando e sendo substituídas.
5. Verifique o regime de de minimis na data de hoje.
6. NÃO inclua frete nem taxa de desembaraço da transportadora.

Sobre a alíquota MFN: ela varia por NCM, então registre a medida com tipo "mfn" e aliquota_pct = -1. Quem for calcular vai buscar a alíquota do NCM específico depois.

"confianca": use "alta" somente se confirmou TODAS as medidas em fonte primária e abriu os anexos que existirem. Qualquer medida que você não conseguiu confirmar na fonte primária derruba para "media" ou "baixa", e deve estar dita em "observacoes".`;

/** Assinatura numérica da apuração, para comparar duas rodadas objetivamente. */
function assinatura(r) {
    const medidas = (r?.medidas || [])
        .map((m) => `${m.tipo}:${Number(m.aliquota_pct)}`)
        .sort()
        .join('|');

    const dm = r?.de_minimis || {};
    const ic = r?.imposto_consumo || {};

    return [
        medidas,
        `dm:${dm.existe ? Number(dm.limite) : 'nao'}`,
        `ic:${ic.incide_na_importacao ? Number(ic.aliquota_pct) : 'nao'}`,
    ].join(' // ');
}

/** O que diferiu entre as rodadas, em linguagem de quem vai conferir. */
function compararRodadas(a, b) {
    const div = [];

    const chave = (m) => `${m.tipo}:${Number(m.aliquota_pct)}`;
    const mapA = new Map((a?.medidas || []).map((m) => [chave(m), m]));
    const mapB = new Map((b?.medidas || []).map((m) => [chave(m), m]));

    for (const [k, m] of mapA) {
        if (!mapB.has(k)) div.push({ onde: 'medida', so_na_rodada: 1, medida: m.medida, aliquota_pct: m.aliquota_pct });
    }
    for (const [k, m] of mapB) {
        if (!mapA.has(k)) div.push({ onde: 'medida', so_na_rodada: 2, medida: m.medida, aliquota_pct: m.aliquota_pct });
    }

    const dmA = a?.de_minimis || {};
    const dmB = b?.de_minimis || {};
    if (!!dmA.existe !== !!dmB.existe || Number(dmA.limite) !== Number(dmB.limite)) {
        div.push({ onde: 'de_minimis', rodada_1: dmA, rodada_2: dmB });
    }

    const icA = a?.imposto_consumo || {};
    const icB = b?.imposto_consumo || {};
    if (Number(icA.aliquota_pct) !== Number(icB.aliquota_pct)) {
        div.push({ onde: 'imposto_consumo', rodada_1: icA, rodada_2: icB });
    }

    return div;
}

/** Soma das sobretaxas de alíquota fixa — o que entra além do MFN do item. */
function sobretaxaTotalPct(regime) {
    return (regime?.medidas || [])
        .filter((m) => m.tipo !== 'mfn' && Number(m.aliquota_pct) > 0)
        .reduce((acc, m) => acc + Number(m.aliquota_pct), 0);
}

/**
 * Apura o regime e grava como 'pendente'. Não aprova nada sozinho: cobrar
 * contra número não conferido é o que este módulo inteiro existe para evitar.
 *
 * @param {{ paisDestino: string, paisOrigem?: string, db: any }} args
 */
async function pesquisarRegime({ paisDestino, paisOrigem = 'BR', db }) {
    if (!paisDestino) throw new Error('paisDestino é obrigatório');

    const destino = String(paisDestino).trim().toUpperCase();
    const hoje = new Date().toISOString().slice(0, 10);

    const pergunta = [
        `Data de hoje: ${hoje}`,
        `País de destino: ${destino}`,
        `Origem da mercadoria: ${paisOrigem}`,
        '',
        'Apure o regime tarifário em vigor hoje para mercadoria deste país de origem entrando neste destino por courier expresso.',
    ].join('\n');

    const rodadas = [];
    for (let i = 0; i < RODADAS; i++) {
        const { dados, meta } = await chamarModelo({
            sistema: SISTEMA,
            pergunta,
            schema: SCHEMA,
            maxBuscas: MAX_BUSCAS,
            effort: 'max',
            maxTokens: 32000,
        });
        rodadas.push({ dados, meta });
    }

    const [r1, r2] = rodadas;
    const divergencias = RODADAS > 1 ? compararRodadas(r1.dados, r2.dados) : [];
    const concordaram = divergencias.length === 0;

    // Quando discordam, fica a rodada mais conservadora — a que soma mais
    // sobretaxa. Não é para cobrar assim (o status segue 'pendente'), é para
    // quem conferir olhar primeiro o cenário que dá prejuízo se ignorado.
    let escolhida = r1;
    if (!concordaram && r2 && sobretaxaTotalPct(r2.dados) > sobretaxaTotalPct(r1.dados)) {
        escolhida = r2;
    }

    const confiancaFinal = concordaram ? (escolhida.dados.confianca || 'media') : 'baixa';

    const custoTotal = rodadas.reduce((a, r) => a + (r.meta.custo?.total_usd || 0), 0);
    const validoAte = new Date(Date.now() + VALIDADE_DIAS * 24 * 60 * 60 * 1000);

    const linha = await db.RegimeImportacao.create({
        pais_destino: destino,
        pais_origem: paisOrigem,
        resumo: escolhida.dados.resumo || null,
        medidas: escolhida.dados.medidas || [],
        de_minimis: escolhida.dados.de_minimis || null,
        imposto_consumo: escolhida.dados.imposto_consumo || null,
        fontes: escolhida.dados.fontes || [],
        confianca: confiancaFinal,
        rodadas: RODADAS,
        divergencias: concordaram ? null : divergencias,
        status: 'pendente',
        valido_ate: validoAte,
        raw: {
            escolhida: escolhida.dados,
            assinaturas: rodadas.map((r) => assinatura(r.dados)),
            custo_usd: Math.round(custoTotal * 10000) / 10000,
            todas: rodadas.map((r) => ({ dados: r.dados, meta: r.meta })),
        },
    });

    console.log('[REGIME][APURADO]', {
        pais: destino,
        id: linha.id,
        concordaram,
        divergencias: divergencias.length,
        confianca: confiancaFinal,
        medidas: (escolhida.dados.medidas || []).length,
        descartadas: (escolhida.dados.medidas_descartadas || []).length,
        ms: rodadas.reduce((a, r) => a + r.meta.duracao_ms, 0),
        custo_usd: Math.round(custoTotal * 10000) / 10000,
    });

    return linha;
}

/**
 * Regime aprovado e dentro da validade. Retorna null quando não há — e nesse
 * caso quem chama decide: estimar sem regime apurado (marcando isso) ou não
 * estimar.
 */
async function obterRegimeAprovado({ paisDestino, db }) {
    if (!paisDestino) return null;

    return db.RegimeImportacao.findOne({
        where: {
            pais_destino: String(paisDestino).trim().toUpperCase(),
            status: 'aprovado',
        },
        order: [['aprovado_em', 'DESC']],
    }).then((r) => {
        if (!r) return null;
        if (r.valido_ate && new Date(r.valido_ate) < new Date()) return null;
        return r;
    });
}

/** Aprova uma apuração. É o gate entre "a IA disse" e "a Intrex cobra". */
async function aprovarRegime({ id, quem, db }) {
    const linha = await db.RegimeImportacao.findByPk(id);
    if (!linha) return null;

    await linha.update({
        status: 'aprovado',
        aprovado_por: String(quem || 'desconhecido').slice(0, 120),
        aprovado_em: new Date(),
    });

    return linha;
}

async function rejeitarRegime({ id, quem, db }) {
    const linha = await db.RegimeImportacao.findByPk(id);
    if (!linha) return null;

    await linha.update({
        status: 'rejeitado',
        aprovado_por: String(quem || 'desconhecido').slice(0, 120),
        aprovado_em: new Date(),
    });

    return linha;
}

module.exports = {
    pesquisarRegime,
    obterRegimeAprovado,
    aprovarRegime,
    rejeitarRegime,
    sobretaxaTotalPct,
    VALIDADE_DIAS,
};
