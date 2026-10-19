// services/impostosIA/cliente.js
// Plumbing compartilhado das chamadas ao Claude: cliente, timeout, extração do
// JSON e tratamento de recusa. Fica separado porque duas perguntas muito
// diferentes usam a mesma canalização — o regime tarifário do destino (rara,
// cara, com busca pesada) e a classificação do item (por cotação, barata).

const Anthropic = require('@anthropic-ai/sdk');
const { calcularCusto } = require('./custo');

const MODELO = 'claude-opus-5';

// A pesquisa de regime chega a alguns minutos quando abre anexo de tarifa.
// Nenhuma das duas chamadas tem alguém esperando do outro lado, então folga
// aqui não custa nada; apertado custa uma estimativa já paga.
const TIMEOUT_MS = 600000;

let clienteCache = null;

function cliente() {
    if (!clienteCache) {
        // Erro explícito: sem isso o SDK falha lá na frente com 401 genérico e
        // o log não diz qual serviço do Render ficou sem a variável.
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY não configurada neste serviço');
        }
        clienteCache = new Anthropic({ timeout: TIMEOUT_MS });
    }
    return clienteCache;
}

/** Extrai o JSON da resposta. Com busca ativa vêm blocos de resultado junto. */
function extrairJson(resposta) {
    const textos = (resposta?.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

    if (!textos) return null;

    try {
        return JSON.parse(textos);
    } catch {
        // Cinto de segurança: se algo escapar do schema, ainda tenta achar o
        // objeto no meio do texto.
        const inicio = textos.indexOf('{');
        const fim = textos.lastIndexOf('}');
        if (inicio < 0 || fim <= inicio) return null;
        try {
            return JSON.parse(textos.slice(inicio, fim + 1));
        } catch {
            return null;
        }
    }
}

/**
 * @param {{
 *   sistema: string,
 *   pergunta: string,
 *   schema: object,
 *   maxBuscas?: number,
 *   effort?: 'low'|'medium'|'high'|'xhigh'|'max',
 *   maxTokens?: number,
 * }} args
 */
async function chamarModelo({ sistema, pergunta, schema, maxBuscas = 4, effort = 'high', maxTokens = 16000 }) {
    const inicio = Date.now();

    const body = {
        model: MODELO,
        max_tokens: maxTokens,
        system: [
            // Bloco próprio para entrar em cache entre chamadas do mesmo tipo.
            { type: 'text', text: sistema, cache_control: { type: 'ephemeral' } },
        ],
        output_config: {
            effort,
            format: { type: 'json_schema', schema },
        },
        messages: [{ role: 'user', content: pergunta }],
    };

    // Sem busca a chamada fica muito mais rápida e barata; a classificação com
    // regime já apurado não precisa pesquisar nada.
    if (maxBuscas > 0) {
        body.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxBuscas }];
    }

    const resposta = await cliente().messages.create(body);

    const uso = {
        entrada: resposta.usage?.input_tokens ?? 0,
        saida: resposta.usage?.output_tokens ?? 0,
        cache_leitura: resposta.usage?.cache_read_input_tokens ?? 0,
        // Escrita de cache é o item mais caro escondido numa chamada com
        // busca: os resultados entram no contexto e são gravados a 1,25x o
        // preço de entrada. Sem medir isso, o custo mensal é chute.
        cache_escrita: resposta.usage?.cache_creation_input_tokens ?? 0,
        buscas: resposta.usage?.server_tool_use?.web_search_requests ?? 0,
    };

    const custo = calcularCusto(uso);

    console.log('[IA][CUSTO]', {
        buscas: uso.buscas,
        saida: uso.saida,
        cache_escrita: uso.cache_escrita,
        usd: custo.total_usd,
        s: Math.round((Date.now() - inicio) / 1000),
    });

    if (resposta.stop_reason === 'refusal') {
        const erro = new Error(`Claude recusou: ${resposta.stop_details?.category || 'sem categoria'}`);
        erro.stopDetails = resposta.stop_details;
        throw erro;
    }

    const dados = extrairJson(resposta);
    if (!dados) throw new Error('Resposta da IA não trouxe JSON utilizável');

    return {
        dados,
        meta: {
            modelo: resposta.model,
            duracao_ms: Date.now() - inicio,
            uso,
            custo,
        },
    };
}

module.exports = { chamarModelo, MODELO, TIMEOUT_MS };
