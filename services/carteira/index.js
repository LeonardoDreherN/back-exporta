// services/carteira/index.js
// Regras da carteira Intrex: saldo, crédito, débito e a ponte com o Asaas.
//
// Decisões (2026-10-14): saldo em real; a taxa do cartão é paga pelo cliente
// (PIX e saldo sem taxa). A liberação, que era só a allowlist
// CARTEIRA_BETA_EMAILS, hoje é a coluna Cliente.carteiraHabilitada OU a env var
// — ver carteiraHabilitada() abaixo.

const axios = require('axios');
const crypto = require('crypto');
const db = require('../../models');
const { verificaCustomer } = require('../../controller/Asaas.js');

const URL_ASAAS = process.env.ASAAS_AMB === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';

const AMBIENTE_ASAAS = process.env.ASAAS_AMB === 'production' ? 'production' : 'sandbox';
const VAR_TOKEN = AMBIENTE_ASAAS === 'production' ? 'ASAAS_TOKEN_PROD' : 'ASAAS_TOKEN_SANDBOX';

// Chave colada com aspas ou \n no painel do Render chega aqui junto do valor e
// o Asaas responde "chave de API inválida", que não ajuda ninguém a achar o
// problema. Limpa antes de mandar.
function tokenAsaas() {
    return String(process.env[VAR_TOKEN] || '')
        .trim()
        .replace(/^['"]|['"]$/g, '');
}

function asaas() {
    return axios.create({
        baseURL: URL_ASAAS,
        timeout: 20000,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'exporta-digital-intrex/1.0',
            access_token: tokenAsaas(),
        },
    });
}

// ---------- liberação ----------

function emailsBeta() {
    return String(process.env.CARTEIRA_BETA_EMAILS || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Carteira liberada para a conta?
 *
 * Duas fontes, em OU: a coluna `carteiraHabilitada` (liberada pelo admin, sem
 * deploy) e a allowlist CARTEIRA_BETA_EMAILS (como era antes). A env var
 * continua valendo porque quem já estava nela não pode perder a carteira — e o
 * saldo — só porque a coluna nasceu `false` para todo mundo. Quando a lista
 * estiver migrada para o banco, a env var pode sair.
 */
function carteiraHabilitada(cliente) {
    if (cliente?.carteiraHabilitada === true) return true;

    const email = String(cliente?.emailPrincipal || '').trim().toLowerCase();
    return !!email && emailsBeta().includes(email);
}

// ---------- valores ----------

const intEnv = (nome, padrao) => {
    const v = Number(process.env[nome]);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : padrao;
};

const LIMITES = {
    minimo: () => intEnv('CARTEIRA_RECARGA_MIN_CENTAVOS', 1000),   // R$ 10
    maximo: () => intEnv('CARTEIRA_RECARGA_MAX_CENTAVOS', 2000000), // R$ 20.000
};

/**
 * Taxa repassada ao cliente no cartão. Padrões = contrato Asaas (cartão à vista 2,99% + R$ 0,49, conferido em 2026-10-14); ajuste
 * CARTAO_TAXA_PCT / CARTAO_TAXA_FIXA_CENTAVOS para o contrato real do Asaas.
 * Calculada "por dentro": o total cobre a taxa que o Asaas desconta do total.
 */
function taxaCartao(valorCentavos) {
    const pct = Number(process.env.CARTAO_TAXA_PCT ?? 2.99);
    const fixa = intEnv('CARTAO_TAXA_FIXA_CENTAVOS', 49);
    const p = Number.isFinite(pct) && pct >= 0 && pct < 50 ? pct / 100 : 0.0299;
    const total = Math.ceil((valorCentavos + fixa) / (1 - p));
    return { taxa: total - valorCentavos, total };
}

const reais = (centavos) => Math.round(centavos) / 100;

// ---------- livro ----------

async function saldoCentavos(clienteId, { transaction } = {}) {
    const total = await db.CarteiraLancamento.sum('valor_centavos', {
        where: { cliente_id: clienteId },
        transaction,
    });
    return Number(total) || 0;
}

/** Insere o lançamento; se a chave já existe, não faz nada (idempotente). */
async function lancar({ clienteId, tipo, valorCentavos, descricao, referenciaTipo, referenciaId, chave }, { transaction } = {}) {
    try {
        const l = await db.CarteiraLancamento.create({
            cliente_id: clienteId,
            tipo,
            valor_centavos: valorCentavos,
            descricao,
            referencia_tipo: referenciaTipo,
            referencia_id: referenciaId,
            chave,
        }, { transaction });
        return { criado: true, lancamento: l };
    } catch (err) {
        if (err?.name === 'SequelizeUniqueConstraintError') return { criado: false };
        throw err;
    }
}

/**
 * Debita o saldo de forma atômica. Trava a linha do cliente durante a
 * transação: dois envios pagos ao mesmo tempo não conseguem gastar o mesmo
 * saldo. Recusa se não houver saldo suficiente.
 */
async function debitar({ clienteId, valorCentavos, tipo = 'debito_envio', descricao, referenciaTipo, referenciaId, chave }) {
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error('valor de débito inválido');

    return db.sequelize.transaction(async (t) => {
        await db.Cliente.findByPk(clienteId, { transaction: t, lock: t.LOCK.UPDATE });

        const saldo = await saldoCentavos(clienteId, { transaction: t });
        if (saldo < valorCentavos) {
            const e = new Error('Saldo insuficiente');
            e.code = 'SALDO_INSUFICIENTE';
            e.saldo = saldo;
            throw e;
        }

        const r = await lancar({
            clienteId, tipo, valorCentavos: -valorCentavos, descricao, referenciaTipo, referenciaId, chave,
        }, { transaction: t });

        return { ...r, saldo: saldo - (r.criado ? valorCentavos : 0) };
    });
}

/**
 * Ajuste manual lançado pelo admin: crédito de cortesia, correção de recarga
 * que não caiu, baixa de valor cobrado por fora.
 *
 * Crédito usa `lancar`; débito usa `debitar`, que trava a linha do cliente e
 * recusa deixar o saldo negativo — um ajuste para baixo não pode criar dívida
 * sem alguém decidir isso explicitamente.
 *
 * A `chave` é derivada do próprio ajuste mais o minuto corrente. Dois cliques
 * no mesmo botão caem na mesma chave e o segundo não entra; um ajuste idêntico
 * de verdade (mesmo cliente, mesmo valor, mesmo motivo, mesmo admin) passa no
 * minuto seguinte. Sem isso, clique duplo em tela de dinheiro lança duas vezes.
 */
async function ajustar({ clienteId, valorCentavos, motivo, adminUserId }) {
    if (!Number.isInteger(valorCentavos) || valorCentavos === 0) {
        const e = new Error('Informe um valor diferente de zero.'); e.status = 400; throw e;
    }

    const descricao = String(motivo || '').trim();
    if (descricao.length < 3) {
        const e = new Error('Descreva o motivo do ajuste.'); e.status = 400; throw e;
    }

    const minuto = new Date().toISOString().slice(0, 16); // AAAA-MM-DDTHH:MM
    const impressao = crypto
        .createHash('sha256')
        .update(`${clienteId}|${valorCentavos}|${descricao}|${adminUserId || 0}|${minuto}`)
        .digest('hex')
        .slice(0, 24);
    const chave = `ajuste:admin:${impressao}`;

    if (valorCentavos < 0) {
        const r = await debitar({
            clienteId,
            valorCentavos: Math.abs(valorCentavos),
            tipo: 'ajuste',
            descricao: descricao.slice(0, 160),
            referenciaTipo: 'admin',
            referenciaId: adminUserId || null,
            chave,
        });
        return { ...r, saldo: await saldoCentavos(clienteId) };
    }

    const r = await lancar({
        clienteId,
        tipo: 'ajuste',
        valorCentavos,
        descricao: descricao.slice(0, 160),
        referenciaTipo: 'admin',
        referenciaId: adminUserId || null,
        chave,
    });

    return { ...r, saldo: await saldoCentavos(clienteId) };
}

// ---------- cobranças no Asaas ----------

function hojeBrasil(diasAFrente = 0) {
    const d = new Date(Date.now() - 3 * 3600 * 1000 + diasAFrente * 86400 * 1000);
    return d.toISOString().slice(0, 10);
}

/**
 * Cria a recarga: registro local + cobrança no Asaas. PIX volta com o QR;
 * cartão volta com o link da página de pagamento do Asaas (o cartão é
 * digitado lá, nunca passa pelo nosso servidor).
 */
async function criarRecarga(cliente, { valorCentavos, metodo }) {
    if (!['PIX', 'CREDIT_CARD'].includes(metodo)) {
        const e = new Error('Forma de pagamento inválida'); e.status = 400; throw e;
    }
    if (!Number.isInteger(valorCentavos) || valorCentavos < LIMITES.minimo() || valorCentavos > LIMITES.maximo()) {
        const e = new Error(`Valor deve ficar entre R$ ${reais(LIMITES.minimo()).toFixed(2)} e R$ ${reais(LIMITES.maximo()).toFixed(2)}`);
        e.status = 400; throw e;
    }

    const { taxa, total } = metodo === 'CREDIT_CARD'
        ? taxaCartao(valorCentavos)
        : { taxa: 0, total: valorCentavos };

    const pagamento = await db.Pagamento.create({
        cliente_id: cliente.id,
        finalidade: 'recarga',
        metodo,
        valor_centavos: valorCentavos,
        taxa_centavos: taxa,
        total_centavos: total,
    });

    // Sem chave nao adianta chamar o Asaas: ele devolve "chave de API invalida"
    // e o erro chega no cliente como se a cobranca tivesse sido recusada.
    if (!tokenAsaas()) {
        await pagamento.update({ status: 'FALHOU' });
        const e = new Error(
            `Asaas nao configurado no servidor: falta ${VAR_TOKEN} (ambiente ${AMBIENTE_ASAAS}).`
        );
        e.status = 503;
        throw e;
    }

    try {
        const customer = await verificaCustomer(cliente);
        const api = asaas();

        const { data } = await api.post('/payments', {
            customer,
            billingType: metodo,
            value: reais(total),
            dueDate: hojeBrasil(metodo === 'PIX' ? 1 : 0),
            description: `Recarga carteira Intrex - R$ ${reais(valorCentavos).toFixed(2)}`,
            externalReference: `recarga:${pagamento.id}`,
        });

        const patch = {
            asaas_payment_id: data.id,
            invoice_url: data.invoiceUrl || null,
            status_asaas: data.status || null,
        };

        let pixImagem = null;
        if (metodo === 'PIX') {
            const { data: qr } = await api.get(`/payments/${data.id}/pixQrCode`);
            patch.pix_copia_cola = qr.payload || null;
            patch.pix_expira_em = qr.expirationDate ? new Date(qr.expirationDate) : null;
            pixImagem = qr.encodedImage || null;
        }

        await pagamento.update(patch);
        return { pagamento, pixImagem };
    } catch (err) {
        await pagamento.update({ status: 'FALHOU' });
        const msg = err?.response?.data?.errors?.[0]?.description || err.message;
        console.error('[CARTEIRA][RECARGA] falha no Asaas', {
            pagamentoId: pagamento.id,
            ambiente: AMBIENTE_ASAAS,
            varToken: VAR_TOKEN,
            url: URL_ASAAS,
            msg,
        });
        const e = new Error(`Não foi possível criar a cobrança: ${msg}`);
        e.status = 502;
        throw e;
    }
}

const STATUS_PAGO = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
const STATUS_ESTORNO = ['REFUNDED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];
const STATUS_CANCELADO = ['DELETED', 'OVERDUE'];

/**
 * Lê o status no Asaas (fonte da verdade) e aplica no sistema. Chamado pelo
 * webhook e pela consulta do front. Seguro para rodar várias vezes: crédito e
 * estorno têm chave única.
 */
async function sincronizarPagamento(pagamento) {
    if (!pagamento?.asaas_payment_id) return pagamento;

    const { data } = await asaas().get(`/payments/${pagamento.asaas_payment_id}`);
    const st = String(data?.status || '');

    if (STATUS_PAGO.includes(st)) {
        if (pagamento.finalidade === 'recarga') {
            await lancar({
                clienteId: pagamento.cliente_id,
                tipo: 'recarga',
                valorCentavos: pagamento.valor_centavos,
                descricao: pagamento.metodo === 'PIX' ? 'Recarga via PIX' : 'Recarga via cartão',
                referenciaTipo: 'pagamento',
                referenciaId: pagamento.id,
                chave: `recarga:pagamento:${pagamento.id}`,
            });
        }
        await pagamento.update({
            status: 'PAGO',
            status_asaas: st,
            pago_em: pagamento.pago_em || new Date(),
        });
    } else if (STATUS_ESTORNO.includes(st)) {
        // Só desfaz o que foi creditado. Pode deixar o saldo negativo se o
        // cliente já gastou: aí fica devendo, e isso aparece no extrato.
        if (pagamento.finalidade === 'recarga' && pagamento.status === 'PAGO') {
            await lancar({
                clienteId: pagamento.cliente_id,
                tipo: 'estorno',
                valorCentavos: -pagamento.valor_centavos,
                descricao: st.startsWith('CHARGEBACK') ? 'Chargeback da recarga' : 'Estorno da recarga',
                referenciaTipo: 'pagamento',
                referenciaId: pagamento.id,
                chave: `estorno:pagamento:${pagamento.id}`,
            });
        }
        await pagamento.update({ status: 'ESTORNADO', status_asaas: st });
    } else if (STATUS_CANCELADO.includes(st) && pagamento.status === 'PENDING') {
        await pagamento.update({ status: 'CANCELADO', status_asaas: st });
    } else if (st && st !== pagamento.status_asaas) {
        await pagamento.update({ status_asaas: st });
    }

    return pagamento;
}

/**
 * Relê o status de um boleto (AsaasBoletos) no Asaas e grava.
 *
 * O `status` do boleto era escrito uma única vez, na criação, com o que o Asaas
 * devolveu na hora — sempre PENDING. Nada no sistema o atualizava depois: o
 * webhook só procurava em `Pagamento` e devolvia "ignorado" para boleto. O
 * efeito era que a condição de pago em cobrancaCotacao.situacaoPagamento
 * (RECEIVED / CONFIRMED / RECEIVED_IN_CASH) nunca podia ser verdadeira — quem
 * pagava boleto ficava eternamente "aguardando compensar", e o cancelamento
 * não estornava porque o sistema achava que nada tinha sido pago.
 *
 * Mesma regra do pagamento: o status não vem do corpo do evento, vem de uma
 * consulta à API do Asaas.
 */
async function sincronizarBoleto(boleto) {
    if (!boleto?.asaasPaymentId) return boleto;

    const { data } = await asaas().get(`/payments/${boleto.asaasPaymentId}`);
    const st = String(data?.status || '');

    if (st && st !== String(boleto.status)) {
        await boleto.update({ status: st });
    }

    return boleto;
}

function pagamentoPublico(p, extra = {}) {
    return {
        id: p.id,
        finalidade: p.finalidade,
        metodo: p.metodo,
        valor: reais(p.valor_centavos),
        taxa: reais(p.taxa_centavos),
        total: reais(p.total_centavos),
        status: p.status,
        invoice_url: p.invoice_url,
        pix_copia_cola: p.pix_copia_cola,
        pix_expira_em: p.pix_expira_em,
        criado_em: p.created_at || p.createdAt,
        pago_em: p.pago_em,
        ...extra,
    };
}

module.exports = {
    carteiraHabilitada,
    taxaCartao,
    ajustar,
    LIMITES,
    reais,
    saldoCentavos,
    lancar,
    debitar,
    criarRecarga,
    sincronizarPagamento,
    sincronizarBoleto,
    pagamentoPublico,
};
