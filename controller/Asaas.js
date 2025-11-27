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

// async function downloadBoleto(req, res) {
//     const id = req.params.id;

//     try {
//         let buf;
//         const mime = 'application/pdf';

//         if (row.invoice_path) {
//             // [NEW] baixa direto do Supabase Storage
//             buf = await downloadFromBucket(INVOICES_BUCKET, row.invoice_path);
//         } else if (row.invoice_base64) {
//             // [LEGACY] mantém lógica antiga enquanto ainda existir base64
//             let b64 = row.invoice_base64;
//             if (mime === 'application/pdf') {
//                 b64 = await keepFirstPageFromPdfB64(b64);
//             }
//             buf = Buffer.from(b64, 'base64');
//         } else {
//             return res.status(404).json({ error: 'Invoice não disponível' });
//         }

//         res.setHeader('Content-Type', mime);
//         res.setHeader('Content-Length', buf.length);
//         res.setHeader('Content-Disposition', 'attachment; filename="invoice.pdf"');
//         return res.send(buf);
//     } catch (err) {
//         console.error('[DOWNLOAD INVOICE][ERROR]', err);
//         return res.status(500).json({ error: 'Erro ao baixar invoice' });
//     }
// }

const gerarBoleto = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const clienteId = Number(
            req.cliente?.id ??
            req.usuario?.clienteId ??
            req.user?.clienteId ??
            req.body?.clienteId // <-- adiciona isso
        );

        const { valor, dueDate } = req.body || {};

        if (!valor) {
            return res.status(400).json({ error: "Parâmetros insuficientes." });
        }

        if (!clienteId) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: 'clienteId é obrigatório' });
        }

        if (valor <= 0) {
            return res.status(400).json({ error: "Valor inválido." });
        }

        const cliente = await db.Cliente.findByPk(clienteId, { transaction: t });
        if (!cliente) {
            await t.rollback();
            return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });
        }

        let customer; 
        
        if(cliente.customerAsaas){
            customer = cliente.customerAsaas;
        }else{
            customer = await verificaCustomer(cliente);
            //verifica se o cliente ja tem um customer, se tiver ele apenas pega ele, se nao ele cria :)
        }

        const boletoPayload = {
            customer: customer,
            billingType: "BOLETO", //sempre usamos boleto
            value: valor,
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
        })

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
}