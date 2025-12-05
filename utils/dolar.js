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
        const hoje = new Date();
        const dia = String(hoje.getDate()).padStart(2, "0");
        const mes = String(hoje.getMonth() + 1).padStart(2, "0");
        const ano = hoje.getFullYear();

        const data = `${mes}-${dia}-${ano}`;

        const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${data}'&$top=1&$format=json`;

        const resp = await axios.get(url);

        const valor = resp.data?.value?.[0]?.cotacaoVenda;

        if (!valor) throw new Error("Sem cotação do dia.");

        return Number(valor);
    } catch (err) {
        console.error("[DOLAR] Erro ao consultar PTAX:", err.message);
        return 0; // fallback
    }
}

module.exports = { valorConversao };
