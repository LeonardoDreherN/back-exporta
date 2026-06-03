const db = require('../models');
const { getAccessTokenForStore } = require('../middleware/nuvemshopAuth');

const API_BASE = 'https://api.nuvemshop.com.br/v1';
const USER_AGENT = 'Intrex (contato@exportadigital.com)';

async function resolveLojaEToken(req) {
    const clienteId = req.clienteId ?? req?.res?.locals?.clienteId;
    if (!clienteId) {
        const err = new Error('Cliente não autenticado');
        err.http = 401;
        throw err;
    }

    const infoRow = await db.InfoNuvemshop.findOne({
        where: { id_cliente: clienteId },
        attributes: ['storeId'],
        order: [['createdAt', 'DESC']],
        raw: true,
    });

    if (!infoRow) {
        const err = new Error('Cliente não possui loja Nuvemshop conectada');
        err.http = 404;
        throw err;
    }

    const { token } = await getAccessTokenForStore(infoRow.storeId);
    if (!token) {
        const err = new Error('Token ausente. Reinstale o app Nuvemshop.');
        err.http = 401;
        throw err;
    }

    return { storeId: infoRow.storeId, token };
}

const verProdutosLojaNuvemshop = async (req, res) => {
    try {
        const { storeId, token } = await resolveLojaEToken(req);

        const perPage = Math.min(Number(req.query.limite) || 50, 200);
        const page = Number(req.query.page) || 1;

        const params = new URLSearchParams({
            per_page: String(perPage),
            page: String(page),
        });

        const url = `${API_BASE}/${storeId}/products?${params.toString()}`;

        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 15000);
        const resp = await fetch(url, {
            headers: {
                'Authentication': `bearer ${token}`,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json',
            },
            signal: ac.signal,
        }).finally(() => clearTimeout(to));

        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            return res.status(resp.status).json({
                erro: 'Erro ao consultar produtos na Nuvemshop',
                detalhes: body,
            });
        }

        const lista = await resp.json();

        const produtos = lista.map(p => {
            const name = p.name?.pt || p.name?.es || p.name?.en || Object.values(p.name || {})[0] || '';
            const handle = p.handle?.pt || Object.values(p.handle || {})[0] || '';
            return {
                id: p.id,
                title: name,
                handle,
                status: p.published ? 'active' : 'archived',
                updated_at: p.updated_at ?? null,
                product_type: p.categories?.[0]?.name?.pt || null,
                variants: (p.variants || []).map(v => ({
                    id: v.id,
                    sku: v.sku ?? null,
                    price: v.price ?? null,
                    harmonizedSystemCode: null,
                })),
            };
        });

        const totalCount = Number(resp.headers.get('X-Total-Count') || '0');
        const totalPages = Math.ceil(totalCount / perPage);
        const nextPage = page < totalPages ? page + 1 : null;

        return res.status(200).json({ produtos, nextPage, loja: storeId });
    } catch (err) {
        if (String(err?.name || '').toLowerCase().includes('abort'))
            return res.status(504).json({ erro: 'Timeout consultando Nuvemshop' });
        const http = err?.http || 500;
        if (http !== 500) return res.status(http).json({ erro: err.message });
        console.error('❌ verProdutosLojaNuvemshop:', err);
        return res.status(500).json({ erro: 'Erro interno', detalhes: err.message });
    }
};

module.exports = { verProdutosLojaNuvemshop, resolveLojaEToken };
