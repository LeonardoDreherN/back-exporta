const { Op } = require('sequelize');
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

// Monta {connected, storeId, store, carrier, warnings} pra uma loja já resolvida
// (usado tanto pelo endpoint autenticado quanto pela landing embedded, que resolve
// a loja direto pelo store_id da query string em vez de sessão de cliente)
async function buildResumoPorStoreId(storeId, token) {
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

    return {
        connected: true,
        storeId: String(storeId),
        store,
        carrier,
        warnings,
    };
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

    const resumo = await buildResumoPorStoreId(storeId, token);
    return res.status(200).json(resumo);
};

const ENTREGUE_STATUSES = ['ENTREGUE'];
const EM_ANDAMENTO_STATUSES = ['EM_TRANSITO', 'SAIU_PARA_ENTREGA', 'COLETADO'];

// Números de uso da Intrex (cotações/entregas) pra um cliente já resolvido
async function buildStatsPorCliente(clienteId) {
    const [totalCotacoes, entregues, emAndamento] = await Promise.all([
        db.Cotacao.count({ where: { cliente_id: clienteId } }),
        db.Cotacao.count({ where: { cliente_id: clienteId, status_norm: { [Op.in]: ENTREGUE_STATUSES } } }),
        db.Cotacao.count({ where: { cliente_id: clienteId, status_norm: { [Op.in]: EM_ANDAMENTO_STATUSES } } }),
    ]);
    return { totalCotacoes, entregues, emAndamento };
}

// GET /nuvemshop/resumo-embed?store_id=...
// Igual ao /nuvemshop/resumo, mas resolve a loja pelo store_id da query em vez de
// sessão de cliente — é o que a tela embutida no admin da Nuvemshop chama (ali não
// existe sessão da Intrex, só o handshake do Nexo, que já garante que quem está
// perguntando é o próprio admin da loja em questão).
const getResumoEmbedNuvemshop = async (req, res) => {
    const storeId = String(req.query.store_id || '').trim();
    if (!storeId) return res.status(400).json({ erro: 'store_id obrigatório' });

    try {
        const shopRow = await db.NuvemshopShop.findOne({
            where: { storeId },
            attributes: ['accessToken'],
            raw: true,
        });

        if (!shopRow?.accessToken) {
            return res.status(200).json({ connected: false });
        }

        const infoRow = await db.InfoNuvemshop.findOne({
            where: { storeId },
            attributes: ['id_cliente'],
            raw: true,
        });

        const [resumo, stats] = await Promise.all([
            buildResumoPorStoreId(storeId, shopRow.accessToken),
            infoRow?.id_cliente ? buildStatsPorCliente(infoRow.id_cliente) : Promise.resolve(null),
        ]);

        return res.status(200).json({ ...resumo, stats });
    } catch (e) {
        console.error('❌ getResumoEmbedNuvemshop:', e);
        return res.status(500).json({ erro: 'Erro ao carregar resumo da loja' });
    }
};

// ===== Regras de frete (grátis / % / valor fixo por transportadora) =====
// CRUD identificado por store_id (não por sessão de cliente): quem chama é o
// painel embutido no admin da Nuvemshop, que só tem o handshake do Nexo.

const TIPOS_DESCONTO_VALIDOS = ['gratis', 'percentual', 'fixo'];
const TRANSPORTADORAS_VALIDAS = ['UPS', 'FEDEX'];

async function resolveClienteIdPorStoreId(storeId) {
    const infoRow = await db.InfoNuvemshop.findOne({
        where: { storeId: String(storeId || '') },
        attributes: ['id_cliente'],
        raw: true,
    });
    return infoRow?.id_cliente || null;
}

function validarPayloadRegra(body) {
    const erros = [];
    if (!body.nome || !String(body.nome).trim()) erros.push('nome é obrigatório');
    if (!Number.isFinite(Number(body.valorMinimo)) || Number(body.valorMinimo) < 0) {
        erros.push('valorMinimo inválido');
    }
    if (!TIPOS_DESCONTO_VALIDOS.includes(body.tipoDesconto)) erros.push('tipoDesconto inválido');
    if (body.tipoDesconto && body.tipoDesconto !== 'gratis' && !Number.isFinite(Number(body.valorDesconto))) {
        erros.push('valorDesconto é obrigatório para esse tipo de desconto');
    }
    if (
        !Array.isArray(body.transportadoras) ||
        !body.transportadoras.length ||
        !body.transportadoras.every(t => TRANSPORTADORAS_VALIDAS.includes(t))
    ) {
        erros.push('transportadoras inválidas');
    }
    return erros;
}

// GET /nuvemshop/regras-frete?store_id=...
const listarRegrasFrete = async (req, res) => {
    try {
        const clienteId = await resolveClienteIdPorStoreId(req.query.store_id);
        if (!clienteId) return res.status(404).json({ erro: 'Loja não conectada' });
        const regras = await db.RegraFrete.findAll({
            where: { id_cliente: clienteId },
            order: [['prioridade', 'ASC'], ['createdAt', 'ASC']],
        });
        return res.json(regras);
    } catch (e) {
        console.error('❌ listarRegrasFrete:', e);
        return res.status(500).json({ erro: 'Erro ao listar regras de frete' });
    }
};

// POST /nuvemshop/regras-frete
const criarRegraFrete = async (req, res) => {
    try {
        const clienteId = await resolveClienteIdPorStoreId(req.body.store_id);
        if (!clienteId) return res.status(404).json({ erro: 'Loja não conectada' });

        const erros = validarPayloadRegra(req.body);
        if (erros.length) return res.status(400).json({ erro: erros.join(', ') });

        const regra = await db.RegraFrete.create({
            id_cliente: clienteId,
            nome: req.body.nome,
            ativa: req.body.ativa ?? true,
            valorMinimo: req.body.valorMinimo,
            transportadoras: req.body.transportadoras,
            tipoDesconto: req.body.tipoDesconto,
            valorDesconto: req.body.tipoDesconto === 'gratis' ? null : req.body.valorDesconto,
            prioridade: Number.isFinite(Number(req.body.prioridade)) ? Number(req.body.prioridade) : 0,
        });
        return res.status(201).json(regra);
    } catch (e) {
        console.error('❌ criarRegraFrete:', e);
        return res.status(500).json({ erro: 'Erro ao criar regra de frete' });
    }
};

// PUT /nuvemshop/regras-frete/:id
const atualizarRegraFrete = async (req, res) => {
    try {
        const clienteId = await resolveClienteIdPorStoreId(req.body.store_id);
        if (!clienteId) return res.status(404).json({ erro: 'Loja não conectada' });

        const erros = validarPayloadRegra(req.body);
        if (erros.length) return res.status(400).json({ erro: erros.join(', ') });

        const regra = await db.RegraFrete.findOne({
            where: { id: req.params.id, id_cliente: clienteId },
        });
        if (!regra) return res.status(404).json({ erro: 'Regra não encontrada' });

        await regra.update({
            nome: req.body.nome,
            ativa: req.body.ativa ?? regra.ativa,
            valorMinimo: req.body.valorMinimo,
            transportadoras: req.body.transportadoras,
            tipoDesconto: req.body.tipoDesconto,
            valorDesconto: req.body.tipoDesconto === 'gratis' ? null : req.body.valorDesconto,
            prioridade: Number.isFinite(Number(req.body.prioridade)) ? Number(req.body.prioridade) : regra.prioridade,
        });
        return res.json(regra);
    } catch (e) {
        console.error('❌ atualizarRegraFrete:', e);
        return res.status(500).json({ erro: 'Erro ao atualizar regra de frete' });
    }
};

// DELETE /nuvemshop/regras-frete/:id?store_id=...
const excluirRegraFrete = async (req, res) => {
    try {
        const clienteId = await resolveClienteIdPorStoreId(req.query.store_id);
        if (!clienteId) return res.status(404).json({ erro: 'Loja não conectada' });

        const apagou = await db.RegraFrete.destroy({
            where: { id: req.params.id, id_cliente: clienteId },
        });
        if (!apagou) return res.status(404).json({ erro: 'Regra não encontrada' });
        return res.json({ ok: true });
    } catch (e) {
        console.error('❌ excluirRegraFrete:', e);
        return res.status(500).json({ erro: 'Erro ao excluir regra de frete' });
    }
};

module.exports = {
    verProdutosLojaNuvemshop,
    resolveLojaEToken,
    getResumoNuvemshop,
    getResumoEmbedNuvemshop,
    buildResumoPorStoreId,
    listarRegrasFrete,
    criarRegraFrete,
    atualizarRegraFrete,
    excluirRegraFrete,
};
