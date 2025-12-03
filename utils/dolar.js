const { default: axios } = require("axios");

async function valorConversao(){
    const { data } = await axios.get("https://economia.awesomeapi.com.br/json/last/USD-BRL")

    const resp = data?.USDBRL

    if(!resp){
        throw new Error("Resposta inválida da API de câmbio");
    }

    const dolar = Number(Number(resp.high).toFixed(2)) - 0.01
    console.log(dolar)
    return dolar
}

module.exports = { valorConversao }