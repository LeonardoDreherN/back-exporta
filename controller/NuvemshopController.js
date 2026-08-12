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

const CARRIER_NAME = 'Intrex Shipping';
const CARRIER_CALLBACK_HINT = '/nuvemshop/frete';

async function fetchJsonComTimeout(url, token, timeoutMs = 10000) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            headers: {
                'Authentication': `bearer ${token}`,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json',
            },
            signal: ac.signal,
        });
        const body = await resp.json().catch(() => null);
        return { ok: resp.ok, status: resp.status, body };
    } catch (e) {
        return { ok: false, status: 0, body: null, aborted: String(e?.name || '').toLowerCase().includes('abort') };
    } finally {
        clearTimeout(to);
    }
}

function parseNomeLoja(nameField) {
    if (!nameField) return null;
    if (typeof nameField === 'string') return nameField;
    return nameField.pt || nameField.es || nameField.en || Object.values(nameField)[0] || null;
}

function contarOptionsPorPrefixo(options, prefixo) {
    if (!Array.isArray(options)) return null;
    return options.filter(o => String(o?.code || '').startsWith(prefixo)).length;
}

// GET /nuvemshop/resumo
// Retorna dados agregados (loja + status do carrier) para a tela de pós-instalação
const getResumoNuvemshop = async (req, res) => {
    let storeId, token;
    try {
        ({ storeId, token } = await resolveLojaEToken(req));
    } catch (err) {
        if (err?.http === 404) return res.status(200).json({ connected: false });
        if (err?.http === 401) {
            // InfoNuvemshop existe mas o token sumiu (linha corrompida/reinstalação parcial)
            return res.status(200).json({
                connected: true,
                storeId: null,
                store: null,
                carrier: null,
                warnings: ['token_missing'],
            });
        }
        console.error('❌ getResumoNuvemshop (resolveLojaEToken):', err);
        return res.status(500).json({ erro: 'Erro ao carregar resumo da loja' });
    }

    const warnings = [];

    const [storeResult, carriersResult] = await Promise.allSettled([
        fetchJsonComTimeout(`${API_BASE}/${storeId}`, token),
        fetchJsonComTimeout(`${API_BASE}/${storeId}/shipping_carriers`, token),
    ]);

    let store = null;
    if (storeResult.status === 'fulfilled' && storeResult.value.ok && storeResult.value.body) {
        const b = storeResult.value.body;
        store = {
            name: parseNomeLoja(b.name),
            email: b.email || null,
            url: b.url || null,
        };
    } else {
        warnings.push('store_unavailable');
    }

    let carrier = null;
    if (carriersResult.status === 'fulfilled' && carriersResult.value.ok && Array.isArray(carriersResult.value.body)) {
        const lista = carriersResult.value.body;
        const encontrado = lista.find(c =>
            c?.name === CARRIER_NAME ||
            String(c?.callback_url || '').includes(CARRIER_CALLBACK_HINT)
        );

        if (encontrado) {
            let options = Array.isArray(encontrado.options) ? encontrado.options : null;

            if (!options) {
                const optResult = await fetchJsonComTimeout(
                    `${API_BASE}/${storeId}/shipping_carriers/${encontrado.id}/options`,
                    token
                );
                if (optResult.ok && Array.isArray(optResult.body)) {
                    options = optResult.body;
                } else {
                    warnings.push('carrier_options_unavailable');
                }
            }

            carrier = {
                registered: true,
                active: typeof encontrado.active === 'boolean' ? encontrado.active : null,
                upsOptions: contarOptionsPorPrefixo(options, 'UPS_'),
                fedexOptions: contarOptionsPorPrefixo(options, 'FEDEX_'),
            };
        } else {
            carrier = { registered: false, active: null, upsOptions: null, fedexOptions: null };
        }
    } else {
        warnings.push('carrier_unavailable');
    }

    return res.status(200).json({
        connected: true,
        storeId: String(storeId),
        store,
        carrier,
        warnings,
    });
};

module.exports = { verProdutosLojaNuvemshop, resolveLojaEToken, getResumoNuvemshop };
