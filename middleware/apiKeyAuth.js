const VALID_KEYS = new Set(
    (process.env.PUBLIC_QUOTE_API_KEYS || '')
        .split(',')
        .map(k => k.trim())
        .filter(Boolean)
);

function apiKeyAuth(req, res, next) {
    const key = (req.headers['x-api-key'] || req.query.api_key || '').trim();
    if (!key || !VALID_KEYS.has(key)) {
        return res.status(401).json({ ok: false, error: 'API key inválida ou ausente' });
    }
    next();
}

module.exports = { apiKeyAuth };
