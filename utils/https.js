const { setTimeout: delay } = require("timers/promises");
const axios = require("axios");

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

function createHttp(timeoutMs = 15000) {
    const api = axios.create({ timeout: timeoutMs });
    api.interceptors.response.use(r => r, async err => {
        const cfg = err.config || {};
        cfg.__retries = (cfg.__retries || 0) + 1;
        if (cfg.__retries <= 2 && (!err.response || err.response.status >= 500)) {
            await new Promise(r => setTimeout(r, 250 * cfg.__retries));
            return api(cfg);
        }
        throw err;
    });
    return api;
}

module.exports = { getJson, createHttp };