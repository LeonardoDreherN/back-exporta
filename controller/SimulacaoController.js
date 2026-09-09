// controller/SimulacaoController.js
// Endpoints do simulador de frete + impostos do dashboard do cliente.
// Somente leitura: nao cria cotacao, nao grava nada.

const {
    simular,
    listarOrigens,
    listarDestinos,
    LIMITES,
    SimulacaoInputError,
} = require('../services/simulacao');

/** GET /api/simulacao/opcoes — popula os selects do modal. */
async function opcoes(_req, res) {
    return res.json({
        ok: true,
        origens: listarOrigens(),
        destinos: listarDestinos(),
        moedas: ['USD', 'BRL', 'EUR'],
        limites: LIMITES,
    });
}

/** POST /api/simulacao — roda a simulacao. */
async function simulacao(req, res) {
    try {
        const resultado = await simular(req.body || {});
        return res.json(resultado);
    } catch (err) {
        if (err instanceof SimulacaoInputError) {
            return res.status(400).json({ ok: false, error: err.message });
        }

        const status = err.status || 500;
        if (status >= 500) console.error('[SIMULACAO][ERR]', err?.message);

        return res.status(status).json({
            ok: false,
            error: err.message || 'Falha ao simular',
            ...(err.avisos ? { avisos: err.avisos } : {}),
        });
    }
}

module.exports = { opcoes, simulacao };
