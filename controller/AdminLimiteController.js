// controller/AdminLimiteController.js
//
// Operacao do limite de exposicao: ligar/desligar por conta, promover nivel,
// dar baixa em envio pago fora do sistema e ver a situacao de cada cliente.
//
// Ligar o limite numa conta que ja opera pode barra-la na hora seguinte, se o
// historico dela nunca constou como pago. Por isso `ativar` devolve a
// exposicao ANTES de ligar e exige confirmacao explicita quando ela ja
// estoura o limite — ninguem liga sem ver o que vai acontecer.

const db = require('../models');
const { QueryTypes, Op } = require('sequelize');
const {
    NIVEIS,
    NIVEL_MAXIMO,
    nivelInfo,
    limiteDoCliente,
    emAbertoUsd,
    avaliarLimite,
    nivelSugerido,
    totalPagoUsd,
} = require('../services/limiteCredito');
const { logAdminAction } = require('../services/audit');

function quemEstaLogado(req) {
    return req.admin?.email || req.admin?.nome || req.adminUser?.email || 'admin';
}

/** GET /api/admin/limite/niveis — a tabela de niveis, para a tela montar o select. */
async function niveis(_req, res) {
    return res.json({ ok: true, niveis: NIVEIS, nivelMaximo: NIVEL_MAXIMO });
}

/**
 * GET /api/admin/limite — panorama de todas as contas.
 * Uma consulta agregada so: a tela lista 22 clientes e nao pode disparar
 * duas queries por linha.
 */
async function panorama(_req, res) {
    try {
        const linhas = await db.sequelize.query(
            `
            SELECT cl.id,
                   cl."razaoSocial"                                  AS nome,
                   cl.codigo,
                   cl."limiteCreditoAtivo"                           AS ativo,
                   cl."nivelConta"                                   AS nivel,
                   cl."limiteAbertoUsdOverride"                      AS override,
                   COALESCE(SUM(c.preco_final) FILTER (WHERE aberto.pago IS FALSE), 0)::float AS em_aberto,
                   COUNT(*)      FILTER (WHERE aberto.pago IS FALSE)::int                     AS envios_abertos,
                   COALESCE(SUM(c.preco_final) FILTER (WHERE aberto.pago IS TRUE), 0)::float  AS total_pago
            FROM "Clientes" cl
            LEFT JOIN cotacoes c
                   ON c.cliente_id = cl.id
                  AND (c.status_norm IS NULL OR c.status_norm::text <> 'CANCELADO')
            LEFT JOIN LATERAL (
                SELECT (
                    c.pago_manual_em IS NOT NULL
                    OR EXISTS (SELECT 1 FROM carteira_lancamentos w
                               WHERE w.chave = 'envio:cotacao:' || c.id)
                    OR EXISTS (SELECT 1 FROM "AsaasBoletos" b
                               WHERE b."cotacaoId" = c.id
                                 AND b.status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH'))
                ) AS pago
            ) aberto ON TRUE
            GROUP BY cl.id, cl."razaoSocial", cl.codigo, cl."limiteCreditoAtivo",
                     cl."nivelConta", cl."limiteAbertoUsdOverride"
            ORDER BY em_aberto DESC
            `,
            { type: QueryTypes.SELECT },
        );

        const contas = linhas.map((l) => {
            const limite = limiteDoCliente({
                nivelConta: l.nivel,
                limiteAbertoUsdOverride: l.override,
            });
            const aberto = Number(l.em_aberto || 0);

            return {
                id: l.id,
                nome: l.nome,
                codigo: l.codigo,
                ativo: l.ativo,
                nivel: l.nivel,
                nivelRotulo: nivelInfo(l.nivel).rotulo,
                limiteUsd: limite,
                overrideUsd: l.override === null ? null : Number(l.override),
                emAbertoUsd: Number(aberto.toFixed(2)),
                enviosAbertos: l.envios_abertos,
                totalPagoUsd: Number(Number(l.total_pago || 0).toFixed(2)),
                nivelSugerido: nivelSugerido(l.total_pago),
                // Útil mesmo com o limite desligado: é a prévia de quem seria
                // barrado se a regra fosse ligada nessa conta agora.
                estouraria: limite !== null && aberto > limite,
            };
        });

        return res.json({ ok: true, contas, total: contas.length });
    } catch (err) {
        console.error('[ADMIN LIMITE] panorama:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao carregar o panorama.' });
    }
}

/** GET /api/admin/limite/:clienteId — situacao de uma conta. */
async function detalhe(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const cliente = await db.Cliente.findByPk(clienteId, {
            attributes: [
                'id', 'razaoSocial', 'codigo', 'limiteCreditoAtivo',
                'limiteCreditoAtivadoEm', 'nivelConta', 'limiteAbertoUsdOverride',
            ],
        });
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado.' });

        const [{ emAbertoUsd: aberto, envios }, { totalPagoUsd: pago, enviosPagos }] =
            await Promise.all([emAbertoUsd(clienteId), totalPagoUsd(clienteId)]);

        const limite = limiteDoCliente(cliente);

        return res.json({
            ok: true,
            cliente: {
                id: cliente.id,
                nome: cliente.razaoSocial,
                codigo: cliente.codigo,
                ativo: cliente.limiteCreditoAtivo,
                ativadoEm: cliente.limiteCreditoAtivadoEm,
                nivel: cliente.nivelConta,
                nivelRotulo: nivelInfo(cliente.nivelConta).rotulo,
                limiteUsd: limite,
                overrideUsd: cliente.limiteAbertoUsdOverride === null
                    ? null : Number(cliente.limiteAbertoUsdOverride),
            },
            exposicao: {
                emAbertoUsd: Number(aberto.toFixed(2)),
                enviosAbertos: envios,
                disponivelUsd: limite === null ? null : Number((limite - aberto).toFixed(2)),
                estouraria: limite !== null && aberto > limite,
            },
            historico: {
                totalPagoUsd: Number(pago.toFixed(2)),
                enviosPagos,
                nivelSugerido: nivelSugerido(pago),
            },
        });
    } catch (err) {
        console.error('[ADMIN LIMITE] detalhe:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao carregar.' });
    }
}

/**
 * POST /api/admin/limite/:clienteId/ativar
 * body: { ativo: true|false, confirmarBloqueio?: boolean }
 */
async function ativar(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const cliente = await db.Cliente.findByPk(clienteId);
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado.' });

        const ativo = req.body?.ativo === true;

        if (ativo) {
            const { emAbertoUsd: aberto, envios } = await emAbertoUsd(clienteId);
            const limite = limiteDoCliente(cliente);

            /*
             * Ligar numa conta que ja estoura o limite a barra no proximo
             * despacho. Nao da para impedir — e uma decisao legitima — mas da
             * para garantir que ninguem faca isso sem ver. A tela mostra o
             * numero e reenvia com confirmarBloqueio.
             */
            if (limite !== null && aberto > limite && req.body?.confirmarBloqueio !== true) {
                return res.status(409).json({
                    ok: false,
                    precisa_confirmar: true,
                    error: `Esta conta tem US$ ${aberto.toFixed(2)} em ${envios} envios ainda não pagos, `
                        + `acima do limite de US$ ${limite.toFixed(2)} do nível ${cliente.nivelConta}. `
                        + 'Ligar agora bloqueia o próximo despacho dela. '
                        + 'Dê baixa nos envios antigos, suba o nível, ou reenvie com confirmarBloqueio.',
                    em_aberto_usd: Number(aberto.toFixed(2)),
                    envios_abertos: envios,
                    limite_usd: limite,
                });
            }
        }

        await cliente.update({
            limiteCreditoAtivo: ativo,
            limiteCreditoAtivadoEm: ativo ? new Date() : null,
        });

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            req,
            action: ativo ? 'LIMITE_ATIVADO' : 'LIMITE_DESATIVADO',
            entityType: 'cliente',
            entityId: clienteId,
            clienteId,
            metadata: { por: quemEstaLogado(req), forcado: req.body?.confirmarBloqueio === true },
        });

        return res.json({ ok: true, ativo });
    } catch (err) {
        console.error('[ADMIN LIMITE] ativar:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao alterar.' });
    }
}

/**
 * PUT /api/admin/limite/:clienteId/nivel
 * body: { nivel?: number, overrideUsd?: number|null }
 */
async function definirNivel(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const cliente = await db.Cliente.findByPk(clienteId);
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado.' });

        const patch = {};

        if (req.body?.nivel !== undefined) {
            const n = Number(req.body.nivel);
            if (!Number.isInteger(n) || n < 1 || n > NIVEL_MAXIMO) {
                return res.status(400).json({
                    ok: false,
                    error: `nivel tem que ser inteiro de 1 a ${NIVEL_MAXIMO}.`,
                });
            }
            patch.nivelConta = n;
        }

        if (req.body?.overrideUsd !== undefined) {
            const bruto = req.body.overrideUsd;
            if (bruto === null || bruto === '') {
                patch.limiteAbertoUsdOverride = null;
            } else {
                const v = Number(bruto);
                if (!Number.isFinite(v) || v < 0) {
                    return res.status(400).json({
                        ok: false,
                        error: 'overrideUsd tem que ser um número >= 0, ou null para usar o nível.',
                    });
                }
                patch.limiteAbertoUsdOverride = v;
            }
        }

        if (!Object.keys(patch).length) {
            return res.status(400).json({ ok: false, error: 'Nada para alterar.' });
        }

        const antes = {
            nivel: cliente.nivelConta,
            override: cliente.limiteAbertoUsdOverride,
        };

        await cliente.update(patch);

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            req,
            action: 'LIMITE_NIVEL',
            entityType: 'cliente',
            entityId: clienteId,
            clienteId,
            metadata: { antes, depois: patch, por: quemEstaLogado(req) },
        });

        return res.json({ ok: true, ...patch });
    } catch (err) {
        console.error('[ADMIN LIMITE] definirNivel:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao alterar.' });
    }
}

/**
 * POST /api/admin/limite/:clienteId/promover
 * Sobe a conta para o nivel que o historico pago justifica. Nunca rebaixa.
 */
async function promover(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const cliente = await db.Cliente.findByPk(clienteId);
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado.' });

        const { totalPagoUsd: pago } = await totalPagoUsd(clienteId);
        const sugerido = nivelSugerido(pago);

        if (sugerido <= cliente.nivelConta) {
            return res.json({
                ok: true,
                alterado: false,
                nivel: cliente.nivelConta,
                motivo: 'O histórico pago não justifica um nível maior que o atual.',
                totalPagoUsd: Number(pago.toFixed(2)),
            });
        }

        const de = cliente.nivelConta;
        await cliente.update({ nivelConta: sugerido });

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            req,
            action: 'LIMITE_PROMOVIDO',
            entityType: 'cliente',
            entityId: clienteId,
            clienteId,
            metadata: { de, para: sugerido, totalPagoUsd: pago, por: quemEstaLogado(req) },
        });

        return res.json({
            ok: true,
            alterado: true,
            de,
            nivel: sugerido,
            totalPagoUsd: Number(pago.toFixed(2)),
        });
    } catch (err) {
        console.error('[ADMIN LIMITE] promover:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao promover.' });
    }
}

/** GET /api/admin/limite/:clienteId/abertos — os envios que compõem a exposição. */
async function enviosAbertos(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        const linhas = await db.sequelize.query(
            `
            SELECT c.id, c.pedido_ref, c.carrier, c.pais_dest, c.status_norm,
                   c.preco_final::float AS valor_usd, c.created_at,
                   c.tracking_number
            FROM cotacoes c
            WHERE c.cliente_id = :clienteId
              AND (c.status_norm IS NULL OR c.status_norm::text <> 'CANCELADO')
              AND c.pago_manual_em IS NULL
              AND NOT EXISTS (SELECT 1 FROM carteira_lancamentos w
                              WHERE w.chave = 'envio:cotacao:' || c.id)
              AND NOT EXISTS (SELECT 1 FROM "AsaasBoletos" b
                              WHERE b."cotacaoId" = c.id
                                AND b.status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH'))
            ORDER BY c.created_at DESC
            LIMIT 500
            `,
            { replacements: { clienteId }, type: QueryTypes.SELECT },
        );

        return res.json({ ok: true, envios: linhas, total: linhas.length });
    } catch (err) {
        console.error('[ADMIN LIMITE] enviosAbertos:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao listar.' });
    }
}

/**
 * POST /api/admin/limite/baixa
 * body: { cotacaoIds: number[], obs?: string }
 *
 * Baixa manual: o frete foi acertado fora do sistema. Pagamento por carteira
 * e por boleto Asaas o sistema ja reconhece sozinho e nao precisa disto.
 */
async function darBaixa(req, res) {
    const t = await db.sequelize.transaction();
    try {
        const ids = Array.isArray(req.body?.cotacaoIds)
            ? req.body.cotacaoIds.map(Number).filter(Number.isInteger)
            : [];

        if (!ids.length) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: 'Mande "cotacaoIds".' });
        }

        const obs = String(req.body?.obs || '').trim().slice(0, 200) || null;

        const [afetadas] = await db.Cotacao.update(
            {
                pago_manual_em: new Date(),
                pago_manual_por: quemEstaLogado(req),
                pago_manual_obs: obs,
            },
            {
                // Só o que ainda está em aberto: repetir a baixa não pode
                // reescrever quem deu baixa antes nem a data original.
                where: { id: { [Op.in]: ids }, pago_manual_em: null },
                transaction: t,
            },
        );

        await t.commit();

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            req,
            action: 'LIMITE_BAIXA_MANUAL',
            entityType: 'cotacao',
            entityId: ids.join(','),
            metadata: { quantidade: afetadas, pedidos: ids, obs, por: quemEstaLogado(req) },
        });

        return res.json({ ok: true, baixados: afetadas, pedidos: ids.length });
    } catch (err) {
        await t.rollback().catch(() => {});
        console.error('[ADMIN LIMITE] darBaixa:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao dar baixa.' });
    }
}

/** DELETE /api/admin/limite/baixa/:cotacaoId — desfaz uma baixa manual. */
async function desfazerBaixa(req, res) {
    try {
        const id = Number(req.params.cotacaoId);
        const [afetadas] = await db.Cotacao.update(
            { pago_manual_em: null, pago_manual_por: null, pago_manual_obs: null },
            { where: { id, pago_manual_em: { [Op.ne]: null } } },
        );

        if (!afetadas) {
            return res.status(404).json({ ok: false, error: 'Envio sem baixa manual.' });
        }

        await logAdminAction({
            adminUserId: req.adminUser?.id,
            req,
            action: 'LIMITE_BAIXA_DESFEITA',
            entityType: 'cotacao',
            entityId: id,
            metadata: { por: quemEstaLogado(req) },
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('[ADMIN LIMITE] desfazerBaixa:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao desfazer.' });
    }
}

/** GET /api/admin/limite/:clienteId/simular?valor=120 — o que aconteceria. */
async function simular(req, res) {
    try {
        const clienteId = Number(req.params.clienteId);
        // Previa: avalia mesmo com o limite desligado, que e o caso em que o
        // operador mais precisa dela — antes de decidir se liga.
        const r = await avaliarLimite({
            clienteId,
            valorNovoUsd: Number(req.query.valor) || 0,
            ignorarAtivacao: true,
        });
        return res.json({ ok: true, ...r });
    } catch (err) {
        console.error('[ADMIN LIMITE] simular:', err);
        return res.status(500).json({ ok: false, error: 'Falha ao simular.' });
    }
}

module.exports = {
    niveis,
    panorama,
    detalhe,
    ativar,
    definirNivel,
    promover,
    enviosAbertos,
    darBaixa,
    desfazerBaixa,
    simular,
};
