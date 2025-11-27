const { Op } = require("sequelize");
const db = require("../models/index.js");

const URL_ASAAS = "https://api-sandbox.asaas.com/v3";
const ASAAS_TOKEN = process.env.ASAAS_TOKEN;

async function verificaCustomer(cliente) {
    if (cliente.customerAsaas) {
        return cliente.customerAsaas;
    }

    const payload = {
        name: cliente.razaoSocial,
        cpfCnpj: cliente.cnpj,
        email: cliente.emailPrincipal,
        phone: cliente.telefoneCelular,
    } //payload minimo

    const { data } = await require('axios').post(`${URL_ASAAS}/customers`, payload, {
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

function fromSurcharges(c) {
    const s = c.surcharges || {};
    const base = n(s.base);
    const itemized = Array.isArray(s.itemized) ? s.itemized : [];
    const taxas = itemized.reduce((acc, it) => acc + n(it.value), 0);
    const totalCarrier = n(s.total) || (base + taxas + n(s.serviceOptions));
    const currency = s.currency || "USD";
    const taxas_itens = itemized
        .map((it) => `${it.code}:${n(it.value).toFixed(2)}`)
        .join(" | ");
    return { base, taxas, totalCarrier, currency, taxas_itens };
}

async function pegarValor({ from, to, clienteId }) {
    try {
        const where = {};
        if (clienteId) where.clienteId = Number(clienteId);
        if (from || to) {
            where.createdAt = {
                [Op.between]: [
                    new Date((from || "1970-01-01") + "T00:00:00Z"),
                    new Date((to || "2999-12-31") + "T23:59:59Z"),
                ],
            };
        }

        const cotacoes = await Cotacao.findAll({
            where,
            order: [["createdAt", "DESC"]],
            raw: true
        });

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
        const total_final = linhas.reduce((acc, l) => acc + n(l.preco_final), 0);

        // linha de rodapé (só para referência; você pode deixar só o TOTAL_GERAL)
        return total_final;
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

        if (!total_final || total_final <= 0) {
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
        console.error("Erro ao gerar boleto:", err);
        return res.status(500).json({
            error: "Erro interno do servidor.",
            detail: err.response?.data || err.message
        });
    }
}

module.exports = {
    gerarBoleto,
    pegarValor
}