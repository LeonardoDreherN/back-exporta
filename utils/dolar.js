// utils/dolar.js
const axios = require("axios");

const CACHE_MS = 60 * 60 * 1000;           // 10 minutos
let cache = {
    valor: null,
    atualizadoEm: 0,
};
async function valorConversao() {
    const agora = Date.now();

    // Se tiver valor recente em cache, usa e evita chamar a API externa
    if (cache.valor && (agora - cache.atualizadoEm) < CACHE_MS) {
        console.log("[DOLAR BACK] USANDO CACHE. valor =", cache.valor);
        return cache.valor;
    }

    try {
        // const hoje = new Date();
        // const dia = String(hoje.getDate()).padStart(2, "0");
        // const mes = String(hoje.getMonth() + 1).padStart(2, "0");
        // const ano = hoje.getFullYear();

        // const data = `${mes}-${dia}-${ano}`;

        const url = `https://economia.awesomeapi.com.br/json/last/USD-BRL`;

        const resp = await axios.get(url);
        console.log(">>>>>>>",resp?.data.USDBRL.high)

        // const valor = resp.USDBRL.high;

        // if (!valor) throw new Error("Sem cotação do dia.");
        cache.valor = resp?.data.USDBRL.high;
        cache.atualizadoEm = agora;

        return resp?.data.USDBRL.high;
    } catch (err) {
        console.error("[DOLAR] Erro ao consultar PTAX:", err.message);
        return 0; // fallback
    }
}

module.exports = { valorConversao };
