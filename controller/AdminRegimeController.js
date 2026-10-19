// controller/AdminRegimeController.js
// Conferência e aprovação do regime tarifário por destino.
//
// É o gate entre "a IA apurou" e "a Intrex cobra o cliente". Nada que sai da
// pesquisa vale para cobrança antes de alguém ler e aprovar aqui.

const db = require('../models');
const {
    pesquisarRegime,
    aprovarRegime,
    rejeitarRegime,
    sobretaxaTotalPct,
    VALIDADE_DIAS,
} = require('../services/regimeImportacao');
const { logAdminAction } = require('../services/audit');

function quemEstaLogado(req) {
    return req.admin?.email || req.admin?.nome || req.adminUser?.email || 'admin';
}

/** Lista as apurações, mais recentes primeiro. GET /admin/regimes */
async function listar(req, res) {
    try {
        const { pais, status } = req.query || {};
        const where = {};
        if (pais) where.pais_destino = String(pais).trim().toUpperCase();
        if (status) where.status = String(status).trim().toLowerCase();

        const linhas = await db.RegimeImportacao.findAll({
            where,
            order: [['created_at', 'DESC']],
            limit: 100,
        });

        return res.json({
            ok: true,
            validade_dias: VALIDADE_DIAS,
            regimes: linhas.map((r) => ({
                id: r.id,
                pais_destino: r.pais_destino,
                status: r.status,
                confianca: r.confianca,
                resumo: r.resumo,
                medidas: r.medidas,
                de_minimis: r.de_minimis,
                imposto_consumo: r.imposto_consumo,
                sobretaxa_total_pct: sobretaxaTotalPct({ medidas: r.medidas }),
                // Divergência entre as rodadas é o sinal mais forte de que
                // precisa olho humano — sobe para o topo da resposta.
                divergencias: r.divergencias,
                rodadas: r.rodadas,
                medidas_descartadas: r.raw?.escolhida?.medidas_descartadas || [],
                fontes: r.fontes,
                valido_ate: r.valido_ate,
                vencido: r.valido_ate ? new Date(r.valido_ate) < new Date() : null,
                aprovado_por: r.aprovado_por,
                aprovado_em: r.aprovado_em,
                created_at: r.created_at,
            })),
        });
    } catch (err) {
        console.error('[ADMIN/REGIME] listar:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao listar regimes' });
    }
}

/** Detalhe completo, incluindo as duas rodadas cruas. GET /admin/regimes/:id */
async function detalhe(req, res) {
    try {
        const linha = await db.RegimeImportacao.findByPk(req.params.id);
        if (!linha) return res.status(404).json({ ok: false, error: 'Regime não encontrado' });
        return res.json({ ok: true, regime: linha });
    } catch (err) {
        console.error('[ADMIN/REGIME] detalhe:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao carregar regime' });
    }
}

/**
 * Dispara a apuração de um destino. POST /admin/regimes/pesquisar { pais }
 *
 * Solta sem await: são duas rodadas com busca pesada, passa de um minuto, e
 * quem clicou não precisa ficar segurando a conexão.
 */
async function pesquisar(req, res) {
    try {
        const pais = String(req.body?.pais || '').trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(pais)) {
            return res.status(400).json({ ok: false, error: 'pais deve ser ISO-2, ex.: US' });
        }

        pesquisarRegime({ paisDestino: pais, db })
            .then((linha) => {
                logAdminAction({
                    action: 'REGIME_APURADO',
                    entityType: 'regime_importacao',
                    entityId: linha.id,
                    metadata: {
                        pais,
                        confianca: linha.confianca,
                        divergencias: (linha.divergencias || []).length,
                    },
                });
            })
            .catch((e) => console.error('[ADMIN/REGIME] pesquisa falhou:', pais, e?.message));

        return res.status(202).json({
            ok: true,
            pais,
            aviso: 'Apuração iniciada. São duas rodadas com busca em fonte primária; leva alguns minutos. Recarregue a lista para ver o resultado.',
        });
    } catch (err) {
        console.error('[ADMIN/REGIME] pesquisar:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao iniciar apuração' });
    }
}

/** POST /admin/regimes/:id/aprovar */
async function aprovar(req, res) {
    try {
        const linha = await db.RegimeImportacao.findByPk(req.params.id);
        if (!linha) return res.status(404).json({ ok: false, error: 'Regime não encontrado' });

        // Aprovar apuração em que as rodadas discordaram é possível, mas tem
        // que ser deliberado: quem aprova precisa dizer que viu a divergência.
        const temDivergencia = Array.isArray(linha.divergencias) && linha.divergencias.length > 0;
        if (temDivergencia && !req.body?.ciente_da_divergencia) {
            return res.status(409).json({
                ok: false,
                error: 'As duas rodadas divergiram nesta apuração.',
                divergencias: linha.divergencias,
                como_prosseguir: 'Reenvie com { "ciente_da_divergencia": true } se quiser aprovar mesmo assim.',
            });
        }

        const quem = quemEstaLogado(req);
        await aprovarRegime({ id: linha.id, quem, db });

        logAdminAction({
            action: 'REGIME_APROVADO',
            entityType: 'regime_importacao',
            entityId: linha.id,
            metadata: { pais: linha.pais_destino, quem, com_divergencia: temDivergencia },
        });

        return res.json({ ok: true, id: linha.id, status: 'aprovado', aprovado_por: quem });
    } catch (err) {
        console.error('[ADMIN/REGIME] aprovar:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao aprovar regime' });
    }
}

/** POST /admin/regimes/:id/rejeitar */
async function rejeitar(req, res) {
    try {
        const linha = await db.RegimeImportacao.findByPk(req.params.id);
        if (!linha) return res.status(404).json({ ok: false, error: 'Regime não encontrado' });

        const quem = quemEstaLogado(req);
        await rejeitarRegime({ id: linha.id, quem, db });

        logAdminAction({
            action: 'REGIME_REJEITADO',
            entityType: 'regime_importacao',
            entityId: linha.id,
            metadata: { pais: linha.pais_destino, quem, motivo: req.body?.motivo || null },
        });

        return res.json({ ok: true, id: linha.id, status: 'rejeitado' });
    } catch (err) {
        console.error('[ADMIN/REGIME] rejeitar:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao rejeitar regime' });
    }
}

module.exports = { listar, detalhe, pesquisar, aprovar, rejeitar };
