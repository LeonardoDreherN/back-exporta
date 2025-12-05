// utils/dolar.js
const axios = require("axios");

let cache = {
    valor: null,
    atualizadoEm: 0,
};

const CACHE_MS = 10 * 60 * 1000;           // 10 minutos

async function valorConversao() {
    const agora = Date.now();

    // Se tiver valor recente em cache, usa e evita chamar a API externa
    if (cache.valor && (agora - cache.atualizadoEm) < CACHE_MS) {
        return cache.valor;
    }

    try {
        const { data } = await axios.get(
            "https://economia.awesomeapi.com.br/json/last/USD-BRL",
            { timeout: 3000 }
        );

        const valor = Number(data?.USDBRL?.high);

        if (!Number.isFinite(valor)) {
            throw new Error("Cotação inválida");
        }

        cache = { valor, atualizadoEm: agora };
        return valor;
    } catch (err) {
        console.error(
            "[DOLAR] Erro ao consultar AwesomeAPI, usando fallback:",
            err?.response?.status,
            err?.response?.data || err.message
        );
    }
}

module.exports = { valorConversao };
