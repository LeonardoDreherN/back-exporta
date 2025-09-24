// controller/CotacaoController.js
const { Cotacao, PedidoImport /*, Caixas*/ } = require("../models");

const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const s = (v, d = "") => (v ?? d).toString().trim();

function normalizePedido(ped) {
    if (!ped) return null;
    return {
        id: s(ped.id || ped.pedido_ref),
        moeda: s(ped.moeda),
        total: n(ped.total),
        nomeComprador: s(ped.nomeComprador),
        emailComprador: s(ped.emailComprador),
        telefoneComprador: s(ped.telefoneComprador),
        endereco: s(ped.endereco || ped.endereço),
        cidade: s(ped.cidade),
        estado: s(ped.estado),
        CEP: s(ped.CEP || ped.cep),
        pais: s(ped.pais),
        itens: Array.isArray(ped.itens) ? ped.itens : [],
    };
}

async function criarCotacao(req, res) {
    try {
        const cliente_id = req.clienteId;
        const body = req.body || {};

        const moeda_emissao = s(body.moeda_emissao || body.moeda_emiassao || body.moedaEmissao);
        const moeda_pagamento = s(body.moeda_pagamento || body.moedaPagamento);
        const pais_remetente = s(body.pais_remetente || body.paisRemetente);
        const pais_dest = s(body.pais_dest || body.paisDestino || body.pais_destino);

        // pedido: por ref do cliente ou inline
        let pedido = body.pedido ? normalizePedido(body.pedido) : null;
        let pedido_ref = s(body.pedido_ref || (pedido && pedido.id));
        if (!pedido && pedido_ref) {
            const ped = await PedidoImport.findOne({ where: { cliente_id, pedido_ref } });
            if (!ped) return res.status(400).json({ ok: false, error: "pedido_ref não encontrado" });
            pedido = normalizePedido({ ...ped.toJSON(), id: ped.pedido_ref });
        }

        // caixas: inline ou por ids (se você tiver model Caixas multi-tenant)
        let caixas = [];
        if (Array.isArray(body.caixas)) caixas = body.caixas;
        else if (Array.isArray(body.caixa)) caixas = body.caixa;
        if ((!caixas || caixas.length === 0) && Array.isArray(body.caixa_ids)) {
            // const rows = await Caixas.findAll({ where: { cliente_id, id: body.caixa_ids } });
            // caixas = rows.map(r => ({ altura:r.altura, largura:r.largura, profundidade:r.profundidade, peso:r.peso }));
        }

        const missing = [];
        if (!moeda_emissao) missing.push("moeda_emissao");
        if (!moeda_pagamento) missing.push("moeda_pagamento");
        if (!pais_remetente) missing.push("pais_remetente");
        if (!pais_dest) missing.push("pais_dest");
        if (!pedido || !(pedido.id || pedido_ref)) missing.push("pedido_ref ou pedido válido");
        if (!caixas || caixas.length === 0) missing.push("caixas (mín. 1)");
        if (missing.length) return res.status(400).json({ ok: false, error: "Campos obrigatórios ausentes", campos: missing });

        if (!pedido_ref) pedido_ref = s(pedido.id);

        // cálculo mock
        let pesoTaxavelTotal = 0;
        const itensCaixa = [];
        for (const c of caixas) {
            const altura = n(c.altura), largura = n(c.largura), profundidade = n(c.profundidade), peso = n(c.peso);
            const pesoCubado = (altura * largura * profundidade) / 5000;
            const pesoTaxavel = Math.max(peso, pesoCubado);
            itensCaixa.push({
                altura_cm: altura, largura_cm: largura, profundidade_cm: profundidade,
                peso_real_kg: Number(peso.toFixed(2)),
                peso_cubado_kg: Number(pesoCubado.toFixed(2)),
                peso_taxavel_kg: Number(pesoTaxavel.toFixed(2)),
            });
            pesoTaxavelTotal += pesoTaxavel;
        }

        const base = 9.9, porKg = 4.5, seguro = 2.0;
        const crossBorderFee = pais_remetente.toUpperCase() !== pais_dest.toUpperCase() ? 6.0 : 0;
        const preco = base + pesoTaxavelTotal * porKg + seguro + crossBorderFee;

        const resp = {
            ok: true,
            quote_id: "Q" + Math.random().toString(36).slice(2, 8).toUpperCase(),
            created_at: new Date().toISOString(),
            carrier: "MockCarrier",
            moeda_emissao, moeda_pagamento, pais_remetente, pais_dest,
            quantidade_caixas: itensCaixa.length,
            resumo_caixas: { peso_taxavel_total_kg: Number(pesoTaxavelTotal.toFixed(2)), itens: itensCaixa },
            pedido,
            preco_total: Number(preco.toFixed(2)),
            preco_total_moeda_pagamento: Number(preco.toFixed(2)),
            breakdown: { base, porKg, seguro, crossBorderFee },
        };

        await Cotacao.create({
            cliente_id,
            quote_id: resp.quote_id,
            carrier: resp.carrier,
            pedido_ref,
            caixa_ids: Array.isArray(body.caixa_ids) ? body.caixa_ids : null,
            moeda_emissao, moeda_pagamento, pais_remetente, pais_dest,
            quantidade_caixas: resp.quantidade_caixas,
            preco_total: resp.preco_total,
            preco_total_moeda_pagamento: resp.preco_total_moeda_pagamento,
            peso_taxavel_total_kg: resp.resumo_caixas.peso_taxavel_total_kg,
            pedido_snapshot: pedido,
            caixas_snapshot: itensCaixa,
            breakdown: resp.breakdown,
        });

        res.json({ cliente_id, pedido_ref, ...resp });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}

async function listarCotacoes(req, res) {
    try {
        const cliente_id = req.clienteId;
        const where = { cliente_id };
        if (req.query.pais_dest) where.pais_dest = req.query.pais_dest;
        if (req.query.moeda) where.moeda_emissao = req.query.moeda;
        if (req.query.pedido_ref) where.pedido_ref = req.query.pedido_ref;

        const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
        const offset = Math.max(0, Number(req.query.offset || 0));

        const rows = await Cotacao.findAll({ where, limit, offset, order: [["created_at", "DESC"]] });
        res.json({ ok: true, cliente_id, itens: rows, limit, offset });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}

module.exports = { criarCotacao, listarCotacoes };
