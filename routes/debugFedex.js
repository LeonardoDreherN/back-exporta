// backend/routes/debugFedex.js
const router = require('express').Router();
const fedexCfg = require('../config/fedex');
const axios = require('axios');

router.get('/__fedex/oauth-test', async (_req, res) => {
    try {
        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: fedexCfg.clientId,
            client_secret: fedexCfg.clientSecret,
        });

        // [CHANGE] escopo opcional
        if (fedexCfg.scope && fedexCfg.scope.trim()) {
            body.append('scope', fedexCfg.scope.trim());
        }

        const r = await axios.post(fedexCfg.oauth, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: fedexCfg.timeoutMs,
            validateStatus: () => true,
        });

        if (r.status !== 200) {
            const data = r.data && typeof r.data === 'object' ? r.data : { raw: r.data };
            const firstErr = Array.isArray(data?.errors) ? data.errors[0] : null;
            return res.status(r.status).json({
                ok: false,
                status: r.status,
                base: fedexCfg.base,
                oauth: fedexCfg.oauth,
                scope: fedexCfg.scope || null,
                errorCode: firstErr?.code || data?.error || null,
                errorMsg: firstErr?.message || data?.error_description || null,
                data,
            });
        }

        res.json({
            ok: true,
            tokenPrefix: String(r.data?.access_token || '').slice(0, 12),
            expiresIn: r.data?.expires_in,
            base: fedexCfg.base,
            oauth: fedexCfg.oauth,
            scope: fedexCfg.scope || null,
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
