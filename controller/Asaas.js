const { Op } = require("sequelize");
const db = require("../models/index.js");
const Cotacao = db.Cotacao;
const { fromSurcharges } = require("../utils/fromSurcharges.js");
const { valorConversao } = require("../utils/dolar.js");
const { impostosBetaHabilitado } = require("../services/featureFlags.js");
const axios = require("axios");

function round2(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
}

const URL_ASAAS =
    process.env.ASAAS_AMB === "production"
        ? "https://api.asaas.com/v3"
        : "https://api-sandbox.asaas.com/v3";

const ASAAS_TOKEN = process.env.ASAAS_AMB === "production" ? process.env.ASAAS_TOKEN_PROD : process.env.ASAAS_TOKEN_SANDBOX

function n(v) {
    if (v === null || v === undefined) return 0;
    const num = Number(
        String(v).replace(".", "").replace(",", ".") // aceita "1.234,56"
    );
    return Number.isNaN(num) ? 0 : num;
}

async function verificaCustomer(cliente) {
    if (cliente.customerAsaas) {
        try {
            const { data } = await axios.get(
                `${URL_ASAAS}/customers/${cliente.customerAsaas}`,
                {
                    headers: {
                        Accept: "application/json",
                        "User-Agent": "exporta-digital-intrex/1.0",
                        access_token: ASAAS_TOKEN,
                    },
                }
            );

            // se não estourou erro, o customer existe nesse ambiente
            return data.id;
        } catch (error) {
            console.warn(
                "[ASAAS] customer salvo é inválido nesse ambiente, recriando...",
                error?.response?.data || error.message
            );
            // segue o fluxo pra criar um novo abaixo
        }
    }

    const payload = {
        name: cliente.razaoSocial,
        cpfCnpj: cliente.cnpj,
        email: cliente.emailPrincipal,
        phone: cliente.telefoneCelular,
    } //payload minimo

    const { data } = await axios.post(`${URL_ASAAS}/customers`, payload, {
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'access_token': ASAAS_TOKEN
        }
    });

    cliente.customerAsaas = data.id;
    await cliente.save();

    return data.id;
}

async function pegarValor({ from, to, clienteId }) {
    try {
        const where = {};
        if (clienteId) where.cliente_id = Number(clienteId);
        if (from || to) {
            where.createdAt = {
                [Op.between]: [
                    new Date((from || "1970-01-01") + "T00:00:00Z"),
                    new Date((to || "2999-12-31") + "T23:59:59Z"),
                ],
            };
        }
        where.carrier = 'FEDEX';
        where.status_pagamento = 'NAOGERADO';

        const cotacoes = await Cotacao.findAll({
            where,
            order: [["createdAt", "DESC"]],
            raw: true
        });

        const [updated] = await Cotacao.update(
            { status_pagamento: "GERADO" },
            { where }
        );

        const linhas = cotacoes.map(c => {
            const sur = fromSurcharges(c);
            // usa SEMPRE o preço final já salvo no seu banco (ajuste o nome do campo abaixo)
            const precoFinal = n(c.preco_final) || n(c.total_cliente) || n(c.valor_frete_cliente);
            return {
                preco_final: precoFinal,         // o que entra no total geral
                moeda: sur.currency,
                taxas_itens: sur.taxas_itens
            };
        });

        // totais (somamos o que você precisa)
        const total_final = linhas.reduce((acc, l) => acc + (l.preco_final || 0), 0);
        if (!total_final || total_final <= 0) {
            return 0;
        }

        const converte_valor = total_final / 100 //o valor até aqui estava vindo em centavos

        const dolar_para_real = await valorConversao() //pega o valor de dolar para real

        const total_convertido = converte_valor * dolar_para_real

        // linha de rodapé (só para referência; você pode deixar só o TOTAL_GERAL)
        return total_convertido + 2.00;
    } catch (e) {
        console.error(e);
    }
}


const gerarBoleto = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const clienteId = Number(
            req.cliente?.id ??
            req.usuario?.clienteId ??
            req.user?.clienteId ??
            req.body?.clienteId // <-- adiciona isso
        );

        const { dueDate, from, to } = req.body || {};

        // if (!valor) {
        //     return res.status(400).json({ error: "Parâmetros insuficientes." });
        // }

        // if (valor <= 0) {
        //     return res.status(400).json({ error: "Valor inválido." });
        // }

        if (!clienteId) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: 'clienteId é obrigatório' });
        }

        const cliente = await db.Cliente.findByPk(clienteId, { transaction: t });
        if (!cliente) {
            await t.rollback();
            return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });
        }

        if (!dueDate) {
            await t.rollback();
            return res
                .status(400)
                .json({ ok: false, error: "dueDate é obrigatório (YYYY-MM-DD)" });
        }

        const valor_total = await pegarValor({ from, to, clienteId });

        if (!valor_total || valor_total <= 0) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error:
                    "Nenhuma cotação encontrada para o período informado ou total zerado.",
            });
        }

        const customer = await verificaCustomer(cliente);

        const boletoPayload = {
            customer: customer,
            billingType: "BOLETO", //sempre usamos boleto
            value: valor_total,
            dueDate: dueDate,
        }


        const { data } = await require('axios').post(`${URL_ASAAS}/payments`, boletoPayload, {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'access_token': ASAAS_TOKEN
            }
        })

        const novoBoleto = await db.AsaasBoletos.create({
            clienteId: cliente.id,
            asaasCustomerId: customer,
            asaasPaymentId: data.id,
            bankSlipUrl: data.bankSlipUrl,
            value: data.value,
            dueDate: data.dueDate,
            status: data.status,
        }, { transaction: t });

        await t.commit();

        return res.json({
            ok: true,
            id: novoBoleto.id,
            asaasPaymentId: novoBoleto.asaasPaymentId,
            bankSlipUrl: novoBoleto.bankSlipUrl,
            status: novoBoleto.status,
        });
    } catch (err) {
        const status = err?.response?.status;
        const body = err?.response?.data;

        console.error("[BOLETO] ERRO AO GERAR BOLETO:");
        console.error("  STATUS =", status);
        console.error("  BODY   =", JSON.stringify(body, null, 2));

        await t.rollback();

        return res.status(500).json({
            error: "Erro interno do servidor.",
            detail: body || err.message
        });
    }
}

/**
 * Gera UM boleto Asaas para UMA cotação, somando frete + imposto estimado.
 * Feature beta — só para contas na allowlist IMPOSTOS_BETA_EMAILS.
 * Devolve o detalhamento completo para conferência ("veio certo?").
 * POST /boletos/cotacao/:id  body: { dueDate: "YYYY-MM-DD" }
 */
const gerarBoletoCotacao = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const clienteId = Number(
            req.clienteId ??
            req.cliente?.id ??
            req.usuario?.clienteId ??
            req.user?.clienteId
        );
        const cotacaoId = Number(req.params.id);
        const { dueDate } = req.body || {};

        if (!clienteId) { await t.rollback(); return res.status(401).json({ ok: false, error: "Cliente não autenticado" }); }
        if (!cotacaoId) { await t.rollback(); return res.status(400).json({ ok: false, error: "id da cotação inválido" }); }
        if (!dueDate) { await t.rollback(); return res.status(400).json({ ok: false, error: "dueDate é obrigatório (YYYY-MM-DD)" }); }

        const cot = await Cotacao.findOne({ where: { id: cotacaoId, cliente_id: clienteId }, transaction: t });
        if (!cot) { await t.rollback(); return res.status(404).json({ ok: false, error: "Cotação não encontrada" }); }

        const cliente = await db.Cliente.findByPk(clienteId, { transaction: t });
        if (!cliente) { await t.rollback(); return res.status(404).json({ ok: false, error: "Cliente não encontrado" }); }

        if (!impostosBetaHabilitado(cliente)) {
            await t.rollback();
            return res.status(403).json({ ok: false, error: "Feature não habilitada para esta conta." });
        }

        let fx = Number(await valorConversao());
        if (!Number.isFinite(fx) || fx <= 0) fx = 0;

        // frete: preco_final é tratado como USD aqui; itens vão separados na resposta
        // para qualquer divergência de unidade ficar visível na conferência.
        const freteUsd = n(cot.preco_final);
        const freteBrl = round2(freteUsd * fx);
        const impostoBrl = round2(n(cot.impostos_valor_brl));
        const totalBrl = round2(freteBrl + impostoBrl);

        if (!totalBrl || totalBrl <= 0) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: "Total zerado (sem frete e sem imposto estimado)." });
        }

        let est = null;
        if (cot.imposto_estimativa_id) {
            est = await db.ImpostoEstimativa.findByPk(cot.imposto_estimativa_id, { transaction: t });
        }

        const customer = await verificaCustomer(cliente);

        const description =
            `Frete + impostos estimados (importação) - cotação #${cot.id} / pedido ${cot.pedido_ref}`;

        const { data } = await axios.post(`${URL_ASAAS}/payments`, {
            customer,
            billingType: "BOLETO",
            value: totalBrl,
            dueDate,
            description,
        }, {
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                access_token: ASAAS_TOKEN,
            },
        });

        const novoBoleto = await db.AsaasBoletos.create({
            clienteId: cliente.id,
            asaasCustomerId: customer,
            asaasPaymentId: data.id,
            bankSlipUrl: data.bankSlipUrl,
            value: data.value,
            dueDate: data.dueDate,
            status: data.status,
        }, { transaction: t });

        await t.commit();

        return res.json({
            ok: true,
            boleto: {
                id: novoBoleto.id,
                asaasPaymentId: novoBoleto.asaasPaymentId,
                bankSlipUrl: novoBoleto.bankSlipUrl,
                value: novoBoleto.value,
                status: novoBoleto.status,
            },
            detalhe: {
                frete_usd: freteUsd,
                imposto_usd_base: est ? Number(est.imposto_usd_base) : null,
                margem_pct: est ? Number(est.margem_pct) : null,
                imposto_usd_com_margem: est ? Number(est.imposto_usd_com_margem) : null,
                fx,
                fx_fonte: est ? est.fx_fonte : "awesomeapi",
                colchao_cambio_pct: est ? Number(est.colchao_cambio_pct) : null,
                frete_brl: freteBrl,
                imposto_brl: impostoBrl,
                total_brl: totalBrl,
                breakdown: est ? est.breakdown : (cot.impostos_estimados || []),
                provider: est ? est.provider : null,
                de_minimis: est ? est.de_minimis : null,
                estimativa_id: cot.imposto_estimativa_id || null,
                is_estimate: true,
            },
        });
    } catch (err) {
        const body = err?.response?.data;
        console.error("[BOLETO/COTACAO] ERRO:", err?.response?.status, JSON.stringify(body, null, 2) || err.message);
        try { await t.rollback(); } catch (_) { }
        return res.status(500).json({ ok: false, error: "Erro ao gerar boleto da cotação.", detail: body || err.message });
    }
};

module.exports = {
    gerarBoleto,
    pegarValor,
    verificaCustomer,
    gerarBoletoCotacao
}
