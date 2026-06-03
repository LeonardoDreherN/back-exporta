const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../models');
const { autenticarUsuario, vincularCliente } = require('../middleware/auth');
const { verProdutosLojaNuvemshop } = require('../controller/NuvemshopController');

const router = express.Router();

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
