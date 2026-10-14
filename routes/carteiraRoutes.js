// routes/carteiraRoutes.js
// Carteira Intrex do cliente logado. Montado em /api/carteira já com
// autenticarUsuario + vincularCliente.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../models');
const carteira = require('../services/carteira');

const router = express.Router();

// Cada recarga cria uma cobrança no Asaas. Sem teto, um clique repetido (ou um
// script) enche o Asaas de cobranças abertas.
const recargaLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `carteira:${req.clienteId}`,
    message: { ok: false, error: 'Muitas recargas seguidas. Aguarde alguns minutos.' },
});

async function clienteHabilitado(req, res) {
    const cliente = await db.Cliente.findByPk(req.clienteId);
    if (!cliente) {
        res.status(404).json({ ok: false, error: 'Cliente não encontrado' });
        return null;
    }
    if (!carteira.carteiraHabilitada(cliente)) {
        res.status(403).json({ ok: false, habilitada: false, error: 'Carteira ainda não liberada para esta conta' });
        return null;
    }
    return cliente;
}

// Resumo: saldo, extrato recente e recargas aguardando pagamento.
router.get('/', async (req, res) => {
    try {
        const cliente = await db.Cliente.findByPk(req.clienteId);
        if (!cliente || !carteira.carteiraHabilitada(cliente)) {
            return res.json({ ok: true, habilitada: false });
        }

        const [saldo, lancamentos, pendentes] = await Promise.all([
            carteira.saldoCentavos(cliente.id),
            db.CarteiraLancamento.findAll({
                where: { cliente_id: cliente.id },
                order: [['id', 'DESC']],
                limit: 50,
            }),
            db.Pagamento.findAll({
                where: { cliente_id: cliente.id, finalidade: 'recarga', status: 'PENDING' },
                order: [['id', 'DESC']],
                limit: 5,
            }),
        ]);

        const taxaExemplo = carteira.taxaCartao(10000);

        return res.json({
            ok: true,
            habilitada: true,
            saldo: carteira.reais(saldo),
            limites: {
                minimo: carteira.reais(carteira.LIMITES.minimo()),
                maximo: carteira.reais(carteira.LIMITES.maximo()),
            },
            // Para o front mostrar a taxa antes de a pessoa escolher o cartão.
            taxa_cartao_pct_efetiva: Math.round((taxaExemplo.taxa / taxaExemplo.total) * 10000) / 100,
            lancamentos: lancamentos.map((l) => ({
                id: l.id,
                tipo: l.tipo,
                valor: carteira.reais(l.valor_centavos),
                descricao: l.descricao,
                criado_em: l.created_at || l.createdAt,
            })),
            pendentes: pendentes.map((p) => carteira.pagamentoPublico(p)),
        });
    } catch (err) {
        console.error('[CARTEIRA][GET]', err);
        return res.status(500).json({ ok: false, error: 'Erro ao carregar a carteira' });
    }
});

// Prévia do total no cartão (com a taxa), sem criar cobrança.
router.get('/taxa-cartao', (req, res) => {
    const centavos = Math.round(Number(String(req.query.valor || '').replace(',', '.')) * 100);
    if (!Number.isInteger(centavos) || centavos <= 0) return res.status(400).json({ ok: false, error: 'valor inválido' });
    const { taxa, total } = carteira.taxaCartao(centavos);
    return res.json({ ok: true, valor: carteira.reais(centavos), taxa: carteira.reais(taxa), total: carteira.reais(total) });
});

router.post('/recargas', recargaLimiter, async (req, res) => {
    try {
        const cliente = await clienteHabilitado(req, res);
        if (!cliente) return;

        const valor = Number(String(req.body?.valor ?? '').replace(',', '.'));
        const metodo = String(req.body?.metodo || '').toUpperCase();
        const valorCentavos = Math.round(valor * 100);

        const { pagamento, pixImagem } = await carteira.criarRecarga(cliente, { valorCentavos, metodo });
        return res.status(201).json({ ok: true, pagamento: carteira.pagamentoPublico(pagamento, { pix_imagem: pixImagem }) });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[CARTEIRA][RECARGA]', err.message);
        return res.status(status).json({ ok: false, error: err.message || 'Erro ao criar recarga' });
    }
});

// Consulta usada pelo front enquanto espera o PIX/cartão. Também confere no
// Asaas: se o webhook atrasar ou falhar, a recarga entra mesmo assim.
router.get('/recargas/:id', async (req, res) => {
    try {
        const pagamento = await db.Pagamento.findOne({
            where: { id: Number(req.params.id) || 0, cliente_id: req.clienteId, finalidade: 'recarga' },
        });
        if (!pagamento) return res.status(404).json({ ok: false, error: 'Recarga não encontrada' });

        if (pagamento.status === 'PENDING') {
            try {
                await carteira.sincronizarPagamento(pagamento);
            } catch (e) {
                console.warn('[CARTEIRA][SYNC] falha ao consultar Asaas', { id: pagamento.id, msg: e.message });
            }
        }

        const saldo = await carteira.saldoCentavos(req.clienteId);
        return res.json({ ok: true, pagamento: carteira.pagamentoPublico(pagamento), saldo: carteira.reais(saldo) });
    } catch (err) {
        console.error('[CARTEIRA][RECARGA][GET]', err);
        return res.status(500).json({ ok: false, error: 'Erro ao consultar recarga' });
    }
});

module.exports = router;
