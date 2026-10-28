// controller/AdminCarteiraController.js
//
// A carteira pelo lado da Intrex.
//
// O livro de lançamentos e as cobranças no Asaas existiam só para o cliente: o
// painel não mostrava saldo, extrato nem recarga, e `tipo: 'ajuste'` estava no
// model de CarteiraLancamento sem ninguém para escrevê-lo. Cliente ligando
// porque "fiz o PIX e não caiu" terminava em SQL na mão.
//
// Tudo aqui é leitura, menos duas ações: sincronizar uma recarga com o Asaas
// (que não cria dinheiro, só relê a fonte da verdade) e o ajuste manual, que
// cria e por isso é restrito a `admin` e sempre vai para o AdminAuditLog.

const { Op } = require('sequelize');
const db = require('../models');
const carteira = require('../services/carteira');
const { logAdminAction } = require('../services/audit');

const EXTRATO_LIMITE = 200;

function lancamentoDTO(l) {
    return {
        id: l.id,
        tipo: l.tipo,
        valor: carteira.reais(l.valor_centavos),
        valor_centavos: l.valor_centavos,
        descricao: l.descricao,
        referencia_tipo: l.referencia_tipo,
        referencia_id: l.referencia_id,
        chave: l.chave,
        criado_em: l.created_at ?? l.createdAt,
    };
}

/**
 * Saldo, extrato e recargas de um cliente.
 * GET /admin/carteira/clientes/:id
 */
async function verCliente(req, res) {
    try {
        const clienteId = Number(req.params.id);
        const cliente = await db.Cliente.findByPk(clienteId, {
            attributes: [
                'id', 'razaoSocial', 'emailPrincipal',
                'carteiraHabilitada', 'carteiraHabilitadaEm',
            ],
        });
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado.' });

        const [saldo, lancamentos, pagamentos] = await Promise.all([
            carteira.saldoCentavos(clienteId),
            db.CarteiraLancamento.findAll({
                where: { cliente_id: clienteId },
                order: [['id', 'DESC']],
                limit: EXTRATO_LIMITE,
            }),
            db.Pagamento.findAll({
                where: { cliente_id: clienteId },
                order: [['id', 'DESC']],
                limit: 50,
            }),
        ]);

        // Entrou x saiu, para o atendente ver o movimento sem somar na mão.
        let creditado = 0;
        let debitado = 0;
        for (const l of lancamentos) {
            if (l.valor_centavos > 0) creditado += l.valor_centavos;
            else debitado += Math.abs(l.valor_centavos);
        }

        return res.json({
            ok: true,
            cliente: {
                id: cliente.id,
                razaoSocial: cliente.razaoSocial,
                emailPrincipal: cliente.emailPrincipal,
            },
            // `habilitada` é o que o sistema realmente aplica (coluna OU env
            // var); `habilitada_por_coluna` diz se dá para desligar daqui. Sem
            // os dois, o admin desliga o botão e a carteira continua de pé pela
            // env var, sem explicação na tela.
            habilitada: carteira.carteiraHabilitada(cliente),
            habilitada_por_coluna: cliente.carteiraHabilitada === true,
            habilitada_em: cliente.carteiraHabilitadaEm,
            saldo: carteira.reais(saldo),
            saldo_centavos: saldo,
            totais: {
                creditado: carteira.reais(creditado),
                debitado: carteira.reais(debitado),
                lancamentos: lancamentos.length,
                truncado: lancamentos.length === EXTRATO_LIMITE,
            },
            lancamentos: lancamentos.map(lancamentoDTO),
            pagamentos: pagamentos.map((p) =>
                carteira.pagamentoPublico(p, { asaas_payment_id: p.asaas_payment_id }),
            ),
        });
    } catch (err) {
        console.error('[ADMIN][CARTEIRA][CLIENTE]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao carregar a carteira.' });
    }
}

/**
 * Fila de recargas de todos os clientes. GET /admin/carteira/recargas
 *
 * É a tela que responde "fiz o PIX e não caiu": PENDING antigo aqui é recarga
 * cujo webhook não chegou.
 */
async function listarRecargas(req, res) {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

        const where = {};
        const status = String(req.query.status || '').trim().toUpperCase();
        if (['PENDING', 'PAGO', 'ESTORNADO', 'FALHOU', 'CANCELADO'].includes(status)) {
            where.status = status;
        }
        if (req.query.cliente_id) where.cliente_id = Number(req.query.cliente_id);

        const metodo = String(req.query.metodo || '').trim().toUpperCase();
        if (['PIX', 'CREDIT_CARD'].includes(metodo)) where.metodo = metodo;

        const { rows, count } = await db.Pagamento.findAndCountAll({
            where,
            order: [['id', 'DESC']],
            limit: pageSize,
            offset: (page - 1) * pageSize,
        });

        const clienteIds = [...new Set(rows.map((p) => p.cliente_id).filter(Boolean))];
        const clientes = clienteIds.length
            ? await db.Cliente.findAll({
                  where: { id: clienteIds },
                  attributes: ['id', 'razaoSocial', 'emailPrincipal'],
              })
            : [];
        const porCliente = new Map(clientes.map((c) => [c.id, c]));

        // Pendente com mais de uma hora é o caso que precisa de olho: ou o
        // cliente desistiu, ou o webhook do Asaas não chegou.
        const umaHoraAtras = new Date(Date.now() - 3600 * 1000);
        const pendentesAntigos = await db.Pagamento.count({
            where: { status: 'PENDING', created_at: { [Op.lt]: umaHoraAtras } },
        });

        return res.json({
            ok: true,
            page,
            pageSize,
            total: count,
            pendentes_antigos: pendentesAntigos,
            recargas: rows.map((p) => {
                const c = porCliente.get(p.cliente_id);
                return {
                    ...carteira.pagamentoPublico(p, { asaas_payment_id: p.asaas_payment_id }),
                    cliente: c
                        ? { id: c.id, razaoSocial: c.razaoSocial, emailPrincipal: c.emailPrincipal }
                        : { id: p.cliente_id, razaoSocial: null, emailPrincipal: null },
                };
            }),
        });
    } catch (err) {
        console.error('[ADMIN][CARTEIRA][RECARGAS]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao carregar as recargas.' });
    }
}

/**
 * Relê o status no Asaas e aplica. POST /admin/carteira/recargas/:id/sincronizar
 *
 * Não cria dinheiro: chama a mesma função do webhook, que consulta o Asaas e
 * credita pela chave única. Resolve na hora o PIX pago cujo webhook se perdeu,
 * sem esperar o cliente reabrir a tela.
 */
async function sincronizarRecarga(req, res) {
    try {
        const pagamento = await db.Pagamento.findByPk(Number(req.params.id));
        if (!pagamento) return res.status(404).json({ ok: false, error: 'Recarga não encontrada.' });
        if (!pagamento.asaas_payment_id) {
            return res.status(400).json({
                ok: false,
                error: 'Esta cobrança nunca chegou a ser criada no Asaas.',
            });
        }

        const statusAnterior = pagamento.status;
        await carteira.sincronizarPagamento(pagamento);

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            action: 'carteira.recarga_sincronizada',
            entityType: 'Pagamento',
            entityId: pagamento.id,
            clienteId: pagamento.cliente_id,
            metadata: {
                statusAnterior,
                statusNovo: pagamento.status,
                status_asaas: pagamento.status_asaas,
            },
            req,
        });

        const saldo = await carteira.saldoCentavos(pagamento.cliente_id);
        return res.json({
            ok: true,
            mudou: statusAnterior !== pagamento.status,
            status_anterior: statusAnterior,
            recarga: carteira.pagamentoPublico(pagamento, {
                asaas_payment_id: pagamento.asaas_payment_id,
            }),
            saldo: carteira.reais(saldo),
        });
    } catch (err) {
        console.error('[ADMIN][CARTEIRA][SINCRONIZAR]', err?.message);
        const msg = err?.response?.data?.errors?.[0]?.description || err?.message;
        return res.status(502).json({ ok: false, error: `Falha ao consultar o Asaas: ${msg}` });
    }
}

/**
 * Crédito ou débito manual. POST /admin/carteira/clientes/:id/ajuste
 *
 * Único ponto do sistema que cria saldo sem dinheiro entrando no Asaas, então:
 * só `admin`, motivo obrigatório e AdminAuditLog sempre. O motivo vai também
 * para a descrição do lançamento, que o cliente lê no extrato dele.
 */
async function ajustar(req, res) {
    try {
        const clienteId = Number(req.params.id);
        const cliente = await db.Cliente.findByPk(clienteId, {
            attributes: ['id', 'razaoSocial', 'emailPrincipal'],
        });
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado.' });

        // Aceita tanto `valor` em reais (o que a tela manda) quanto
        // `valor_centavos`, para script e chamada direta não precisarem
        // converter e arriscar o erro de 100x que já aconteceu no boleto.
        const temCentavos = req.body?.valor_centavos !== undefined;
        const valorCentavos = temCentavos
            ? Math.round(Number(req.body.valor_centavos))
            : Math.round(Number(String(req.body?.valor ?? '').replace(',', '.')) * 100);

        if (!Number.isFinite(valorCentavos)) {
            return res.status(400).json({ ok: false, error: 'Valor inválido.' });
        }

        const motivo = String(req.body?.motivo || '').trim();

        const r = await carteira.ajustar({
            clienteId,
            valorCentavos,
            motivo,
            adminUserId: req.adminUser?.id,
        });

        // `criado: false` é a chave única barrando um ajuste idêntico no mesmo
        // minuto — quase sempre clique duplo. Dizer isso é melhor que devolver
        // sucesso e deixar o admin em dúvida se lançou uma ou duas vezes.
        if (!r.criado) {
            return res.status(409).json({
                ok: false,
                error: 'Um ajuste idêntico já foi lançado neste minuto. Confira o extrato.',
                saldo: carteira.reais(r.saldo),
            });
        }

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            action: valorCentavos > 0 ? 'carteira.ajuste_credito' : 'carteira.ajuste_debito',
            entityType: 'Cliente',
            entityId: cliente.id,
            clienteId: cliente.id,
            metadata: {
                valor_centavos: valorCentavos,
                motivo,
                lancamentoId: r.lancamento?.id ?? null,
                saldo_depois: r.saldo,
            },
            req,
        });

        return res.status(201).json({
            ok: true,
            lancamento: r.lancamento ? lancamentoDTO(r.lancamento) : null,
            saldo: carteira.reais(r.saldo),
            saldo_centavos: r.saldo,
        });
    } catch (err) {
        if (err?.code === 'SALDO_INSUFICIENTE') {
            return res.status(409).json({
                ok: false,
                error: 'O débito deixaria o saldo negativo.',
                saldo: carteira.reais(err.saldo),
            });
        }
        const status = err.status || 500;
        if (status >= 500) console.error('[ADMIN][CARTEIRA][AJUSTE]', err);
        return res.status(status).json({ ok: false, error: err.message || 'Falha no ajuste.' });
    }
}

/**
 * Liga ou desliga a carteira da conta.
 * PATCH /admin/carteira/clientes/:id/habilitada
 */
async function definirHabilitada(req, res) {
    try {
        const cliente = await db.Cliente.findByPk(Number(req.params.id));
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado.' });

        if (typeof req.body?.habilitada !== 'boolean') {
            return res.status(400).json({ ok: false, error: 'Informe habilitada: true ou false.' });
        }
        const habilitada = req.body.habilitada;
        const anterior = cliente.carteiraHabilitada === true;

        await cliente.update({
            carteiraHabilitada: habilitada,
            carteiraHabilitadaEm: habilitada ? (cliente.carteiraHabilitadaEm || new Date()) : null,
        });

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            action: habilitada ? 'carteira.habilitada' : 'carteira.desabilitada',
            entityType: 'Cliente',
            entityId: cliente.id,
            clienteId: cliente.id,
            metadata: { anterior, novo: habilitada },
            req,
        });

        // Desligar a coluna não desliga a carteira de quem está na env var: a
        // tela precisa dizer isso, senão o admin acha que tirou e não tirou.
        const aindaPelaEnv = !habilitada && carteira.carteiraHabilitada(cliente);

        return res.json({
            ok: true,
            habilitada_por_coluna: habilitada,
            habilitada: carteira.carteiraHabilitada(cliente),
            aviso: aindaPelaEnv
                ? 'A conta continua com a carteira pela allowlist CARTEIRA_BETA_EMAILS. Remova o e-mail da variável no Render para desligar de fato.'
                : null,
        });
    } catch (err) {
        console.error('[ADMIN][CARTEIRA][HABILITAR]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao alterar a liberação.' });
    }
}

module.exports = {
    verCliente,
    listarRecargas,
    sincronizarRecarga,
    ajustar,
    definirHabilitada,
};
