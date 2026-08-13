const { setTimeout: delay } = require("timers/promises");
const axios = require("axios");
const { logSync } = require("../services/syncLog");
const { sinalizarInstabilidade } = require("../services/integrationAlert");

async function getJson(url, { timeout = 8000, headers = {} } = {}) {
    const ac = new AbortController();
    const id = setTimeout(() => ac.abort(), timeout);
    try {
        const resp = await fetch(url, { signal: ac.signal, headers });
        const isJson = resp.headers.get("content-type")?.includes("application/json");
        const body = isJson ? await resp.json() : null;
        return { ok: resp.ok, status: resp.status, body };
    } finally {
        clearTimeout(id);
        await delay(0);
    }
}

const MAX_RETRIES_5XX = 2;
const MAX_RETRIES_429 = 3;

function parseRetryAfterMs(headerValue) {
    if (!headerValue) return null;
    const asSeconds = Number(headerValue);
    if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000);
    const asDate = Date.parse(headerValue);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
    return null;
}

// `integration` (ex.: 'ups', 'fedex') é opcional — quando informado, cada tentativa que
// falha vira uma linha em SyncLog (status: 'error'), respondendo ao questionário de
// homologação sobre log de requests com erro.
function createHttp(timeoutMs = 15000, integration = null) {
    const api = axios.create({ timeout: timeoutMs });

    api.interceptors.response.use(r => r, async (err) => {
        const cfg = err.config || {};
        const status = err.response?.status;
        const isRateLimited = status === 429;
        const isServerError = !err.response || status >= 500;

        cfg.__retries = (cfg.__retries || 0) + 1;
        const maxRetries = isRateLimited ? MAX_RETRIES_429 : MAX_RETRIES_5XX;
        const podeTentarDeNovo = (isRateLimited || isServerError) && cfg.__retries <= maxRetries;

        if (integration) {
            logSync({
                integration,
                status: 'error',
                message: `${(cfg.method || 'GET').toUpperCase()} ${cfg.url || ''} - HTTP ${status ?? 'sem resposta'} - tentativa ${cfg.__retries}/${maxRetries}${podeTentarDeNovo ? ' - retentando' : ' - desistindo'} - ${err.message}`,
            }).catch(() => {});
        }

        if (podeTentarDeNovo) {
            // 429: respeita Retry-After da API se vier, senão espera bem mais que o
            // backoff de 5xx (pedido explícito do questionário de homologação)
            const waitMs = isRateLimited
                ? (parseRetryAfterMs(err.response?.headers?.['retry-after']) ?? 2000 * cfg.__retries)
                : 250 * cfg.__retries;
            await delay(waitMs);
            return api(cfg);
        }

        // 429 persistente mesmo depois de esgotar as retentativas: sinaliza como
        // instabilidade na status page (mesmo mecanismo do health-check periódico),
        // não só loga — responde a "analisar se há algum problema na integração"
        if (isRateLimited && integration) {
            sinalizarInstabilidade(integration, `Rate limit (429) persistente após ${cfg.__retries} tentativas`).catch(() => {});
        }

        throw err;
    });

    return api;
}

module.exports = { getJson, createHttp };