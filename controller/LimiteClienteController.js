// controller/LimiteClienteController.js
//
// O limite visto pelo PRÓPRIO cliente.
//
// Sem isto o cliente só descobre que tem limite quando é barrado, no meio de
// um despacho — e aí já perdeu a venda. O painel mostra quanto ele já usou,
// para que o aperto seja previsível e ele possa quitar antes de precisar.
//
// A conta sem limite ligado recebe `ativo: false` e nada mais: não existe
// motivo para anunciar uma regra que não se aplica a ela.

const db = require('../models');
const {
    emAbertoUsd,
    limiteDoCliente,
    nivelInfo,
    NIVEIS,
} = require('../services/limiteCredito');

/** Faixa de alerta. 80% é onde vale avisar; 100% é onde já travou. */
function faixa(pct) {
    if (pct >= 100) return 'bloqueado';
    if (pct >= 80) return 'atencao';
    return 'ok';
}

function clienteDaRequisicao(req) {
    return Number(
        req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId
    );
}

/** GET /api/limite/meu */
async function meuLimite(req, res) {
    try {
        const clienteId = clienteDaRequisicao(req);
        if (!clienteId) {
            return res.status(401).json({ ok: false, error: 'Cliente não identificado.' });
        }

        const cliente = await db.Cliente.findByPk(clienteId, {
            attributes: ['id', 'limiteCreditoAtivo', 'nivelConta', 'limiteAbertoUsdOverride'],
        });
        if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado.' });

        if (!cliente.limiteCreditoAtivo) {
            return res.json({ ok: true, ativo: false });
        }

        const limite = limiteDoCliente(cliente);

        // Nível sem teto: ativo, mas não há percentual que faça sentido.
        if (limite === null) {
            return res.json({
                ok: true,
                ativo: true,
                semTeto: true,
                nivel: cliente.nivelConta,
                nivelRotulo: nivelInfo(cliente.nivelConta).rotulo,
            });
        }

        const { emAbertoUsd: aberto, envios } = await emAbertoUsd(clienteId);

        // Limite 0 é um bloqueio deliberado do admin, não uma divisão por zero.
        const pct = limite > 0
            ? Math.min(999, Math.round((aberto / limite) * 100))
            : 100;

        const proximo = NIVEIS.find((n) => n.nivel === cliente.nivelConta + 1) || null;

        return res.json({
            ok: true,
            ativo: true,
            semTeto: false,
            nivel: cliente.nivelConta,
            nivelRotulo: nivelInfo(cliente.nivelConta).rotulo,
            limiteUsd: limite,
            emAbertoUsd: Number(aberto.toFixed(2)),
            disponivelUsd: Number(Math.max(0, limite - aberto).toFixed(2)),
            percentualUsado: pct,
            faixa: faixa(pct),
            enviosEmAberto: envios,
            proximoNivel: proximo
                ? { nivel: proximo.nivel, rotulo: proximo.rotulo, limiteUsd: proximo.limiteUsd }
                : null,
        });
    } catch (err) {
        console.error('[LIMITE CLIENTE] meuLimite:', err);
        return res.status(500).json({ ok: false, error: 'Não foi possível carregar o limite.' });
    }
}

module.exports = { meuLimite };
