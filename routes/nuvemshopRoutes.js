const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../models');
const { autenticarUsuario, vincularCliente } = require('../middleware/auth');
const { verProdutosLojaNuvemshop } = require('../controller/NuvemshopController');
const upsRating = require('../services/ups/rating');
const normUps = require('../utils/normalize/upsRate');
const { quoteRates } = require('../services/fedex/ratingFedex');

const router = express.Router();

const API_BASE = 'https://api.nuvemshop.com.br/v1';
const USER_AGENT = 'Intrex (contato@exportadigital.com)';

const NS_ORIGIN = {
    postal_code: '88140570',
    province: 'SC',
    city: 'Santo Amaro da Imperatriz',
    country: 'BR',
    address1: 'Rua Saint German, 87',
    name: 'Exporta Digital BR',
    phone: '47992104226',
    company_name: 'Intrex Shipping',
};

const upsNameMap = {
    '01': 'UPS Express (1-3 dias úteis)',
    '07': 'UPS Express (2-4 dias úteis)',
    '08': 'UPS Expedited (4-7 dias úteis)',
    '65': 'UPS Saver (2-4 dias úteis)',
};

const fedexNameMap = {
    FEDEX_INTERNATIONAL_CONNECT_PLUS: 'FedEx Economy (3-7 dias úteis)',
    INTERNATIONAL_PRIORITY: 'FedEx Express (2-4 dias úteis)',
    INTERNATIONAL_ECONOMY: 'FedEx Economy (4-7 dias úteis)',
};

const upsDaysMap = { '01': 3, '07': 4, '08': 7, '65': 4 };
const fedexDaysMap = {
    FEDEX_INTERNATIONAL_CONNECT_PLUS: 7,
    INTERNATIONAL_PRIORITY: 4,
    INTERNATIONAL_ECONOMY: 7,
};

function toKg(grams) { return Number(grams || 0) / 1000; }

function normFedexState(state) {
    if (!state) return undefined;
    const raw = String(state).trim().toUpperCase();
    return raw.length <= 2 ? raw : undefined;
}

function buildNsPackages(items = []) {
    const valid = items.filter(i => !i?.free_shipping);
    if (!valid.length) return [{ weightKg: 1, dimCm: { length: 20, width: 15, height: 10 } }];
    return valid.map(item => ({
        weightKg: Math.max(0.1, toKg(item.grams || 500)),
        dimCm: {
            length: Number(item.dimensions?.depth || 20),
            width: Number(item.dimensions?.width || 15),
            height: Number(item.dimensions?.height || 10),
        },
    }));
}

function buildNsCommodities(items = [], currency = 'USD') {
    const valid = items.filter(i => !i?.free_shipping);
    if (!valid.length) return [{
        description: 'Merchandise', quantity: 1, quantityUnits: 'PCS',
        unitPrice: { amount: 1, currency }, customsValue: { amount: 1, currency },
        weight: { units: 'KG', value: 1 }, countryOfManufacture: 'BR',
    }];
    return valid.map(item => {
        const qty = Number(item.quantity || 1) || 1;
        const totalPrice = Number(item.price || 0) / 100 || 1;
        return {
            description: String(item.name || item.sku || 'Item').slice(0, 100),
            quantity: qty,
            quantityUnits: 'PCS',
            unitPrice: { amount: Number((totalPrice / qty).toFixed(2)), currency },
            customsValue: { amount: Number(totalPrice.toFixed(2)), currency },
            weight: { units: 'KG', value: Number(Math.max(0.1, toKg(item.grams || 500)).toFixed(3)) },
            countryOfManufacture: 'BR',
        };
    });
}

async function registrarCarrierOptions(storeId, accessToken, carrierId) {
    const options = [
        { code: 'UPS_01', name: 'UPS Express (1-3 dias úteis)' },
        { code: 'UPS_07', name: 'UPS Express (2-4 dias úteis)' },
        { code: 'UPS_08', name: 'UPS Expedited (4-7 dias úteis)' },
        { code: 'UPS_65', name: 'UPS Saver (2-4 dias úteis)' },
        { code: 'FEDEX_INTERNATIONAL_PRIORITY', name: 'FedEx Express (2-4 dias úteis)' },
        { code: 'FEDEX_INTERNATIONAL_ECONOMY', name: 'FedEx Economy (4-7 dias úteis)' },
        { code: 'FEDEX_FEDEX_INTERNATIONAL_CONNECT_PLUS', name: 'FedEx Connect+ (3-7 dias úteis)' },
    ];
    const results = [];
    for (const opt of options) {
        const url = `${API_BASE}/${storeId}/shipping_carriers/${carrierId}/options`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authentication': `bearer ${accessToken}`,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ...opt, additional_days: 0, additional_cost: 0, allow_free_shipping: false }),
        });
        const body = await resp.json().catch(() => ({}));
        results.push({ code: opt.code, status: resp.status, body });
    }
    return results;
}

async function registrarCarrierNuvemshop(storeId, accessToken, appUrl, path = '/nuvemshop/carrier') {
    const url = `${API_BASE}/${storeId}/shipping_carriers`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authentication': `bearer ${accessToken}`,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: 'Intrex Shipping',
            callback_url: `${appUrl}${path}`,
            types: 'ship',
        }),
    });
    const body = await resp.json().catch(() => ({}));
    return { status: resp.status, body };
}

const APP_ID = process.env.NUVEMSHOP_APP_ID || '';
const CLIENT_SECRET = process.env.NUVEMSHOP_CLIENT_SECRET || '';
const APP_URL = (process.env.NUVEMSHOP_APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
const FRONT_URL = (process.env.FRONT_URL || '').replace(/\/$/, '');

const NUVEMSHOP_AUTH_URL = `https://www.nuvemshop.com.br/apps/${APP_ID}/authorize`;
const NUVEMSHOP_TOKEN_URL = 'https://www.nuvemshop.com.br/apps/authorize/token';

// POST /nuvemshop/prepare-install
// Retorna authUrl para o frontend redirecionar o usuário ao OAuth da Nuvemshop
router.post('/prepare-install', autenticarUsuario, async (req, res) => {
    const clienteId = req.clienteId ?? req.usuario?.clienteId;
    if (!clienteId) return res.status(403).json({ erro: 'Cliente não identificado' });

    const bindToken = jwt.sign({ clienteId }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const authUrl = `${APP_URL}/nuvemshop/auth?bind_token=${encodeURIComponent(bindToken)}`;
    return res.json({ authUrl });
});

// GET /nuvemshop/auth
// Define cookie de vínculo e redireciona para Nuvemshop
router.get('/auth', async (req, res) => {
    const { bind_token } = req.query;

    if (bind_token) {
        try {
            const decoded = jwt.verify(String(bind_token), process.env.JWT_SECRET);
            if (decoded.clienteId) {
                res.cookie('ns_bind_cliente_id', String(decoded.clienteId), {
                    httpOnly: true,
                    sameSite: 'none',
                    secure: true,
                    path: '/nuvemshop',
                    maxAge: 10 * 60 * 1000,
                });
            }
        } catch {
            return res.status(400).send('bind_token inválido ou expirado');
        }
    }

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('ns_state', state, {
        httpOnly: true,
        sameSite: 'none',
        secure: true,
        path: '/nuvemshop',
        maxAge: 10 * 60 * 1000,
    });

    const url = new URL(NUVEMSHOP_AUTH_URL);
    url.searchParams.set('state', state);

    return res.redirect(url.toString());
});

// GET /nuvemshop/callback
// Nuvemshop redireciona aqui após o lojista autorizar o app
router.get('/callback', async (req, res) => {
    try {
        const { code, user_id, state } = req.query;

        if (!code) return res.status(400).send('Parâmetro ausente: code');

        if (state && req.cookies?.ns_state && req.cookies.ns_state !== state) {
            return res.status(401).send('State inválido');
        }
        res.clearCookie('ns_state', { path: '/nuvemshop' });

        const tokenResp = await fetch(NUVEMSHOP_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: APP_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
            }),
        });

        const tokenBody = await tokenResp.json().catch(() => ({}));

        console.log('[NS CALLBACK] tokenBody:', tokenBody);

        if (!tokenResp.ok || !tokenBody?.access_token) {
            console.error('[NS CALLBACK] Falha ao obter token:', tokenResp.status, tokenBody);
            return res.status(502).send('Falha ao obter token da Nuvemshop');
        }

        // Nuvemshop retorna user_id no corpo do token, não na URL
        const storeId = String(user_id || tokenBody.user_id || tokenBody.store_id || '');

        await db.NuvemshopShop.upsert({
            storeId,
            accessToken: tokenBody.access_token,
            scope: tokenBody.scope || null,
        });

        const bindClienteId = req.cookies?.ns_bind_cliente_id;
        if (bindClienteId) {
            await db.InfoNuvemshop.upsert({ id_cliente: bindClienteId, storeId });
            res.clearCookie('ns_bind_cliente_id', { path: '/nuvemshop' });
        }

        // Registra carrier + options automaticamente após OAuth
        try {
            const { status: cs, body: cb } = await registrarCarrierNuvemshop(storeId, tokenBody.access_token, APP_URL, '/nuvemshop/frete');
            console.log('[NS CARRIER REGISTER]', cs, cb);
            if (cs === 201 && cb?.id) {
                const optResults = await registrarCarrierOptions(storeId, tokenBody.access_token, cb.id);
                console.log('[NS CARRIER OPTIONS]', optResults);
            }
        } catch (e) {
            console.error('[NS CARRIER REGISTER ERROR]', e.message);
        }

        return res.redirect(`${FRONT_URL}/nuvemshop-conectado?store_id=${storeId}`);
    } catch (e) {
        console.error('[NS CALLBACK] erro:', e);
        return res.status(500).send('Erro no OAuth Nuvemshop');
    }
});

// GET /nuvemshop/conexao
router.get('/conexao', autenticarUsuario, async (req, res) => {
    try {
        const clienteId = req.clienteId ?? res.locals?.clienteId;
        if (!clienteId) return res.json({ connected: false });

        const info = await db.InfoNuvemshop.findOne({
            where: { id_cliente: clienteId },
            attributes: ['storeId'],
            order: [['updatedAt', 'DESC']],
            raw: true,
        });

        if (!info?.storeId) return res.json({ connected: false });

        const shopRow = await db.NuvemshopShop.findOne({
            where: { storeId: info.storeId },
            attributes: ['accessToken'],
            raw: true,
        });

        return res.json({ connected: !!shopRow?.accessToken, storeId: info.storeId });
    } catch (e) {
        console.error('[NS /conexao] erro:', e);
        return res.status(500).json({ erro: 'Falha ao verificar conexão' });
    }
});

// GET /nuvemshop/produtos
router.get('/produtos', autenticarUsuario, vincularCliente, verProdutosLojaNuvemshop);

// POST /nuvemshop/carrier e /nuvemshop/frete (alias para resetar circuit breaker)
// Nuvemshop chama aqui para cotação de frete no checkout
async function handleCarrier(req, res) {
    try {
        console.log('[NS CARRIER] body:', JSON.stringify(req.body, null, 2));

        const { destination: destRaw, items = [], currency = 'BRL' } = req.body;
        // Nuvemshop envia zipcode (não postal_code) e street (não address)
        const destination = destRaw ? {
            ...destRaw,
            postal_code: destRaw.zipcode || destRaw.postal_code,
            address: destRaw.street || destRaw.address,
            province: destRaw.province || destRaw.state,
        } : null;

        if (!destination) return res.status(200).json({ rates: [] });

        const origin = NS_ORIGIN;
        const packages = buildNsPackages(items);
        const commodities = buildNsCommodities(items, 'USD');
        const shipperNumber = process.env.UPS_ACCOUNT_NUMBER || undefined;

        const upsPkgs = packages.map(p => ({
            PackagingType: { Code: '02' },
            PackageWeight: {
                UnitOfMeasurement: { Code: 'KGS' },
                Weight: String(Math.max(0.5, Number((p.weightKg || 1).toFixed(2)))),
            },
            Dimensions: {
                UnitOfMeasurement: { Code: 'CM' },
                Height: String(Math.round(p.dimCm?.height || 10)),
                Width: String(Math.round(p.dimCm?.width || 15)),
                Length: String(Math.round(p.dimCm?.length || 20)),
            },
        }));

        const upsPayload = {
            RateRequest: {
                Request: {
                    RequestOption: 'Rate',
                    TransactionReference: { CustomerContext: 'nuvemshop-carrier' },
                },
                Shipment: {
                    Service: { Code: '08' },
                    Shipper: {
                        ...(shipperNumber ? { ShipperNumber: shipperNumber } : {}),
                        Address: {
                            PostalCode: origin.postal_code,
                            CountryCode: origin.country,
                            StateProvinceCode: origin.province || undefined,
                            City: origin.city || undefined,
                            AddressLine: origin.address1 ? [origin.address1] : undefined,
                        },
                    },
                    ShipTo: {
                        Address: {
                            PostalCode: destination.postal_code,
                            CountryCode: destination.country,
                            StateProvinceCode: destination.province || undefined,
                            City: destination.city || undefined,
                            AddressLine: destination.address ? [destination.address] : undefined,
                        },
                    },
                    ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
                    Package: upsPkgs,
                },
            },
        };

        const fedexPayload = {
            shipper: {
                contact: {
                    personName: origin.name,
                    companyName: origin.company_name,
                    phoneNumber: origin.phone,
                },
                address: {
                    postalCode: origin.postal_code,
                    countryCode: origin.country,
                    city: origin.city,
                    stateOrProvinceCode: normFedexState(origin.province),
                    streetLines: [origin.address1],
                },
            },
            recipient: {
                contact: {
                    personName: destination.name || 'Recipient',
                    companyName: destination.name || 'Recipient',
                    phoneNumber: destination.phone || '11999999999',
                },
                address: {
                    postalCode: destination.postal_code,
                    countryCode: destination.country,
                    city: destination.city,
                    stateOrProvinceCode: normFedexState(destination.province),
                    streetLines: [destination.address || 'Address'],
                    residential: false,
                },
            },
            packages,
            commodities,
            currency: 'USD',
        };

        const [upsResult, fedexResult] = await Promise.allSettled([
            upsRating.quote(upsPayload),
            quoteRates(fedexPayload),
        ]);

        const rates = [];

        if (upsResult.status === 'fulfilled') {
            const upsQuotes = normUps({ raw: upsResult.value });
            upsQuotes.forEach(q => {
                if (!q?.total) return;
                const code = String(q.serviceCode || '').trim();
                rates.push({
                    name: upsNameMap[code] || `UPS ${q.serviceLabel || 'International'}`,
                    code: `UPS_${code || 'STD'}`,
                    price: String(Math.round(Number(q.total) * 100)),
                    currency: q.currency || 'USD',
                    type: 'ship',
                    min_delivery_date: null,
                    max_delivery_date: null,
                    phone_required: false,
                    accepts_cod: false,
                    availability: 'all',
                    days: upsDaysMap[code] || 7,
                    reference: '',
                });
            });
        } else {
            console.error('[NS CARRIER][UPS ERROR]', upsResult.reason?.message);
        }

        if (fedexResult.status === 'fulfilled') {
            const fedexQuotes = fedexResult.value?.rows || [];
            fedexQuotes.forEach(q => {
                if (!q?.total) return;
                const type = String(q.serviceType || '').trim();
                rates.push({
                    name: fedexNameMap[type] || 'FedEx International Shipping',
                    code: `FEDEX_${type.replace(/\s+/g, '_') || 'STD'}`,
                    price: String(Math.round(Number(q.total) * 100)),
                    currency: q.currency || 'USD',
                    type: 'ship',
                    min_delivery_date: null,
                    max_delivery_date: null,
                    phone_required: false,
                    accepts_cod: false,
                    availability: 'all',
                    days: fedexDaysMap[type] || 7,
                    reference: '',
                });
            });
        } else {
            console.error('[NS CARRIER][FEDEX ERROR]', fedexResult.reason?.message);
        }

        if (!rates.length) {
            rates.push({
                name: 'Intrex International Shipping',
                code: 'INTREX_FALLBACK',
                price: '2500',
                currency: 'USD',
                type: 'ship',
                min_delivery_date: null,
                max_delivery_date: null,
                phone_required: false,
                accepts_cod: false,
                availability: 'all',
                days: 10,
                reference: '',
            });
        }

        console.log('[NS CARRIER] rates:', JSON.stringify(rates, null, 2));
        return res.json({ rates });
    } catch (err) {
        console.error('[NS CARRIER ERROR]', err);
        return res.status(200).json({ rates: [] });
    }
}

router.post('/carrier', handleCarrier);
router.post('/frete', handleCarrier);

// GET /nuvemshop/listar-carriers
router.get('/listar-carriers', autenticarUsuario, vincularCliente, async (req, res) => {
    try {
        const clienteId = req.clienteId ?? req.usuario?.clienteId;
        const infoRow = await db.InfoNuvemshop.findOne({ where: { id_cliente: clienteId }, attributes: ['storeId'], raw: true });
        if (!infoRow) return res.status(404).json({ erro: 'Loja não conectada' });
        const shopRow = await db.NuvemshopShop.findOne({ where: { storeId: String(infoRow.storeId) }, attributes: ['accessToken'], raw: true });
        if (!shopRow?.accessToken) return res.status(404).json({ erro: 'Token não encontrado' });
        const resp = await fetch(`${API_BASE}/${infoRow.storeId}/shipping_carriers`, {
            headers: { 'Authentication': `bearer ${shopRow.accessToken}`, 'User-Agent': USER_AGENT },
        });
        const body = await resp.json().catch(() => ({}));
        return res.json({ status: resp.status, carriers: body });
    } catch (e) {
        return res.status(500).json({ erro: e.message });
    }
});

// DELETE /nuvemshop/deletar-carrier/:id
router.delete('/deletar-carrier/:id', autenticarUsuario, vincularCliente, async (req, res) => {
    try {
        const clienteId = req.clienteId ?? req.usuario?.clienteId;
        const infoRow = await db.InfoNuvemshop.findOne({ where: { id_cliente: clienteId }, attributes: ['storeId'], raw: true });
        if (!infoRow) return res.status(404).json({ erro: 'Loja não conectada' });
        const shopRow = await db.NuvemshopShop.findOne({ where: { storeId: String(infoRow.storeId) }, attributes: ['accessToken'], raw: true });
        if (!shopRow) return res.status(404).json({ erro: 'Token não encontrado' });
        const resp = await fetch(`${API_BASE}/${infoRow.storeId}/shipping_carriers/${req.params.id}`, {
            method: 'DELETE',
            headers: { 'Authentication': `bearer ${shopRow.accessToken}`, 'User-Agent': USER_AGENT },
        });
        return res.json({ status: resp.status });
    } catch (e) {
        return res.status(500).json({ erro: e.message });
    }
});

// POST /nuvemshop/registrar-carrier
// Registra manualmente o carrier service na loja Nuvemshop do cliente logado
router.post('/registrar-carrier', autenticarUsuario, vincularCliente, async (req, res) => {
    try {
        const clienteId = req.clienteId ?? req.usuario?.clienteId;
        if (!clienteId) return res.status(403).json({ erro: 'Cliente não identificado' });

        const infoRow = await db.InfoNuvemshop.findOne({
            where: { id_cliente: clienteId },
            attributes: ['storeId'],
            raw: true,
        });
        if (!infoRow) return res.status(404).json({ erro: 'Loja Nuvemshop não conectada' });

        const shopRow = await db.NuvemshopShop.findOne({
            where: { storeId: String(infoRow.storeId) },
            attributes: ['accessToken'],
            raw: true,
        });
        if (!shopRow?.accessToken) return res.status(404).json({ erro: 'Token não encontrado. Reconecte a loja.' });

        const { status, body } = await registrarCarrierNuvemshop(infoRow.storeId, shopRow.accessToken, APP_URL, '/nuvemshop/frete');
        let options = [];
        if (status === 201 && body?.id) {
            options = await registrarCarrierOptions(infoRow.storeId, shopRow.accessToken, body.id);
            console.log('[NS CARRIER OPTIONS]', options);
        }
        return res.status(status < 500 ? 200 : 502).json({ status, body, options });
    } catch (e) {
        console.error('[NS REGISTRAR CARRIER]', e);
        return res.status(500).json({ erro: 'Erro ao registrar carrier', detalhes: e.message });
    }
});

// LGPD — obrigatório pela Nuvemshop
router.post('/webhooks/store-redact', (req, res) => {
    console.log('[NS LGPD] store-redact:', req.body);
    res.status(200).json({ ok: true });
});

router.post('/webhooks/customers-redact', (req, res) => {
    console.log('[NS LGPD] customers-redact:', req.body);
    res.status(200).json({ ok: true });
});

router.post('/webhooks/customers-data-request', (req, res) => {
    console.log('[NS LGPD] customers-data-request:', req.body);
    res.status(200).json({ ok: true });
});

module.exports = router;
