// backend/api/mock-transportadora.js
const ALLOW_ORIGIN = process.env.FRONTEND_URL || "*";

const cors = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
    return new Response(null, { status: 204, headers: cors });
}

function n(v, d = 0) {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
}
function s(v, d = "") {
    return (v ?? d).toString().trim();
}

export async function POST(req) {
    try {
        const body = await req.json();

        // --- mapeia/normaliza campos recebidos
        // Observação: o usuário escreveu "moeda_emiassao"; aceitamos ambos:
        const moeda_emissao =
            s(body.moeda_emissao || body.moeda_emiassao || body.moedaEmissao || "");
        const moeda_pagamento = s(body.moeda_pagamento || body.moedaPagamento || "");
        const pais_remetente = s(body.pais_remetente || body.paisRemetente || "");
        const pais_dest = s(body.pais_dest || body.paisDestino || body.pais_destino || "");

        // caixas: [{altura, largura, profundidade, peso}]
        const caixasInput = Array.isArray(body.caixa) ? body.caixa : body.caixas;
        const caixas = Array.isArray(caixasInput) ? caixasInput : [];

        // quantidade de caixas = tamanho do array
        const quantidade_caixas = caixas.length;

        // pedido
        const pedidoRaw = body.pedido || {};
        const pedido = {
            id: s(pedidoRaw.id),
            moeda: s(pedidoRaw.moeda),
            total: n(pedidoRaw.total),
            nomeComprador: s(pedidoRaw.nomeComprador),
            emailComprador: s(pedidoRaw.emailComprador),
            telefoneComprador: s(pedidoRaw.telefoneComprador),
            endereco: s(pedidoRaw.endereço || pedidoRaw.endereco),
            cidade: s(pedidoRaw.cidade),
            estado: s(pedidoRaw.estado),
            CEP: s(pedidoRaw.CEP || pedidoRaw.cep),
            pais: s(pedidoRaw.pais),
            itens: Array.isArray(pedidoRaw.itens) ? pedidoRaw.itens : [],
        };

        // --- validações mínimas
        const missing = [];
        if (!moeda_emissao) missing.push("moeda_emissao");
        if (!moeda_pagamento) missing.push("moeda_pagamento");
        if (!pais_remetente) missing.push("pais_remetente");
        if (!pais_dest) missing.push("pais_dest");
        if (!quantidade_caixas) missing.push("caixas (mín. 1)");

        if (missing.length) {
            return new Response(
                JSON.stringify({ ok: false, error: "Campos obrigatórios ausentes", campos: missing }),
                { status: 400, headers: { "Content-Type": "application/json", ...cors } }
            );
        }

        // --- cálculo mock
        // peso cubado (kg) = (C * L * A) / 5000  (C,L,A em cm) – regra aérea comum
        // peso taxável = max(peso real, peso cubado)
        // tarifa = base + (porKg * pesoTaxávelTotal) + seguro + crossBorderFee (se países diferentes)
        let pesoTaxavelTotal = 0;
        const itensCaixa = [];

        for (const c of caixas) {
            const altura = n(c.altura);
            const largura = n(c.largura);
            const profundidade = n(c.profundidade);
            const peso = n(c.peso); // kg

            const pesoCubado = (altura * largura * profundidade) / 5000;
            const pesoTaxavel = Math.max(peso, pesoCubado);

            itensCaixa.push({
                altura_cm: altura,
                largura_cm: largura,
                profundidade_cm: profundidade,
                peso_real_kg: Number(peso.toFixed(2)),
                peso_cubado_kg: Number(pesoCubado.toFixed(2)),
                peso_taxavel_kg: Number(pesoTaxavel.toFixed(2)),
            });

            pesoTaxavelTotal += pesoTaxavel;
        }

        // parâmetros da tarifa (ajuste à vontade)
        const base = 9.9;
        const porKg = 4.5;
        const seguro = 2.0;
        const crossBorderFee =
            pais_remetente && pais_dest && pais_remetente.toUpperCase() !== pais_dest.toUpperCase()
                ? 6.0
                : 0;

        const preco = base + pesoTaxavelTotal * porKg + seguro + crossBorderFee;

        // simulando conversão de moeda de emissão → moeda de pagamento (mock fixo 1:1)
        // se quiser, aplique um câmbio aqui
        const preco_na_moeda_pagamento = preco;

        // --- resposta
        const resp = {
            ok: true,
            quote_id: "Q" + Math.random().toString(36).slice(2, 8).toUpperCase(),
            carrier: "MockCarrier",
            moeda_emissao,
            moeda_pagamento,
            pais_remetente,
            pais_dest,
            quantidade_caixas,
            resumo_caixas: {
                peso_taxavel_total_kg: Number(pesoTaxavelTotal.toFixed(2)),
                itens: itensCaixa,
            },
            pedido, // eco dos dados do pedido
            preco_total: Number(preco.toFixed(2)),
            preco_total_moeda_pagamento: Number(preco_na_moeda_pagamento.toFixed(2)),
            breakdown: {
                base,
                porKg,
                seguro,
                crossBorderFee,
            },
        };

        return new Response(JSON.stringify(resp), {
            status: 200,
            headers: { "Content-Type": "application/json", ...cors },
        });
    } catch (e) {
        return new Response(
            JSON.stringify({ ok: false, error: e?.message || "bad request" }),
            { status: 400, headers: { "Content-Type": "application/json", ...cors } }
        );
    }
}
