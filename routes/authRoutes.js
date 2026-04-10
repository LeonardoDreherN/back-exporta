// exemplo em routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const ACCESS_TOKEN = 15 * 60;
const isProd = process.env.NODE_ENV === 'production';

const cookieBase = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
};

function refresh (req, res) {
    const rt = req.cookies?.refresh_token;
    if (!rt) return res.status(401).json({ erro: 'Sem refresh' });

    try {
        const data = jwt.verify(rt, process.env.JWT_REFRESH_SECRET);
        const access = jwt.sign({ sub: data.sub, scope: ['user'] }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN });
        res.cookie('access_token', access, { ...cookieBase, maxAge: ACCESS_TOKEN * 1000 });
        return res.json({ ok: true });
    } catch {
        return res.status(401).json({ erro: 'Refresh inválido' });
    }
};

function logout (req, res) {
  const clearBase = {
    path: '/',
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  };

  res.clearCookie('access_token', clearBase);
  res.clearCookie('refresh_token', clearBase);
  res.clearCookie('csrf_token', clearBase);
  res.clearCookie('token', clearBase);
  res.json({ ok: true });
};

module.exports = {refresh, logout};
