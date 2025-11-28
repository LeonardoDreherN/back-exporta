const { default: axios } = require("axios");

async function valorConversao(){
    const { data } = await axios.get("https://economia.awesomeapi.com.br/json/last/USD-BRL")

    const resp = data?.USDBRL

    if(!resp){
        throw new Error("Resposta inválida da API de câmbio");
    }

    const dolar = Number(resp.bid)
    return dolar
}

module.exports = { valorConversao }