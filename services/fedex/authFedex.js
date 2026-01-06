// backend/services/fedex/oauth.js
const axios = require("axios");
const cfg = require("../../config/fedex");

let tokenCache = { token: null, exp: 0 };

async function getToken() {
    const now = Date.now();
    if (tokenCache.token && now < tokenCache.exp - 60_000) return tokenCache.token;

    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", cfg.clientId);
    params.append("client_secret", cfg.clientSecret);
    if (cfg.scope) params.append("scope", cfg.scope);

    const url = cfg.oauth || "https://apis-sandbox.fedex.com/oauth/token";

    try {
        console.log("[FEDEX] base:", cfg.base);
        console.log("[FEDEX] oauth:", url);
        console.log("[FEDEX] rate:", cfg.rateQuotes);
        console.log("[FEDEX] clientId(first8):", String(cfg.clientId || "").slice(0, 8));
        console.log("[FEDEX] NODE_ENV:", process.env.NODE_ENV);

        const res = await axios.post(url, params.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            validateStatus: () => true,
            timeout: cfg.timeoutMs || 30000,
        });

        if (res.status >= 400) {
            console.error("[FEDEX/OAUTH][ERR]", res.status, res.data);
            const err = new Error("FedEx OAuth error");
            err.status = res.status;
            err.upstream = res.data;
            throw err;
        }

        const { access_token, expires_in } = res.data || {};
        if (!access_token) throw new Error("FedEx OAuth: access_token ausente na resposta");

        const ttlMs = (Number(expires_in) || 3600) * 1000;
        tokenCache = { token: access_token, exp: Date.now() + ttlMs };

        // console.log("[FEDEX/OAUTH] Token OK. Expira em ~", ttlMs / 1000, "s");
        return access_token;
    } catch (err) {
        const status = err?.response?.status ?? err?.status;
        const data = err?.response?.data ?? err?.upstream;

        // console.log("[FEDEX][OAUTH][FAIL] status:", status);
        // console.log("[FEDEX][OAUTH][FAIL] data:", JSON.stringify(data, null, 2));
        // console.log("[FEDEX][OAUTH][FAIL] message:", err?.message);
        // console.log("[FEDEX][OAUTH][FAIL] code:", err?.code);
        // console.log("[FEDEX][OAUTH][FAIL] url:", err?.config?.url);

        throw Object.assign(new Error("FedEx OAuth error"), { status, upstream: data, code: err?.code });
    }
}

function baseUrl(path = "") {
    const root = cfg.base || "https://apis-sandbox.fedex.com";
    if (!path) return root;
    if (path.startsWith("/")) return root + path;
    return `${root}/${path}`;
}

module.exports = { getToken, baseUrl };
