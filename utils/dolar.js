// utils/dolar.js
const axios = require("axios");

const CACHE_MS = 60 * 60 * 1000;           //UMA HORA
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

        const resp = await axios.get(url, {
            timeout: 8000,
            headers: {
                // a AwesomeAPI aceita x-api-key
                "x-api-key": process.env.AWESOMEAPI_TOKEN,
            },
            // se em algum momento preferir por querystring, seria algo tipo:
            // params: { token: process.env.AWESOMEAPI_TOKEN },
        });
        console.log(">>>>>>>", resp?.data.USDBRL.high)

        // const valor = resp.USDBRL.high;

        // if (!valor) throw new Error("Sem cotação do dia.");
        cache.valor = resp?.data.USDBRL.high;
        cache.atualizadoEm = agora;

        return resp?.data.USDBRL.high;
    } catch (err) {
        console.error(
            "[DOLAR BACK] ERRO AO CONSULTAR AWESOMEAPI:",
            err?.message || err
        );

        // se já tinha valor em cache, usa ele
        if (cache.valor) {
            console.warn(
                "[DOLAR BACK] Usando valor antigo do cache após erro:",
                cache.valor
            );
            return cache.valor;
        }

        // deixa estourar pra gente ver no JSON também
        throw err;
    }
}

module.exports = { valorConversao };
