const db = require('../models');

async function publicApiKeyAuth(req, res, next) {
    const key = (req.headers['x-api-key'] || req.query.api_key || '').trim();
    if (!key) {
        return res.status(401).json({ ok: false, error: 'API key ausente' });
    }

    try {
        const cliente = await db.Cliente.findOne({
            where: { publicApiKey: key },
            attributes: ['id', 'status', 'razaoSocial'],
        });

        if (!cliente) {
            return res.status(401).json({ ok: false, error: 'API key inválida' });
        }
        if (cliente.status !== 'ativo') {
            return res.status(403).json({ ok: false, error: 'Cliente inativo' });
        }

        req.clienteId = cliente.id;
        req.clientePublico = { id: cliente.id, razaoSocial: cliente.razaoSocial };
        next();
    } catch (e) {
        console.error('[publicApiKeyAuth] erro:', e);
        return res.status(500).json({ ok: false, error: 'Falha ao validar API key' });
    }
}

module.exports = { publicApiKeyAuth };
