module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return res.status(200).json({ ok: true, message: 'API on Vercel (multi-tenant ready)' });
};
