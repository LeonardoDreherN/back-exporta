const { setTimeout: delay } = require("timers/promises");

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

module.exports = { getJson };