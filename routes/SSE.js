const express = require('express');
const router = express.Router();
const clients = new Set();

router.get('/status', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    clients.add(res);
    req.on('close', () => clients.delete(res));
});

function broadcastStatusUpdate(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) res.write(data);
}

module.exports = { router, broadcastStatusUpdate };
